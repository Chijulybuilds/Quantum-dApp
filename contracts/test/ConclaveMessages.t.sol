// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {ConclaveMessages} from "../src/libraries/ConclaveMessages.sol";

contract MessagesHarness {
    function propose(address dao, address member, uint256 nonce, uint256 deadline, bytes32 hash)
        external
        view
        returns (string memory)
    {
        return string(ConclaveMessages.propose(dao, member, nonce, deadline, hash));
    }

    function vote(address dao, address member, uint256 id, bytes32 hash, bool support)
        external
        view
        returns (string memory)
    {
        return string(ConclaveMessages.vote(dao, member, id, hash, support));
    }

    function cancel(address dao, address member, uint256 id, bytes32 hash) external view returns (string memory) {
        return string(ConclaveMessages.cancel(dao, member, id, hash));
    }

    function signingBytes(string calldata chainId, bytes calldata message) external pure returns (bytes memory) {
        return ConclaveMessages.signingBytes(chainId, message);
    }
}

/// @notice Golden tests: the exact text members see in QoreX. Changing the format is a breaking
///         change for every wallet and frontend, so it must be deliberate.
contract ConclaveMessagesTest is Test {
    MessagesHarness internal h = new MessagesHarness();

    address internal immutable DAO = vm.parseAddress("0x00000000000000000000000000000000000c0de0");
    address internal immutable MEMBER = vm.parseAddress("0xabcdef0123456789abcdef0123456789abcdef01");
    bytes32 internal constant HASH = 0x1111111111111111111111111111111111111111111111111111111111111111;

    function setUp() public {
        vm.chainId(9800);
    }

    function test_Golden_Vote() public view {
        assertEq(
            h.vote(DAO, MEMBER, 7, HASH, true),
            "Conclave v1\n" "action: vote\n" "support: for\n" "proposal: 7\n"
            "proposal hash: 0x1111111111111111111111111111111111111111111111111111111111111111\n"
            "member: 0xabcdef0123456789abcdef0123456789abcdef01\n" "dao: 0x00000000000000000000000000000000000c0de0\n"
            "chain: 9800"
        );
        assertEq(
            h.vote(DAO, MEMBER, 7, HASH, false),
            "Conclave v1\n" "action: vote\n" "support: against\n" "proposal: 7\n"
            "proposal hash: 0x1111111111111111111111111111111111111111111111111111111111111111\n"
            "member: 0xabcdef0123456789abcdef0123456789abcdef01\n" "dao: 0x00000000000000000000000000000000000c0de0\n"
            "chain: 9800"
        );
    }

    function test_Golden_Propose() public view {
        assertEq(
            h.propose(DAO, MEMBER, 3, 1_764_633_600, HASH),
            "Conclave v1\n" "action: propose\n"
            "proposal hash: 0x1111111111111111111111111111111111111111111111111111111111111111\n" "nonce: 3\n"
            "valid until: 1764633600\n" "member: 0xabcdef0123456789abcdef0123456789abcdef01\n"
            "dao: 0x00000000000000000000000000000000000c0de0\n" "chain: 9800"
        );
    }

    function test_Golden_Cancel() public view {
        assertEq(
            h.cancel(DAO, MEMBER, 12, bytes32(0)),
            "Conclave v1\n" "action: cancel\n" "proposal: 12\n"
            "proposal hash: 0x0000000000000000000000000000000000000000000000000000000000000000\n"
            "member: 0xabcdef0123456789abcdef0123456789abcdef01\n" "dao: 0x00000000000000000000000000000000000c0de0\n"
            "chain: 9800"
        );
    }

    function test_Golden_SigningBytes() public view {
        assertEq(h.signingBytes("qorechain-diana", "abc"), bytes("qorechain-msg-v1|qorechain-diana|abc"));
    }

    function test_MessagesFitInQorexLimit() public view {
        // QoreX signs messages of 1 to 4096 bytes.
        bytes32 maxHash = bytes32(type(uint256).max);
        uint256 longest = bytes(h.propose(DAO, MEMBER, type(uint256).max, type(uint256).max, maxHash)).length;
        assertLt(longest, 4096);
    }

    function test_MessagesDoNotUseReservedQorechainPrefix() public view {
        // QoreX refuses messages that start with a reserved "qorechain-" signing prefix.
        bytes memory m = bytes(h.vote(DAO, MEMBER, 1, HASH, true));
        assertEq(uint8(m[0]), uint8(0x43)); // "C"
    }

    function testFuzz_ActionsNeverCollide(uint256 id, bytes32 hash, bool support) public view {
        bytes32 v = keccak256(bytes(h.vote(DAO, MEMBER, id, hash, support)));
        bytes32 c = keccak256(bytes(h.cancel(DAO, MEMBER, id, hash)));
        bytes32 p = keccak256(bytes(h.propose(DAO, MEMBER, id, id, hash)));
        assertTrue(v != c && v != p && c != p);
    }
}
