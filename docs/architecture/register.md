# Register of members

[Architecture](README.md) · [Issuance](contracts-and-issuance.md)

The current-members register is derived at read time for one share class.
[register.py](../../backend/tokens/services/register.py) combines chain membership
with identity and allotment records. Former members are stored separately.

The [stored register foundation](../operations/register-foundation.md) adds member
references with durable wallet links, immutable events and a holdings projection
for #647. An [approved opening capture](../operations/register-foundation.md#approved-opening-capture-and-wallet-links)
initialises it from one verified canonical chain boundary under documentary
authority, and the integrity verifier replays the whole chain. These HTTP reads
and the execution workflows have not switched to it yet: issuance and settlement
do not record register events, and later workflow recording will classify each
completion's verified final inclusion against the captured opening boundary so
each economic effect appears exactly once.

Owner-submitted [compensating corrections](../operations/register-foundation.md#reviewed-compensating-corrections)
now bind documentary authority to an exact reversal and register revision.
Permitted staff review and application commit together, retaining the original
entry and private evidence. This applies to the stored foundation; it does not
change these chain-derived HTTP reads or perform chain reconciliation.

## Membership and identity

The holder set unions completed issuance recipients with every non-zero
participant in `Transfer` history from deployment to the provider head. A
transfer-only holder is included even without an allotment. Every balance is
confirmed on chain. A missing balance, transfer history, deployment block,
issued supply or chain response makes the entire read unavailable with 503;
there is no partial register or fallback to allotment quantities.

Identity follows the whitelist entry through wallet, account and profile, in
bounded address chunks. Holder types are:

| Type | Meaning |
| --- | --- |
| `member` | A resolved profile, or a resolved identity stamp from allotment |
| `treasury` | A bare whitelisted treasury address with a label |
| `ambiguous` | More than one wallet/entry can identify the address |
| `unidentified` | No resolved identity |

Live identity is preferred. An unidentified address can fall back to its latest
completed allotment's resolved identity stamp. The row names the source and
stamp date; a name without a resolved stamp remains unidentified. Old unstamped
issuances are not backfilled by guessing identity.

Allotments provide the earliest completion date and consideration, not membership.
A transfer-only holder therefore has a chain-confirmed quantity and blank
allotment particulars. Amount paid is blank unless every share is subscribed,
subscribed quantity equals the confirmed balance, and the subscription's
`money_backing_shares` supports the shares printed. Unallotted subscriptions,
unsubscribed holdings and quantity mismatches leave it blank. A pending refund
must not inflate consideration; zero must not stand in for an unknown value.

## API and export

`GET /api/v1/tokens/{uuid}/holders/` returns current holders, issued/listed supply,
discrepancy and former-member freshness. Both this route and
`GET /api/v1/tokens/{uuid}/register/export/` are issuer-scoped. The current-member
API omits residential addresses, but former-member rows include them.

The CSV has three sections with different widths:

1. Current members: Name, Residential address, Wallet address, Holder type,
   Class, Shares held, Percentage of issued supply, Balance source, Identity
   source, Date entered, Whitelist status and Amount paid.
2. Supply summary: issued supply, held by listed holders and any discrepancy.
3. Former members: retained particulars, cessation and fold freshness.

Read sections by their headers rather than assuming one width or column index.
`csv_cell` neutralizes formula-opening user values. An export logs requesting
user ID and row count; there is no durable, queryable export audit model yet.
A discrepancy also logs a warning. See the [stored-register work](https://github.com/Ledova/ledova/issues/647).

The company shareholder tile counts distinct completed allotment addresses and
does no chain read. Operator identity queues also use allotment addresses and
apply no identity-stamp fallback. They can include former holders and miss
transfer-only holders; neither is a substitute for the register.

## Former members

`former_holders.py` folds `Transfer` history through the provider's finalized
block and records cessations in `FormerHolder`. Particulars are frozen at first
recorded cessation: current profile at recording, otherwise an allotment stamp
no later than cessation, otherwise unknown. Refolding does not rewrite them.

Each class fold is all-or-nothing. Failure leaves its last successful timestamp
and block unchanged and does not stop processing other classes. The register
marks a fold older than 24 hours, or one never completed, stale. GET never folds;
only successful background work clears that marker.

The retention floor and clock are documented in
[retention settings](../operations/uploads.md#data-retention). Purged former rows
cannot be recreated by a later full-history fold. Only the company owner and
operator read them; the application role cannot write them. Pre-platform former
members cannot be reconstructed from the chain, and no import exists.

## Deletion protection

The register spine is `Company -> ShareToken -> {ShareIssuance,
ShareIssuanceRequest, CapitalIncreaseRequest, Offering, TransferOrder}`. Those
relations and `SwapOrder.share_token` use `PROTECT`. Subscription links to its
offering, account and wallet are also protected.

API company/share-class deletion returns 409 where records must remain.
`contract_address`, not deployment status, identifies a class that has been on
chain; a paused class still carries its register. Delist a company with on-chain
classes. Delete draft classes before deleting a company containing only drafts;
a company with no classes is deletable. Admin removal of test data still respects
protected relations.

Company documents and registry-check history are application evidence rather
than register membership rows. Wallet deletion still cascades its whitelist
entry; durable [whitelist commands](outgoing-signing.md#whitelist-changes)
retain their original identity independently. Allotment identity stamps preserve
the member identity where one was resolved when shares were issued. Treasury relabeling or current profile guesses
must not replace that historical source.

Next: [legal positions](../legal/positions.md), [scheduled folds](../operations/jobs.md)
and [operator recovery](../operations/recovery.md).
