// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/// @title ConclaveMessages
/// @notice Builds the human-readable messages Conclave members sign with their ML-DSA-87 key.
/// @dev QoreX shows the whole message before the member approves it, so every message says in plain
///      text what is being authorised. Each message is bound to:
///        - the action (`propose`, `vote`, `cancel`): a signature for one action never works for another;
///        - the member's own address: a key registered for two accounts cannot vote twice;
///        - this DAO's address and the EVM chain id: no replay on another deployment or network;
///        - the proposal id and the hash of its exact content.
///      Fields are newline-separated `key: value` pairs. Values are decimal integers or lowercase hex,
///      which never contain a newline, so the encoding is unambiguous.
///
///      The wallet signs `"qorechain-msg-v1|" + <native chain id> + "|" + <message>` (QoreSign
///      `messagePqSignBytes`); see {signingBytes}.
library ConclaveMessages {
    using Strings for uint256;
    using Strings for address;

    /// @notice Domain prefix QoreX and QoreSign put before every signed message.
    string internal constant QORECHAIN_MESSAGE_DOMAIN = "qorechain-msg-v1|";

    /// @notice Message a member signs to submit a proposal.
    function propose(address dao, address member, uint256 nonce, uint256 deadline, bytes32 proposalHash)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodePacked(
            "Conclave v1\naction: propose",
            "\nproposal hash: ",
            _hex32(proposalHash),
            "\nnonce: ",
            nonce.toString(),
            "\nvalid until: ",
            deadline.toString(),
            _binding(dao, member)
        );
    }

    /// @notice Message a member signs to vote on a proposal.
    function vote(address dao, address member, uint256 proposalId, bytes32 proposalHash, bool support)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodePacked(
            "Conclave v1\naction: vote",
            "\nsupport: ",
            support ? "for" : "against",
            "\nproposal: ",
            proposalId.toString(),
            "\nproposal hash: ",
            _hex32(proposalHash),
            _binding(dao, member)
        );
    }

    /// @notice Message the proposer signs to cancel their proposal.
    function cancel(address dao, address member, uint256 proposalId, bytes32 proposalHash)
        internal
        view
        returns (bytes memory)
    {
        return abi.encodePacked(
            "Conclave v1\naction: cancel",
            "\nproposal: ",
            proposalId.toString(),
            "\nproposal hash: ",
            _hex32(proposalHash),
            _binding(dao, member)
        );
    }

    /// @notice The exact bytes the ML-DSA-87 key signs for `message` on `nativeChainId`.
    function signingBytes(string memory nativeChainId, bytes memory message) internal pure returns (bytes memory) {
        return abi.encodePacked(QORECHAIN_MESSAGE_DOMAIN, nativeChainId, "|", message);
    }

    function _binding(address dao, address member) private view returns (bytes memory) {
        return abi.encodePacked(
            "\nmember: ", member.toHexString(), "\ndao: ", dao.toHexString(), "\nchain: ", block.chainid.toString()
        );
    }

    function _hex32(bytes32 value) private pure returns (string memory) {
        return uint256(value).toHexString(32);
    }
}
