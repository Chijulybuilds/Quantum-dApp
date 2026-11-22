// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Conclave} from "../../src/Conclave.sol";

/// @notice A future Conclave version, as an upgrade would ship it: same storage, one new feature
///         with its own ERC-7201 namespace and a one-time migration (`reinitializer(2)`).
contract ConclaveV2Mock is Conclave {
    /// @custom:storage-location erc7201:conclave.storage.ConclaveV2
    struct V2Storage {
        string motto;
    }

    function initializeV2(string calldata motto_) external reinitializer(2) {
        _v2().motto = motto_;
    }

    function motto() external view returns (string memory) {
        return _v2().motto;
    }

    function version() external pure override returns (string memory) {
        return "2.0.0";
    }

    function _v2() private pure returns (V2Storage storage $) {
        bytes32 location =
            keccak256(abi.encode(uint256(keccak256("conclave.storage.ConclaveV2")) - 1)) & ~bytes32(uint256(0xff));
        assembly ("memory-safe") {
            $.slot := location
        }
    }
}
