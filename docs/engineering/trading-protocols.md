# Trading protocols

[Engineering](README.md) · [Documentation](../README.md)

The identities, locks and recovery contracts behind secondary trading, for engineers changing the
order book or settlement. Who may trade, what investors see, the one-match rule and the accepted
experimental limits are in [trading](../business/trading.md); the operator response to pending work
is in [recovery](../operations/recovery.md#wallet-transfers-and-trading).

Contents: [intent and settlement](#intent-and-settlement) · [creating](#creating-an-order) and
[cancelling or modifying](#cancelling-or-modifying-an-order) an order ·
[lock graph](#the-trading-lock-graph) · [reviewed intent](#the-reviewed-intent) ·
[settlement context](#swap-settlement-context) · [admission matrix](#the-settlement-admission-matrix)
· [payment units](#payment-units) · [participant approvals](#participant-approvals) ·
[durable execution](#durable-execution) · [PostgreSQL guards](#what-postgresql-freezes) ·
[unclaimed expiry](#unclaimed-expiry).

## Intent and settlement

`TradingFeatureFlagMiddleware` (`backend/feature_flags/middleware.py`) refuses every method under
`/api/v1/trading/orders/`, `wallets/`, `swaps/` and `events/` with 403 while the `trading_enabled`
flag is off; an operator switches it per deployment in Django admin. The read-only token market and
the per-class whitelist status sit outside those prefixes.

The rules are in
[who may trade and who sees orders](../business/trading.md#who-may-trade-and-who-sees-orders).
Order creation, modification and swap signing call `TradingAdmission.require_current`
(`backend/tokens/services/trading_admission.py`) for the account that signed, beside the wallet,
registry and balance checks; without a current
[eligibility decision](../business/participants.md#company-eligibility-decisions) from the class's
company it refuses with `investor_not_eligible`, which create and modify record as terminal. Market
quotes aggregate open or partially filled orders that pass the signed admission and current-authority
checks foreign matching uses, so unjournaled, stale-domain, unverified-wallet and inactive-owner
orders advertise nothing; quotes use the same uniquely configured, active settlement asset and live
deployment as new orders, and absent or ambiguous configuration suppresses them.

Owned order lists and details show the visible class identity or else the recorded create-admission
identity, which search also covers; legacy orders without that record return null names, symbols and
contract addresses. Pending swaps keep their recorded V1 display, with inaccessible legacy class
names and symbols null. These reads keep the order and wallet ownership checks.

Selling reads the chosen wallet's balance of every deployed class and of the settlement asset from
the chain (`GET /api/v1/trading/wallets/balances/`). One is left out, and logged with its symbol and
address, only when its call returns no data and the node, asked again at once, reports the
configured chain (`eth_chainId`) and no code at that address (`eth_getCode`). Every other failure
answers 503 rather than a partial list: an unreachable or slow node, any JSON-RPC error (web3 reports
some, rate limits and internal errors among them, as contract errors), a revert, a node on another
chain, missing return data where the address has code, or a check that cannot be made.

Swap-row RLS policies alone do not complete every settlement, reservation or signer guarantee
([tenancy](security.md#tenancy-model)).

## Creating an order

Create-order requests use an account-scoped client `submission_id`: a deliberate new order gets a new
UUID, even with equal terms, and a retry keeps its UUID. The message route
(`POST /api/v1/trading/orders/create/message/`) records the account, wallet, terms and signing
domain before issuing a challenge whose envelope binds those identities. Legacy issued challenges
are preserved but cannot be attached to a submission retroactively. An old request missing the new
ids gets ordinary required-field errors; a keyed request presenting an unlinked legacy challenge gets
`submission_refresh_required`. Both are refused before challenge spend.

After an uncertain response, read
`GET /api/v1/trading/orders/submissions/{submission_id}/?owner_account_uuid=...` (account, wallet
ownership and address still required). Unknown and inaccessible submissions share a 404, which does
not prove the request failed to commit. Retry with the same id; changed terms return
`submission_conflict` and spend no challenge. Recovering a created or refused outcome precedes
deployment, wallet verification and challenge-expiry checks. A pending submission still needs an
eligible token and wallet, exactly one configured settlement asset (recorded on the order; none or
several refuse the message and the execution before any spend) and a valid, unspent linked
signature. Recovery returns immutable `intent` beside the current `order` and the original `match`; later
changes never rewrite it. Its `quantity` and `min_quantity` are
canonical decimal strings to forward unchanged when renewing or retrying, so JavaScript rounding
cannot alter stored terms; numeric draft inputs and order detail quantities keep their formats, and
a hidden token's authorised display snapshot can still describe the owned order.

The submission is authorised in app scope, then the bounded operator service locks it, rechecks
actor, account and wallet authority and terms, and commits challenge spend, order creation, matching
and the outcome in one independent operator transaction (`execute_order_submission` in
`backend/tokens/services/trading_order_create.py`), with autocommit on both aliases and no enclosing
transaction; serialisation runs back under app authority. A lost response recovers the recorded
result through the owner-scoped lookup, with no second commit or matching queue. The app connection
cannot insert swap rows: its write policy on `tokens_swaporder` is `false`
(`shared/0002_database_guards`).

Foreign candidates need a recorded signed create admission with the current wallet, account, token
and chain identity, the same payment asset, a verified EVM wallet and an active account owner;
unjournaled orders match within their account only. The database orders candidates by price,
creation time and primary key; the matcher streams batches of 100 and yields compatible candidates
one at a time, closing the iterator on success or refusal, never materialising the book or a match
list. Each attempt has its own savepoint and takes the candidate's wallet, account, profile and user
rows `FOR NO KEY UPDATE NOWAIT` and only the incoming and candidate order pair `FOR UPDATE NOWAIT`
in primary-key order; the locked terms must still match the snapshot. A busy or changed candidate
returns HTTP 503 `order_matching_busy`: spend, new orders, matches and reservations roll back, the
submission stays pending, and the client retries its same UUID. An unrepresentable settlement rolls
back its savepoint, releasing those locks before the next candidate; unrelated lower-priority or
minimum-incompatible wallets and orders are never locked. The
[owner chose this contention behaviour](https://github.com/Ledova/ledova/issues/646#issuecomment-5745891659)
over accepting an order while silently skipping a busy counterparty.

These record a terminal refusal, with creation and matching rolled back to their savepoint while
spend and refusal commit together; the database accepts only these five codes:

| Cause                                                                                                                                                                                | Code                            | Scope                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- | --------------------------------------------------- |
| A negative whitelist result                                                                                                                                                          | `not_whitelisted`               | The submission                                      |
| Insufficient seller share or buyer payment balance                                                                                                                                   | `insufficient_balance`          | The submission                                      |
| No current eligibility decision from the class's company, including one that lapses or is revoked before commit; the detail carries the reasons (usually `no_live_company_decision`) | `investor_not_eligible`         | Token-wide                                          |
| A share token whose recorded deployment names a chain other than the domain about to be signed, or whose deployment row cannot be read                                               | `settlement_chain_disagreement` | Token-wide: matching refuses at the first candidate |
| Every compatible fill fails the [amount check](#payment-units)                                                                                                                       | `invalid_settlement_amount`     | Earlier failing candidates are skipped              |

The UUID stays refused even if the counter-order or deployment later changes; a corrected intent
uses a new UUID, and a separate deliberate order undergoes the ordinary checks. Provider,
configuration, database and unclassified matching failures stay retryable; a lost commit
acknowledgement needs recovery. PostgreSQL guards protect the account and key, intent, challenge
linkage and terminal outcome against direct SQL; never delete these identities to retry. This
protocol adds no aggregate balance policy, signer activation or settlement finality guarantee.

## Cancelling or modifying an order

Cancel and modify requests use a separate account-scoped `action_id`, persisted before the first
message POST; a deliberate second action gets another even with equal terms. Read-only
`GET /api/v1/trading/orders/{order_uuid}/action-context/?owner_account_uuid=...` supplies the
canonical quantity, minimum and price strings for every absolute replacement value, unchanged values
in a price-only modification included; the order list's numeric quantities are not lossless.

Under `/api/v1/trading`, `orders/{order_uuid}/cancel/message/` and `modify/message/` issue the
challenge (a modify needs all three of `new_quantity`, `new_min_quantity` and `new_price_per_share`
as strings), and `cancel/` and `modify/` execute the signed action. Issuance freezes the
authoritative identity and domain, which the client compares with its review before signing. A
mismatch may already have created a pending action: keep its id, discard the stale review and
challenge, recover the recorded intent before a new review, and never attach that id to other terms.

For a reminder or uncertain response, read
`GET /api/v1/trading/orders/actions/{action_id}/?owner_account_uuid=...`; a 404 (absent or
inaccessible) does not authorise deleting the reminder, a replacement id or claiming recovered terms.
The execute POST identifies the action before checking a pending signature, so an authorised result
stays recoverable with absent, expired or irrelevant old credentials, under the usual ownership
checks. The response separates immutable `intent`, `review`, `result` and `refusal` from the current
`order`, in the camel-case renderer.

A stored business refusal returns the complete snapshot with `status: refused` and a
`refusal.httpStatus`. The database allows exactly `order_cancellation_failed` (400) for a cancel, and
`order_modification_failed` (400), `order_modification_conflict` (409) and `investor_not_eligible`
(403) for a modify; an applied modify records the eligibility decision it was admitted under.
`action_intent_conflict`, `action_context_conflict` and provider, preflight, validation and
infrastructure errors are not terminal and leave the reminder unresolved: recover before retrying.
Terminal replay repeats no order change or event; events have no outbox, so database recovery does
not guarantee their delivery. A keyed pending action with an unlinked legacy challenge gets
`action_refresh_required` before spend, with no rebinding or legacy fallback. This protocol changes
no balance eligibility, admits no signer, broadcasts nothing and establishes no finality.

## The trading lock graph

Every trading journey locks rows in one global order, G, with PostgreSQL `FOR UPDATE` unless stated:

journal row (`OrderSubmission` or `OrderActionSubmission`) → `OutgoingOperation` → `SigningAccount` →
`Wallet` (`FOR NO KEY UPDATE`) → `UserAccount` (`FOR NO KEY UPDATE`) → `UserProfile` → `User` →
`SigningChallenge` → `TransferOrder` (ascending primary key) → `SwapOrder` → `BlockchainTransaction`.
Wallet-side writers branch off after `Wallet` into `Transaction` → `Holding` and never touch an order
or a swap.

Each journey's sequence is a subsequence of G: create and match (`execute_order_submission`,
`create_order_and_match`), cancel and modify (`execute_order_action`), the swap signature
(`submit_signature`), execution recovery (`recover`), settlement (`settle`) and the expiry sweep
(`expire_unclaimed_swap`), with three exceptions. The action path locks its `SigningChallenge` after
its `TransferOrder`; a challenge is bound to one submission or action and one wallet, so only replays
of the same action contend, and those already serialise on the journal row. That order lock is
load-bearing: `apply_order_modification` saves every column, so a stale decision would overwrite a
match. The held-order sweep (`place_held_order`) locks its held order first, then a candidate's
authority and the order pair, all `NOWAIT`, so having started out of order it never waits on another
trading journey (its foreign-key checks wait only on wallet-side writers, as a create's do); a busy
row leaves the order held for the next minute. Its second pass (`hold_crossing_order`) locks only
the newer listed order of a crossing pair, also `NOWAIT`. Foreign authority comes after the incoming
authority and challenge but never waits (R3).

Foreign-key checks add edges against G: a swap insert references both wallets, and deferred checks
after repeated order updates can take `FOR KEY SHARE` on the counterparty's account at commit.
Same-account legacy candidates keep their earlier authority-lock behaviour; foreign candidates have
their complete authority locked before matching. Three rules keep these edges from closing a cycle:

- R1: trading journeys lock `Wallet` and `UserAccount` `FOR NO KEY UPDATE`, never `FOR UPDATE`
  (`_lock_authorized_wallet`, `create_order_and_match`, `_lock_authority`,
  `_lock_foreign_matching_authority`). `FOR KEY SHARE` is compatible with it, so a matcher's
  foreign-key checks never wait on another trading transaction's wallet or account lock, which still
  excludes authorisation changes; without R1 one account's two wallets deadlock at commit.
  Wallet-side writers hold `Wallet` `FOR UPDATE` but nothing at or after `TransferOrder`, so they can
  delay the insert but never wait on the matcher.
- R2: every lock that can cover more than one `TransferOrder` row goes through `lock_orders`
  (`backend/tokens/services/trading_locks.py`), which orders by primary key before locking
  (`find_matching_orders`, `match_orders`, `create_swap_order`, `_lock_swap`,
  `expire_unclaimed_swap`). The action path's `_authorized_order` locks exactly one row.
- R3: foreign wallet, account, profile and user acquisition and each candidate's order pair use
  `NOWAIT`, so two creates holding different incoming wallets cannot wait on each other, and a matcher
  holding its own authority cannot wait behind a foreign action, expiry or account deletion.
  Contention or changed terms abort the create, leaving the submission retryable; each failed amount
  check rolls back its savepoint, so locks do not accumulate across the priority walk.

Two properties are deliberate. The create path reads the whitelist and chain balance while holding
its wallet and account rows, so a balance is measured against every commitment visible under the
lock, and a slow provider delays only that wallet's other create-path requests. Matching runs only
inside creation and the held-order sweep, each order deciding from committed orders whether it may
rest, so two crossing orders created concurrently can both rest unmatched; the minute's sweep bounds
that without a new lock by holding back the newer and matching it on its next run. A held order the
sweep lists publishes `order_listed`, one it matches `order_matched`, and the newer order of a
crossing pair it holds back `order_held`; both clients refresh the book and the owner's orders on
each. Every placement, settlement, lapse, revert and modification checks the
[book it would rest in](../business/trading.md#one-match-never-crossed).

The graph must hold these competing pairs; their process-level tests were retired under the
[minimum-test policy](../decisions.md#minimum-tests-and-fresh-migrations).

| Pair                                                                                       | What must hold                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1: create against create, one wallet                                                      | the second waits at the wallet lock and measures its balance against the first's committed order: refused when the two do not fit, open when they do                                                                                                                                                                                                               |
| P2: create against create, two wallets of one account, crossing                            | the second waits on the account row; the matcher's key share on the second wallet does not deadlock; both commit and exactly one swap exists                                                                                                                                                                                                                       |
| P3: a decision against an authorisation change (wallet verification, account reassignment) | the change waits on the wallet or account row until the decision commits, then the next submission is refused                                                                                                                                                                                                                                                      |
| P4: the matcher against a cancel or modify of its candidate                                | same-account journeys serialise at the account; a foreign action waits behind an admitted matcher at the wallet, while a matcher meeting a busy foreign wallet returns retryable 503 and re-reads committed terms on retry: a modify or cancel of a matched order records its refusal with the spend committed, and a match after a modify uses the modified terms |
| P5: cancel or modify against signature, execution or settlement of the same order          | fenced by status under the order lock: a decision taken while a swap is pending records a refusal, and that refusal is what every later replay returns                                                                                                                                                                                                             |
| P6: signature, expiry and settlement of one swap against each other                        | both orders in primary-key order, then the swap: one release, a late admission refused, an admission never released                                                                                                                                                                                                                                                |
| P7: recovery against recovery                                                              | the operation row first, then G; every lock released before an RPC; one attempt and one nonce                                                                                                                                                                                                                                                                      |
| P8: a wallet-side writer against a create on one wallet                                    | serialisation only: the two sides share no accounting record, so their mutual exclusion buys identity freshness and nothing else                                                                                                                                                                                                                                   |

These are
[PostgreSQL row-lock semantics](https://www.postgresql.org/docs/16/explicit-locking.html#LOCKING-ROWS),
not a substitute for the ownership, address, verification, deployment and balance checks under them.

## The reviewed intent

V1, the EIP-712 `SwapOrder` typed data over the `LedovaAtomicSwap` domain, is the only signed
protocol; unsupported protocols cannot be adopted, replayed or re-signed. A newly matched swap
captures its settlement context before anything is signed: the typed domain (name, version,
`chainId`, `verifyingContract`) and message (seller, buyer, share token, payment token, share
amount, payment amount, nonce, deadline), the parties bound to their exact order, account, wallet
and payment asset, the deployment that priced the payment, the digest and the `order_hash`.
`capture_settlement_context` (`backend/tokens/services/settlement_context.py`) refuses a share token
whose recorded deployment names another chain, or cannot be read, with the terminal
`settlement_chain_disagreement` that [order creation](#creating-an-order) records. New swaps use the
owner-selected 15-minute signing window (`SWAP_ORDER_EXPIRY_HOURS`, default 0.25); earlier recorded
deadlines and signatures keep their own. Two deliberate orders with equal terms remain two
submissions, orders and swaps. Every stage re-checks the captured context under its locks through
the [admission matrix](#the-settlement-admission-matrix), and
[PostgreSQL guards](#what-postgresql-freezes) hold it.

## Swap settlement context

The backend, shared package, dashboard and mobile carry the protocol together. Swap requests
require the exact swap, order, account and verified wallet identity (HTTP 400 when missing); signing
and approval requests also require the recorded settlement digest, which the first authorised context
lookup may omit and then returns. An unsupported protocol or missing recorded context returns HTTP 409
`swap_settlement_context_changed`. Exact lookup preserves the review display and decimal-string typed
values after expiry or configuration drift but authorises no new signature or approval under changed
terms; numeric order and swap fields are not a lossless source for signed values.

The swap list's `viewerParties` names each recorded buyer or seller role, account UUID and wallet
UUID still belonging to the viewer and verified with the original address, never the other
participant's identifiers, and includes both owned sides whichever wallet selected the row. Clients
use them to pick an unsigned side, fetch the context without a digest, and pin the returned digest
for later approval and signature requests. The lookup rechecks ownership and verification; a list
entry is not authorisation, and a same-address wallet cannot substitute for the recorded one. Exact
amounts come from the fetched context, never rounded list fields. Signed sides stay visible only
while another owned side still needs a signature.

## The settlement admission matrix

Every `swap/*` route on the order resource resolves the exact swap context and re-checks admission
before it answers. The resolver, `resolve_exact_swap_context`
(`backend/tokens/services/trading_order_access.py`), binds the caller's order, account and verified
wallet to the swap's recorded context and names the caller's party; anything else is an ordinary
not-found. The re-check, `require_pending_settlement`, requires a pending status, no transaction, a
live signed deadline and a context that still matches current configuration.

| Route                          | Resolves                                                          | Re-checks                                                                                                                                                                                                                                    |
| ------------------------------ | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET swap/`                    | identity lookup, repeated after an optional approval-journal read | the re-check result is reported as `admission_refusal` rather than raised; a stale supplied digest or unsupported context still refuses with HTTP 409 through the resolver                                                                   |
| `POST swap/sign`               | exact identity                                                    | `submit_signature` re-reads the swap, verifies the signature against the recorded terms, and under the operator lock re-authorises the actor, account and wallet (`_lock_authority`) and re-checks drift, deadline and status before storing |
| `GET swap/approval-status`     | identity lookup                                                   | re-check, then a fresh resolve and re-check before answering                                                                                                                                                                                 |
| `GET swap/approval-data`       | identity lookup                                                   | re-check, then a fresh resolve and re-check before answering, on both outcomes                                                                                                                                                               |
| `POST swap/approval-broadcast` | exact identity                                                    | the service re-checks before decoding, re-invokes the route's fresh resolver, and the recording transaction re-checks the locked swap and its digest                                                                                         |

No automated test covers every route in this matrix. Delivery and recovery re-authorise the recorded
actor under the lock (`_lock_command(authority=True)` to `_lock_authority`), never a fresh one. The
finality consumer `settle` performs no actor authorisation, because finality is not an actor's
action; it reaches neither the resolver, the re-check nor the authority lock. The swap list is a
wallet-scoped read under row-level security, not an admission, and is outside this matrix.

## Payment units

Payment is the share quantity times the execution price in the deployed payment token's decimals,
calculated from the same deployment snapshot as the context. The total must be exactly
representable, positive and within the stored signed 64-bit range, and shares positive whole
integers in that range; nothing is rounded, truncated or resized. So 100 shares at 1.23 need 123
units of a zero-decimal token, while three shares at that price cannot settle. Matching skips
unrepresentable or out-of-range fills in price and time order, each rolling back without changing the
resting order, its reservations or the proposed quantity, and the first usable fill within the
signed price limit wins. If every otherwise compatible candidate fails, the
[submission](#creating-an-order) is refused for good; with none compatible, the order stays open.

V1 market history decodes the raw payment with its captured deployment scale, even where an older
quoted price disagreed with the signed amount, rewriting no amount, signature, context or digest.
Market reads pick the latest completed swap by completion time, then identifier, with exact payment
digits and no floating point, and grant no permission to execute historical swaps.

## Participant approvals

The scoped approval-broadcast route verifies the signed bytes against the captured party, chain,
token, spender and existing unlimited approval value, then, in one bounded operator transaction
before any RPC, locks the swap row and reuses the `SwapApprovalSubmission` holding the same bytes,
refuses different bytes at a recorded sender nonce with HTTP 409 `swap_approval_conflict`, or
inserts the bytes, computed hash, nonce, sender, token, spender, settlement digest, participant
identity and requesting actor. Committing before the send means a lost response or killed process
cannot lose the effect. The journal is
operator-only; `(chain_id, tx_hash)` and `(chain_id, sender_address, nonce)` are unique across every
swap, and PostgreSQL freezes the identity, writes the outcome once and refuses insertion unless the
referenced V1 swap is still pending.

Then a row already holding its receipt answers HTTP 200 with no RPC; otherwise the bytes are sent,
the acknowledgement recorded when the node returns the computed hash, and the request waits a few
seconds for the receipt, recorded as `confirmed` or `reverted` with block and gas and attributed to
the original context even if the deadline or configuration changes meanwhile. Only `confirmed`
answers 200; anything else returns HTTP 503 `swap_approval_unconfirmed` with the scoped identity,
computed hash and the row's own outcome. While the row is pending, recovery is in progress: do not
sign another approval for that swap. A `reverted` or `superseded` row took no effect and is no
longer replayed, so `approval-data` prepares a fresh one. The client keeps its saved hash until
outcome recovery establishes a definite result.

`GET swap/` accepts one optional `approval_tx_hash`. Its `approval_outcome` is absent when no hash
was requested, null when no authorised journal row matches, or the original `tx_hash` and
`pending|confirmed|reverted|superseded` outcome. This bounded operator read uses the supplied hash,
captured chain, sender, token and spender and the current party's account and wallet, resolving
authorisation again afterwards; it returns no signed bytes and calls no provider, so expiry, drift or
an outage cannot prevent reading a recorded outcome. An unlimited approval can serve another swap
with identical effect terms for the same account and wallet; its journal's first swap is not its only
valid consumer.

Both clients recover saved hashes through that read, validating the returned context and hash
before clearing a `confirmed`, `reverted` or `superseded` reminder and showing its outcome. Pending,
missing, inaccessible or malformed evidence, or an older response without the field, stays
unresolved, and a failed storage removal keeps the reminder. A sufficient allowance does not
establish the transaction's outcome. Recovery never signs or sends a new approval; after a definite
failure a still-admitted settlement can use the fresh approval review.

The five-minute `recover_swap_approval_submissions` sweep attempts at most 100 pending rows, least
recently updated first, advancing that activity timestamp before checking identity or a provider so
an unavailable row cannot monopolise a batch; a separate send timestamp controls resends. Each
attempt verifies the bytes against the recorded identity, reads the endpoint's chain id and records a
receipt found by hash. With none, a sender whose mined nonce has passed the recorded one marks the
row `superseded`; otherwise the bytes are resent, at most once a minute across route and sweep, only
while the swap is pending, its context matches configuration and the deadline is live; after that
the row is only observed until a receipt arrives or the nonce moves. Rows are kept indefinitely. The
sweep never signs, allocates a nonce or sends bytes it did not record.

`approval-data` refuses with HTTP 409 `swap_approval_pending` while a submission for the same chain,
sender, token and spender is pending, so a second device cannot prepare a competing approval; a fresh
one is prepared only after `confirmed`, `reverted` or `superseded`. Execution admission proceeds on
an included approval without waiting for finality. Approval data otherwise has two exclusive
outcomes: sufficient allowance, or an approval transaction with the original identity. Signing and
approval schemas describe only the exact settlement contract; the general transfer service is
unchanged.

Approval provider admission uses the cached `assert_expected_chain` result; execution recovery also
reads the endpoint's chain id before observation and delivery. Execution admission keeps the
complete signed arguments and domain, and a receipt not attributable to that chain and context leaves
the claim unresolved. Private cross-account matching and outcome writes needing both parent objects
keep separate limits. Unresolved claims and reservations stay for operator reconciliation; a
successful signature response does not establish settlement. Participant approval submissions admit
no signer: the operator's [automatic swap approval](chain.md#automatic-swap-approval) and swap
execution stay under the [outgoing foundation's admission](chain.md#signer-admission).

## Durable execution

The completing signature, a private `BlockchainTransaction` admission and its
`recover_swap_execution` job commit together, recording the authenticated caller's participant and
actor even when relaying the other party's signature; both private parent orders change through a
bounded operator transaction. With no valid relayer key both signatures stay READY until an exact
signature replay admits the execution; a sweep never invents the initiating actor.

Recovery binds the transaction to `swap-execution:<transaction UUID>` in the
[outgoing foundation](chain.md#outgoing-signing-foundation), with the recorded chain, relayer, target
and full ABI calldata; the signed bytes, hash and nonce reservation commit with both transaction and
swap hashes before any send, and competing workers recover the same operation. Before each resend it
reads the relayer's mined transaction count; once that passes the attempt's nonce, the attempt's
bytes go through the [nonce-spend reader](wallet-protocols.md#evm-nonce-spend-evidence) and the swap
holds for operator attribution with nothing resent, the warning naming the consuming hash and kind,
or why the provider could not answer. A spend made outside the foundation is recorded, never
adopted, and a stuck relayer nonce has no supported remedy.

The five-minute `resolve_executing_swaps` sweep runs `recover` on at most 100 admitted pending or
submitted transactions older than ten minutes, oldest update first, recovering admission before the
operation exists and a receipt retained before projection, and passes at most 100 confirmed or
reverted transactions of still-executing swaps to the finality consumer.

Fresh preparation and signing require the original caller's active ownership and verified wallet,
unchanged settlement configuration and a live deadline; signed delivery rechecks them and signer
admission before the send, with locks committed before RPC, so a call that crossed that boundary may
still send. Receipt observation survives authority, key, domain or deadline changes while the chain
is reachable, and infers no new authority.

Success requires the original receipt hash, sender, target and one correctly decoded `SwapExecuted`
with the exact digest, parties, tokens and amounts, from the receipt's transaction and block; a
contradictory, removed, missing or duplicate event stays unresolved, and revert evidence must name
the original transaction. The operation stores its first receipt summary only after full event
verification. Signed receipts, successful or reverted, leave the swap EXECUTING and reservations held
until finality; only a proven unsigned preparation failure fails it earlier, unwinding its
reservation once. There is no aggregate capital reservation
([#625](https://github.com/Ledova/ledova/issues/625), not planned); the per-row guards and the
sell-side and buyer-side commitment checks stand.

### The finality consumer

`settle` reads the chain with the wallet observer's evidence collector under the
[approved finality policy](wallet-protocols.md#wallet-chain-observations) for the swap's network
(`evm:<chain_id>`), without a persisted observation: the verdict is recomputed each sweep, and the
settlement write beside the frozen first-seen receipt summary is the record. It accepts only a
canonical inclusion whose finality is satisfied, then rereads the receipt and re-verifies
`SwapExecuted` before writing; `unknown`, `waiting` and `orphaned` hold the swap with nothing resent,
so an inclusion that never returns to the canonical chain stays executing for operator attribution
and is logged. Chain reads happen outside locks; the write locks both parents, the swap and the
transaction in that order and rechecks the recorded identities, so no swap settles twice and a
settled swap needs no further chain call.

Completion rechecks the policy under those locks, and `finalized_receipt` records the verified final
block number and hash, gas and policy with completion or final failure and the parent updates. A
same-outcome reinclusion completes when the hash is final in its new block and the event
re-verifies; the operation and transaction keep their first-seen summaries. Register integration
must use the swap's final inclusion when comparing settlement against an opening boundary
([recording completions](records.md#recording-completions-after-the-opening)), and company-run
[register openings](records.md#openings-api) from the chain read it. The database validates the
evidence shape and freezes it on settlement; the service verifies provider evidence.
`finalized_receipt` is nullable: older completed swaps keep none and the guards refuse backfills,
new signed settlement requires it, and unsigned preparation failures keep none.

A final successful inclusion completes the swap. `completed_at` is the settlement clock, when
finality was observed, not the block time. Parents keep their filled quantity, take the transaction
hash, and become `completed` when fully filled; a parent with shares left returns to the book as
`partially_filled`, or is held back (`held`) when its price would cross, and takes its next single
match from the minute's sweep; either way it can be modified or cancelled again. Both parties'
holdings are then [written from the chain](chain.md#holdings-written-from-the-chain),
`swap_completed` is published after commit, and the market's last price moves now rather than at the
first receipt. A reverted inclusion releases the reservation only once that revert is itself final,
through the unwind an unsigned failure uses, which returns both parents as the expiry sweep does. A
re-inclusion whose final outcome differs from the first receipt's (a revert finalised as a success or
the reverse) is held for operator attribution: the sweep logs both outcomes once per pass and neither
completes nor releases the swap.

PostgreSQL cannot see finality, so that remains the service's guarantee. Swaps wait for it because
they hold a financial reservation ([which families wait](chain.md#receipts-and-outcomes)); a local
chain never settles a swap unless `LOCAL_CHAIN_FINALITY_DEPTH` is set
([configuration](../operations/configuration.md#chain)).

## What PostgreSQL freezes

`shared/0002_database_guards` installs these guards on a fresh database from
`backend/tokens/database_guards.sql` and `backend/blockchain/database_guards.sql`; this map is not an
upgrade procedure.

| Subject                                               | Freezes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Settlement context and swap identity                  | The settlement context, digest and `order_hash` cannot be replaced, and the fifteen-field swap identity (uuid, both parents, both wallets, token, payment asset, both addresses, both amounts, nonce, order hash, expiry, creation) is immutable; new swaps must carry protocol 1 and name both parent orders with matching tokens, types, wallets and addresses; a recorded settlement identity cannot be deleted                                                                                                                                                                                                             |
| Order owner identity and the captured-party signature | Each order's owner identity (uuid, account, wallet, address) cannot change, and a referenced parent order cannot be replaced; a captured party's signature is permitted through either currently authorised participant while the other order and wallet stay private; case-only address spelling, economic and status updates and unreferenced order deletion remain available; an unchanged V1 update must prove one current captured participant to avoid both-parent derivation, and INSERT, legacy and the original operator or both-visible path keep their checks                                                       |
| V0 rows                                               | Every V0 row is held: all UPDATE and DELETE attempts on it, including operator writes and parent cascades, are rejected                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Execution admission                                   | Exact addresses, supported exact integers, both original 65-byte signatures and the original chain; transaction identity, admission and arguments are immutable, the first receipt summary, first submission time and original nonce are kept, and historical transactions gain no new signing authority; admission requires its original actor and participant, its original V1 order, arguments equal to the original settlement and signatures, an unclaimed ready order and an empty journal; failure requires proof that the original operation never signed; the original claim cannot restart, including after a revert |
| Swap status transitions                               | Fresh swaps start without signatures or execution claims; claimed swaps keep their journal, signatures and execution hash; `executing` becomes `completed` only with a confirmed admitted journal, its confirmed operation, a matching hash and a completion time, or `failed` with a reverted journal or a proved unsigned failure whose journal holds no hash; `completed` and `failed` are terminal; signed swaps stay held until finality                                                                                                                                                                                  |
| Outgoing history and nonces                           | Outgoing transaction history cannot be changed or deleted; signer identity and reserved nonces cannot be rewound; outgoing operation identity cannot be changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| One operation per swap                                | An admitted swap transaction binds exactly one outgoing operation (one-to-one, protected), and at most one admitted swap transaction exists per swap                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

Narrower guards freeze order submission identity and terminal outcomes, the recordable refusal codes
and the participant approval journal. Application connections cannot read or write the private
execution journal, historical unmarked transactions stay held for attribution, the generic monitor
does not handle swap transactions, and there is no direct executor or receipt-driven financial
completion.

## Unclaimed expiry

`expire_unclaimed_matches` runs every minute and releases the reserved share quantity of an expired
V1 swap only when the matching service marked it eligible at creation, both orders still name that
match, and no execution claim, transaction record, hash or other active match exists. The sweep
(`expire_unclaimed_swap`) locks both orders in identifier order, then the swap, as
[the lock graph](#the-trading-lock-graph) requires, and commits each release separately. It keeps
filled quantities and signed terms, marks the swap `expired`, and publishes `swap_expired` so both
clients refresh their orders and swaps; a retry cannot release a reservation twice. Signing still
stops at the recorded deadline; the next sweep returns the two orders oldest first under the
[one-match rule](../business/trading.md#one-match-never-crossed), and the held-order sweep never
pairs them again.

The expiry-eligibility marker is immutable; never backfill it, because missing transaction data
does not prove nothing was sent. Claimed, executing and inconsistent matches keep their reservations
for reconciliation. The sweep inspects no chain, refunds nothing, cancels no broadcast and changes no
signature or deadline.

Next: [trading](../business/trading.md), [contracts and chain](chain.md),
[wallet protocols](wallet-protocols.md) and [recovery](../operations/recovery.md).
