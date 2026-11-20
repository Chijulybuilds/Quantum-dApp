// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {Conclave} from "../../src/Conclave.sol";
import {IConclave} from "../../src/interfaces/IConclave.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Drives Conclave with random sequences of honest member actions and classical-key attacks.
/// @dev Honest members sign with their (mock) ML-DSA-87 keys; the attacker holds every classical key
///      (it can send from any member, guardian or relayer account) but no ML-DSA-87 key.
contract ConclaveHandler is Test {
    enum Kind {
        Payout,
        Threshold
    }

    struct Tracked {
        uint256 id;
        Kind kind;
        address to;
        uint256 amount;
        uint16 newThreshold;
    }

    Conclave public immutable conclave;
    address public immutable guardian;
    address public immutable attacker;
    address[] internal _founders;
    address[] internal _recipients;
    Tracked[] internal _tracked;

    uint256 public ghostDeposited;
    uint256 public ghostPaidOut;
    uint256 public ghostExecuted;
    uint256 public ghostPauses;
    uint256 public ghostForgedAccepted;
    uint256 public ghostUnauthorizedSuccess;
    uint256 public ghostVotes;
    uint256 public ghostQueued;
    uint256 public ghostExecuteAttempts;

    constructor(Conclave conclave_, address[] memory founders_, address guardian_, address attacker_) {
        conclave = conclave_;
        _founders = founders_;
        guardian = guardian_;
        attacker = attacker_;
        _recipients.push(makeAddr("recipient-1"));
        _recipients.push(makeAddr("recipient-2"));
        _recipients.push(makeAddr("recipient-3"));
    }

    // ---------------------------------------------------------------------------------------------
    // Honest behaviour
    // ---------------------------------------------------------------------------------------------

    function deposit(uint256 amount) external {
        amount = bound(amount, 0, 20 ether);
        vm.deal(address(this), amount);
        (bool ok,) = address(conclave).call{value: amount}("");
        require(ok, "deposit failed");
        ghostDeposited += amount;
    }

    function proposePayout(uint256 proposerSeed, uint256 recipientSeed, uint256 amount) external {
        address to = _recipients[recipientSeed % _recipients.length];
        amount = bound(amount, 0, 40 ether);
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _single(to, amount, "");
        uint256 id = _propose(_founders[proposerSeed % _founders.length], targets, values, calldatas, "payout");
        _tracked.push(Tracked(id, Kind.Payout, to, amount, 0));
    }

    function proposeThreshold(uint256 proposerSeed, bool strict) external {
        uint16 newThreshold = strict ? 3 : 2;
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) =
            _single(address(conclave), 0, abi.encodeCall(IConclave.setThreshold, (newThreshold)));
        uint256 id = _propose(_founders[proposerSeed % _founders.length], targets, values, calldatas, "threshold");
        _tracked.push(Tracked(id, Kind.Threshold, address(0), 0, newThreshold));
    }

    /// @dev Votes on an Active proposal the voter has not voted on yet (searching from the seed).
    function vote(uint256 proposalSeed, uint256 voterSeed, uint256 supportSeed) external {
        uint256 n = _tracked.length;
        if (n == 0) return;
        address voter = _founders[voterSeed % _founders.length];
        // Mostly FOR, so that proposals regularly pass and payouts get exercised.
        bool support = supportSeed % 4 != 0;
        // Usually start at the oldest proposal so votes concentrate and proposals reach the threshold.
        uint256 start = proposalSeed % 3 == 0 ? proposalSeed % n : 0;
        for (uint256 k; k < n; ++k) {
            uint256 id = _tracked[(start + k) % n].id;
            if (conclave.state(id) != IConclave.ProposalState.Active || conclave.hasVoted(id, voter)) continue;
            bytes memory sig = _sign(voter, bytes(conclave.voteMessage(id, voter, support)));
            conclave.castVote(id, voter, support, sig);
            ghostVotes++;
            if (conclave.state(id) == IConclave.ProposalState.Queued) ghostQueued++;
            return;
        }
    }

    /// @dev Like a keeper: executes a Ready proposal, or waits for a Queued one's timelock and then
    ///      executes it (searching from the seed).
    function execute(uint256 proposalSeed) external {
        uint256 n = _tracked.length;
        if (n == 0) return;
        uint256 start = proposalSeed % n;
        for (uint256 k; k < n; ++k) {
            Tracked memory t = _tracked[(start + k) % n];
            IConclave.ProposalState s = conclave.state(t.id);
            if (s == IConclave.ProposalState.Queued) {
                vm.warp(conclave.getProposal(t.id).eta);
                s = conclave.state(t.id);
            }
            if (s != IConclave.ProposalState.Ready) continue;
            _execute(t);
            return;
        }
    }

    function _execute(Tracked memory t) internal {
        ghostExecuteAttempts++;
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description) =
            _actionsOf(t);
        try conclave.execute(t.id, targets, values, calldatas, keccak256(bytes(description))) {
            ghostExecuted++;
            if (t.kind == Kind.Payout) ghostPaidOut += t.amount;
        } catch {
            // Expected when the treasury is short or the DAO is paused.
        }
    }

    /// @dev Mostly short steps (within the timelock and voting period), sometimes long jumps.
    function warp(uint256 seconds_) external {
        uint256 step = seconds_ % 8 == 0 ? bound(seconds_, 1 days, 8 days) : bound(seconds_, 0, 2 hours);
        vm.warp(block.timestamp + step);
    }

    /// @dev Rare on purpose: a pause blocks payouts for a day, which would starve the other paths.
    function guardianPause(uint256 seed) external {
        if (seed % 8 != 0) return;
        vm.prank(guardian);
        try conclave.pause() {
            ghostPauses++;
        } catch {}
    }

    // ---------------------------------------------------------------------------------------------
    // Attacks with classical keys only
    // ---------------------------------------------------------------------------------------------

    function attackForgedVote(uint256 proposalSeed, uint256 voterSeed, bytes32 junk) external {
        if (_tracked.length == 0) return;
        uint256 id = _tracked[proposalSeed % _tracked.length].id;
        address voter = _founders[voterSeed % _founders.length];
        bytes memory sig = new bytes(4627);
        assembly {
            mstore(add(sig, 32), junk)
        }
        vm.prank(voter); // sent from the member's own account, with its stolen classical key
        try conclave.castVote(id, voter, true, sig) {
            ghostForgedAccepted++;
        } catch {}
    }

    function attackReplayVote(uint256 fromSeed, uint256 toSeed, uint256 voterSeed) external {
        if (_tracked.length < 2) return;
        uint256 fromId = _tracked[fromSeed % _tracked.length].id;
        uint256 toId = _tracked[toSeed % _tracked.length].id;
        if (fromId == toId) return;
        address voter = _founders[voterSeed % _founders.length];
        bytes memory sig = _sign(voter, bytes(conclave.voteMessage(fromId, voter, true)));
        vm.prank(attacker);
        try conclave.castVote(toId, voter, true, sig) {
            ghostForgedAccepted++;
        } catch {}
    }

    function attackProposeForMember(uint256 memberSeed, uint256 amount) external {
        address member = _founders[memberSeed % _founders.length];
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) =
            _single(attacker, bound(amount, 1, 100 ether), "");
        vm.prank(member);
        try conclave.propose(member, targets, values, calldatas, "steal", block.timestamp, new bytes(4627)) {
            ghostForgedAccepted++;
        } catch {}
    }

    function attackGovernance(uint256 callerSeed, uint8 which) external {
        address caller = callerSeed % 2 == 0 ? attacker : _founders[callerSeed % _founders.length];
        vm.startPrank(caller);
        bool succeeded;
        which = which % 6;
        if (which == 0) {
            try conclave.payERC20(IERC20(address(0xBEEF)), attacker, 1) {
                succeeded = true;
            } catch {}
        } else if (which == 1) {
            try conclave.addMember(attacker) {
                succeeded = true;
            } catch {}
        } else if (which == 2) {
            try conclave.removeMember(_founders[0]) {
                succeeded = true;
            } catch {}
        } else if (which == 3) {
            try conclave.setThreshold(1) {
                succeeded = true;
            } catch {}
        } else if (which == 4) {
            try conclave.setGuardian(attacker) {
                succeeded = true;
            } catch {}
        } else {
            try conclave.unpause() {
                succeeded = true;
            } catch {}
        }
        vm.stopPrank();
        if (succeeded) ghostUnauthorizedSuccess++;
    }

    function attackRedirectPayout(uint256 proposalSeed) external {
        if (_tracked.length == 0) return;
        Tracked memory t = _tracked[proposalSeed % _tracked.length];
        if (t.kind != Kind.Payout) return;
        (address[] memory targets, uint256[] memory values, bytes[] memory calldatas) = _single(attacker, t.amount, "");
        vm.prank(attacker);
        try conclave.execute(t.id, targets, values, calldatas, keccak256("payout")) {
            ghostUnauthorizedSuccess++;
        } catch {}
    }

    // ---------------------------------------------------------------------------------------------
    // Views for the invariants
    // ---------------------------------------------------------------------------------------------

    function trackedCount() external view returns (uint256) {
        return _tracked.length;
    }

    function trackedAt(uint256 i) external view returns (Tracked memory) {
        return _tracked[i];
    }

    // ---------------------------------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------------------------------

    function _propose(
        address proposer,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) internal returns (uint256) {
        bytes32 hash = keccak256(abi.encode(targets, values, calldatas, keccak256(bytes(description))));
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(proposer, bytes(conclave.proposeMessage(proposer, hash, deadline)));
        return conclave.propose(proposer, targets, values, calldatas, description, deadline, sig);
    }

    function _single(address target, uint256 value, bytes memory data)
        internal
        pure
        returns (address[] memory targets, uint256[] memory values, bytes[] memory calldatas)
    {
        targets = new address[](1);
        values = new uint256[](1);
        calldatas = new bytes[](1);
        targets[0] = target;
        values[0] = value;
        calldatas[0] = data;
    }

    function _actionsOf(Tracked memory t)
        internal
        view
        returns (address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description)
    {
        if (t.kind == Kind.Payout) {
            (targets, values, calldatas) = _single(t.to, t.amount, "");
            description = "payout";
        } else {
            (targets, values, calldatas) =
                _single(address(conclave), 0, abi.encodeCall(IConclave.setThreshold, (t.newThreshold)));
            description = "threshold";
        }
    }

    /// @dev Mock ML-DSA-87 signature by `signer`'s registered key (see MockQorePQC / ConclaveTestBase).
    function _sign(address signer, bytes memory message) internal view returns (bytes memory sig) {
        bytes memory pubkey = new bytes(2592);
        bytes32 seed = keccak256(abi.encode("pubkey", signer));
        assembly {
            mstore(add(pubkey, 32), seed)
        }
        bytes32 t = keccak256(abi.encode("mock-ml-dsa-87", pubkey, conclave.signingBytes(string(message))));
        sig = new bytes(4627);
        assembly {
            mstore(add(sig, 32), t)
        }
    }
}
