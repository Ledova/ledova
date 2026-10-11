# Order submission and action protocols

[Reference](README.md) · [Documentation](../README.md)

The immutable identities and recovery contracts for creating, cancelling and modifying orders.

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
eligible token/wallet, exactly one configured settlement asset (which the created
order records; none or several refuse the message and the execution alike before
any challenge is spent) and a valid, unspent linked signature before creating an
order. Recovery returns immutable `intent` alongside the current `order` and
the original `match`; order modification or cancellation does not rewrite intent.
The immutable intent's `quantity` and `min_quantity` are canonical decimal
strings. Forward them unchanged when renewing or retrying so JavaScript number
rounding cannot alter stored terms. New numeric draft inputs and existing order
detail quantities retain their current formats.
If a token becomes hidden, its previously authorised display snapshot can still
describe the owned order without granting visibility to the token itself.

The exact submission is authorised in app scope before entering the bounded
operator service. That service locks the submission, rechecks actor/account/wallet
authority and immutable terms, and commits challenge spend, order creation,
matching and the recorded outcome in one independent operator transaction.
Both aliases must have autocommit enabled and no enclosing transaction. The
request returns to app authority before serialization. A lost response recovers
the same recorded result through the owner-scoped lookup; no second commit or
matching queue is introduced. The app connection cannot insert swap rows: its
row-level write policy on `tokens_swaporder` is `false`, installed with the
other policies and grants by `shared/0002_database_guards`.

Foreign candidates must still have verified EVM wallets and active account owners.
The database orders candidates by price, creation time and primary key. The matcher
streams batches of 100 rows and yields compatible candidates one at a time, closing
the iterator on success or refusal; it does not materialize the entire book or a
second match list. Each attempt has its own savepoint. It acquires that candidate's wallet, account, profile and
user rows with `FOR NO KEY UPDATE NOWAIT`, and only the incoming/candidate order
pair with `FOR UPDATE NOWAIT` in primary-key order. The locked order terms must
still match the selected snapshot. A busy or changed candidate returns HTTP 503
with code `order_matching_busy`. Challenge spend,
new orders, matches and reservations roll back; the existing submission remains
pending, and the client retries its same UUID. A fresh UUID is not a retry.
An unrepresentable settlement rolls back its candidate savepoint, releasing its
authority/order locks before the next candidate is attempted. Unrelated
lower-priority or minimum-incompatible wallets and order rows are not locked.
The [owner chose this contention behaviour](https://github.com/Ledova/ledova/issues/646#issuecomment-5745891659)
instead of accepting an order while silently skipping a busy counterparty.

A negative whitelist result, an investor classification that is not live for
the share class's company, insufficient seller share or buyer payment
balance, failure of every compatible fill's amount check, or a share token whose
recorded deployment names a chain other than the one in the domain about to be
signed, including one whose deployment row cannot be read, records a terminal
business refusal: creation and matching roll back to their savepoint
while spend and refusal commit together. The chain disagreement records its own
`settlement_chain_disagreement` code and is token-wide, so matching refuses at the
first candidate rather than retrying the refusal per candidate; the classification refusal records
`investor_not_eligible` and is equally token-wide; the amount refusal
keeps `invalid_settlement_amount`, and matching tries later candidates when a
proposed fill fails that check, retaining price/time priority among usable fills. It
neither rounds nor resizes a fill, and leaves skipped resting orders unchanged. The
same submission UUID remains refused even if the counter-order or deployment later
changes. A corrected intent uses a new UUID. See
[payment units](swap-settlement.md#payment-units) for the exact calculation rules.
Provider, configuration,
database and unclassified matching failures remain retryable; a lost commit
acknowledgement requires recovery. PostgreSQL guards protect the account/key,
original intent, challenge linkage and terminal outcome against direct SQL
changes.
Never delete these identities to retry or reinterpret a refusal as permission
to create another order. A separate deliberate order still undergoes the ordinary
creation and matching checks. This protocol adds no aggregate balance policy,
outgoing signer activation or settlement finality guarantee.

The rows a submission holds across its decision, the order every trading journey
takes its locks in, and the competing pairs that order must hold are in
[the trading lock graph](#the-trading-lock-graph).

## Cancelling or modifying an order

Cancel and modify requests use a separate account-scoped `action_id`. Before
preparing a fresh action, read
`GET /api/v1/trading/orders/{order_uuid}/action-context/?owner_account_uuid=...`.
This request is read-only. Use its canonical quantity/minimum/price strings for
all absolute replacement values, including unchanged values in a price-only
modification; the order list's numeric quantities are not a lossless source.
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
A 404 means absent or currently inaccessible; it does not authorise deleting the
reminder, generating a replacement ID or claiming recovered terms. The execute
POST identifies the action before checking a pending signature, so an authorised
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

A keyed pending action presenting an unlinked legacy challenge receives
`action_refresh_required` before spend; there is no automatic rebinding or
legacy execution fallback. This protocol changes no balance eligibility, admits
no signer, broadcasts no transaction and establishes no settlement finality.

## The trading lock graph

Every trading journey locks rows in one global order, G, taking PostgreSQL
`FOR UPDATE` unless stated otherwise:

journal row (`OrderSubmission` or `OrderActionSubmission`) → `OutgoingOperation`
→ `SigningAccount` → `Wallet` (`FOR NO KEY UPDATE`) → `UserAccount` (`FOR NO KEY UPDATE`) →
`UserProfile` → `User` → `SigningChallenge` → `TransferOrder` (ascending primary
key) → `SwapOrder` → `BlockchainTransaction`. Wallet-side writers branch off after
`Wallet` into `Transaction` → `Holding` and never touch an order or a swap.

Each journey's sequence is a subsequence of G: create and match
(`execute_order_submission`, `create_order_and_match`), cancel and modify
(`execute_order_action`), the swap signature (`submit_signature`), execution
recovery (`recover`), settlement (`settle`) and the expiry sweep
(`expire_unclaimed_swap`), with three exceptions. The action path locks its
`SigningChallenge` after its `TransferOrder`; a challenge is bound to one
submission or action and one wallet, so only replays of the same action contend
for it, and those already serialised on the journal row. The action path's order
lock is load-bearing: `apply_order_modification` saves every column of the order,
so a decision taken on a stale read would overwrite a match. The held-order sweep
(`place_held_order`) locks its held order first and then, like a create, a
candidate's authority and the order pair; it takes every one of those locks with
`NOWAIT`, so having started out of order it never waits on another trading
journey (its foreign-key checks wait only on wallet-side writers, as a create's
do), and a busy row leaves the order held for the next minute's sweep. Its
second pass (`hold_crossing_order`) locks one listed order, the newer of a
crossing pair, also with `NOWAIT`, and nothing else. Foreign authority comes
after the incoming authority and challenge but never waits (R3).

Foreign-key checks introduce edges against G. A swap insert references both
wallets; deferred checks after repeated order updates can also take `FOR KEY SHARE`
on the counterparty's account at commit. Same-account legacy candidates retain
their earlier authority-lock behaviour; foreign candidates have their complete
authority locked before matching. Three rules keep these edges from closing
a cycle:

- **R1**: trading journeys lock `Wallet` and `UserAccount` with `FOR NO KEY UPDATE`,
  never `FOR UPDATE` (`_lock_authorized_wallet`, `create_order_and_match`,
  `_lock_authority`, `_lock_foreign_matching_authority`). `FOR KEY SHARE` is
  compatible with `FOR NO KEY UPDATE`, so a matcher's foreign-key checks never
  wait on another trading transaction's wallet or account lock, while those
  locks still exclude concurrent authorisation changes. Without R1 one account's
  two wallets deadlock at commit. Wallet-side writers hold `Wallet` `FOR UPDATE`
  but nothing at or after `TransferOrder` in G, so they can delay the insert,
  never wait on the matcher.
- **R2**: every lock that can cover more than one `TransferOrder` row goes
  through `lock_orders`, which orders by primary key before locking
  (`find_matching_orders`, `match_orders`, `create_swap_order`, `_lock_swap`,
  `expire_unclaimed_swap`). The action path's `_authorized_order` locks exactly
  one row.
- **R3**: foreign wallet/account/profile/user acquisition and each candidate's
  order pair use `NOWAIT`, so two creates holding different incoming wallets
  cannot wait on one another's authority, and a matcher cannot wait behind a
  foreign action, expiry or account deletion while holding its own authority.
  Contention or changed candidate terms abort the whole create transaction and
  leave the submission retryable; each failed amount check rolls back its
  candidate savepoint, so locks do not accumulate across the priority walk.

Two properties of the graph are deliberate. The create path reads the whitelist
and the chain balance while holding its wallet and account rows, so a balance is
measured against every commitment visible under the lock; a slow provider
therefore extends how long that wallet's other requests wait on the create path
only. And matching runs only inside creation and the held-order sweep, each
order deciding whether it may rest from the orders already committed, so two
crossing orders created concurrently can both rest unmatched. The minute's sweep
bounds that liveness limit without a new lock: it holds back the newer of any
two listed orders that cross and matches it on its next run. Every placement,
settlement, lapse, revert and modification checks the
[book it would rest in](../architecture/trading.md#one-match-never-crossed).

The competing pairs the graph must hold are below. Their process-level proofs
were retired under the [11 October policy](../decisions.md#minimum-tests-and-fresh-migrations);
the sources remain in Git history.

| Pair | What must hold |
| --- | --- |
| P1: create against create, one wallet | the second waits at the wallet lock and measures its balance against the first's committed order: refused when the two do not fit, open when they do |
| P2: create against create, two wallets of one account, crossing | the second waits on the account row; the matcher's key share on the second wallet does not deadlock; both commit and exactly one swap exists |
| P3: a decision against an authorisation change (wallet verification, account reassignment) | the change waits on the wallet or account row until the decision commits, then the next submission is refused |
| P4: the matcher against a cancel or modify of its candidate | same-account journeys serialise at the account; a foreign action waits behind an admitted matcher at the wallet, while a matcher meeting a busy foreign wallet returns retryable 503 and re-reads committed terms on retry: a modify or cancel of a matched order records its refusal with the spend committed, and a match after a modify uses the modified terms |
| P5: cancel or modify against signature, execution or settlement of the same order | fenced by status under the order lock: a decision taken while a swap is pending records a refusal, and that refusal is what every later replay returns |
| P6: signature, expiry and settlement of one swap against each other | both orders in primary-key order, then the swap: one release, a late admission refused, an admission never released |
| P7: recovery against recovery | the operation row first, then G; every lock released before an RPC; one attempt and one nonce |
| P8: a wallet-side writer against a create on one wallet | serialisation only: the two sides share no accounting record, so their mutual exclusion buys identity freshness and nothing else |

These are [PostgreSQL row-lock semantics](https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS),
not a replacement for the account-ownership, wallet-address, verification,
deployment and balance checks that run under the locks.
