// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Conclave} from "../src/Conclave.sol";
import {IConclave} from "../src/interfaces/IConclave.sol";
import {QorePQC} from "../src/libraries/QorePQC.sol";
import {ConclaveTestBase} from "./utils/ConclaveTestBase.sol";

contract ConclaveDeployTest is ConclaveTestBase {
    function test_InitialConfiguration() public view {
        assertEq(conclave.memberCount(), 3);
        assertEq(conclave.threshold(), 2);
        assertEq(conclave.epoch(), 0);
        assertEq(conclave.proposalCount(), 0);
        assertTrue(conclave.isMember(alice) && conclave.isMember(bob) && conclave.isMember(carol));
        assertFalse(conclave.isMember(dave));
        assertEq(conclave.guardian(), guardian);
        assertTrue(conclave.guardianArmed());
        assertFalse(conclave.isPaused());
        assertEq(conclave.nativeChainId(), NATIVE_CHAIN_ID);
        assertEq(conclave.votingPeriod(), VOTING_PERIOD);
        assertEq(conclave.timelockDelay(), TIMELOCK);
        assertEq(conclave.gracePeriod(), GRACE);
        assertEq(conclave.pauseDuration(), PAUSE);

        address[] memory list = conclave.members();
        assertEq(list.length, 3);
        assertEq(list[0], alice);
        assertEq(list[1], bob);
        assertEq(list[2], carol);
    }

    function test_AcceptsDeposits() public {
        vm.deal(dave, 5 ether);
        vm.expectEmit(address(conclave));
        emit IConclave.Deposited(dave, 5 ether);
        vm.prank(dave);
        (bool ok,) = address(conclave).call{value: 5 ether}("");
        assertTrue(ok);
        assertEq(address(conclave).balance, TREASURY + 5 ether);
    }

    function test_WithoutGuardian_NobodyCanPause() public {
        Conclave noGuardian = _deploy(_founders(), 2, address(0));
        assertEq(noGuardian.guardian(), address(0));
        assertFalse(noGuardian.guardianArmed());
        vm.prank(alice);
        vm.expectRevert(IConclave.NotGuardian.selector);
        noGuardian.pause();
    }

    function test_RevertWhen_NoMembers() public {
        vm.expectRevert(abi.encodeWithSelector(IConclave.InvalidMemberCount.selector, 0));
        _deploy(new address[](0), 1, guardian);
    }

    function test_RevertWhen_TooManyMembers() public {
        address[] memory list = new address[](65);
        for (uint256 i; i < list.length; ++i) {
            list[i] = vm.addr(i + 1);
            _registerKey(list[i]);
        }
        vm.expectRevert(abi.encodeWithSelector(IConclave.InvalidMemberCount.selector, 65));
        _deploy(list, 40, guardian);
    }

    function test_AcceptsMaxMembers() public {
        address[] memory list = new address[](64);
        for (uint256 i; i < list.length; ++i) {
            list[i] = vm.addr(i + 1);
            _registerKey(list[i]);
        }
        Conclave big = _deploy(list, 33, guardian);
        assertEq(big.memberCount(), 64);
    }

    function test_RevertWhen_DuplicateMember() public {
        address[] memory list = _founders();
        list[2] = alice;
        vm.expectRevert(abi.encodeWithSelector(IConclave.AlreadyMember.selector, alice));
        _deploy(list, 2, guardian);
    }

    function test_RevertWhen_ZeroAddressMember() public {
        address[] memory list = _founders();
        list[1] = address(0);
        vm.expectRevert(IConclave.ZeroAddress.selector);
        _deploy(list, 2, guardian);
    }

    function test_RevertWhen_MemberHasNoPqcKey() public {
        address[] memory list = _founders();
        list[2] = attacker; // no key registered
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcKeyNotRegistered.selector, attacker));
        _deploy(list, 2, guardian);
    }

    function test_RevertWhen_MemberKeyIsNotMlDsa87() public {
        keyRegistry.setKey(carol, true, 2, _pubkeyOf(carol));
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcUnsupportedAlgorithm.selector, carol, 2));
        _deploy(_founders(), 2, guardian);
    }

    function test_RevertWhen_MemberKeyHasWrongLength() public {
        keyRegistry.setKey(carol, true, 1, new bytes(1952)); // an ML-DSA-65 sized key
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcMalformedKey.selector, carol, 1952));
        _deploy(_founders(), 2, guardian);
    }

    function test_RevertWhen_PrecompilesInactive() public {
        vm.etch(QorePQC.PQC_KEY_STATUS, "");
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcPrecompileUnavailable.selector, QorePQC.PQC_KEY_STATUS));
        _deploy(_founders(), 2, guardian);
    }

    function testFuzz_ThresholdMustBeStrictMajority(uint8 rawCount, uint16 needed) public {
        uint256 count = bound(rawCount, 1, 12);
        needed = uint16(bound(needed, 0, 16));
        address[] memory list = new address[](count);
        for (uint256 i; i < count; ++i) {
            list[i] = vm.addr(i + 100);
            _registerKey(list[i]);
        }
        bool valid = needed > 0 && needed <= count && uint256(needed) * 2 > count;
        if (!valid) vm.expectRevert(abi.encodeWithSelector(IConclave.InvalidThreshold.selector, needed, count));
        Conclave c = _deploy(list, needed, guardian);
        if (valid) assertEq(c.threshold(), needed);
    }

    function test_RevertWhen_TimingOutOfBounds() public {
        IConclave.Timing[8] memory bad;
        for (uint256 i; i < bad.length; ++i) {
            bad[i] = _timing();
        }
        bad[0].votingPeriod = 5 minutes - 1;
        bad[1].votingPeriod = 30 days + 1;
        bad[2].timelockDelay = 59;
        bad[3].timelockDelay = 30 days + 1;
        bad[4].gracePeriod = 1 hours - 1;
        bad[5].pauseDuration = 10 minutes - 1;
        bad[6].pauseDuration = 14 days + 1;
        bad[7].pauseDuration = GRACE; // the grace period must outlast a pause
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(IConclave.InvalidTiming.selector);
            _deployWith(_founders(), 2, guardian, bad[i], NATIVE_CHAIN_ID);
        }
    }

    function test_RevertWhen_NativeChainIdInvalid() public {
        string[5] memory bad =
            ["", "qorechain|diana", "qorechain diana", "qorechain-diana-0123456789-abcdef", "diana\n"];
        for (uint256 i; i < bad.length; ++i) {
            vm.expectRevert(IConclave.InvalidChainId.selector);
            _deployWith(_founders(), 2, guardian, _timing(), bad[i]);
        }
    }

    function test_AcceptsMainnetChainId() public {
        Conclave c = _deployWith(_founders(), 2, guardian, _timing(), "qorechain-vladi");
        assertEq(c.nativeChainId(), "qorechain-vladi");
    }
}
