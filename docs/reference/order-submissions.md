# Order submission and action protocols

[Reference](README.md) · [Documentation](../README.md)

The immutable identities and recovery contracts for creating, cancelling and modifying orders. Trading is enabled by default.

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
If a token becomes hidden, its previously authorized display snapshot can still
describe the owned order without granting visibility to the token itself.

The exact submission is authorized in app scope before entering the bounded
operator service. That service locks the submission, rechecks actor/account/wallet
authority and immutable terms, and commits challenge spend, order creation,
matching and the recorded outcome in one independent operator transaction.
Both aliases must have autocommit enabled and no enclosing transaction. The
request returns to app authority before serialization. A lost response recovers
the same recorded result through the owner-scoped lookup; no second commit or
matching queue is introduced. `shared/0012` removes the app's redundant swap
INSERT permission on existing databases as well as fresh installs.

Foreign candidates must still have verified EVM wallets and active account owners.
The matcher acquires the first compatible candidate's wallet, account, profile and
user rows together with `FOR NO KEY UPDATE NOWAIT` before locking candidate orders
in primary-key order. It rechecks that authority before matching, and acquires a
later candidate's authority only if matching reaches that fallback. A busy
lower-priority or minimum-incompatible wallet does not by itself refuse an
available better match. PostgreSQL lock
contention returns HTTP 503 with code `order_matching_busy`. Challenge spend,
new orders, matches and reservations roll back; the existing submission remains
pending, and the client retries its same UUID. A fresh UUID is not a retry.
The [owner chose this contention behavior](https://github.com/Ledova/ledova/issues/646#issuecomment-5745891659)
instead of accepting an order while silently skipping a busy counterparty.

A negative whitelist result, insufficient seller share or buyer payment
balance, failure of every compatible fill's amount check, or a share token whose
recorded deployment names a chain other than the one in the domain about to be
signed — including one whose deployment row cannot be read — records a terminal
business refusal: creation and matching roll back to their savepoint
while spend and refusal commit together. The chain disagreement records its own
`settlement_chain_disagreement` code and is token-wide, so matching refuses at the
first candidate rather than retrying the refusal per candidate; the amount refusal
keeps `invalid_settlement_amount`, and matching tries later candidates when a
proposed fill fails that check, retaining price/time priority among usable fills. It
neither rounds nor resizes a fill, and leaves skipped resting orders unchanged. The
same submission UUID remains refused even if the counter-order or deployment later
changes. A corrected intent uses a new UUID. See
[payment units](swap-settlement.md) for the exact calculation rules.
Provider, configuration,
database and unclassified matching failures remain retryable; a lost commit
acknowledgement requires recovery. `tokens/0037` protects the account/key, original
intent, challenge linkage and terminal outcome against direct SQL changes.
Never delete these identities to retry or reinterpret a refusal as permission
to create another order. A separate deliberate order still undergoes the ordinary
creation and matching checks. This protocol adds no aggregate balance policy,
outgoing signer activation or settlement finality guarantee.

The rows a submission holds across its decision, the order every trading journey
takes its locks in, and the competing pairs the suite proves are in
[the trading lock graph](#the-trading-lock-graph).

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
(`expire_unclaimed_swap`), with two exceptions. The action path locks its
`SigningChallenge` after its `TransferOrder`; a challenge is bound to one
submission or action and one wallet, so only replays of the same action contend
for it, and those already serialised on the journal row. The action path's order
lock is load-bearing: `apply_order_modification` saves every column of the order,
so a decision taken on a stale read would overwrite a match. Foreign authority
comes after the incoming authority and challenge, with fallback authority acquired
after candidate-order locks, but never waits (R3).

Foreign-key checks introduce edges against G. A swap insert references both
wallets; deferred checks after repeated order updates can also take `FOR KEY SHARE`
on the counterparty's account at commit. Same-account legacy candidates retain
their earlier authority-lock behavior; foreign candidates have their complete
authority locked before matching. Three rules keep these edges from closing
a cycle:

- **R1** — trading journeys lock `Wallet` and `UserAccount` with `FOR NO KEY UPDATE`, never
  `FOR UPDATE` (`_lock_authorized_wallet`, `create_order_and_match`,
  `_lock_authority`, `_lock_foreign_matching_authority`). `FOR KEY SHARE` is compatible
  with `FOR NO KEY UPDATE` and
  conflicts with `FOR UPDATE`, so a matcher's foreign-key checks never wait on
  another trading transaction's wallet or account lock. These locks still exclude
  concurrent authorization changes. Without R1, one
  account's two wallets deadlock: the first request holds the account and wants a
  key share on the second wallet, while the second holds its wallet and waits for
  the account. A foreign seller's action can likewise hold its account and wait
  for the order while the matcher holds that order and waits for an account key
  share at commit. Wallet-side writers do hold `Wallet` `FOR UPDATE` and can delay the
  insert, but they hold nothing at or after `TransferOrder` in G, so they can only
  delay it, never wait on the matcher.
- **R2** — every lock that can cover more than one `TransferOrder` row goes
  through `lock_orders`, which orders by primary key before locking
  (`find_matching_orders`, `match_orders`, `create_swap_order`, `_lock_swap`,
  `expire_unclaimed_swap`). The action path's `_authorized_order` locks exactly
  one row.

- **R3** — foreign wallet/account/profile/user acquisition uses `NOWAIT`. Two creates holding different
  incoming wallets cannot wait on one another's authority, nor can a matcher wait
  behind a foreign action or account deletion while holding its own authority. Contention aborts the
  complete create transaction and leaves the submission retryable.

`tokens/tests/test_trading_lock_rules.py` holds R1, R2 and R3 against the source.

Two properties of the graph are deliberate rather than defects. The create path
reads the whitelist and the chain balance while holding its wallet and account
rows, so a balance is measured against every commitment visible under the lock,
while the modify path reads the chain outside every transaction; a slow provider
therefore extends how long the wallet's other requests and its authorization
changes wait on the create path only. And matching runs only inside creation:
two crossing orders created concurrently each see only committed candidates, so
both can rest unmatched until a third order arrives. That is a liveness limit of
the book, not a lock defect; nothing sweeps a crossed book.

| Pair | What must hold | Proved by |
| --- | --- | --- |
| P1 — create against create, one wallet | the second waits at the wallet lock and measures its balance against the first's committed order: refused when the two do not fit, open when they do | `test_order_submission_processes.py`: `test_a_second_sell_on_one_wallet_waits_and_is_refused_by_the_first_commitment` and `test_two_sells_that_fit_the_balance_together_both_open_after_waiting`, through independent app requests with bounded operator commits |
| P2 — create against create, two wallets of one account, crossing | the second waits on the account row; the matcher's key share on the second wallet does not deadlock; both commit and exactly one swap exists | `test_order_submission_processes.py`: `test_crossing_creates_on_two_wallets_wait_on_the_account_and_match_once`; reverting R1 turns it into a `DeadlockDetected` in one child |
| P3 — a decision against an authorization change (wallet verification, account reassignment) | the change waits on the wallet or account row until the decision commits, then the next submission is refused | `test_matching_wallet_locks.py` for the create path, whose two sides are threads on separate connections in one process; `test_order_action_processes.py`: `test_a_verification_change_waits_for_the_modify_and_then_refuses_a_fresh_submission` for the action path, where the modify is an independent process and the competing authorization change is a thread on the operator connection in the test process |
| P4 — the matcher against a cancel or modify of its candidate | same-account journeys serialize at the account; a foreign action waits behind an admitted matcher at the wallet, while a matcher encountering a busy foreign wallet returns retryable 503 and re-reads committed terms on retry: a modify or cancel of a matched order records its refusal with the spend committed, and a match after a modify uses the modified terms | `test_order_action_processes.py`: `test_a_modify_waits_for_the_match_and_is_then_refused_on_the_matched_order`, `test_a_cancellation_waits_for_the_match_and_is_then_refused_on_the_matched_order` and `test_a_match_waits_for_a_modification_and_matches_the_modified_values`, plus `test_the_foreign_sellers_modify_waits_for_matching_and_is_refused`, `test_the_foreign_sellers_cancel_waits_for_matching_and_is_refused` and `test_a_busy_foreign_modification_leaves_the_submission_retryable_with_no_spend` in `test_cross_account_matching.py`, using independent app requests and the bounded operator matcher; the serial one-process fences remain in `test_cancel_concurrency.py` and `test_modification_refusals.py` |
| P5 — cancel or modify against signature, execution or settlement of the same order | fenced by status under the order lock: a decision taken while a swap is pending records a refusal, and that refusal is what every later replay returns | `test_order_actions.py`: `test_a_pending_swap_is_a_recorded_refusal_only_after_validated_execution`, which proves that one interleaving and its terminal replay once the swap has failed; a swap arriving while an action is already in flight is not in the suite |
| P6 — signature, expiry and settlement of one swap against each other | both orders in primary-key order, then the swap: one release, a late admission refused, an admission never released | `test_swap_expiry_processes.py`, `test_swap_finality.py` (`test_two_settlement_workers_wait_for_the_orders_and_complete_once`) and `test_swap_process_concurrency.py`, in independent processes; the expiry and signature/matching pairs also run as scoped twins with the ownership rules in force — the signing and matching requests authenticate the recorded principal before their bounded operator commits, while the expiry sweep runs as the operator, matching the task framework's `acting_for(None)` shape — while the settlement-process class stays ordinary-only because `settle` requires the operator connection by design |
| P7 — recovery against recovery | the operation row first, then G; every lock released before an RPC; one attempt and one nonce | `test_swap_execution_recovery.py`: `test_rpc_boundaries_release_every_operation_authority_and_order_lock` and `test_delayed_open_after_peer_confirmation_reuses_its_attempt_and_nonce` |
| P8 — a wallet-side writer against a create on one wallet | serialisation only: the two sides share no accounting record, so their mutual exclusion buys identity freshness and nothing else | a property of G rather than a test: the wallet side holds nothing at or after `TransferOrder` |

These are [PostgreSQL row-lock semantics](https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS),
not a replacement for the account-ownership, wallet-address, verification,
deployment and balance checks that run under the locks.
