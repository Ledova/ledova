# The demonstration journey

[Operations](README.md) · [Chains and keys](chains.md) · [Product §8](../product.md#8-guidance-for-implementation)

[Product §8](../product.md#8-guidance-for-implementation) asks for an
incremental flow covering discovery, a seller listing, offer acceptance,
approvals, simulated external payment, contract-enforced transfer and
reconciliation, and for verification of private-data isolation, revocation,
provider failure, direct contract calls, duplicate requests and migration to
another interface. [#645](https://github.com/Ledova/ledova/issues/645) builds
that as one real-chain test on one synthetic data set. This page maps each step
and each verification item to the test that proves it, and states what is real,
what is simulated and what is still untested.

Every test named here is in `backend/tokens/tests/test_chain_journey.py`, class
`DemonstrationJourneyChainTest`. `make chain-test` runs it against a local
Hardhat node with the core contracts deployed by `deploy-all.ts`; an ordinary
backend suite skips it for want of the chain environment. See
[chains and keys](chains.md) for the target.

## The data set

Each test starts from the same synthetic company:

- its share class, deployed through the real `ShareTokenFactory`, which creates
  the company's own `WhitelistRegistry`, and approved on the `AtomicSwap`;
- a seller and a buyer, each with a verified professional classification and a
  verified wallet, each approved on the company's registry by a staff
  whitelist change whose `setExpiry` carries their classification's expiry;
- 20 shares issued to the seller;
- the register opened from the chain, with the seller as its only member;
- an account whose classification was never verified, so it is not eligible
  to invest, and the owner of another company, eligible on a verified
  classification of their own.

## The journey

`test_the_demonstration_journey_runs_from_discovery_to_a_reconciled_register`
calls one step method for each §8 step, in order, and each step asserts its own
result.

| §8 step | Step | What the test does | What it asserts |
| --- | --- | --- | --- |
| Discovery | `discover` | The buyer reads the trading market, `/api/v1/trading/tokens/` | The class is listed with its contract address and no ask. The ineligible account gets an empty market, and the class's route gives it the same 404 as an unknown id |
| Seller listing | `list_shares` | The seller signs an order challenge over HTTP and creates a sell order; the create reads the registry and the seller's balance on the node | The order rests open for 10 shares at 1.50, and the buyer's market read now shows that ask |
| Simulated external payment | `record_deposit` | Staff record the buyer's off-platform AUD deposit as a `MintRequest` with a synthetic reference and date, and execute it, as the asset admin's mint form does | The request is `executed` with its reference, date, executing staff member and transaction; the node's receipt carries the AUDY mint to the buyer, and the buyer's AUDY balance rises by the deposit |
| Offer acceptance | `accept` | The buyer signs and creates a buy order at the ask | The buy's submission is recorded as created, with its spent challenge, the resting order it matched and the swap it opened. The swap is `created`, with no transaction, and no balance has moved |
| Approvals | `approve` | Both parties approve the swap contract through `approval-data` and `approval-broadcast`, and sign the settlement through `/swap/sign/` | Each staff whitelist change is a confirmed `setExpiry` transaction on the company's registry, which reports the future expiry; each classification is live; each token approval is confirmed; the swap moves from `seller_signed` to `executing` |
| Contract-enforced transfer | `transfer` | The deferred `recover_swap_execution` job runs with its recorded arguments | The relayer's `executeSwap` receipt emits `SwapExecuted`, and in that one transaction 10 shares reach the buyer and 15.00 AUDY reach the seller |
| Reconciliation | `finalise`, `reconcile` | `resolve_executing_swaps` runs before and after one more block under a two-block depth; `reconcile_every_register` compares the register with the node; the company links the buyer's wallet to a new member and instructs the transfer over HTTP, and staff apply both | The swap completes only after the extra block, with its final receipt. The first reconciliation matches with the transfer waiting, first as `unlinked`, then as `uninstructed`. The instruction writes one transfer entry, `verify_register` passes, the holders read shows 10 and 10, and a second reconciliation matches at the new register sequence |

The test then checks that acceptance, payment, transfer and register update are
distinct records: the executed deposit, the accepted submission, the completed
swap and the register entry carry four increasing times, and the deposit's
transaction is not the settlement's.

## The verification list

| §8 item | Test | What it shows |
| --- | --- | --- |
| Duplicate requests | The journey's `list_shares`, `transfer` and `reconcile` steps | Re-posting the identical signed sell create returns the same order, and the class still has one order. Re-submitting the buyer's settlement signature after execution queues recovery again, and running every queued job leaves one signed attempt and the relayer's nonce advanced once. Re-submitting the register instruction returns the applied instruction; a fresh instruction for the same settlement is refused, and there is one transfer entry |
| Revocation | `test_a_revoked_buyer_is_removed_from_the_registry_and_can_neither_list_nor_transfer` | After the trade, staff revoke the buyer's classification, and the refresh job it queued removes the approval: the registry reports expiry zero and no listing. A new sell order from the buyer is refused as `not_whitelisted`, and a transfer signed with the buyer's key and broadcast raw reverts on the node with `SenderNotWhitelisted`, leaving every balance unchanged. Before the revocation, a simulated call of the same transfer succeeded |
| Direct contract calls | `test_direct_calls_to_the_share_and_swap_contracts_revert_on_the_node` | A transfer the seller signs to an address with no approval reverts with `RecipientNotWhitelisted`. The buyer's own `executeSwap`, carrying the exact calldata the relayer was admitted to send with both signatures, reverts with `NotRelayer`. No balance moves, and the relayer then settles the same calldata |
| Provider failure | `test_register_reconciliation_fails_closed_while_the_provider_is_unreachable_and_then_recovers` | With `BLOCKCHAIN_RPC_URL` pointed at a closed local port, the scheduled reconciliation raises and records a failed reconciliation with no block. With the real URL restored, it matches. The client is not patched: the connection is refused |
| Private-data isolation | `test_another_tenant_reaches_none_of_the_journeys_records` | After the whole journey, another tenant, the owner of another company, gets 404 from each order, swap and register route that the party or owner reads with 200, and the journey's orders are not in their order list, which does list their own. The company pack is a staff admin route: they are redirected to the admin login, no export is recorded, and staff holding the pack permissions reach its page |
| Migration to another interface | Not yet | A company pack built from the journey's end state and read by the independent consumer is still to be added, on top of [#725](https://github.com/Ledova/ledova/pull/725)'s fix to the pack's evidence paths |

## What is real and what is simulated

Real:

- the node: a Hardhat node on chain id 31337, which mines each transaction and
  enforces every contract rule;
- the contracts: `ShareTokenFactory`, `AUDY` and `AtomicSwap` from
  `deploy-all.ts`, and the share token and registry the factory creates;
- the database: PostgreSQL, fully migrated, with each API request under the
  application role as the ordinary suite runs it;
- the API: each route named above runs through Django's request handling,
  with the DRF test client standing in for the network and for sign-in;
- the signatures: every order challenge, token approval, settlement signature
  and raw transaction is signed with the party's own key.

Simulated:

- **The payment.** No bank and no stablecoin provider take part. The buyer's
  AUD deposit is a `MintRequest` with a synthetic reference and date, and the
  AUDY it mints is the platform's own test stablecoin, which then pays the
  seller inside the swap. The owner is confirming this reading of "simulated
  external payment" on [#645](https://github.com/Ledova/ledova/issues/645).
- **The worker.** No Procrastinate worker runs. The test reads each deferred
  job's recorded arguments from the job table and calls the task with them,
  and it calls the scheduled tasks directly.
- **Staff screens.** The staff actions, from the whitelist changes and the
  deposit record to the revocation and the register decisions, call the
  services the admin pages call, not the pages themselves.
- **Finality.** The local node uses the test depth policy of one block, and
  two around the settlement sweep, not Base Sepolia's approved policy.
- **Identities and companies.** All of them are synthetic.

## What remains untested

- **A browser.** No browser drives this journey; Playwright covers sign-in only.
- **A public testnet.** The journey runs on a local node, never on Base Sepolia.
- **Portability.** No company pack is yet built from the journey's end state,
  as above.
- **Live events.** Trading events are published to Redis, which the test does
  not observe.
