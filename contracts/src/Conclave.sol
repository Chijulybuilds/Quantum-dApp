// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ShortString, ShortStrings} from "@openzeppelin/contracts/utils/ShortStrings.sol";

import {IConclave} from "./interfaces/IConclave.sol";
import {ConclaveMessages} from "./libraries/ConclaveMessages.sol";
import {QorePQC} from "./libraries/QorePQC.sol";

/// @title Conclave
/// @notice A DAO treasury that only moves on post-quantum votes.
///
/// @dev Security model ("Q-Day model"): assume an attacker has recovered the classical ECDSA key of
///      every member, of the guardian and of every relayer. On QoreChain that key alone cannot open an
///      EVM window, but it can use any window that is already open. So in this contract:
///
///        - `msg.sender` carries no authority, with one exception: the guardian may `pause()` once.
///        - Proposing, voting and cancelling need an ML-DSA-87 signature, checked by the `pqcVerify`
///          precompile against the key the signer registered on chain (`pqcKeyStatus`).
///        - Moving funds, changing members, the threshold or the guardian, and unpausing all happen
///          only through an executed proposal: a quorum of post-quantum votes plus a timelock.
///        - Executing a passed proposal is permissionless: its content is fixed by `proposalHash`.
///
///      The worst a classical-only attacker can do is one temporary pause (`pauseDuration`, shorter
///      than `gracePeriod`, so queued proposals survive it), and only with the guardian's key.
contract Conclave is IConclave, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------------------------------
    // Constants
    // ---------------------------------------------------------------------------------------------

    uint256 public constant MAX_MEMBERS = 64;
    uint256 public constant MAX_ACTIONS = 16;

    uint64 public constant MIN_VOTING_PERIOD = 5 minutes;
    uint64 public constant MAX_VOTING_PERIOD = 30 days;
    uint64 public constant MIN_TIMELOCK_DELAY = 1 minutes;
    uint64 public constant MAX_TIMELOCK_DELAY = 30 days;
    uint64 public constant MIN_GRACE_PERIOD = 1 hours;
    uint64 public constant MAX_GRACE_PERIOD = 90 days;
    uint64 public constant MIN_PAUSE_DURATION = 10 minutes;
    uint64 public constant MAX_PAUSE_DURATION = 14 days;

    // ---------------------------------------------------------------------------------------------
    // Immutable configuration
    // ---------------------------------------------------------------------------------------------

    uint64 public immutable votingPeriod;
    uint64 public immutable timelockDelay;
    uint64 public immutable gracePeriod;
    uint64 public immutable pauseDuration;
    /// @dev Native chain id QoreX puts in the signed message, e.g. `qorechain-diana`.
    ShortString private immutable _nativeChainId;

    // ---------------------------------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------------------------------

    /// @notice Classical key allowed to pause once. Cannot move funds or unpause.
    address public guardian;
    /// @notice Whether the guardian may still pause. A pause uses it up; governance re-arms it.
    bool public guardianArmed;
    /// @notice Paused while `block.timestamp < pausedUntil`.
    uint64 public pausedUntil;

    /// @notice FOR votes a proposal needs. Always a strict majority of the members.
    uint16 public threshold;
    /// @notice Advances on every member or threshold change; older proposals become Stale.
    uint32 public epoch;
    uint64 public proposalCount;

    address[] private _members;
    /// @dev Index in `_members` plus one; zero for non-members.
    mapping(address => uint256) private _memberPosition;
    /// @notice Next nonce a member's `propose` signature must use.
    mapping(address => uint256) public proposeNonce;
    mapping(uint256 => Proposal) private _proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    // ---------------------------------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------------------------------

    /// @param initialMembers Founding members. Each must already have an ML-DSA-87 key registered.
    /// @param initialThreshold FOR votes needed; must be a strict majority of `initialMembers`.
    /// @param initialGuardian Account allowed to pause once, or zero for none.
    /// @param timing Voting period, timelock, grace period and pause duration (seconds).
    /// @param nativeChainId_ Native chain id QoreX signs with, e.g. `qorechain-diana`.
    constructor(
        address[] memory initialMembers,
        uint16 initialThreshold,
        address initialGuardian,
        Timing memory timing,
        string memory nativeChainId_
    ) {
        if (
            timing.votingPeriod < MIN_VOTING_PERIOD || timing.votingPeriod > MAX_VOTING_PERIOD
                || timing.timelockDelay < MIN_TIMELOCK_DELAY || timing.timelockDelay > MAX_TIMELOCK_DELAY
                || timing.gracePeriod < MIN_GRACE_PERIOD || timing.gracePeriod > MAX_GRACE_PERIOD
                || timing.pauseDuration < MIN_PAUSE_DURATION || timing.pauseDuration > MAX_PAUSE_DURATION
                || timing.gracePeriod <= timing.pauseDuration
        ) revert InvalidTiming();
        votingPeriod = timing.votingPeriod;
        timelockDelay = timing.timelockDelay;
        gracePeriod = timing.gracePeriod;
        pauseDuration = timing.pauseDuration;
        _nativeChainId = _toNativeChainId(nativeChainId_);

        uint256 count = initialMembers.length;
        if (count == 0 || count > MAX_MEMBERS) revert InvalidMemberCount(count);
        for (uint256 i; i < count; ++i) {
            _addMember(initialMembers[i]);
        }
        threshold = initialThreshold;
        emit ThresholdChanged(initialThreshold);
        _checkConfig();

        if (initialGuardian != address(0)) {
            guardian = initialGuardian;
            guardianArmed = true;
            emit GuardianChanged(initialGuardian);
        }
    }

    /// @notice Accepts native QOR into the treasury.
    receive() external payable {
        emit Deposited(msg.sender, msg.value);
    }

    // ---------------------------------------------------------------------------------------------
    // Post-quantum authorised actions. Anyone may relay them: the signature carries the authority.
    // ---------------------------------------------------------------------------------------------

    /// @notice Submits a proposal signed by `proposer` with ML-DSA-87.
    /// @dev The signed message is {proposeMessage}; `deadline` bounds how long the signature is usable.
    function propose(
        address proposer,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        string calldata description,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant returns (uint256 proposalId) {
        if (!isMember(proposer)) revert NotMember(proposer);
        if (block.timestamp > deadline) revert SignatureExpired(deadline);
        _validateActions(targets, values, calldatas);

        bytes32 proposalHash = hashProposal(targets, values, calldatas, keccak256(bytes(description)));
        uint256 nonce = proposeNonce[proposer];
        _verify(proposer, ConclaveMessages.propose(address(this), proposer, nonce, deadline, proposalHash), signature);
        proposeNonce[proposer] = nonce + 1;

        proposalId = ++proposalCount;
        uint64 voteEnd = uint64(block.timestamp) + votingPeriod;
        _proposals[proposalId] = Proposal({
            proposalHash: proposalHash,
            proposer: proposer,
            voteEnd: voteEnd,
            epoch: epoch,
            eta: 0,
            forVotes: 0,
            againstVotes: 0,
            executed: false,
            canceled: false
        });
        emit ProposalCreated(
            proposalId, proposer, proposalHash, targets, values, calldatas, description, voteEnd, epoch
        );
    }

    /// @notice Records `voter`'s ML-DSA-87 signed vote. Reaching the threshold queues the proposal.
    function castVote(uint256 proposalId, address voter, bool support, bytes calldata signature) external nonReentrant {
        _requireState(proposalId, ProposalState.Active);
        _castVote(proposalId, voter, support, signature);
    }

    /// @notice Records several signed votes in one transaction.
    /// @dev Votes already counted (e.g. relayed by someone else first) are skipped, so a front-runner
    ///      cannot make the batch fail. Stops once the proposal leaves the Active state.
    function castVotes(
        uint256 proposalId,
        address[] calldata voters,
        bool[] calldata choices,
        bytes[] calldata signatures
    ) external nonReentrant returns (uint256 counted) {
        uint256 count = voters.length;
        if (count == 0 || choices.length != count || signatures.length != count) revert LengthMismatch();
        _requireState(proposalId, ProposalState.Active);

        for (uint256 i; i < count; ++i) {
            if (hasVoted[proposalId][voters[i]]) continue;
            _castVote(proposalId, voters[i], choices[i], signatures[i]);
            ++counted;
            if (state(proposalId) != ProposalState.Active) break;
        }
    }

    /// @notice Cancels a proposal that has not been executed, with the proposer's ML-DSA-87 signature.
    function cancel(uint256 proposalId, bytes calldata signature) external nonReentrant {
        ProposalState current = state(proposalId);
        if (current != ProposalState.Active && current != ProposalState.Queued && current != ProposalState.Ready) {
            revert UnexpectedState(proposalId, current);
        }
        Proposal storage p = _proposals[proposalId];
        address proposer = p.proposer;
        _verify(proposer, ConclaveMessages.cancel(address(this), proposer, proposalId, p.proposalHash), signature);
        p.canceled = true;
        emit ProposalCanceled(proposalId);
    }

    // ---------------------------------------------------------------------------------------------
    // Permissionless execution
    // ---------------------------------------------------------------------------------------------

    /// @notice Executes a passed proposal after its timelock. Anyone may call it.
    /// @dev While paused only governance actions on this contract are allowed (to unpause, rotate the
    ///      guardian or change members), never payouts. All actions succeed or the whole call reverts.
    function execute(
        uint256 proposalId,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bytes32 descriptionHash
    ) external nonReentrant {
        _requireState(proposalId, ProposalState.Ready);
        Proposal storage p = _proposals[proposalId];
        if (hashProposal(targets, values, calldatas, descriptionHash) != p.proposalHash) {
            revert ProposalHashMismatch();
        }

        uint256 count = targets.length;
        if (isPaused()) {
            for (uint256 i; i < count; ++i) {
                if (!_isGovernanceAction(targets[i], values[i], calldatas[i])) revert BlockedWhilePaused(i);
            }
        }

        p.executed = true;
        uint32 epochBefore = epoch;
        for (uint256 i; i < count; ++i) {
            _call(targets[i], values[i], calldatas[i], i);
        }
        // Member and threshold changes are validated once, after all actions, so their order does not matter.
        if (epoch != epochBefore) _checkConfig();
        emit ProposalExecuted(proposalId);
    }

    // ---------------------------------------------------------------------------------------------
    // Classical circuit breaker
    // ---------------------------------------------------------------------------------------------

    /// @notice Pauses payouts for `pauseDuration`. Usable once until governance re-arms the guardian.
    /// @dev The only action a classical key can take. It cannot move funds or unpause, and since
    ///      `pauseDuration < gracePeriod` a queued proposal can still be executed after the pause.
    function pause() external nonReentrant {
        if (msg.sender != guardian) revert NotGuardian();
        if (!guardianArmed) revert GuardianDisarmed();
        guardianArmed = false;
        uint64 until = uint64(block.timestamp) + pauseDuration;
        pausedUntil = until;
        emit Paused(msg.sender, until);
    }

    // ---------------------------------------------------------------------------------------------
    // Governance: only callable by this contract, through an executed proposal
    // ---------------------------------------------------------------------------------------------

    /// @notice Adds a member. The account must have an ML-DSA-87 key registered on chain.
    function addMember(address account) external onlySelf {
        _addMember(account);
        _advanceEpoch();
    }

    /// @notice Removes a member.
    function removeMember(address account) external onlySelf {
        uint256 position = _memberPosition[account];
        if (position == 0) revert NotMember(account);
        uint256 last = _members.length;
        if (position != last) {
            address moved = _members[last - 1];
            _members[position - 1] = moved;
            _memberPosition[moved] = position;
        }
        _members.pop();
        delete _memberPosition[account];
        emit MemberRemoved(account);
        _advanceEpoch();
    }

    /// @notice Changes the number of FOR votes a proposal needs.
    function setThreshold(uint16 newThreshold) external onlySelf {
        threshold = newThreshold;
        emit ThresholdChanged(newThreshold);
        _advanceEpoch();
    }

    /// @notice Sets (and arms) the guardian, or removes it with the zero address.
    function setGuardian(address newGuardian) external onlySelf {
        guardian = newGuardian;
        guardianArmed = newGuardian != address(0);
        emit GuardianChanged(newGuardian);
    }

    /// @notice Ends a pause early.
    function unpause() external onlySelf {
        pausedUntil = 0;
        emit Unpaused();
    }

    /// @notice Pays out an ERC-20 token held by the treasury (reverts on a failed transfer).
    function payERC20(IERC20 token, address to, uint256 amount) external onlySelf {
        if (to == address(0)) revert ZeroAddress();
        token.safeTransfer(to, amount);
        emit TokenPaid(token, to, amount);
    }

    // ---------------------------------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------------------------------

    /// @notice Current state of a proposal.
    function state(uint256 proposalId) public view returns (ProposalState) {
        if (proposalId == 0 || proposalId > proposalCount) return ProposalState.Unknown;
        Proposal storage p = _proposals[proposalId];
        if (p.executed) return ProposalState.Executed;
        if (p.canceled) return ProposalState.Canceled;
        if (p.epoch != epoch) return ProposalState.Stale;

        uint64 eta = p.eta;
        if (eta == 0) {
            if (block.timestamp > p.voteEnd) return ProposalState.Defeated;
            // Once more members voted against than may stay away, the threshold is out of reach.
            uint256 memberTotal = _members.length;
            uint256 needed = threshold;
            if (needed > memberTotal || p.againstVotes > memberTotal - needed) return ProposalState.Defeated;
            return ProposalState.Active;
        }
        if (block.timestamp < eta) return ProposalState.Queued;
        if (block.timestamp > uint256(eta) + gracePeriod) return ProposalState.Expired;
        return ProposalState.Ready;
    }

    function getProposal(uint256 proposalId) external view returns (Proposal memory) {
        return _proposals[proposalId];
    }

    function isMember(address account) public view returns (bool) {
        return _memberPosition[account] != 0;
    }

    function members() external view returns (address[] memory) {
        return _members;
    }

    function memberCount() external view returns (uint256) {
        return _members.length;
    }

    function isPaused() public view returns (bool) {
        return block.timestamp < pausedUntil;
    }

    /// @notice Native chain id the signed messages are bound to (e.g. `qorechain-diana`).
    function nativeChainId() public view returns (string memory) {
        return ShortStrings.toString(_nativeChainId);
    }

    /// @notice Commitment to a proposal's exact content.
    function hashProposal(
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bytes32 descriptionHash
    ) public pure returns (bytes32) {
        return keccak256(abi.encode(targets, values, calldatas, descriptionHash));
    }

    /// @notice Message `member` must sign (QoreX `signArbitrary`) to propose `proposalHash`.
    function proposeMessage(address member, bytes32 proposalHash, uint256 deadline)
        external
        view
        returns (string memory)
    {
        return string(ConclaveMessages.propose(address(this), member, proposeNonce[member], deadline, proposalHash));
    }

    /// @notice Message `member` must sign to vote on `proposalId`.
    function voteMessage(uint256 proposalId, address member, bool support) external view returns (string memory) {
        bytes32 proposalHash = _existingProposal(proposalId).proposalHash;
        return string(ConclaveMessages.vote(address(this), member, proposalId, proposalHash, support));
    }

    /// @notice Message the proposer must sign to cancel `proposalId`.
    function cancelMessage(uint256 proposalId) external view returns (string memory) {
        Proposal storage p = _existingProposal(proposalId);
        return string(ConclaveMessages.cancel(address(this), p.proposer, proposalId, p.proposalHash));
    }

    /// @notice The exact bytes the ML-DSA-87 key signs for `message` (QoreSign `messagePqSignBytes`).
    function signingBytes(string calldata message) external view returns (bytes memory) {
        return ConclaveMessages.signingBytes(nativeChainId(), bytes(message));
    }

    // ---------------------------------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------------------------------

    function _castVote(uint256 proposalId, address voter, bool support, bytes calldata signature) private {
        if (!isMember(voter)) revert NotMember(voter);
        if (hasVoted[proposalId][voter]) revert AlreadyVoted(proposalId, voter);
        Proposal storage p = _proposals[proposalId];
        _verify(voter, ConclaveMessages.vote(address(this), voter, proposalId, p.proposalHash, support), signature);
        hasVoted[proposalId][voter] = true;

        uint16 forVotes = p.forVotes;
        uint16 againstVotes = p.againstVotes;
        if (support) {
            p.forVotes = ++forVotes;
        } else {
            p.againstVotes = ++againstVotes;
        }
        emit VoteCast(proposalId, voter, support, forVotes, againstVotes);

        if (support && forVotes >= threshold) {
            uint64 eta = uint64(block.timestamp) + timelockDelay;
            p.eta = eta;
            emit ProposalQueued(proposalId, eta);
        }
    }

    function _verify(address signer, bytes memory message, bytes calldata signature) private view {
        QorePQC.verify(signer, ConclaveMessages.signingBytes(nativeChainId(), message), signature);
    }

    function _call(address target, uint256 value, bytes calldata data, uint256 index) private {
        // Calldata sent to an account without code would "succeed" and do nothing.
        if (data.length != 0 && target.code.length == 0) revert TargetNotContract(index);
        bool ok;
        assembly ("memory-safe") {
            let ptr := mload(0x40)
            calldatacopy(ptr, data.offset, data.length)
            // Return data is not copied on success, so a target cannot inflate the caller's memory cost.
            ok := call(gas(), target, value, ptr, data.length, 0, 0)
            if iszero(ok) {
                let size := returndatasize()
                if size {
                    returndatacopy(ptr, 0, size)
                    revert(ptr, size)
                }
            }
        }
        if (!ok) revert CallFailed(index);
    }

    function _addMember(address account) private {
        if (account == address(0)) revert ZeroAddress();
        if (_memberPosition[account] != 0) revert AlreadyMember(account);
        if (_members.length >= MAX_MEMBERS) revert InvalidMemberCount(_members.length + 1);
        // Reverts unless the account has an ML-DSA-87 key on chain: a member who cannot sign could
        // otherwise make the threshold unreachable.
        QorePQC.keyOf(account);
        _members.push(account);
        _memberPosition[account] = _members.length;
        emit MemberAdded(account);
    }

    function _advanceEpoch() private {
        uint32 next = epoch + 1;
        epoch = next;
        emit EpochAdvanced(next);
    }

    /// @dev At least one member and a threshold that is a strict majority of them.
    function _checkConfig() private view {
        uint256 memberTotal = _members.length;
        uint256 needed = threshold;
        if (memberTotal == 0) revert InvalidMemberCount(0);
        if (needed == 0 || needed > memberTotal || needed * 2 <= memberTotal) {
            revert InvalidThreshold(needed, memberTotal);
        }
    }

    function _validateActions(address[] calldata targets, uint256[] calldata values, bytes[] calldata calldatas)
        private
        pure
    {
        uint256 count = targets.length;
        if (count == 0 || count > MAX_ACTIONS || values.length != count || calldatas.length != count) {
            revert InvalidActions();
        }
        for (uint256 i; i < count; ++i) {
            if (targets[i] == address(0)) revert InvalidActions();
        }
    }

    /// @dev Actions allowed while paused: governance calls on this contract, without value.
    function _isGovernanceAction(address target, uint256 value, bytes calldata data) private view returns (bool) {
        if (target != address(this) || value != 0 || data.length < 4) return false;
        bytes4 selector = bytes4(data[:4]);
        return selector == this.unpause.selector || selector == this.setGuardian.selector
            || selector == this.addMember.selector || selector == this.removeMember.selector
            || selector == this.setThreshold.selector;
    }

    function _requireState(uint256 proposalId, ProposalState expected) private view {
        ProposalState current = state(proposalId);
        if (current != expected) revert UnexpectedState(proposalId, current);
    }

    function _existingProposal(uint256 proposalId) private view returns (Proposal storage p) {
        if (proposalId == 0 || proposalId > proposalCount) revert UnexpectedState(proposalId, ProposalState.Unknown);
        return _proposals[proposalId];
    }

    /// @dev Same rule as QoreSign's chain id check (`^[A-Za-z0-9._-]+$`), so `|` cannot appear in it.
    function _toNativeChainId(string memory id) private pure returns (ShortString) {
        bytes memory raw = bytes(id);
        uint256 length = raw.length;
        if (length == 0 || length > 31) revert InvalidChainId();
        for (uint256 i; i < length; ++i) {
            bytes1 c = raw[i];
            bool ok = (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c == "." || c == "_"
                || c == "-";
            if (!ok) revert InvalidChainId();
        }
        return ShortStrings.toShortString(id);
    }
}
