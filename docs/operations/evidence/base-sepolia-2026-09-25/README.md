# Base Sepolia public approval-control observations

These four unchanged JSON snapshots retain read-only observations of explicitly
synthetic test controls on Base Sepolia, chain 84532. They contain public wallet
and contract addresses, code hashes, block identities, registry state and
zero-value self-transfer `eth_call` inputs/results. They contain no credentials,
private paths, internal infrastructure or database identifiers, or queue records.
The [approval-control evidence](../../approval-controls.md#base-sepolia) explains
the fixture exceptions, transaction history and acceptance limits.

| Snapshot | Recorded at, 25 September 2026 UTC | Finalized block | Observed result |
| --- | --- | --- | --- |
| [C baseline](c-baseline-finalized-01.json) | 16:41:58.214 | 47292664 | A approved C and its simulation succeeded; B did not approve C and refused it |
| [I baseline](i-baseline-finalized-01.json) | 16:55:22.802 | 47292917 | A approved I and its simulation succeeded; B did not approve I and refused it |
| [I after removal](i-removed-finalized-01.json) | 17:28:53.483 | 47293954 | Both registries stored expiry zero and denied membership; both simulations refused I |
| [C after natural expiry](c-expired-finalized-01.json) | 18:24:17.374 | 47295622 | A retained C's original nonzero expiry, now before block time; B retained zero; both denied membership and refused C |

Each capture requested the provider's `finalized` tag, pinned subsequent state
reads and simulations to the returned numbered block, checked chain 84532 before
and after, and re-read that numbered block to require unchanged number, hash and
timestamp. The observer also checked factory/registry/token bindings and code
presence. The JSON retains the block hash and timestamp needed to reproduce the
historical state checks; finality is the provider's report at capture time.

All refusals here are the exact `SenderNotWhitelisted` error for the recorded
control wallet. These are zero-value simulations, not mined transfer outcomes.
The snapshots do not independently establish database state, API responses,
worker attribution, receipt finality, physical Keystone operation or release
acceptance. Copying them into the repository checked their schema, privacy and
digests; it did not perform a fresh RPC execution or independently re-establish
their recorded observations.

Run `shasum -a 256 -c SHA256SUMS` from this directory to check the retained bytes.
The checksum list covers these four snapshots and this README.
