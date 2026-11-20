# Conclave

**A DAO treasury that only moves on post-quantum votes.**

Built for the **Post-Quantum dApp** bounty of *Build Before Q-Day: the QoreChain Developer Fest*.

<!-- After creating the project on build.qorechain.io, paste its README badge here:
[![Built on QoreChain](https://build.qorechain.io/badge/<project-slug>.svg)](https://build.qorechain.io/p/<project-slug>) -->

---

## The problem

Every DAO today trusts one thing: the ECDSA keys of its members. A large quantum computer can
recover an ECDSA private key from its public key, and every member who has ever sent a transaction
has published theirs. On Q-Day an attacker can vote as any member, pass any proposal and empty the
treasury.

## What Conclave does

Every action that can move money or change who is in charge needs an **ML-DSA-87** (FIPS 204)
signature. The contract checks it with QoreChain's **`pqcVerify`** precompile, against the key each
member registered on chain (read with **`pqcKeyStatus`**, never supplied by the caller).

| Action | Who can do it | Authorised by |
|---|---|---|
| Propose a payout or rule change | A member | ML-DSA-87 signature |
| Vote for / against | A member | ML-DSA-87 signature |
| Cancel a proposal | Its proposer | ML-DSA-87 signature |
| Execute a passed proposal | Anyone, after the timelock | The proposal's majority of PQ votes |
| Add/remove members, change threshold or guardian, unpause, pay tokens | The DAO itself | An executed proposal |
| Pause payouts **once**, for at most `pauseDuration` | The guardian | Classical key (the only one) |

Members sign in **QoreX** without paying gas, and the wallet shows them a plain-text message such as:

```text
Conclave v1
action: vote
support: for
proposal: 7
proposal hash: 0x9a1f…
member: 0xabcd…
dao: 0x5fbd…
chain: 9800
```

A **relayer** submits the signatures from an **EVM window scoped to the Conclave contract**. A
leaked relayer key can only submit signatures members already made, and only to Conclave.

**The worst a stolen classical key can do is one temporary pause.** It can never vote, approve,
withdraw or unpause, and a queued payout survives the pause because the grace period is longer.

## Bounty requirements

| Requirement | Where | Status |
|---|---|---|
| **pqcVerify** | [`QorePQC.sol`](contracts/src/libraries/QorePQC.sol) `verify`/`accepts`, used by `propose`, `castVote(s)`, `cancel` in [`Conclave.sol`](contracts/src/Conclave.sol) | Done. Checked against the live precompile (see below) |
| **pqcKeyStatus** | [`QorePQC.sol`](contracts/src/libraries/QorePQC.sol) `keyOf`: signer keys and new members | Done. Checked against the live precompile |
| **Scoped EVM window** | [`scripts/window.ts`](contracts/scripts/window.ts) `open-scoped`: relayer window limited to the Conclave address | Done. Testnet evidence: [docs/EVIDENCE.md](docs/EVIDENCE.md) |
| **Two-stage QCAI audit** | [docs/AUDIT.md](docs/AUDIT.md), reports in [docs/audit/](docs/audit/) | Workbook ready; stages 1 and 2 to run |
| **Foundry tests** | [`contracts/test/`](contracts/test), [`contracts/test-ffi/`](contracts/test-ffi) | 133 unit, fuzz and invariant tests + 4 differential tests |

## Verified on the live testnet

`npm run pqc:check` runs these read-only checks on `qorechain-diana` (no funds needed):

```text
PASS  pqcVerify precompile active
PASS  pqcKeyStatus precompile active
PASS  pqcVerify accepts the QoreX signing bytes
PASS  pqcVerify rejects a changed message
PASS  pqcVerify rejects the bare message (no qorechain-msg-v1 prefix)
PASS  pqcVerify rejects another key
PASS  QorePQC.accepts (Solidity) accepts a valid signature on chain
PASS  QorePQC.accepts (Solidity) rejects a changed message on chain
PASS  QorePQC.keyOf (Solidity) decodes the registered key on chain
```

The last three run Conclave's own Solidity code against the real precompiles, inside an `eth_call`
of creation code ([`script/LivePqcProbe.sol`](contracts/script/LivePqcProbe.sol)).

## Testing

| Suite | What it proves |
|---|---|
| `Conclave.Deploy` | Constructor validation: members, keys, majority threshold, timing, chain id |
| `Conclave.Proposals` | PQ-signed proposals and cancellation; nonce, deadline, content binding |
| `Conclave.Voting` | Vote binding to proposal, support, member, DAO, EVM chain and native chain; key rotation and revocation; batch relay |
| `Conclave.Execution` | Timelock, grace period, content hash, all-or-nothing actions, revert bubbling, re-entrancy |
| `Conclave.Governance` | Self-only governance, membership and threshold changes, stale proposals |
| `Conclave.Pause` | One-shot guardian fuse, what a pause blocks and allows, pause shorter than grace |
| `Conclave.QDay` | An attacker holding **every** classical key cannot move funds, vote or replay signatures |
| `QorePQC` | The precompile wrappers fail closed on every unexpected answer |
| `ConclaveMessages` | Golden tests of the exact text members sign |
| `invariant/` | 256 runs × 64 random honest and attacker calls: treasury accounting, attacker never paid, no forged success, majority always valid |
| `test-ffi/` | The bytes the contract verifies are exactly what **QoreSign** (the library QoreX uses) signs; a real ML-DSA-87 signature verifies over them |

Coverage: 100% of functions, about 95% of lines and branches.

```bash
cd contracts
forge build --sizes   # Conclave: 13.4 KB of 24 KB
forge test            # unit + fuzz + invariant
npm ci && npm run test:ffi
```

Gas (contract cost measured with Foundry, plus the live `pqcVerify` cost measured on testnet):

| Call | Gas |
|---|---|
| `castVote` | ≈ 146k contract + ≈ 74k signature calldata + ≈ 185k `pqcVerify` precompile ≈ **400k** |
| `execute` (native payout) | ≈ 78k |

## Run it on the testnet

```bash
cd contracts && npm ci && forge build && cp .env.example .env   # then fill in .env
npm run window register         # once per account: register its ML-DSA-87 key
npm run window open             # unscoped window, only for the deployment
npm run deploy:testnet          # pre-flight checks every member's key, then deploys
npm run window open-scoped      # relayer window that can ONLY call Conclave
npm run conclave propose-payout <to> 1 "First grant"
npm run conclave vote 1 for     # each member, with their own MEMBER_MNEMONIC
npm run conclave execute 1      # anyone, after the timelock
```

`forge script` cannot deploy Conclave: Foundry's local EVM has no QoreChain precompiles, so the
constructor's key checks would fail in simulation. `deploy.ts` sends the deployment straight to
the chain instead.

## Repository

```text
contracts/src/Conclave.sol                 the DAO treasury
contracts/src/libraries/QorePQC.sol        fail-closed pqcVerify / pqcKeyStatus wrappers
contracts/src/libraries/ConclaveMessages.sol  the messages members sign
contracts/test/                            Foundry unit, fuzz and invariant tests
contracts/test-ffi/                        differential tests against QoreSign
contracts/scripts/                         window, deploy, member CLI, live precompile check
docs/ARCHITECTURE.md                       design, message format, decisions
docs/THREAT_MODEL.md                       Q-Day threat model and mitigations
docs/AUDIT.md                              two-stage QCAI audit workbook and PQC design notes
docs/EVIDENCE.md                           testnet evidence
AI_USAGE.md                                how AI was used
```

## Credits

- [create-qorechain-dapp](https://www.npmjs.com/package/create-qorechain-dapp) Foundry template (Apache-2.0): `foundry.toml` base and the EVM window helper `scripts/window.ts` is adapted from it
- QoreChain kits: `@qorechain/sdk`, `@qorechain/evm`, `@qorechain/qoresign` (Apache-2.0)
- [OpenZeppelin Contracts](https://github.com/OpenZeppelin/openzeppelin-contracts) v5.7.0 (MIT): `ReentrancyGuard`, `SafeERC20`, `Strings`, `ShortStrings`
- [forge-std](https://github.com/foundry-rs/forge-std) v1.17.0 (MIT/Apache-2.0), [viem](https://viem.sh) (MIT)

## License

[MIT](LICENSE)
