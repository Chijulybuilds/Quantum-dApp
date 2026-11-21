// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Conclave} from "../src/Conclave.sol";
import {IConclave} from "../src/interfaces/IConclave.sol";
import {QorePQC} from "../src/libraries/QorePQC.sol";
import {ConclaveTestBase} from "./utils/ConclaveTestBase.sol";

/// @notice Q-Day scenarios: a quantum attacker has recovered every classical (ECDSA) key involved
///         (all members, the guardian and the relayer) but none of the ML-DSA-87 keys.
/// @dev On QoreChain such an attacker can still send EVM transactions from any account whose EVM
///      window is open, so in these tests the attacker may act as any of those accounts (`vm.prank`).
contract ConclaveQDayTest is ConclaveTestBase {
    /// @dev The best an ECDSA-only attacker can produce: something of the right length that is not a
    ///      valid ML-DSA-87 signature (e.g. an ECDSA signature padded out).
    function _forged() internal pure returns (bytes memory sig) {
        sig = new bytes(SIG_LEN);
        sig[0] = 0x1b;
    }

    function test_QDay_ClassicalKeysCannotMoveFunds() public {
        address[5] memory stolen = [alice, bob, carol, guardian, relayer];
        Actions memory steal = _payout(attacker, TREASURY);
        uint256 deadline = block.timestamp + 1 hours;

        for (uint256 i; i < stolen.length; ++i) {
            vm.startPrank(stolen[i]);

            // 1. Propose on a member's behalf: needs the member's ML-DSA-87 signature.
            vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
            conclave.propose(
                alice, steal.targets, steal.values, steal.calldatas, steal.description, deadline, _forged()
            );

            // 2. Call the treasury functions directly: only the DAO itself may.
            vm.expectRevert(IConclave.OnlySelf.selector);
            conclave.payERC20(IERC20(address(0xBEEF)), attacker, 1);
            vm.expectRevert(IConclave.OnlySelf.selector);
            conclave.addMember(attacker);
            vm.expectRevert(IConclave.OnlySelf.selector);
            conclave.setThreshold(1);
            vm.expectRevert(IConclave.OnlySelf.selector);
            conclave.setGuardian(attacker);
            vm.expectRevert(IConclave.OnlySelf.selector);
            conclave.unpause();

            // 3. Plain value transfers out of the contract do not exist.
            (bool ok,) = address(conclave).call(abi.encodeWithSignature("withdraw(uint256)", TREASURY));
            assertFalse(ok);

            vm.stopPrank();
        }
        assertEq(address(conclave).balance, TREASURY);
        assertEq(attacker.balance, 0);
    }

    function test_QDay_ClassicalKeysCannotVote() public {
        uint256 id = _propose(alice, _payout(grantee, 1 ether));
        address[3] memory members = [alice, bob, carol];
        for (uint256 i; i < members.length; ++i) {
            vm.prank(members[i]); // even sent from the member's own account
            vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, members[i]));
            conclave.castVote(id, members[i], true, _forged());
        }
        assertEq(conclave.getProposal(id).forVotes, 0);
    }

    function test_QDay_ReplayingObservedSignaturesFails() public {
        // The attacker watched the chain and collected every signature members ever published.
        Actions memory honest = _payout(grantee, 1 ether);
        uint256 honestId = _propose(alice, honest);
        bytes memory aliceFor = _voteSig(honestId, alice, true);
        bytes memory bobFor = _voteSig(honestId, bob, true);
        conclave.castVote(honestId, alice, true, aliceFor);
        conclave.castVote(honestId, bob, true, bobFor);

        // They cannot propose, so they try to reuse alice's earlier propose signature for their payout.
        Actions memory steal = _payout(attacker, 1 ether);
        bytes memory oldPropose = _sign(alice, _proposeMsg(address(conclave), alice, 0, block.timestamp, _hash(honest)));
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.propose(
            alice, steal.targets, steal.values, steal.calldatas, steal.description, block.timestamp, oldPropose
        );

        // A second, unrelated proposal by carol: the old vote signatures do not carry over.
        uint256 otherId = _propose(carol, _payout(grantee, 2 ether));
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.castVote(otherId, alice, true, aliceFor);

        // Nor to a twin deployment of Conclave with the same members and the same proposal.
        Conclave twin = _deploy(_founders(), 2, guardian);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory twinPropose = _sign(alice, _proposeMsg(address(twin), alice, 0, deadline, _hash(honest)));
        uint256 twinId = twin.propose(
            alice, honest.targets, honest.values, honest.calldatas, honest.description, deadline, twinPropose
        );
        assertEq(twinId, honestId);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        twin.castVote(twinId, alice, true, aliceFor);
    }

    function test_QDay_StolenGuardianKeyCanOnlyDelayOnce() public {
        Actions memory a = _payout(grantee, 5 ether);
        uint256 id = _passAndReady(a);

        vm.prank(guardian); // the attacker, with the guardian's classical key
        conclave.pause();
        vm.expectRevert(abi.encodeWithSelector(IConclave.BlockedWhilePaused.selector, 0));
        _execute(id, a);

        // The attacker tries to extend the pause: the fuse is spent.
        vm.warp(block.timestamp + PAUSE - 1);
        vm.prank(guardian);
        vm.expectRevert(IConclave.GuardianDisarmed.selector);
        conclave.pause();

        // When the pause ends the honest payout goes through, and the members rotate the guardian.
        vm.warp(block.timestamp + 1);
        _execute(id, a);
        assertEq(grantee.balance, 5 ether);

        Actions memory rotate = _selfCall(abi.encodeCall(IConclave.setGuardian, (dave)), "Rotate stolen guardian key");
        _execute(_passAndReady(rotate), rotate);
        assertEq(conclave.guardian(), dave);
    }

    function test_QDay_TamperingWithAPassedProposalFails() public {
        Actions memory honest = _payout(grantee, 5 ether);
        uint256 id = _passAndReady(honest);
        Actions memory redirected = _payout(attacker, 5 ether);
        vm.prank(relayer);
        vm.expectRevert(IConclave.ProposalHashMismatch.selector);
        conclave.execute(id, redirected.targets, redirected.values, redirected.calldatas, keccak256("Grant payout"));
        assertEq(attacker.balance, 0);
    }
}
