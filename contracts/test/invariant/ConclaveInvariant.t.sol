// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IConclave} from "../../src/interfaces/IConclave.sol";
import {ConclaveTestBase} from "../utils/ConclaveTestBase.sol";
import {ConclaveHandler} from "./ConclaveHandler.sol";

/// @notice Properties that must hold after any sequence of honest actions and classical-key attacks.
contract ConclaveInvariantTest is ConclaveTestBase {
    ConclaveHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new ConclaveHandler(conclave, _founders(), guardian, attacker);

        bytes4[] memory selectors = new bytes4[](14);
        selectors[0] = ConclaveHandler.deposit.selector;
        selectors[1] = ConclaveHandler.proposePayout.selector;
        selectors[2] = ConclaveHandler.proposeThreshold.selector;
        selectors[3] = ConclaveHandler.vote.selector;
        selectors[4] = ConclaveHandler.vote.selector; // voting twice as likely
        selectors[5] = ConclaveHandler.execute.selector;
        selectors[6] = ConclaveHandler.warp.selector;
        selectors[7] = ConclaveHandler.guardianPause.selector;
        selectors[8] = ConclaveHandler.attackForgedVote.selector;
        selectors[9] = ConclaveHandler.attackReplayVote.selector;
        selectors[10] = ConclaveHandler.attackProposeForMember.selector;
        selectors[11] = ConclaveHandler.attackGovernance.selector;
        selectors[12] = ConclaveHandler.attackRedirectPayout.selector;
        selectors[13] = ConclaveHandler.execute.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// @notice Funds only leave through executed, post-quantum approved proposals.
    function invariant_TreasuryAccounting() public view {
        assertEq(address(conclave).balance, TREASURY + handler.ghostDeposited() - handler.ghostPaidOut());
    }

    /// @notice A classical-key attacker never receives anything.
    function invariant_AttackerNeverPaid() public view {
        assertEq(attacker.balance, 0);
    }

    /// @notice No forged, replayed or unauthorised action ever succeeded.
    function invariant_NoUnauthorisedSuccess() public view {
        assertEq(handler.ghostForgedAccepted(), 0, "forged signature accepted");
        assertEq(handler.ghostUnauthorizedSuccess(), 0, "unauthorised call succeeded");
    }

    /// @notice The configuration always has a strict-majority threshold.
    function invariant_ConfigurationValid() public view {
        uint256 count = conclave.memberCount();
        uint256 needed = conclave.threshold();
        assertEq(count, 3);
        assertGt(needed, 0);
        assertLe(needed, count);
        assertGt(needed * 2, count);
    }

    /// @notice The guardian's fuse is never usable twice (nothing re-arms it in this run).
    function invariant_GuardianPausesAtMostOnce() public view {
        assertLe(handler.ghostPauses(), 1);
    }

    /// @notice Votes are bounded by the member count; executed proposals reached a majority.
    function invariant_ProposalVotes() public view {
        uint256 n = handler.trackedCount();
        for (uint256 i; i < n; ++i) {
            IConclave.Proposal memory p = conclave.getProposal(handler.trackedAt(i).id);
            assertLe(uint256(p.forVotes) + p.againstVotes, 3);
            if (p.executed) {
                assertGe(p.forVotes, 2, "executed without a majority");
                assertGt(p.eta, 0);
            }
            if (p.eta != 0) assertGe(p.forVotes, 2, "queued without a majority");
        }
    }
}
