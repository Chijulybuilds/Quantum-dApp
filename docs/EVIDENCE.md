# Testnet evidence (qorechain-diana)

Explorer: <https://explore.qore.network>. Add every address used here to the project page
(`qor1…` form) so the fest's checker can mark features as Verified.

## Precompile checks (read-only)

`npm run pqc:check -- <qor1 address>` on 2026-11-20:

| Check | Result |
|---|---|
| `pqcVerify` and `pqcKeyStatus` active (`/cosmos/evm/vm/v1/params`) | PASS |
| `pqcVerify` accepts the QoreX signing bytes of a fresh ML-DSA-87 key | PASS |
| `pqcVerify` rejects a changed message, the bare message, another key | PASS |
| `QorePQC.accepts` (Conclave's Solidity) accepts / rejects on chain | PASS |
| `QorePQC.keyOf` (Conclave's Solidity) decodes a registered 2,592-byte key, algorithm 1 | PASS |
| Live gas: direct `pqcVerify` call | 322,380 (incl. 21,000 base and 7,716 bytes of calldata) |

`npm run pqc:check -- <qor1 address>` on 2026-11-22, behind `ConclaveProxy`:

| Check | Result |
|---|---|
| `ConclaveProxy` deploys with a `ProxyAdmin` owned by the proxy | PASS |
| `pqcVerify` in a proxy `DELEGATECALL` frame: valid accepted, changed message rejected | PASS |
| `pqcKeyStatus` in the proxy constructor's init `DELEGATECALL` and after | PASS |
| `eth_call` gas on the public RPC | capped at about 5M, so the probe uses a small harness behind the real proxy |

## Deployment and life cycle

| Step | Command | Tx hash / address |
|---|---|---|
| Register ML-DSA-87 key (each member, relayer) | `npm run window register` | |
| Unscoped window for the deployment | `npm run window open` | |
| Deploy Conclave (implementation + `ConclaveProxy`) | `npm run deploy:testnet` or `npm run redeploy:testnet` | |
| Fund the treasury | send test QOR to the contract | |
| Relayer window **scoped to Conclave** | `npm run window open-scoped` | |
| Proposal #1 (PQ signed) | `npm run conclave propose-payout …` | |
| Votes (PQ signed, relayed) | `npm run conclave vote 1 for` / `relay-votes` | |
| Queued (`ProposalQueued`) | | |
| Executed payout | `npm run conclave execute 1` | |

## Security evidence

| Scenario | How | Result |
|---|---|---|
| Scoped window refuses another target | send any tx from the relayer to an address other than Conclave | |
| Classical-only vote rejected | `castVote` with a non-ML-DSA signature (simulation shows `PqcInvalidSignature`) | |
| Vote replayed on another proposal rejected | relay proposal #1's vote signature for #2 | |
| Guardian pause, then payout blocked | `npm run conclave pause`, then `execute` | |
| Second pause refused | `npm run conclave pause` again (`GuardianDisarmed`) | |
