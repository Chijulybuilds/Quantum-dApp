// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {Conclave} from "../../src/Conclave.sol";
import {ConclaveProxy} from "../../src/ConclaveProxy.sol";
import {IConclave} from "../../src/interfaces/IConclave.sol";
import {QorePQC} from "../../src/libraries/QorePQC.sol";
import {MockQorePQC} from "../mocks/MockQorePQC.sol";

/// @notice Shared setup: mock precompiles, three members (2-of-3), a guardian and a funded treasury.
///         Conclave is deployed as in production: an implementation behind a TransparentUpgradeableProxy
///         whose ProxyAdmin is owned by the proxy itself.
/// @dev The messages members sign are rebuilt here from the specification, independently of the
///      contract's own message builder, so a drift in the contract's format makes the tests fail.
abstract contract ConclaveTestBase is Test {
    string internal constant NATIVE_CHAIN_ID = "qorechain-diana";
    uint256 internal constant EVM_CHAIN_ID = 9800;
    uint256 internal constant SIG_LEN = 4627;
    uint256 internal constant KEY_LEN = 2592;

    uint64 internal constant VOTING_PERIOD = 1 days;
    uint64 internal constant TIMELOCK = 1 hours;
    uint64 internal constant GRACE = 7 days;
    uint64 internal constant PAUSE = 1 days;
    uint256 internal constant TREASURY = 100 ether;

    MockQorePQC internal keyRegistry = MockQorePQC(QorePQC.PQC_KEY_STATUS);
    MockQorePQC internal verifier = MockQorePQC(QorePQC.PQC_VERIFY);

    Conclave internal conclave;
    /// @dev The shared implementation every test proxy points at.
    Conclave internal implementation;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal guardian = makeAddr("guardian");
    address internal relayer = makeAddr("relayer");
    address internal attacker = makeAddr("attacker");
    address internal grantee = makeAddr("grantee");

    function setUp() public virtual {
        vm.chainId(EVM_CHAIN_ID);
        // Foundry's EVM has no QoreChain precompiles: install the mock at both addresses.
        bytes memory mockCode = address(new MockQorePQC()).code;
        vm.etch(QorePQC.PQC_VERIFY, mockCode);
        vm.etch(QorePQC.PQC_KEY_STATUS, mockCode);

        _registerKey(alice);
        _registerKey(bob);
        _registerKey(carol);
        _registerKey(dave);

        implementation = new Conclave();
        conclave = _deploy(_founders(), 2, guardian);
        vm.deal(address(conclave), TREASURY);
        vm.label(address(conclave), "Conclave");
    }

    // ---------------------------------------------------------------------------------------------
    // Deployment helpers
    // ---------------------------------------------------------------------------------------------

    function _founders() internal view returns (address[] memory list) {
        list = new address[](3);
        list[0] = alice;
        list[1] = bob;
        list[2] = carol;
    }

    function _timing() internal pure returns (IConclave.Timing memory) {
        return IConclave.Timing({
            votingPeriod: VOTING_PERIOD, timelockDelay: TIMELOCK, gracePeriod: GRACE, pauseDuration: PAUSE
        });
    }

    function _deploy(address[] memory founders, uint16 needed, address guardian_) internal returns (Conclave) {
        return _deployWith(founders, needed, guardian_, _timing(), NATIVE_CHAIN_ID);
    }

    /// @dev Deploys a proxy whose ProxyAdmin is owned by the proxy itself: its address is predicted
    ///      from this contract's nonce, exactly like the production deploy scripts do. The only external
    ///      call is the proxy creation, so `vm.expectRevert` before this applies to the initializer.
    function _deployWith(
        address[] memory founders,
        uint16 needed,
        address guardian_,
        IConclave.Timing memory timing,
        string memory chainId
    ) internal returns (Conclave) {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)));
        bytes memory init = abi.encodeCall(Conclave.initialize, (founders, needed, guardian_, timing, chainId));
        ConclaveProxy proxy = new ConclaveProxy(address(implementation), predicted, init);
        // Under vm.expectRevert a failed creation returns a placeholder; only check real deployments.
        if (address(proxy).code.length != 0) assertEq(address(proxy), predicted, "proxy address prediction");
        return Conclave(payable(address(proxy)));
    }

    // ---------------------------------------------------------------------------------------------
    // Key registry and "ML-DSA-87" signing (mocked)
    // ---------------------------------------------------------------------------------------------

    function _pubkeyOf(address account) internal pure returns (bytes memory key) {
        key = new bytes(KEY_LEN);
        bytes32 seed = keccak256(abi.encode("pubkey", account));
        assembly {
            mstore(add(key, 32), seed)
        }
    }

    function _registerKey(address account) internal {
        keyRegistry.setSeededKey(account, keccak256(abi.encode("pubkey", account)));
    }

    /// @dev Signs `message` with `signer`'s registered key, exactly as QoreX would: the signed bytes
    ///      are "qorechain-msg-v1|" + native chain id + "|" + message.
    function _sign(address signer, bytes memory message) internal pure returns (bytes memory) {
        return _signWithKey(_pubkeyOf(signer), _qorexSignedBytes(NATIVE_CHAIN_ID, message));
    }

    function _signWithKey(bytes memory pubkey, bytes memory signedBytes) internal pure returns (bytes memory sig) {
        sig = new bytes(SIG_LEN);
        bytes32 t = keccak256(abi.encode("mock-ml-dsa-87", pubkey, signedBytes));
        assembly {
            mstore(add(sig, 32), t)
        }
    }

    function _qorexSignedBytes(string memory chainId, bytes memory message) internal pure returns (bytes memory) {
        return bytes.concat("qorechain-msg-v1|", bytes(chainId), "|", message);
    }

    // ---------------------------------------------------------------------------------------------
    // Messages, rebuilt from the specification (see docs/ARCHITECTURE.md)
    // ---------------------------------------------------------------------------------------------

    function _binding(address dao, address member) internal view returns (bytes memory) {
        return bytes.concat(
            "\nmember: ",
            bytes(vm.toLowercase(vm.toString(member))),
            "\ndao: ",
            bytes(vm.toLowercase(vm.toString(dao))),
            "\nchain: ",
            bytes(vm.toString(block.chainid))
        );
    }

    function _proposeMsg(address dao, address member, uint256 nonce, uint256 deadline, bytes32 hash)
        internal
        view
        returns (bytes memory)
    {
        return bytes.concat(
            "Conclave v1\naction: propose\nproposal hash: ",
            bytes(vm.toString(hash)),
            "\nnonce: ",
            bytes(vm.toString(nonce)),
            "\nvalid until: ",
            bytes(vm.toString(deadline)),
            _binding(dao, member)
        );
    }

    function _voteMsg(address dao, address member, uint256 id, bytes32 hash, bool support)
        internal
        view
        returns (bytes memory)
    {
        return bytes.concat(
            "Conclave v1\naction: vote\nsupport: ",
            support ? bytes("for") : bytes("against"),
            "\nproposal: ",
            bytes(vm.toString(id)),
            "\nproposal hash: ",
            bytes(vm.toString(hash)),
            _binding(dao, member)
        );
    }

    function _cancelMsg(address dao, address member, uint256 id, bytes32 hash) internal view returns (bytes memory) {
        return bytes.concat(
            "Conclave v1\naction: cancel\nproposal: ",
            bytes(vm.toString(id)),
            "\nproposal hash: ",
            bytes(vm.toString(hash)),
            _binding(dao, member)
        );
    }

    // ---------------------------------------------------------------------------------------------
    // Proposal helpers
    // ---------------------------------------------------------------------------------------------

    struct Actions {
        address[] targets;
        uint256[] values;
        bytes[] calldatas;
        string description;
    }

    function _payout(address to, uint256 amount) internal pure returns (Actions memory a) {
        a.targets = new address[](1);
        a.values = new uint256[](1);
        a.calldatas = new bytes[](1);
        a.targets[0] = to;
        a.values[0] = amount;
        a.description = "Grant payout";
    }

    function _selfCall(bytes memory data, string memory description) internal view returns (Actions memory a) {
        a.targets = new address[](1);
        a.values = new uint256[](1);
        a.calldatas = new bytes[](1);
        a.targets[0] = address(conclave);
        a.calldatas[0] = data;
        a.description = description;
    }

    function _hash(Actions memory a) internal pure returns (bytes32) {
        return keccak256(abi.encode(a.targets, a.values, a.calldatas, keccak256(bytes(a.description))));
    }

    function _propose(address proposer, Actions memory a) internal returns (uint256 id) {
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(
            proposer, _proposeMsg(address(conclave), proposer, conclave.proposeNonce(proposer), deadline, _hash(a))
        );
        vm.prank(relayer);
        id = conclave.propose(proposer, a.targets, a.values, a.calldatas, a.description, deadline, sig);
    }

    function _voteSig(uint256 id, address voter, bool support) internal view returns (bytes memory) {
        bytes32 hash = conclave.getProposal(id).proposalHash;
        return _sign(voter, _voteMsg(address(conclave), voter, id, hash, support));
    }

    function _vote(uint256 id, address voter, bool support) internal {
        bytes memory sig = _voteSig(id, voter, support);
        vm.prank(relayer);
        conclave.castVote(id, voter, support, sig);
    }

    /// @dev Proposes, gathers alice + bob's FOR votes (2-of-3) and waits out the timelock.
    function _passAndReady(Actions memory a) internal returns (uint256 id) {
        id = _propose(alice, a);
        _vote(id, alice, true);
        _vote(id, bob, true);
        vm.warp(block.timestamp + TIMELOCK);
        assertEq(uint8(conclave.state(id)), uint8(IConclave.ProposalState.Ready), "not ready");
    }

    function _execute(uint256 id, Actions memory a) internal {
        vm.prank(relayer);
        conclave.execute(id, a.targets, a.values, a.calldatas, keccak256(bytes(a.description)));
    }

    function _assertState(uint256 id, IConclave.ProposalState expected) internal view {
        assertEq(uint8(conclave.state(id)), uint8(expected), "unexpected proposal state");
    }
}
