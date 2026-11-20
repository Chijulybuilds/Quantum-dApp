// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IConclave} from "../src/interfaces/IConclave.sol";
import {ConclaveTestBase} from "./utils/ConclaveTestBase.sol";
import {TestToken} from "./mocks/TestTargets.sol";

contract ConclavePauseTest is ConclaveTestBase {
    function test_Pause_ByGuardian() public {
        vm.expectEmit(address(conclave));
        emit IConclave.Paused(guardian, uint64(block.timestamp + PAUSE));
        vm.prank(guardian);
        conclave.pause();
        assertTrue(conclave.isPaused());
        assertEq(conclave.pausedUntil(), block.timestamp + PAUSE);
        assertFalse(conclave.guardianArmed());
    }

    function test_RevertWhen_PausedByNonGuardian() public {
        address[3] memory callers = [alice, attacker, address(conclave)];
        for (uint256 i; i < callers.length; ++i) {
            vm.prank(callers[i]);
            vm.expectRevert(IConclave.NotGuardian.selector);
            conclave.pause();
        }
    }

    function test_RevertWhen_PausedTwice() public {
        vm.prank(guardian);
        conclave.pause();
        vm.warp(block.timestamp + PAUSE + 1);
        assertFalse(conclave.isPaused());
        // The fuse is spent: a stolen guardian key cannot keep the DAO paused.
        vm.prank(guardian);
        vm.expectRevert(IConclave.GuardianDisarmed.selector);
        conclave.pause();
    }

    function test_Paused_BlocksNativePayout() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 id = _passAndReady(a);
        vm.prank(guardian);
        conclave.pause();
        vm.expectRevert(abi.encodeWithSelector(IConclave.BlockedWhilePaused.selector, 0));
        _execute(id, a);
    }

    function test_Paused_BlocksTokenPayout() public {
        TestToken fusd = new TestToken();
        fusd.mint(address(conclave), 10e18);
        Actions memory a = _selfCall(abi.encodeCall(IConclave.payERC20, (IERC20(address(fusd)), grantee, 1e18)), "fUSD");
        uint256 id = _passAndReady(a);
        vm.prank(guardian);
        conclave.pause();
        vm.expectRevert(abi.encodeWithSelector(IConclave.BlockedWhilePaused.selector, 0));
        _execute(id, a);
    }

    function test_Paused_BlocksPayoutHiddenBehindGovernanceAction() public {
        Actions memory a;
        a.targets = new address[](2);
        a.values = new uint256[](2);
        a.calldatas = new bytes[](2);
        a.targets[0] = address(conclave);
        a.calldatas[0] = abi.encodeCall(IConclave.unpause, ());
        a.targets[1] = grantee;
        a.values[1] = 1 ether;
        a.description = "Unpause and pay";
        uint256 id = _passAndReady(a);
        vm.prank(guardian);
        conclave.pause();
        vm.expectRevert(abi.encodeWithSelector(IConclave.BlockedWhilePaused.selector, 1));
        _execute(id, a);
    }

    function test_Paused_BlocksValueSentToSelf() public {
        Actions memory a = _selfCall(abi.encodeCall(IConclave.unpause, ()), "Unpause with value");
        a.values[0] = 1;
        uint256 id = _passAndReady(a);
        vm.prank(guardian);
        conclave.pause();
        vm.expectRevert(abi.encodeWithSelector(IConclave.BlockedWhilePaused.selector, 0));
        _execute(id, a);
    }

    function test_Paused_GovernanceCanUnpauseEarly() public {
        vm.prank(guardian);
        conclave.pause();
        // Voting continues during a pause.
        Actions memory a = _selfCall(abi.encodeCall(IConclave.unpause, ()), "Unpause");
        uint256 id = _passAndReady(a);
        assertTrue(conclave.isPaused());

        vm.expectEmit(address(conclave));
        emit IConclave.Unpaused();
        _execute(id, a);
        assertFalse(conclave.isPaused());
    }

    function test_Paused_GovernanceCanRemoveMember() public {
        vm.prank(guardian);
        conclave.pause();
        Actions memory a = _selfCall(abi.encodeCall(IConclave.removeMember, (carol)), "Remove compromised member");
        _execute(_passAndReady(a), a);
        assertFalse(conclave.isMember(carol));
    }

    function test_PauseExpires_QueuedPayoutSurvives() public {
        Actions memory a = _payout(grantee, 4 ether);
        uint256 id = _passAndReady(a);
        // The guardian (or someone holding its classical key) pauses right when the payout is ready.
        vm.prank(guardian);
        conclave.pause();
        vm.warp(block.timestamp + PAUSE);
        assertFalse(conclave.isPaused());
        // gracePeriod > pauseDuration, so the proposal did not expire during the pause.
        _assertState(id, IConclave.ProposalState.Ready);
        _execute(id, a);
        assertEq(grantee.balance, 4 ether);
    }

    function testFuzz_PauseNeverOutlastsGrace(uint64 waitBeforePause) public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 id = _passAndReady(a);
        uint256 eta = conclave.getProposal(id).eta;
        // Pause at any moment between eta and the end of the grace period.
        waitBeforePause = uint64(bound(waitBeforePause, 0, GRACE - PAUSE));
        vm.warp(eta + waitBeforePause);
        vm.prank(guardian);
        conclave.pause();
        vm.warp(conclave.pausedUntil());
        _assertState(id, IConclave.ProposalState.Ready);
        _execute(id, a);
        assertEq(grantee.balance, 1 ether);
    }
}
