// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IConclave} from "../src/interfaces/IConclave.sol";
import {ConclaveTestBase} from "./utils/ConclaveTestBase.sol";
import {FalseToken, ReentrantTarget, RevertingTarget, TestToken} from "./mocks/TestTargets.sol";

contract ConclaveExecutionTest is ConclaveTestBase {
    function test_Execute_NativePayout() public {
        Actions memory a = _payout(grantee, 10 ether);
        uint256 id = _passAndReady(a);

        vm.expectEmit(address(conclave));
        emit IConclave.ProposalExecuted(id);
        _execute(id, a);

        assertEq(grantee.balance, 10 ether);
        assertEq(address(conclave).balance, TREASURY - 10 ether);
        _assertState(id, IConclave.ProposalState.Executed);
    }

    function test_Execute_IsPermissionless() public {
        Actions memory a = _payout(grantee, 3 ether);
        uint256 id = _passAndReady(a);
        // Whoever submits it, the funds go where the members voted.
        vm.prank(attacker);
        conclave.execute(id, a.targets, a.values, a.calldatas, keccak256(bytes(a.description)));
        assertEq(grantee.balance, 3 ether);
        assertEq(attacker.balance, 0);
    }

    function test_Execute_ERC20PayoutThroughPayERC20() public {
        TestToken fusd = new TestToken();
        fusd.mint(address(conclave), 1000e18);
        Actions memory a = _selfCall(
            abi.encodeCall(IConclave.payERC20, (IERC20(address(fusd)), grantee, 250e18)), "Pay grant in fUSD"
        );
        uint256 id = _passAndReady(a);

        vm.expectEmit(address(conclave));
        emit IConclave.TokenPaid(IERC20(address(fusd)), grantee, 250e18);
        _execute(id, a);
        assertEq(fusd.balanceOf(grantee), 250e18);
        assertEq(fusd.balanceOf(address(conclave)), 750e18);
    }

    function test_Execute_MultipleActions() public {
        Actions memory a;
        a.targets = new address[](2);
        a.values = new uint256[](2);
        a.calldatas = new bytes[](2);
        a.targets[0] = grantee;
        a.values[0] = 1 ether;
        a.targets[1] = dave;
        a.values[1] = 2 ether;
        a.description = "Two grants";
        uint256 id = _passAndReady(a);
        _execute(id, a);
        assertEq(grantee.balance, 1 ether);
        assertEq(dave.balance, 2 ether);
    }

    function test_RevertWhen_ExecutedBeforeTimelock() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 id = _propose(alice, a);
        _vote(id, alice, true);
        _vote(id, bob, true);
        vm.warp(block.timestamp + TIMELOCK - 1);
        vm.expectRevert(abi.encodeWithSelector(IConclave.UnexpectedState.selector, id, IConclave.ProposalState.Queued));
        _execute(id, a);
    }

    function test_RevertWhen_ExecutedAfterGracePeriod() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 id = _passAndReady(a);
        vm.warp(block.timestamp + GRACE);
        _execute(id, a); // still inside the grace period
        assertEq(grantee.balance, 1 ether);

        Actions memory b = _payout(grantee, 2 ether);
        uint256 late = _passAndReady(b);
        vm.warp(block.timestamp + GRACE + 1);
        vm.expectRevert(
            abi.encodeWithSelector(IConclave.UnexpectedState.selector, late, IConclave.ProposalState.Expired)
        );
        _execute(late, b);
    }

    function test_RevertWhen_ExecutedWithDifferentContent() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 id = _passAndReady(a);
        bytes32 descHash = keccak256(bytes(a.description));

        Actions memory other = _payout(attacker, 1 ether);
        vm.expectRevert(IConclave.ProposalHashMismatch.selector);
        conclave.execute(id, other.targets, other.values, other.calldatas, descHash);

        other = _payout(grantee, 99 ether);
        vm.expectRevert(IConclave.ProposalHashMismatch.selector);
        conclave.execute(id, other.targets, other.values, other.calldatas, descHash);

        vm.expectRevert(IConclave.ProposalHashMismatch.selector);
        conclave.execute(id, a.targets, a.values, a.calldatas, keccak256("other description"));
    }

    function test_RevertWhen_ExecutedTwice() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 id = _passAndReady(a);
        _execute(id, a);
        vm.expectRevert(
            abi.encodeWithSelector(IConclave.UnexpectedState.selector, id, IConclave.ProposalState.Executed)
        );
        _execute(id, a);
        assertEq(grantee.balance, 1 ether);
    }

    function test_FailedActionRevertsEverythingAndStaysReady() public {
        Actions memory a;
        a.targets = new address[](2);
        a.values = new uint256[](2);
        a.calldatas = new bytes[](2);
        a.targets[0] = grantee;
        a.values[0] = 1 ether;
        a.targets[1] = dave;
        a.values[1] = TREASURY; // more than is left after the first action
        a.description = "Too much";
        uint256 id = _passAndReady(a);

        vm.expectRevert(abi.encodeWithSelector(IConclave.CallFailed.selector, 1));
        _execute(id, a);
        assertEq(grantee.balance, 0, "first action must be rolled back");
        _assertState(id, IConclave.ProposalState.Ready);

        vm.deal(address(conclave), TREASURY + 1 ether); // the treasury gets topped up
        _execute(id, a);
        assertEq(dave.balance, TREASURY);
    }

    function test_RevertWhen_TargetRevertsBubblesReason() public {
        RevertingTarget target = new RevertingTarget();
        Actions memory a = _payout(address(target), 0);
        a.calldatas[0] = abi.encodeCall(RevertingTarget.fail, ());
        uint256 id = _passAndReady(a);
        vm.expectRevert(abi.encodeWithSelector(RevertingTarget.Boom.selector, 42));
        _execute(id, a);
    }

    function test_RevertWhen_CalldataSentToAccountWithoutCode() public {
        Actions memory a = _payout(grantee, 0);
        a.calldatas[0] = abi.encodeWithSignature("transfer(address,uint256)", attacker, 1);
        uint256 id = _passAndReady(a);
        vm.expectRevert(abi.encodeWithSelector(IConclave.TargetNotContract.selector, 0));
        _execute(id, a);
    }

    function test_RevertWhen_TokenTransferReturnsFalse() public {
        FalseToken bad = new FalseToken();
        Actions memory a = _selfCall(abi.encodeCall(IConclave.payERC20, (IERC20(address(bad)), grantee, 1)), "Bad");
        uint256 id = _passAndReady(a);
        vm.expectRevert(abi.encodeWithSelector(SafeERC20.SafeERC20FailedOperation.selector, address(bad)));
        _execute(id, a);
    }

    function test_RevertWhen_PayERC20ToZeroAddress() public {
        TestToken fusd = new TestToken();
        fusd.mint(address(conclave), 1);
        Actions memory a = _selfCall(abi.encodeCall(IConclave.payERC20, (IERC20(address(fusd)), address(0), 1)), "Burn");
        uint256 id = _passAndReady(a);
        vm.expectRevert(IConclave.ZeroAddress.selector);
        _execute(id, a);
    }

    // ---------------------------------------------------------------------------------------------
    // Re-entrancy
    // ---------------------------------------------------------------------------------------------

    function test_RevertWhen_TargetReentersExecute() public {
        ReentrantTarget target = new ReentrantTarget(conclave);
        Actions memory a = _payout(address(target), 0);
        // The target tries to execute the very proposal that is calling it. The calldata cannot
        // contain its own hash, so it re-enters with an empty description: the guard fires first.
        a.calldatas[0] = abi.encodeCall(
            ReentrantTarget.reenterExecute, (1, new address[](0), new uint256[](0), new bytes[](0), bytes32(0))
        );
        uint256 id = _passAndReady(a);
        assertEq(id, 1);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        _execute(id, a);
    }

    function test_RevertWhen_TargetReentersVote() public {
        ReentrantTarget target = new ReentrantTarget(conclave);
        uint256 victim = _propose(bob, _payout(grantee, 1 ether));
        bytes memory carolSig = _voteSig(victim, carol, true);

        Actions memory a = _payout(address(target), 0);
        a.calldatas[0] = abi.encodeCall(ReentrantTarget.reenterVote, (victim, carol, carolSig));
        uint256 id = _passAndReady(a);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        _execute(id, a);
    }

    function test_RevertWhen_TargetCallsGovernanceDirectly() public {
        ReentrantTarget target = new ReentrantTarget(conclave);
        Actions memory a = _payout(address(target), 0);
        a.calldatas[0] = abi.encodeCall(ReentrantTarget.callGovernance, ());
        uint256 id = _passAndReady(a);
        vm.expectRevert(IConclave.OnlySelf.selector);
        _execute(id, a);
    }
}
