# Order submission and action protocols

[Reference](README.md) · [Documentation](../README.md)

The immutable identities and recovery contracts for creating, cancelling and modifying orders. Trading remains disabled by default.

## Creating an order

Create-order requests use an account-scoped client `submission_id`. A deliberate
new order gets a new UUID, including another order with equal terms. A retry
keeps its original UUID. The message route records the original account, wallet,
terms and signing domain before issuing a challenge whose envelope binds those
identities. Legacy issued challenges are preserved and require a fresh challenge
for this protocol; they cannot be attached retroactively to a submission. An old
request missing the new IDs receives ordinary required-field errors. A new keyed
request presenting an unlinked legacy challenge receives
`submission_refresh_required`. Both are refused before challenge spend.

After an uncertain response, read
`GET /api/v1/trading/orders/submissions/{submission_id}/?owner_account_uuid=...`.
Account ownership and the wallet's ownership and address are still required.
Unknown and inaccessible submissions share a 404; that response does not prove
that a preceding request failed to commit. Keep the same ID when retrying.
Changed original terms return `submission_conflict` and never spend a challenge.
Recovery of a created or refused outcome precedes current deployment, wallet
verification and challenge-expiry checks. A pending submission still needs an
eligible token/wallet and a valid, unspent linked signature before creating an
order. Recovery returns immutable `intent` alongside the current `order` and
the original `match`; order modification or cancellation does not rewrite intent.
The immutable intent's `quantity` and `min_quantity` are canonical decimal
strings. Forward them unchanged when renewing or retrying so JavaScript number
rounding cannot alter stored terms. New numeric draft inputs and existing order
detail quantities retain their current formats.
If a token becomes hidden, its previously authorized display snapshot can still
describe the owned order without granting visibility to the token itself.

Challenge spend, order creation, matching and the recorded outcome share one
independent database transaction. An enclosing transaction or disabled autocommit
is refused. A negative whitelist result, insufficient seller balance or failure
of every compatible fill's amount check records a terminal business refusal:
creation and matching roll back to their savepoint
while spend and refusal commit together. The amount refusal uses
`invalid_settlement_amount`; the same submission UUID remains refused even if
the counter-order or deployment later changes. A corrected intent uses a new
UUID. Matching tries later candidates when a proposed fill fails the amount
check, retaining price/time priority among usable fills. It neither rounds nor
resizes a fill, and leaves skipped resting orders unchanged. See
[payment units](swap-settlement.md) for the exact calculation rules.
Provider, configuration,
database and unclassified matching failures remain retryable; a lost commit
acknowledgement requires recovery. `tokens/0037` protects the account/key, original
intent, challenge linkage and terminal outcome against direct SQL changes.
Never delete these identities to retry or reinterpret a refusal as permission
to create another order. A separate deliberate order still undergoes the ordinary
creation and matching checks. This protocol adds no aggregate balance policy,
outgoing signer activation or settlement finality guarantee.

Order-submission admission and matching lock the current wallet with PostgreSQL
`FOR NO KEY UPDATE`. Wallet changes and deletion still wait, while the foreign-key
checks for a counterparty's swap may proceed. One account's two wallets can
therefore submit without each transaction waiting for the other wallet at commit.
The account row stays locked through the decision; moving the account to another
person waits, and prevents a fresh submission afterward.
These are [PostgreSQL row-lock semantics](https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS),
not a replacement for the account-ownership, wallet address, verification or
deployment checks. They do not establish aggregate buying power or the complete trading
lock graph.

## Cancelling or modifying an order

Cancel and modify requests use a separate account-scoped `action_id`, introduced
by `tokens/0038`. Coordinate backend, shared package, dashboard and mobile
releases for this protocol change. Before preparing a fresh action, read
`GET /api/v1/trading/orders/{order_uuid}/action-context/?owner_account_uuid=...`.
This request is read-only. Use its canonical quantity/minimum/price strings for
all absolute replacement values, including unchanged values in a price-only
modification; ordinary order-detail numeric quantities are not a lossless source.
Persist and verify a fresh action UUID before the first message POST. A deliberate
second action gets another UUID even if its terms are equal.

`POST /orders/{order_uuid}/cancel/message/` takes `action_id` and
`owner_account_uuid`; `POST /orders/{order_uuid}/modify/message/` additionally
requires all three `new_quantity`, `new_min_quantity` and `new_price_per_share`
strings. These paths are relative to `/api/v1/trading`. Issuance freezes the
authoritative identity and domain. A client must compare those values with its
reviewed context before signing. A mismatch may already have created a pending
action: retain its ID, discard the stale review/challenge and recover the recorded
intent before asking for a new review. Do not attach that ID to different terms.

For an existing reminder or uncertain response, read
`GET /api/v1/trading/orders/actions/{action_id}/?owner_account_uuid=...` directly.
A 404 means absent or currently inaccessible; it does not authorize deleting the
reminder, generating a replacement ID or claiming recovered terms. The execute
POST identifies the action before checking a pending signature, so an authorized
recorded result remains recoverable with absent, expired or irrelevant old
credentials. Account ownership and wallet/order ownership still apply.
The response separates immutable `intent`, `review`, `result` and `refusal` from
the current `order`. HTTP responses use the existing camel-case renderer.

A stored business refusal returns the complete snapshot with `status: refused`
and `refusal.httpStatus` 400 or 409. Its allowed codes are
`order_cancellation_failed`, `order_modification_failed` and
`order_modification_conflict`. Ordinary `action_intent_conflict` or
`action_context_conflict` errors are not terminal snapshots. Provider/preflight,
validation and infrastructure errors also leave the reminder unresolved; recover
before retrying. Terminal replay does not repeat an order change or publish a
second event. The existing event mechanism has no outbox, so database recovery
is not a guarantee of event delivery.

Old unlinked cancel/modify challenges and modification logs remain unchanged.
The retired GET cancel-message route returns `action_refresh_required`; old
POSTs without the new identity fields receive ordinary required-field errors.
A keyed pending action presenting an unlinked legacy challenge also receives
`action_refresh_required` before spend. There is no automatic rebinding or legacy
execution fallback. Existing settlement signatures and stored swap deadlines are
unchanged. This protocol neither changes balance eligibility nor enables trading,
activates signers, broadcasts transactions or establishes settlement finality.
