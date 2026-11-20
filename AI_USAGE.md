# AI usage

Conclave was built with an AI coding assistant (Claude Code, by Anthropic) working in this
repository under the team's direction. This file documents the workflow, what the AI produced and
what the humans did, as asked by the Best AI-Native Build award.

## Workflow

1. **Research.** The assistant read the fest's rules, prize conditions, FAQ and kits pages, and the
   published QoreChain packages (`@qorechain/sdk`, `@qorechain/evm`, `@qorechain/qoresign`,
   `create-qorechain-dapp`) to extract the exact facts the design depends on: precompile
   addresses and ABI, ML-DSA-87 sizes and algorithm id, the QoreX message-signing format, and how
   EVM windows work.
2. **Design.** It proposed the idea (a DAO, since no Post-Quantum dApp entry covered one), the
   Q-Day security model and the architecture in `docs/ARCHITECTURE.md`. The team chose it.
3. **Implementation.** It wrote the contracts, the tests and the scripts, compiled and ran them
   after every change, and fixed what failed.
4. **Verification.** Rather than trusting its own reading of the docs, it checked assumptions
   against real code and the live chain:
   - differential tests against QoreSign, the library QoreX signs with (`test-ffi/`);
   - `scripts/pqc-check.ts`, which runs the contract's Solidity code against the live testnet
     precompiles with a real ML-DSA-87 signature;
   - an invariant campaign whose coverage it measured and improved (from 24% to 61% of runs
     reaching an executed payout) so the properties were not passing trivially.
5. **Documentation.** It drafted the README, architecture, threat model and audit workbook.

## Generated work

| Area | AI-generated | Notes |
|---|---|---|
| `contracts/src/` | Yes | Reviewed by the team |
| `contracts/test/`, `contracts/test-ffi/` | Yes | |
| `contracts/scripts/` | Yes | `window.ts` adapted from the create-qorechain-dapp template |
| `docs/`, `README.md` | Drafted by AI | Edited by the team |

## Human contribution

_To be completed by the team, honestly and specifically, for example:_

- Chose the bounty, the idea and the scope; reviewed the design decisions.
- Registered the team, created the wallets and registered the ML-DSA-87 keys.
- Ran the testnet deployment and the life cycle, and collected the evidence in `docs/EVIDENCE.md`.
- Ran both QCAI audit stages and decided how to respond to each finding.
- Recorded the demo video and built the frontend.

## Where the AI was wrong, and how it was caught

- It first targeted the Shanghai EVM; OpenZeppelin 5.7 needs Cancun opcodes. The compiler caught it
  and the target was changed after confirming QoreChain supports Prague-era transactions.
- Its first invariant handler overflowed on extreme fuzz inputs and rarely executed payouts;
  measuring the campaign exposed both.
