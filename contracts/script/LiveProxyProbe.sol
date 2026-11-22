// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ConclaveProxy} from "../src/ConclaveProxy.sol";
import {QorePQCProbeHarness} from "./LivePqcProbe.sol";

/// @notice Checks on the LIVE chain that QoreChain's PQC precompiles answer inside the proxy pattern
///         Conclave uses, in an `eth_call` of this creation code (nothing is deployed, no funds).
///         Used by `scripts/pqc-check.ts`.
///
///         Behind ConclaveProxy every Conclave call runs in a DELEGATECALL frame, and `initialize`
///         runs in a DELEGATECALL from the proxy's constructor. This puts Conclave's precompile
///         wrappers (QorePQC) behind a real ConclaveProxy, so both precompiles are exercised in
///         exactly those frames: the init call reads a member's key (`pqcKeyStatus`), later calls
///         verify a signature (`pqcVerify`) and read the key again. It also checks that the
///         ProxyAdmin the proxy creates is owned by the proxy, as Conclave is deployed.
///         (The full Conclave implementation is not created here: the node caps an eth_call at
///         about 5M gas, and creating the implementation alone takes 3.9M.)
/// @dev Returns abi.encode(deployed, adminOwnedByProxy, validViaProxy, tamperedViaProxy, keyLength).
contract LiveProxyProbe {
    constructor(
        bytes memory pubkey,
        bytes memory signedBytes,
        bytes memory tamperedBytes,
        bytes memory signature,
        address registeredMember
    ) {
        QorePQCProbeHarness harness = new QorePQCProbeHarness(); // nonce 1
        address predicted = _createAddress(address(this), 2);
        // Like Conclave.initialize, the init call runs in a DELEGATECALL from the proxy's constructor.
        bytes memory init = registeredMember != address(0)
            ? abi.encodeCall(QorePQCProbeHarness.keyOf, (registeredMember))
            : abi.encodeCall(QorePQCProbeHarness.accepts, (pubkey, signedBytes, signature));
        QorePQCProbeHarness viaProxy =
            QorePQCProbeHarness(address(new ConclaveProxy(address(harness), predicted, init))); // nonce 2

        bool deployed = address(viaProxy) == predicted;
        // TransparentUpgradeableProxy creates its ProxyAdmin as its first contract (nonce 1).
        bool adminOwnedByProxy = Ownable(_createAddress(address(viaProxy), 1)).owner() == address(viaProxy);
        bool validViaProxy = viaProxy.accepts(pubkey, signedBytes, signature);
        bool tamperedViaProxy = viaProxy.accepts(pubkey, tamperedBytes, signature);
        uint256 keyLength = registeredMember != address(0) ? viaProxy.keyOf(registeredMember).length : 0;

        bytes memory out = abi.encode(deployed, adminOwnedByProxy, validViaProxy, tamperedViaProxy, keyLength);
        assembly {
            return(add(out, 32), mload(out))
        }
    }

    /// @dev CREATE address for `deployer` at `nonce` (1..127).
    function _createAddress(address deployer, uint8 nonce) private pure returns (address) {
        return
            address(uint160(uint256(keccak256(abi.encodePacked(bytes1(0xd6), bytes1(0x94), deployer, bytes1(nonce))))));
    }
}
