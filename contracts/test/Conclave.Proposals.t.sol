// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IConclave} from "../src/interfaces/IConclave.sol";
import {QorePQC} from "../src/libraries/QorePQC.sol";
import {ConclaveTestBase} from "./utils/ConclaveTestBase.sol";

contract ConclaveProposalsTest is ConclaveTestBase {
    // ---------------------------------------------------------------------------------------------
    // propose
    // ---------------------------------------------------------------------------------------------

    function test_Propose_CreatesActiveProposal() public {
        Actions memory a = _payout(grantee, 10 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(alice, _proposeMsg(address(conclave), alice, 0, deadline, _hash(a)));

        vm.expectEmit(address(conclave));
        emit IConclave.ProposalCreated(
            1,
            alice,
            _hash(a),
            a.targets,
            a.values,
            a.calldatas,
            a.description,
            uint64(block.timestamp + VOTING_PERIOD),
            0
        );
        vm.prank(relayer);
        uint256 id = conclave.propose(alice, a.targets, a.values, a.calldatas, a.description, deadline, sig);

        assertEq(id, 1);
        assertEq(conclave.proposalCount(), 1);
        assertEq(conclave.proposeNonce(alice), 1);
        _assertState(id, IConclave.ProposalState.Active);
        IConclave.Proposal memory p = conclave.getProposal(id);
        assertEq(p.proposalHash, _hash(a));
        assertEq(p.proposer, alice);
        assertEq(p.voteEnd, block.timestamp + VOTING_PERIOD);
        assertEq(p.epoch, 0);
        assertEq(p.eta, 0);
        assertEq(p.forVotes + p.againstVotes, 0);
    }

    function test_Propose_AnyoneCanRelay() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(bob, _proposeMsg(address(conclave), bob, 0, deadline, _hash(a)));
        vm.prank(attacker); // the relayer's identity is irrelevant
        uint256 id = conclave.propose(bob, a.targets, a.values, a.calldatas, a.description, deadline, sig);
        assertEq(conclave.getProposal(id).proposer, bob);
    }

    function test_Propose_MessageViewMatchesSpecification() public view {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 deadline = block.timestamp + 1 hours;
        assertEq(
            bytes(conclave.proposeMessage(alice, _hash(a), deadline)),
            _proposeMsg(address(conclave), alice, 0, deadline, _hash(a))
        );
    }

    function test_RevertWhen_ProposerIsNotMember() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(dave, _proposeMsg(address(conclave), dave, 0, deadline, _hash(a)));
        vm.expectRevert(abi.encodeWithSelector(IConclave.NotMember.selector, dave));
        conclave.propose(dave, a.targets, a.values, a.calldatas, a.description, deadline, sig);
    }

    function test_RevertWhen_SignedByAnotherMember() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 deadline = block.timestamp + 1 hours;
        // bob signs alice's message: the key does not match alice's registered key.
        bytes memory sig = _sign(bob, _proposeMsg(address(conclave), alice, 0, deadline, _hash(a)));
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.propose(alice, a.targets, a.values, a.calldatas, a.description, deadline, sig);
    }

    function test_RevertWhen_ProposeSignatureReplayed() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(alice, _proposeMsg(address(conclave), alice, 0, deadline, _hash(a)));
        conclave.propose(alice, a.targets, a.values, a.calldatas, a.description, deadline, sig);
        // The nonce moved on: the same signature no longer matches.
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.propose(alice, a.targets, a.values, a.calldatas, a.description, deadline, sig);
    }

    function test_RevertWhen_ProposeSignatureExpired() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(alice, _proposeMsg(address(conclave), alice, 0, deadline, _hash(a)));
        vm.warp(deadline + 1);
        vm.expectRevert(abi.encodeWithSelector(IConclave.SignatureExpired.selector, deadline));
        conclave.propose(alice, a.targets, a.values, a.calldatas, a.description, deadline, sig);
    }

    function test_RevertWhen_SubmittedContentDiffersFromSigned() public {
        Actions memory signed = _payout(grantee, 1 ether);
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(alice, _proposeMsg(address(conclave), alice, 0, deadline, _hash(signed)));

        Actions memory tampered = _payout(attacker, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.propose(
            alice, tampered.targets, tampered.values, tampered.calldatas, tampered.description, deadline, sig
        );

        tampered = _payout(grantee, 100 ether);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.propose(
            alice, tampered.targets, tampered.values, tampered.calldatas, tampered.description, deadline, sig
        );

        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.propose(alice, signed.targets, signed.values, signed.calldatas, "Other text", deadline, sig);
    }

    function test_RevertWhen_SignatureHasWrongLength() public {
        Actions memory a = _payout(grantee, 1 ether);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcMalformedSignature.selector, 65));
        conclave.propose(alice, a.targets, a.values, a.calldatas, a.description, block.timestamp, new bytes(65));
    }

    function test_RevertWhen_ActionsInvalid() public {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = new bytes(SIG_LEN);

        vm.expectRevert(IConclave.InvalidActions.selector);
        conclave.propose(alice, new address[](0), new uint256[](0), new bytes[](0), "", deadline, sig);

        vm.expectRevert(IConclave.InvalidActions.selector);
        conclave.propose(alice, new address[](2), new uint256[](1), new bytes[](2), "", deadline, sig);

        vm.expectRevert(IConclave.InvalidActions.selector);
        conclave.propose(alice, new address[](2), new uint256[](2), new bytes[](1), "", deadline, sig);

        address[] memory many = new address[](17);
        for (uint256 i; i < many.length; ++i) {
            many[i] = grantee;
        }
        vm.expectRevert(IConclave.InvalidActions.selector);
        conclave.propose(alice, many, new uint256[](17), new bytes[](17), "", deadline, sig);

        // A zero target would burn the value sent to it.
        vm.expectRevert(IConclave.InvalidActions.selector);
        conclave.propose(alice, new address[](1), new uint256[](1), new bytes[](1), "", deadline, sig);
    }

    // ---------------------------------------------------------------------------------------------
    // cancel
    // ---------------------------------------------------------------------------------------------

    function test_Cancel_ByProposer() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 id = _propose(alice, a);
        bytes memory sig = _sign(alice, _cancelMsg(address(conclave), alice, id, _hash(a)));
        assertEq(bytes(conclave.cancelMessage(id)), _cancelMsg(address(conclave), alice, id, _hash(a)));

        vm.expectEmit(address(conclave));
        emit IConclave.ProposalCanceled(id);
        vm.prank(relayer);
        conclave.cancel(id, sig);
        _assertState(id, IConclave.ProposalState.Canceled);

        bytes memory voteSig = _voteSig(id, bob, true);
        vm.expectRevert(
            abi.encodeWithSelector(IConclave.UnexpectedState.selector, id, IConclave.ProposalState.Canceled)
        );
        conclave.castVote(id, bob, true, voteSig);
    }

    function test_Cancel_QueuedProposalCannotBeExecuted() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 id = _passAndReady(a);
        conclave.cancel(id, _sign(alice, _cancelMsg(address(conclave), alice, id, _hash(a))));
        vm.expectRevert(
            abi.encodeWithSelector(IConclave.UnexpectedState.selector, id, IConclave.ProposalState.Canceled)
        );
        _execute(id, a);
        assertEq(grantee.balance, 0);
    }

    function test_RevertWhen_CancelSignedByAnotherMember() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 id = _propose(alice, a);
        bytes memory sig = _sign(bob, _cancelMsg(address(conclave), bob, id, _hash(a)));
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.cancel(id, sig);
    }

    function test_RevertWhen_CancelAfterExecution() public {
        Actions memory a = _payout(grantee, 1 ether);
        uint256 id = _passAndReady(a);
        _execute(id, a);
        bytes memory sig = _sign(alice, _cancelMsg(address(conclave), alice, id, _hash(a)));
        vm.expectRevert(
            abi.encodeWithSelector(IConclave.UnexpectedState.selector, id, IConclave.ProposalState.Executed)
        );
        conclave.cancel(id, sig);
    }

    function test_RevertWhen_MessageForUnknownProposal() public {
        vm.expectRevert(abi.encodeWithSelector(IConclave.UnexpectedState.selector, 7, IConclave.ProposalState.Unknown));
        conclave.voteMessage(7, alice, true);
        vm.expectRevert(abi.encodeWithSelector(IConclave.UnexpectedState.selector, 0, IConclave.ProposalState.Unknown));
        conclave.cancelMessage(0);
    }
}
