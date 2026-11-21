// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IConclave} from "../src/interfaces/IConclave.sol";
import {QorePQC} from "../src/libraries/QorePQC.sol";
import {ConclaveTestBase} from "./utils/ConclaveTestBase.sol";

contract ConclaveGovernanceTest is ConclaveTestBase {
    function _twoCalls(bytes memory first, bytes memory second, string memory description)
        internal
        view
        returns (Actions memory a)
    {
        a.targets = new address[](2);
        a.values = new uint256[](2);
        a.calldatas = new bytes[](2);
        a.targets[0] = address(conclave);
        a.targets[1] = address(conclave);
        a.calldatas[0] = first;
        a.calldatas[1] = second;
        a.description = description;
    }

    // ---------------------------------------------------------------------------------------------
    // Governance functions are only reachable through executed proposals
    // ---------------------------------------------------------------------------------------------

    function test_RevertWhen_GovernanceCalledDirectly() public {
        address[4] memory callers = [alice, guardian, attacker, address(this)];
        for (uint256 i; i < callers.length; ++i) {
            vm.startPrank(callers[i]);
            vm.expectRevert(IConclave.OnlySelf.selector);
            conclave.addMember(dave);
            vm.expectRevert(IConclave.OnlySelf.selector);
            conclave.removeMember(carol);
            vm.expectRevert(IConclave.OnlySelf.selector);
            conclave.setThreshold(1);
            vm.expectRevert(IConclave.OnlySelf.selector);
            conclave.setGuardian(attacker);
            vm.expectRevert(IConclave.OnlySelf.selector);
            conclave.unpause();
            vm.expectRevert(IConclave.OnlySelf.selector);
            conclave.payERC20(IERC20(address(1)), attacker, 1);
            vm.stopPrank();
        }
    }

    // ---------------------------------------------------------------------------------------------
    // Members and threshold
    // ---------------------------------------------------------------------------------------------

    function test_AddMember_WithThresholdChange_InEitherOrder() public {
        // 2-of-4 would not be a strict majority, so adding dave needs threshold 3.
        // Validation runs after all actions, so the order inside the proposal does not matter.
        Actions memory a = _twoCalls(
            abi.encodeCall(IConclave.addMember, (dave)), abi.encodeCall(IConclave.setThreshold, (3)), "Welcome dave"
        );
        uint256 id = _passAndReady(a);

        vm.expectEmit(address(conclave));
        emit IConclave.MemberAdded(dave);
        _execute(id, a);

        assertTrue(conclave.isMember(dave));
        assertEq(conclave.memberCount(), 4);
        assertEq(conclave.threshold(), 3);
        assertEq(conclave.epoch(), 2);
    }

    function test_RevertWhen_AddMemberBreaksMajority() public {
        Actions memory a = _selfCall(abi.encodeCall(IConclave.addMember, (dave)), "2-of-4");
        uint256 id = _passAndReady(a);
        vm.expectRevert(abi.encodeWithSelector(IConclave.InvalidThreshold.selector, 2, 4));
        _execute(id, a);
    }

    function test_RevertWhen_AddedMemberHasNoPqcKey() public {
        Actions memory a = _twoCalls(
            abi.encodeCall(IConclave.setThreshold, (3)), abi.encodeCall(IConclave.addMember, (attacker)), "No key"
        );
        uint256 id = _passAndReady(a);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcKeyNotRegistered.selector, attacker));
        _execute(id, a);
    }

    function test_RevertWhen_AddingExistingMember() public {
        Actions memory a = _selfCall(abi.encodeCall(IConclave.addMember, (bob)), "Twice");
        uint256 id = _passAndReady(a);
        vm.expectRevert(abi.encodeWithSelector(IConclave.AlreadyMember.selector, bob));
        _execute(id, a);
    }

    function test_RemoveMember() public {
        Actions memory a = _selfCall(abi.encodeCall(IConclave.removeMember, (alice)), "Bye alice");
        uint256 id = _passAndReady(a);
        vm.expectEmit(address(conclave));
        emit IConclave.MemberRemoved(alice);
        _execute(id, a);

        assertFalse(conclave.isMember(alice));
        assertEq(conclave.memberCount(), 2);
        address[] memory list = conclave.members();
        assertEq(list.length, 2);
        // carol moved into alice's slot.
        assertEq(list[0], carol);
        assertEq(list[1], bob);
        assertEq(conclave.epoch(), 1);
    }

    function test_RevertWhen_RemovingNonMember() public {
        Actions memory a = _selfCall(abi.encodeCall(IConclave.removeMember, (dave)), "Not there");
        uint256 id = _passAndReady(a);
        vm.expectRevert(abi.encodeWithSelector(IConclave.NotMember.selector, dave));
        _execute(id, a);
    }

    function test_RevertWhen_RemovalLeavesThresholdUnreachable() public {
        Actions memory a = _twoCalls(
            abi.encodeCall(IConclave.removeMember, (carol)), abi.encodeCall(IConclave.removeMember, (bob)), "Too many"
        );
        uint256 id = _passAndReady(a);
        vm.expectRevert(abi.encodeWithSelector(IConclave.InvalidThreshold.selector, 2, 1));
        _execute(id, a);
    }

    function test_RevertWhen_RemovingEveryMember() public {
        Actions memory a;
        a.targets = new address[](3);
        a.values = new uint256[](3);
        a.calldatas = new bytes[](3);
        address[] memory founders = _founders();
        for (uint256 i; i < 3; ++i) {
            a.targets[i] = address(conclave);
            a.calldatas[i] = abi.encodeCall(IConclave.removeMember, (founders[i]));
        }
        a.description = "Dissolve";
        uint256 id = _passAndReady(a);
        vm.expectRevert(abi.encodeWithSelector(IConclave.InvalidMemberCount.selector, 0));
        _execute(id, a);
    }

    function test_RevertWhen_AddingBeyondMaxMembers() public {
        address[] memory list = new address[](64);
        for (uint256 i; i < list.length; ++i) {
            list[i] = vm.addr(i + 1);
            _registerKey(list[i]);
        }
        conclave = _deploy(list, 33, guardian);
        Actions memory a = _selfCall(abi.encodeCall(IConclave.addMember, (dave)), "Member 65");
        uint256 id = _propose(list[0], a);
        for (uint256 i; i < 33; ++i) {
            _vote(id, list[i], true);
        }
        vm.warp(block.timestamp + TIMELOCK);
        vm.expectRevert(abi.encodeWithSelector(IConclave.InvalidMemberCount.selector, 65));
        _execute(id, a);
    }

    function test_SigningBytesView() public view {
        assertEq(conclave.signingBytes("abc"), bytes("qorechain-msg-v1|qorechain-diana|abc"));
    }

    function test_RevertWhen_ThresholdNotStrictMajority() public {
        Actions memory a = _selfCall(abi.encodeCall(IConclave.setThreshold, (1)), "1-of-3");
        uint256 id = _passAndReady(a);
        vm.expectRevert(abi.encodeWithSelector(IConclave.InvalidThreshold.selector, 1, 3));
        _execute(id, a);
    }

    function test_ConfigChangeMakesOpenProposalsStale() public {
        // A payout is queued under the 2-of-3 membership...
        Actions memory pay = _payout(grantee, 5 ether);
        uint256 payId = _propose(bob, pay);
        _vote(payId, bob, true);
        _vote(payId, carol, true);

        // ...and another payout is still collecting votes.
        uint256 openId = _propose(carol, _payout(grantee, 1 ether));

        // Membership changes: everything created under the old membership is now Stale.
        Actions memory change = _selfCall(abi.encodeCall(IConclave.setThreshold, (3)), "3-of-3");
        uint256 changeId = _passAndReady(change);
        _execute(changeId, change);

        _assertState(payId, IConclave.ProposalState.Stale);
        _assertState(openId, IConclave.ProposalState.Stale);
        vm.expectRevert(
            abi.encodeWithSelector(IConclave.UnexpectedState.selector, payId, IConclave.ProposalState.Stale)
        );
        _execute(payId, pay);
        bytes memory sig = _voteSig(openId, alice, true);
        vm.expectRevert(
            abi.encodeWithSelector(IConclave.UnexpectedState.selector, openId, IConclave.ProposalState.Stale)
        );
        conclave.castVote(openId, alice, true, sig);
        assertEq(grantee.balance, 0);
    }

    function test_ProposalsUnderNewConfigWork() public {
        Actions memory change = _selfCall(abi.encodeCall(IConclave.removeMember, (carol)), "Remove carol");
        _execute(_passAndReady(change), change);

        // 2-of-2 now: carol can no longer vote, alice + bob still can.
        Actions memory pay = _payout(grantee, 1 ether);
        uint256 id = _propose(alice, pay);
        bytes memory carolSig = _voteSig(id, carol, true);
        vm.expectRevert(abi.encodeWithSelector(IConclave.NotMember.selector, carol));
        conclave.castVote(id, carol, true, carolSig);
        _vote(id, alice, true);
        _vote(id, bob, true);
        vm.warp(block.timestamp + TIMELOCK);
        _execute(id, pay);
        assertEq(grantee.balance, 1 ether);
    }

    // ---------------------------------------------------------------------------------------------
    // Guardian
    // ---------------------------------------------------------------------------------------------

    function test_SetGuardian_RotatesAndRearms() public {
        vm.prank(guardian);
        conclave.pause();
        assertFalse(conclave.guardianArmed());

        address newGuardian = makeAddr("new-guardian");
        Actions memory a = _selfCall(abi.encodeCall(IConclave.setGuardian, (newGuardian)), "Rotate guardian");
        uint256 id = _passAndReady(a);
        _execute(id, a); // allowed while paused: it is a governance action

        assertEq(conclave.guardian(), newGuardian);
        assertTrue(conclave.guardianArmed());
        vm.prank(guardian);
        vm.expectRevert(IConclave.NotGuardian.selector);
        conclave.pause();
    }

    function test_SetGuardian_ZeroRemovesIt() public {
        Actions memory a = _selfCall(abi.encodeCall(IConclave.setGuardian, (address(0))), "No guardian");
        _execute(_passAndReady(a), a);
        assertEq(conclave.guardian(), address(0));
        assertFalse(conclave.guardianArmed());
        // setGuardian does not touch membership: no epoch change.
        assertEq(conclave.epoch(), 0);
    }
}
