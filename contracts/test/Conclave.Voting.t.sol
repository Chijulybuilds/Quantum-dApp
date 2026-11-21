// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Conclave} from "../src/Conclave.sol";
import {IConclave} from "../src/interfaces/IConclave.sol";
import {QorePQC} from "../src/libraries/QorePQC.sol";
import {ConclaveTestBase} from "./utils/ConclaveTestBase.sol";

contract ConclaveVotingTest is ConclaveTestBase {
    Actions internal payout;
    uint256 internal id;

    function setUp() public override {
        super.setUp();
        payout = _payout(grantee, 10 ether);
        id = _propose(alice, payout);
    }

    function test_Vote_CountsAndQueuesAtThreshold() public {
        vm.expectEmit(address(conclave));
        emit IConclave.VoteCast(id, alice, true, 1, 0);
        _vote(id, alice, true);
        _assertState(id, IConclave.ProposalState.Active);
        assertTrue(conclave.hasVoted(id, alice));

        vm.expectEmit(address(conclave));
        emit IConclave.VoteCast(id, bob, true, 2, 0);
        vm.expectEmit(address(conclave));
        emit IConclave.ProposalQueued(id, uint64(block.timestamp + TIMELOCK));
        _vote(id, bob, true);

        _assertState(id, IConclave.ProposalState.Queued);
        assertEq(conclave.getProposal(id).eta, block.timestamp + TIMELOCK);
        vm.warp(block.timestamp + TIMELOCK);
        _assertState(id, IConclave.ProposalState.Ready);
    }

    function test_Vote_MessageViewMatchesSpecification() public view {
        bytes32 hash = conclave.getProposal(id).proposalHash;
        assertEq(bytes(conclave.voteMessage(id, bob, true)), _voteMsg(address(conclave), bob, id, hash, true));
        assertEq(bytes(conclave.voteMessage(id, bob, false)), _voteMsg(address(conclave), bob, id, hash, false));
    }

    function test_Vote_AgainstVotesDefeatEarly() public {
        _vote(id, alice, false);
        _assertState(id, IConclave.ProposalState.Active); // 1 against, threshold still reachable
        _vote(id, bob, false);
        // 2 of 3 against: at most 1 FOR is left, below the threshold of 2.
        _assertState(id, IConclave.ProposalState.Defeated);
        bytes memory sig = _voteSig(id, carol, true);
        vm.expectRevert(
            abi.encodeWithSelector(IConclave.UnexpectedState.selector, id, IConclave.ProposalState.Defeated)
        );
        conclave.castVote(id, carol, true, sig);
    }

    function test_Vote_DefeatedWhenVotingPeriodEnds() public {
        _vote(id, alice, true);
        vm.warp(block.timestamp + VOTING_PERIOD);
        _assertState(id, IConclave.ProposalState.Active); // the last second still counts
        vm.warp(block.timestamp + 1);
        _assertState(id, IConclave.ProposalState.Defeated);
        bytes memory sig = _voteSig(id, bob, true);
        vm.expectRevert(
            abi.encodeWithSelector(IConclave.UnexpectedState.selector, id, IConclave.ProposalState.Defeated)
        );
        conclave.castVote(id, bob, true, sig);
    }

    function test_RevertWhen_VotingTwice() public {
        _vote(id, alice, true);
        bytes memory sig = _voteSig(id, alice, true);
        vm.expectRevert(abi.encodeWithSelector(IConclave.AlreadyVoted.selector, id, alice));
        conclave.castVote(id, alice, true, sig);
    }

    function test_RevertWhen_VoterIsNotMember() public {
        bytes memory sig = _voteSig(id, dave, true);
        vm.expectRevert(abi.encodeWithSelector(IConclave.NotMember.selector, dave));
        conclave.castVote(id, dave, true, sig);
    }

    function test_RevertWhen_SupportFlipped() public {
        bytes memory againstSig = _voteSig(id, alice, false);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.castVote(id, alice, true, againstSig);
    }

    function test_RevertWhen_SignatureIsForAnotherProposal() public {
        uint256 other = _propose(bob, _payout(grantee, 1 ether));
        bytes memory sigForOther = _voteSig(other, alice, true);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.castVote(id, alice, true, sigForOther);
    }

    function test_RevertWhen_SignatureIsForAnotherDao() public {
        Conclave twin = _deploy(_founders(), 2, guardian);
        bytes32 hash = conclave.getProposal(id).proposalHash;
        bytes memory sigForTwin = _sign(alice, _voteMsg(address(twin), alice, id, hash, true));
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.castVote(id, alice, true, sigForTwin);
    }

    function test_RevertWhen_SignatureIsForAnotherEvmChain() public {
        bytes32 hash = conclave.getProposal(id).proposalHash;
        vm.chainId(9801); // mainnet EVM chain id
        bytes memory msgOnMainnet = _voteMsg(address(conclave), alice, id, hash, true);
        vm.chainId(EVM_CHAIN_ID);
        bytes memory sig = _sign(alice, msgOnMainnet);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.castVote(id, alice, true, sig);
    }

    function test_RevertWhen_SignatureIsForAnotherNativeChain() public {
        bytes32 hash = conclave.getProposal(id).proposalHash;
        bytes memory signed = _qorexSignedBytes("qorechain-vladi", _voteMsg(address(conclave), alice, id, hash, true));
        bytes memory sig = _signWithKey(_pubkeyOf(alice), signed);
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.castVote(id, alice, true, sig);
    }

    function test_RevertWhen_SignatureLacksQorexDomain() public {
        // A signature over the bare message (no "qorechain-msg-v1|<chain>|" prefix) is not accepted.
        bytes32 hash = conclave.getProposal(id).proposalHash;
        bytes memory sig = _signWithKey(_pubkeyOf(alice), _voteMsg(address(conclave), alice, id, hash, true));
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.castVote(id, alice, true, sig);
    }

    function test_RevertWhen_SharedKeyUsedForAnotherMember() public {
        // carol registers the very same ML-DSA-87 key as bob (possible with non address-bound keys).
        keyRegistry.setKey(carol, true, 1, _pubkeyOf(bob));
        bytes memory bobSig = _voteSig(id, bob, true);
        // bob's signature names bob as the member, so it cannot be counted as carol's vote.
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, carol));
        conclave.castVote(id, carol, true, bobSig);
    }

    function test_RevertWhen_KeyRotatedAfterSigning() public {
        bytes memory sig = _voteSig(id, alice, true);
        keyRegistry.setKey(alice, true, 1, _pubkeyOf(makeAddr("alice-new-key")));
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.castVote(id, alice, true, sig);
    }

    function test_RevertWhen_KeyRevoked() public {
        bytes memory sig = _voteSig(id, alice, true);
        keyRegistry.setKey(alice, false, 0, "");
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcKeyNotRegistered.selector, alice));
        conclave.castVote(id, alice, true, sig);
    }

    function test_RevertWhen_VotingAfterQueued() public {
        _vote(id, alice, true);
        _vote(id, bob, true);
        bytes memory sig = _voteSig(id, carol, false);
        vm.expectRevert(abi.encodeWithSelector(IConclave.UnexpectedState.selector, id, IConclave.ProposalState.Queued));
        conclave.castVote(id, carol, false, sig);
    }

    function test_RevertWhen_UnknownProposal() public {
        bytes memory sig = new bytes(SIG_LEN);
        vm.expectRevert(abi.encodeWithSelector(IConclave.UnexpectedState.selector, 99, IConclave.ProposalState.Unknown));
        conclave.castVote(99, alice, true, sig);
    }

    // ---------------------------------------------------------------------------------------------
    // castVotes (batch relay)
    // ---------------------------------------------------------------------------------------------

    function _batch(address[] memory voters, bool support)
        internal
        view
        returns (bool[] memory choices, bytes[] memory sigs)
    {
        choices = new bool[](voters.length);
        sigs = new bytes[](voters.length);
        for (uint256 i; i < voters.length; ++i) {
            choices[i] = support;
            sigs[i] = _voteSig(id, voters[i], support);
        }
    }

    function test_CastVotes_QueuesInOneTransaction() public {
        address[] memory voters = new address[](2);
        voters[0] = alice;
        voters[1] = carol;
        (bool[] memory choices, bytes[] memory sigs) = _batch(voters, true);
        vm.prank(relayer);
        uint256 counted = conclave.castVotes(id, voters, choices, sigs);
        assertEq(counted, 2);
        _assertState(id, IConclave.ProposalState.Queued);
    }

    function test_CastVotes_SkipsVotesAlreadyRelayed() public {
        address[] memory voters = new address[](2);
        voters[0] = bob;
        voters[1] = alice;
        (bool[] memory choices, bytes[] memory sigs) = _batch(voters, true);
        // Someone front-runs the batch with bob's vote: the batch must still go through.
        vm.prank(attacker);
        conclave.castVote(id, bob, true, sigs[0]);
        uint256 counted = conclave.castVotes(id, voters, choices, sigs);
        assertEq(counted, 1);
        assertEq(conclave.getProposal(id).forVotes, 2);
        _assertState(id, IConclave.ProposalState.Queued);
    }

    function test_CastVotes_StopsOnceQueued() public {
        address[] memory voters = _founders();
        (bool[] memory choices, bytes[] memory sigs) = _batch(voters, true);
        uint256 counted = conclave.castVotes(id, voters, choices, sigs);
        assertEq(counted, 2);
        assertFalse(conclave.hasVoted(id, carol));
        assertEq(conclave.getProposal(id).forVotes, 2);
    }

    function test_RevertWhen_CastVotesContainsForgedSignature() public {
        address[] memory voters = new address[](2);
        voters[0] = alice;
        voters[1] = bob;
        (bool[] memory choices, bytes[] memory sigs) = _batch(voters, true);
        sigs[1] = _voteSig(id, carol, true); // carol's signature presented as bob's
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, bob));
        conclave.castVotes(id, voters, choices, sigs);
        assertFalse(conclave.hasVoted(id, alice)); // all or nothing
    }

    function test_RevertWhen_CastVotesLengthMismatch() public {
        vm.expectRevert(IConclave.LengthMismatch.selector);
        conclave.castVotes(id, new address[](0), new bool[](0), new bytes[](0));
        vm.expectRevert(IConclave.LengthMismatch.selector);
        conclave.castVotes(id, new address[](2), new bool[](1), new bytes[](2));
        vm.expectRevert(IConclave.LengthMismatch.selector);
        conclave.castVotes(id, new address[](2), new bool[](2), new bytes[](3));
    }

    // ---------------------------------------------------------------------------------------------
    // Fuzz: a vote signature is bound to exactly one (proposal, member, support)
    // ---------------------------------------------------------------------------------------------

    function testFuzz_VoteSignatureBinding(uint8 signerSeed, bool signedSupport, uint8 voterSeed, bool usedSupport)
        public
    {
        address[] memory founders = _founders();
        address signer = founders[signerSeed % 3];
        address voter = founders[voterSeed % 3];
        bytes memory sig = _voteSig(id, signer, signedSupport);

        if (signer == voter && signedSupport == usedSupport) {
            conclave.castVote(id, voter, usedSupport, sig);
            assertTrue(conclave.hasVoted(id, voter));
        } else {
            vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, voter));
            conclave.castVote(id, voter, usedSupport, sig);
        }
    }

    function testFuzz_RandomSignaturesNeverVerify(bytes32 seed) public {
        bytes memory sig = new bytes(SIG_LEN);
        assembly {
            mstore(add(sig, 32), seed)
        }
        vm.expectRevert(abi.encodeWithSelector(QorePQC.PqcInvalidSignature.selector, alice));
        conclave.castVote(id, alice, true, sig);
    }
}
