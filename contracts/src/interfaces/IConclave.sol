// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IConclave
/// @notice A DAO treasury whose sensitive actions need post-quantum (ML-DSA-87) signatures.
interface IConclave {
    // ---------------------------------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------------------------------

    /// @notice Life cycle of a proposal.
    /// - Active:   collecting votes until `voteEnd`.
    /// - Defeated: voting ended without reaching the threshold, or too many members voted against.
    /// - Queued:   threshold reached, waiting for the timelock (`eta`).
    /// - Ready:    executable, from `eta` until `eta + gracePeriod`.
    /// - Expired:  not executed within the grace period.
    /// - Stale:    the member set or threshold changed after the proposal was created.
    enum ProposalState {
        Unknown,
        Active,
        Defeated,
        Queued,
        Ready,
        Executed,
        Canceled,
        Expired,
        Stale
    }

    /// @notice Governance timing, fixed at deployment.
    struct Timing {
        uint64 votingPeriod;
        uint64 timelockDelay;
        uint64 gracePeriod;
        uint64 pauseDuration;
    }

    /// @notice A proposal. Packed into three storage slots; the actions themselves are only
    ///         committed to (`proposalHash`) and published in {ProposalCreated}.
    struct Proposal {
        bytes32 proposalHash;
        address proposer;
        uint64 voteEnd;
        uint32 epoch;
        uint64 eta;
        uint16 forVotes;
        uint16 againstVotes;
        bool executed;
        bool canceled;
    }

    // ---------------------------------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------------------------------

    event ProposalCreated(
        uint256 indexed proposalId,
        address indexed proposer,
        bytes32 proposalHash,
        address[] targets,
        uint256[] values,
        bytes[] calldatas,
        string description,
        uint64 voteEnd,
        uint32 epoch
    );
    event VoteCast(
        uint256 indexed proposalId, address indexed voter, bool support, uint16 forVotes, uint16 againstVotes
    );
    event ProposalQueued(uint256 indexed proposalId, uint64 eta);
    event ProposalExecuted(uint256 indexed proposalId);
    event ProposalCanceled(uint256 indexed proposalId);
    event MemberAdded(address indexed member);
    event MemberRemoved(address indexed member);
    event ThresholdChanged(uint16 threshold);
    event EpochAdvanced(uint32 epoch);
    event GuardianChanged(address indexed guardian);
    event Paused(address indexed guardian, uint64 until);
    event Unpaused();
    event Deposited(address indexed from, uint256 amount);
    event TokenPaid(IERC20 indexed token, address indexed to, uint256 amount);

    // ---------------------------------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------------------------------

    error ZeroAddress();
    error NotMember(address account);
    error AlreadyMember(address account);
    error InvalidMemberCount(uint256 count);
    error InvalidThreshold(uint256 threshold, uint256 memberCount);
    error InvalidTiming();
    error InvalidChainId();
    error InvalidActions();
    error LengthMismatch();
    error SignatureExpired(uint256 deadline);
    error ProposalHashMismatch();
    error UnexpectedState(uint256 proposalId, ProposalState current);
    error AlreadyVoted(uint256 proposalId, address voter);
    error OnlySelf();
    error NotGuardian();
    error GuardianDisarmed();
    error BlockedWhilePaused(uint256 actionIndex);
    error TargetNotContract(uint256 actionIndex);
    error CallFailed(uint256 actionIndex);

    // ---------------------------------------------------------------------------------------------
    // Post-quantum authorised actions (relayable by anyone)
    // ---------------------------------------------------------------------------------------------

    function propose(
        address proposer,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        string calldata description,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 proposalId);

    function castVote(uint256 proposalId, address voter, bool support, bytes calldata signature) external;

    function castVotes(
        uint256 proposalId,
        address[] calldata voters,
        bool[] calldata choices,
        bytes[] calldata signatures
    ) external returns (uint256 counted);

    function cancel(uint256 proposalId, bytes calldata signature) external;

    // ---------------------------------------------------------------------------------------------
    // Permissionless / classical
    // ---------------------------------------------------------------------------------------------

    function execute(
        uint256 proposalId,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bytes32 descriptionHash
    ) external;

    function pause() external;

    // ---------------------------------------------------------------------------------------------
    // Governance only (called by the DAO itself through an executed proposal)
    // ---------------------------------------------------------------------------------------------

    function addMember(address account) external;
    function removeMember(address account) external;
    function setThreshold(uint16 newThreshold) external;
    function setGuardian(address newGuardian) external;
    function unpause() external;
    function payERC20(IERC20 token, address to, uint256 amount) external;
}
