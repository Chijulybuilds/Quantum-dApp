// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Conclave} from "../../src/Conclave.sol";

/// @notice Plain ERC-20 standing in for fUSD.
contract TestToken is ERC20 {
    constructor() ERC20("Fest USD", "fUSD") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Non-standard token whose transfer returns false instead of reverting.
contract FalseToken {
    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

/// @notice Target that always reverts with a custom error.
contract RevertingTarget {
    error Boom(uint256 code);

    function fail() external pure {
        revert Boom(42);
    }
}

/// @notice Target that tries to re-enter Conclave while one of its proposals executes.
contract ReentrantTarget {
    Conclave public immutable conclave;

    constructor(Conclave conclave_) {
        conclave = conclave_;
    }

    /// @notice Re-enters `execute` for the same proposal.
    function reenterExecute(
        uint256 id,
        address[] calldata targets,
        uint256[] calldata values,
        bytes[] calldata calldatas,
        bytes32 descriptionHash
    ) external {
        conclave.execute(id, targets, values, calldatas, descriptionHash);
    }

    /// @notice Tries to vote while the guard is held.
    function reenterVote(uint256 id, address voter, bytes calldata signature) external {
        conclave.castVote(id, voter, true, signature);
    }

    /// @notice Tries to call a governance function directly (msg.sender is this contract, not Conclave).
    function callGovernance() external {
        conclave.setThreshold(1);
    }
}
