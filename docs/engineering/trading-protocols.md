# Trading protocols

[Engineering](README.md) · [Documentation](../README.md)

The immutable identities, locks and recovery contracts behind secondary trading: creating,
cancelling and modifying orders, the captured settlement context both parties sign, participant
approvals, durable swap execution, finality and what PostgreSQL freezes. For engineers changing the
order book or settlement. What investors see, the one-match rule and the accepted experimental limits
are in [trading](../business/trading.md); the operator response to pending work is in
[recovery](../operations/recovery.md#wallet-transfers-and-trading).

Contents:

- [Intent and settlement](#intent-and-settlement)
- [Creating an order](#creating-an-order)
- [Cancelling or modifying an order](#cancelling-or-modifying-an-order)
- [The trading lock graph](#the-trading-lock-graph)
- [The reviewed intent](#the-reviewed-intent),
  [swap settlement context](#swap-settlement-context) and
  [the settlement admission matrix](#the-settlement-admission-matrix)
- [Payment units](#payment-units)
- [Participant approvals](#participant-approvals)
- [Durable execution](#durable-execution) and
  [the finality consumer](#the-finality-consumer)
- [What PostgreSQL freezes](#what-postgresql-freezes)
- [Unclaimed expiry](#unclaimed-expiry)

## Intent and settlement

`TradingFeatureFlagMiddleware` (`backend/feature_flags/middleware.py`) refuses every method under
`/api/v1/trading/orders/`, `wallets/`, `swaps/` and `events/` with 403 while the `trading_enabled`
flag is off; an operator can switch it per deployment in Django admin. The read-only token market and
the per-class whitelist status sit outside those prefixes. The flag is an operations switch, not a
product mode, and does not establish safety.

Who may trade, who sees orders and what a quote promises are business rules:
[who may trade and who sees orders](../business/trading.md#who-may-trade-and-who-sees-orders).
Market readers see aggregated prices and remaining quantities from open or partially filled orders
that meet the same signed admission and current-authority checks as foreign matching. Unjournaled,
stale-domain, unverified-wallet and inactive-owner orders do not advertise liquidity. Quotes use the
same uniquely configured, active settlement asset and live deployment as new orders; absent or
ambiguous configuration suppresses quotes.

Order creation, modification and swap signing each call `TradingAdmission.require_current`
(`backend/tokens/services/trading_admission.py`) for the account that signed, not the caller,
beside the wallet, registry and balance checks; it refuses without a current
[eligibility decision](../business/participants.md#company-eligibility-decisions) from the class's
company with `investor_not_eligible`, which create and modify record as a terminal refusal.

Owned order lists and details keep rows when the current share class becomes inaccessible. They show
the visible class identity where available, otherwise the recorded create-admission identity; legacy
orders without that record return explicit null names, symbols and contract addresses. Search covers
visible class identity and the owner's recorded admission identity. Pending swaps keep their recorded
V1 display; inaccessible legacy class names and symbols are null. These reads keep the order and
wallet ownership checks and neither make a hidden class public nor authorise a new trading action.

Once a swap completes, both parties' share and settlement-asset holdings are written from the chain
([holdings written from the chain](chain.md#holdings-written-from-the-chain)).

Selling reads the chosen wallet's balance of every deployed class and of the settlement asset from
the chain (`GET /api/v1/trading/wallets/balances/`). A class or the settlement asset is left out of
the answer only when its call returns no data and the node, asked again at once, reports the
configured chain (`eth_chainId`) and no contract code at that address (`eth_getCode`): nothing is
deployed there. That is logged with its symbol and address, and the wallet's other classes can still
be sold. Every other failure answers 503 rather than a partial list that would say the wallet holds
nothing: a node that cannot be reached or does not answer in time, any JSON-RPC error (web3 reports
some, rate limits and internal errors among them, as contract errors), a revert, a node on another
chain, missing return data where the address has code, and a check that cannot be made.

Swap-row RLS policies are installed; they do not by themselves complete every settlement,
reservation or signer guarantee ([tenancy](security.md#tenancy-model)).

## Creating an order

Create-order requests use an account-scoped client `submission_id`. A deliberate new order gets a
new UUID, including another order with equal terms; a retry keeps its original UUID. The message
route (`POST /api/v1/trading/orders/create/message/`) records the original account, wallet, terms
and signing domain before issuing a challenge whose envelope binds those identities. Legacy issued
challenges are preserved but cannot be attached retroactively to a submission. An old request missing
the new ids receives ordinary required-field errors; a new keyed request presenting an unlinked legacy
challenge receives `submission_refresh_required`. Both are refused before challenge spend.

After an uncertain response, read
`GET /api/v1/trading/orders/submissions/{submission_id}/?owner_account_uuid=...`. Account ownership
and the wallet's ownership and address are still required. Unknown and inaccessible submissions share
a 404, which does not prove that a preceding request failed to commit. Keep the same id when
retrying; changed original terms return `submission_conflict` and never spend a challenge. Recovery
of a created or refused outcome precedes current deployment, wallet verification and challenge-expiry
checks. A pending submission still needs an eligible token and wallet, exactly one configured
settlement asset (which the created order records; none or several refuse the message and the
execution alike before any challenge is spent) and a valid, unspent linked signature before creating
an order. Recovery returns immutable `intent` beside the current `order` and the original `match`;
modification or cancellation does not rewrite intent. The intent's `quantity` and `min_quantity` are
canonical decimal strings: forward them unchanged when renewing or retrying so JavaScript number
rounding cannot alter stored terms. New numeric draft inputs and existing order detail quantities
keep their formats. If a token becomes hidden, its previously authorised display snapshot can still
describe the owned order without granting visibility to the token.

The exact submission is authorised in app scope before entering the bounded operator service. That
service locks the submission, rechecks actor, account and wallet authority and immutable terms, and
commits challenge spend, order creation, matching and the recorded outcome in one independent
operator transaction (`execute_order_submission` in `backend/tokens/services/trading_order_create.py`).
Both aliases must have autocommit enabled and no enclosing transaction. The request returns to app
authority before serialisation. A lost response recovers the same recorded result through the
owner-scoped lookup; no second commit or matching queue is introduced. The app connection cannot
insert swap rows: its row-level write policy on `tokens_swaporder` is `false`, installed with the
other policies and grants by `shared/0002_database_guards`.

Foreign candidates need a recorded signed create admission with the current wallet, account, token
and chain identity, the same payment asset, a verified EVM wallet and an active account owner.
Unjournaled orders keep same-account matching only and gain no cross-account matching authority.
The database
orders candidates by price, creation time and primary key. The matcher streams batches of 100 rows
and yields compatible candidates one at a time, closing the iterator on success or refusal; it does
not materialise the whole book or a second match list. Each attempt has its own savepoint. It acquires
that candidate's wallet, account, profile and user rows with `FOR NO KEY UPDATE NOWAIT`, and only the
incoming and candidate order pair with `FOR UPDATE NOWAIT` in primary-key order. The locked order
terms must still match the selected snapshot. A busy or changed candidate returns HTTP 503 with code
`order_matching_busy`: challenge spend, new orders, matches and reservations roll back, the existing
submission stays pending, and the client retries its same UUID (a fresh UUID is not a retry). An
unrepresentable settlement rolls back its candidate savepoint, releasing its authority and order
locks before the next candidate. Unrelated lower-priority or minimum-incompatible wallets and order
rows are not locked. The
[owner chose this contention behaviour](https://github.com/Ledova/ledova/issues/646#issuecomment-5745891659)
instead of accepting an order while silently skipping a busy counterparty.

These record a terminal business refusal, with creation and matching rolled back to their savepoint
while spend and refusal commit together; the database accepts only these five codes:

| Cause | Code | Scope |
| --- | --- | --- |
| A negative whitelist result | `not_whitelisted` | The submission |
| Insufficient seller share or buyer payment balance | `insufficient_balance` | The submission |
| No current [eligibility decision](../business/participants.md#company-eligibility-decisions) from the class's company, including one that lapses or is revoked before commit; the refusal detail carries the reasons (usually `no_live_company_decision`) | `investor_not_eligible` | Token-wide |
| A share token whose recorded deployment names a chain other than the domain about to be signed, or whose deployment row cannot be read | `settlement_chain_disagreement` | Token-wide: matching refuses at the first candidate |
| Every compatible fill fails the amount check | `invalid_settlement_amount` | Matching tries later candidates when one fill fails, keeping price and time priority among usable fills |

Matching neither rounds nor resizes a fill, and leaves skipped resting orders unchanged
([payment units](#payment-units)). The same submission UUID
stays refused even if the counter-order or deployment later changes; a corrected intent uses a new
UUID. Provider, configuration, database and unclassified matching failures stay retryable; a lost
commit acknowledgement needs recovery. PostgreSQL guards protect the account and key, original intent,
challenge linkage and terminal outcome against direct SQL changes. Never delete these identities to
retry, or read a refusal as permission to create another order. A separate deliberate order still
undergoes the ordinary creation and matching checks. This protocol adds no aggregate balance policy,
outgoing signer activation or settlement finality guarantee.

## Cancelling or modifying an order

Cancel and modify requests use a separate account-scoped `action_id`. Before preparing a fresh
action, read `GET /api/v1/trading/orders/{order_uuid}/action-context/?owner_account_uuid=...`. This
request is read-only. Use its canonical quantity, minimum and price strings for all absolute
replacement values, including unchanged values in a price-only modification; the order list's
numeric quantities are not a lossless source. Persist and verify a fresh action UUID before the first
message POST. A deliberate second action gets another UUID even if its terms are equal.

`POST /orders/{order_uuid}/cancel/message/` takes `action_id` and `owner_account_uuid`;
`POST /orders/{order_uuid}/modify/message/` also requires all three of `new_quantity`,
`new_min_quantity` and `new_price_per_share` as strings. These paths are relative to
`/api/v1/trading`, and `cancel/` and `modify/` execute the signed action. Issuance freezes the
authoritative identity and domain. A client must compare those values with its reviewed context
before signing. A mismatch may already have created a pending action: keep its id, discard the stale
review and challenge, and recover the recorded intent before asking for a new review. Do not attach
that id to different terms.

For an existing reminder or uncertain response, read
`GET /api/v1/trading/orders/actions/{action_id}/?owner_account_uuid=...` directly. A 404 means absent
or currently inaccessible; it does not authorise deleting the reminder, generating a replacement id
or claiming recovered terms. The execute POST identifies the action before checking a pending
signature, so an authorised recorded result remains recoverable with absent, expired or irrelevant
old credentials. Account ownership and wallet and order ownership still apply. The response separates
immutable `intent`, `review`, `result` and `refusal` from the current `order`; HTTP responses use the
camel-case renderer.

A stored business refusal returns the complete snapshot with `status: refused` and a
`refusal.httpStatus`. The database allows exactly these: `order_cancellation_failed` (400) for a
cancel, and `order_modification_failed` (400), `order_modification_conflict` (409) and
`investor_not_eligible` (403) for a modify. An applied modify records the eligibility decision it was
admitted under. Ordinary `action_intent_conflict` or `action_context_conflict` errors are not
terminal snapshots. Provider and preflight, validation and infrastructure errors also leave the
reminder unresolved; recover before retrying. Terminal replay does not repeat an order change or
publish a second event. The event mechanism has no outbox, so database recovery does not guarantee
event delivery.

A keyed pending action presenting an unlinked legacy challenge receives `action_refresh_required`
before spend; there is no automatic rebinding or legacy execution fallback. This protocol changes no
balance eligibility, admits no signer, broadcasts no transaction and establishes no settlement
finality.

## The trading lock graph

Every trading journey locks rows in one global order, G, taking PostgreSQL `FOR UPDATE` unless
stated otherwise:

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
of the same action contend for it, and those already serialise on the journal row. The action path's
order lock is load-bearing: `apply_order_modification` saves every column of the order, so a decision
taken on a stale read would overwrite a match. The held-order sweep (`place_held_order`) locks its
held order first and then, like a create, a candidate's authority and the order pair; it takes every
one of those locks with `NOWAIT`, so having started out of order it never waits on another trading
journey (its foreign-key checks wait only on wallet-side writers, as a create's do), and a busy row
leaves the order held for the next minute's sweep. Its second pass (`hold_crossing_order`) locks one
listed order, the newer of a crossing pair, also with `NOWAIT`, and nothing else. Foreign authority
comes after the incoming authority and challenge but never waits (R3).

Foreign-key checks add edges against G. A swap insert references both wallets; deferred checks after
repeated order updates can also take `FOR KEY SHARE` on the counterparty's account at commit.
Same-account legacy candidates keep their earlier authority-lock behaviour; foreign candidates have
their complete authority locked before matching. Three rules keep these edges from closing a cycle:

- R1: trading journeys lock `Wallet` and `UserAccount` with `FOR NO KEY UPDATE`, never `FOR UPDATE`
  (`_lock_authorized_wallet`, `create_order_and_match`, `_lock_authority`,
  `_lock_foreign_matching_authority`). `FOR KEY SHARE` is compatible with `FOR NO KEY UPDATE`, so a
  matcher's foreign-key checks never wait on another trading transaction's wallet or account lock,
  while those locks still exclude concurrent authorisation changes. Without R1 one account's two
  wallets deadlock at commit. Wallet-side writers hold `Wallet` `FOR UPDATE` but nothing at or after
  `TransferOrder` in G, so they can delay the insert but never wait on the matcher.
- R2: every lock that can cover more than one `TransferOrder` row goes through `lock_orders`
  (`backend/tokens/services/trading_locks.py`), which orders by primary key before locking
  (`find_matching_orders`, `match_orders`, `create_swap_order`, `_lock_swap`,
  `expire_unclaimed_swap`). The action path's `_authorized_order` locks exactly one row.
- R3: foreign wallet, account, profile and user acquisition and each candidate's order pair use
  `NOWAIT`, so two creates holding different incoming wallets cannot wait on one another's authority,
  and a matcher cannot wait behind a foreign action, expiry or account deletion while holding its own
  authority. Contention or changed candidate terms abort the whole create transaction and leave the
  submission retryable; each failed amount check rolls back its candidate savepoint, so locks do not
  accumulate across the priority walk.

Two properties of the graph are deliberate. The create path reads the whitelist and the chain balance
while holding its wallet and account rows, so a balance is measured against every commitment visible
under the lock; a slow provider therefore extends how long that wallet's other requests wait on the
create path only. And matching runs only inside creation and the held-order sweep, each order
deciding whether it may rest from the orders already committed, so two crossing orders created
concurrently can both rest unmatched. The minute's sweep bounds that liveness limit without a new
lock: it holds back the newer of any two listed orders that cross and matches it on its next run.
A held order the sweep lists publishes `order_listed`, one it matches publishes `order_matched`,
and the newer order of a crossing pair it holds back publishes `order_held`; both clients refresh
the book and the owner's orders on each. Every placement, settlement, lapse, revert and modification checks the
[book it would rest in](../business/trading.md#one-match-never-crossed).

The competing pairs the graph must hold are below. No process-level test proves them; they were
retired under the [minimum-test policy](../decisions.md#minimum-tests-and-fresh-migrations).

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
not a replacement for the account-ownership, wallet-address, verification, deployment and balance
checks that run under the locks.

## The reviewed intent

V1, the EIP-712 `SwapOrder` typed data over the `LedovaAtomicSwap` domain, is the only signed
protocol; unsupported protocols cannot be adopted, replayed or re-signed.

A newly matched swap captures its settlement context before anything is signed: the typed domain
(name, version, `chainId`, `verifyingContract`) and message (seller, buyer, share token, payment
token, share amount, payment amount, nonce, deadline), the parties bound to their exact order,
account, wallet and payment asset, the deployment that priced the payment, the digest and the
`order_hash`. `capture_settlement_context` (`backend/tokens/services/settlement_context.py`) refuses
a share token whose recorded deployment names a chain other than the domain about to be signed,
including one whose deployment row cannot be read, with the terminal `settlement_chain_disagreement`
refusal that [order creation](#creating-an-order) records.
Newly matched swaps use the owner-selected 15-minute signing window (`SWAP_ORDER_EXPIRY_HOURS`,
default 0.25); every recorded deadline and issued signature predating that decision keeps its own.
Two deliberate orders with equal terms remain two submissions, two orders and two swaps. Order
creation resolves the operator's single active, deployed, supported settlement asset, so two signed
orders form a swap. The captured context is what the parties review; every stage re-checks it under
its locks through the admission matrix below, and
[what PostgreSQL freezes](#what-postgresql-freezes) maps the
guards that hold it.

## Swap settlement context

Matches use the immutable settlement context installed by the fresh migrations and database guards;
the backend, shared package, dashboard and mobile carry this protocol together. New-context swap
requests require the exact swap, order, account and verified wallet identity; signing and approval
requests also require the recorded full settlement digest. The initial authorised context lookup may
omit that digest, and the response returns the original value for later requests. Missing identity
fields return HTTP 400 validation errors. An unsupported protocol or missing recorded context returns
HTTP 409 `swap_settlement_context_changed`. Exact lookup preserves the original review display and
decimal-string typed values after expiry or configuration drift; it does not authorise a new
signature or approval under changed terms. Ordinary numeric order and swap fields are not a lossless
source for rebuilding those signed values.

The swap list supplies `viewerParties`: each entry names a recorded buyer or seller role, account
UUID and wallet UUID that still belongs to the authenticated viewer and is verified with the original
address. It never exposes the other participant's private account or wallet identifiers. The
projection includes both owned sides whichever wallet address selected the row, so combining wallet
lists cannot drop a signing side.

Dashboard and mobile use those identities to select an available unsigned side, then fetch the exact
original context without a digest, and pin the returned digest for every later approval and signature
request. The lookup checks current ownership and verification again; a list entry is not
authorisation. Same-address wallets cannot substitute for the recorded wallet. List rows offer
review; exact amounts come from the fetched context before signing, never from rounded numeric list
fields. Signed sides stay visible only while another owned side still needs a signature.

## The settlement admission matrix

Every `swap/*` route on the order resource resolves the exact swap context and re-checks admission
before it answers. The resolver, `resolve_exact_swap_context`
(`backend/tokens/services/trading_order_access.py`), binds the caller's order, account and verified
wallet to the swap's recorded settlement context and names the caller's party; anything else is an
ordinary not-found. The re-check, `require_pending_settlement`, requires a pending status, no
transaction, a live signed deadline and a settlement context that still matches current
configuration.

| Route                          | Resolves                                                          | Re-checks |
| ------------------------------ | ----------------------------------------------------------------- | --------- |
| `GET swap/`                    | identity lookup, repeated after an optional approval-journal read | the re-check result is reported as `admission_refusal` rather than raised; a stale supplied digest or unsupported context still refuses with HTTP 409 through the resolver |
| `POST swap/sign`               | exact identity                                                    | `submit_signature` re-reads the swap, verifies the signature against the recorded terms, and under the operator lock re-authorises the actor, account and wallet (`_lock_authority`) and re-checks drift, deadline and status before storing |
| `GET swap/approval-status`     | identity lookup                                                   | re-check, then a fresh resolve and re-check before answering |
| `GET swap/approval-data`       | identity lookup                                                   | re-check, then a fresh resolve and re-check before answering, on both outcomes |
| `POST swap/approval-broadcast` | exact identity                                                    | the service re-checks before decoding, re-invokes the route's fresh resolver, and the recording transaction re-checks the locked swap and its digest |

No automated test covers every route in this matrix.

Delivery and recovery re-authorise the recorded actor under the lock
(`_lock_command(authority=True)` to `_lock_authority`), never a fresh one. The finality consumer
`settle` deliberately performs no actor authorisation at all: finality is not an actor's action, and
its body reaches neither the resolver, the re-check nor the authority lock. The swap list is a
wallet-scoped read under row-level security, not an admission, and is outside this matrix.

## Payment units

New matches calculate payment from the share quantity and execution price using the deployed payment
token's decimals. Calculation and context capture share one deployment snapshot. The total must be
exactly representable, positive and fit the stored signed 64-bit integer range; shares must also be
positive whole integers in that range. No amount is rounded or truncated. A fractional price is
allowed when its total is representable: 100 shares at 1.23 need 123 units of a zero-decimal token,
while three shares at that price cannot settle. Matching tries candidates in price and time order and
skips proposed fills that are unrepresentable or out of range. Each skipped attempt rolls back without
changing the resting order, its reservations or the proposed quantity. The first usable fill wins
within the signed price limit. If every otherwise compatible candidate fails this amount check, the
[submission protocol](#creating-an-order) records a permanent
refusal. With no compatible candidate, the order stays open.

V1 market history decodes the original raw payment with its captured deployment scale, including
older V1 records whose quoted price disagreed with the signed amount. It does not replace that amount
with the quote or rewrite signatures, context or digest. Market reads select the latest completed
swap by completion time, then identifier, and keep exact payment digits without floating-point
conversion. These read rules grant no permission to execute historical swaps.

## Participant approvals

The scoped approval-broadcast route verifies the actual signed bytes against the captured party,
chain, token, spender and existing unlimited approval value, then records them before any RPC. Inside
one bounded operator transaction it locks the swap row, reuses the `SwapApprovalSubmission` that
already holds the same bytes, refuses different bytes at a recorded sender nonce with HTTP 409
`swap_approval_conflict`, and otherwise inserts the exact bytes, their locally computed hash, nonce,
sender, token, spender, settlement digest, participant identity and requesting actor. The row commits
before the send, so a lost response or a killed process cannot lose the effect. The journal is
operator-only, and `(chain_id, tx_hash)` and `(chain_id, sender_address, nonce)` are unique across
every swap; PostgreSQL freezes the identity, writes the outcome once and refuses insertion unless the
referenced V1 swap is still pending.

Outside that transaction the recorded row is attempted: a row that already holds its receipt answers
HTTP 200 with no RPC; otherwise the bytes are sent, the acknowledgement is recorded when the node
returns the computed hash, and the request waits a few seconds for the receipt. A receipt whose
transaction hash equals the computed hash is recorded as `confirmed` or `reverted` with its block and
gas, and stays attributed to the original context if the deadline or configuration changes during
the wait. Only `confirmed` answers HTTP 200. Everything else returns HTTP 503
`swap_approval_unconfirmed` with the original scoped identity and computed hash, and its detail
states the recorded row's own outcome. While the row is pending the approval is recorded and recovery
is in progress: do not sign another approval for that swap. A `reverted` or `superseded` row says
the approval took no effect and is no longer replayed, which is when `approval-data` prepares a fresh
one. The client keeps its saved hash until exact outcome recovery establishes a definite result.

`GET swap/` accepts one optional `approval_tx_hash`. Its `approval_outcome` is absent when no hash
was requested, null when no authorised journal row matches, or the original `tx_hash` and
`pending|confirmed|reverted|superseded` outcome. This is a bounded operator read of the supplied hash,
captured chain, sender, token and spender, and the current party's account and wallet; authorisation
is resolved again after the read. It returns no signed bytes and makes no provider call, so expiry,
configuration drift or a provider outage cannot prevent reading a recorded outcome. An unlimited
approval can serve another swap with identical effect terms for the same account and wallet; its
journal's first swap is not its only valid consumer.

Both clients recover saved approval hashes through that exact-context read. They validate the
returned context and requested hash before clearing a `confirmed`, `reverted` or `superseded`
reminder and showing its outcome. Pending, missing, inaccessible or malformed evidence stays
unresolved, as does an older server response without the optional field. A storage removal failure
keeps the reminder and allows another check. A sufficient allowance does not establish the original
transaction's outcome. Recovery never signs or sends a new approval: after a definite failure, a
still-admitted settlement can use the fresh approval review.

The five-minute `recover_swap_approval_submissions` sweep attempts at most 100 pending rows, least
recently updated first. An attempt advances that activity timestamp before checking identity or
reading a provider, so an unavailable row cannot monopolise a bounded batch; the send timestamp stays
separate and controls the resend interval. Each attempt verifies the bytes against the recorded
identity, reads the endpoint's current chain id, and looks for the receipt by hash first, recording
it when found. With no receipt, a sender whose mined nonce has passed the recorded nonce marks the
row `superseded`. Otherwise the exact bytes are resent, at most once a minute across route and sweep,
only while the swap is still pending, its captured context still matches the current configuration
and the signed deadline is live; after the deadline or after drift nothing is resent and the row is
observed until a receipt arrives or the nonce moves. Rows are kept indefinitely. The sweep never
signs, never allocates a nonce and never sends bytes it did not record.

`approval-data` refuses with HTTP 409 `swap_approval_pending` while a submission for the same chain,
sender, token and spender is pending, so a second device cannot prepare a competing approval; a fresh
approval is prepared only after `confirmed`, `reverted` or `superseded`. Execution admission still
proceeds on an included approval without waiting for finality. Approval data otherwise has two
mutually exclusive outcomes: sufficient allowance, or an approval transaction with the original
identity. Signing and approval schemas describe only the exact settlement contract, and the general
transfer service is unchanged.

Approval provider admission uses the inherited cached `assert_expected_chain` result; execution
recovery additionally reads the endpoint's current chain id before observation and delivery.
Execution admission keeps complete signed arguments and their original domain, and a receipt that
cannot be attributed to that original chain and context leaves the claim unresolved. A captured
party's signature is permitted through either currently authorised participant while the other order
and wallet stay private. Private cross-account matching and outcome writes requiring both parent
objects keep separate limits. Unresolved claims and reservations are kept for operator
reconciliation; a successful signature response does not establish settlement. Participant approval
submissions admit no signer: the operator's
[automatic swap approval](chain.md#automatic-swap-approval) and swap execution
stay under the [outgoing foundation's admission](chain.md#signer-admission).

## Durable execution

The completing signature, a private `BlockchainTransaction` admission and its `recover_swap_execution`
job commit together. Admission records the authenticated caller's original account participant and
actor, even when that participant relays the other party's valid signature. Both parties' private
parent orders are changed through a bounded operator transaction. If no valid relayer key is
configured, both signatures stay READY; an explicit exact signature replay can admit the execution
later. A sweep never invents the initiating actor.

Recovery binds the original transaction to `swap-execution:<transaction UUID>` in the
[outgoing foundation](chain.md#outgoing-signing-foundation), using the recorded
chain, relayer, target and full ABI calldata. Before any send, the common signed bytes, hash and
nonce reservation commit with both transaction and swap hashes. Competing workers recover the same
operation. A lost response, process stop or missing receipt cannot authorise a second transaction or
nonce. Before each resend, recovery reads the relayer's mined transaction count; once it passes the
attempt's nonce, the attempt's own bytes go through the
[nonce-spend reader](wallet-protocols.md#evm-nonce-spend-evidence) and the swap
holds for operator attribution with nothing resent. The warning names the consuming hash and its kind
when the provider can answer, and the reason it could not when it cannot. The foundation cannot
replace or cancel a signed attempt, so a spend made outside it is recorded, never adopted, and a
stuck relayer nonce has no supported remedy.

The five-minute `resolve_executing_swaps` sweep considers at most 100 admitted pending or submitted
transactions older than ten minutes, oldest update first, and runs `recover` on them; separately it
passes at most 100 confirmed or reverted transactions whose swap is still executing to the finality
consumer below. It can recover admission before the common operation exists and a receipt retained
before its local projection.

Fresh preparation and signing require the original caller's active ownership and verified wallet,
unchanged settlement configuration and a live signed deadline. Signed delivery checks those
conditions again, plus current signer admission, before the send. Locks commit before RPC; a call
that crossed the boundary may still send after a concurrent change, and closing admission is a drain
barrier. Original receipt observation stays available after authority, key, domain or deadline
changes, provided the original chain remains reachable; no new authority is inferred from it.

Success requires the original receipt hash, sender, target and one correctly decoded `SwapExecuted`
event with the exact digest, parties, tokens and amounts. The event must belong to the receipt's
transaction and block. A contradictory, removed, missing or duplicate event stays unresolved. Revert
evidence must name the original transaction. The common operation keeps its first receipt summary;
full event evidence is verified before storing that summary.

Both successful and reverted signed receipts leave the public swap EXECUTING and parent reservations
held until finality. Only a proven unsigned preparation failure can fail the swap before that and
unwind its reservation once. This adapter never restarts its original claim, including after a
revert. There is no aggregate capital reservation
([#625](https://github.com/Ledova/ledova/issues/625), not planned); the per-row guards and the
sell-side and buyer-side commitment checks stand.

### The finality consumer

`settle` runs from the same sweep for every executing swap whose transaction is confirmed or
reverted. It reads the chain with the wallet observer's evidence collector under the
[approved finality policy](wallet-protocols.md#wallet-chain-observations) for the
swap's own network (`evm:<chain_id>`), without a persisted observation: the verdict is recomputed
every sweep, and the settlement write beside the frozen first-seen receipt summary is the record. It
accepts only a canonical inclusion whose finality is satisfied, then reads the receipt again and
re-verifies the `SwapExecuted` event before writing anything; `unknown`, `waiting` and `orphaned`
hold the swap for the next sweep, and nothing is resent, so an inclusion that never returns to the
canonical chain stays executing for operator attribution and is logged. Every chain read happens
outside locks; the write locks both parents, the swap and the transaction in that order and checks
the recorded identities again, so two workers cannot settle one swap twice and a settled swap is left
alone without another chain call.

Completion rechecks the configured finality policy under those locks. The swap's `finalized_receipt`
records the verified final block number and hash, gas and policy in the same transaction as
completion or final failure and the parent updates. A same-outcome reinclusion may have a different
block from the first receipt; the common operation and the transaction both keep their immutable
first summaries. Register integration must use the swap's final inclusion when comparing settlement
against an opening boundary
([recording completions](records.md#recording-completions-after-the-opening)), and company-run
[register openings](records.md#openings-api) from the chain read it. The database validates the evidence
shape and freezes it on settlement; provider evidence is verified by the service, not proven by those
database checks. `finalized_receipt` is nullable: swaps completed without it keep no evidence, and
the guards refuse ordinary backfills. New signed settlement requires evidence; unsigned preparation
failures keep none.

A final successful inclusion completes the swap. `completed_at` is the settlement clock, when
finality was observed, not the block time. Parents keep their filled quantity, take the transaction
hash, and become `completed` when fully filled. A parent with shares left returns to the book as
`partially_filled`, or is held back (`held`) when its price would cross the book, and takes its next
single match from the minute's sweep
([one match, never crossed](../business/trading.md#one-match-never-crossed)); either way it
can be modified or cancelled again. `swap_completed` is published after commit, and the market's last
price moves at this point rather than at the first receipt. A reverted inclusion releases the
reservation only once that revert is itself final, through the same unwind as an unsigned failure,
which returns both parents as the expiry sweep does; its first receipt holds. A transaction
re-included in a different block completes when the same hash is final there and the event
re-verifies; the frozen receipt summary on the operation and transaction records the first-seen
inclusion and is not rewritten. A re-inclusion whose finalized outcome differs from the first
receipt's, a revert finalized as a success or the reverse, is held for operator attribution: the
sweep logs both outcomes once per pass and neither completes nor releases the swap.

PostgreSQL cannot see finality, so that remains the service's guarantee. Swaps hold a financial
reservation; of the other operator families only share issuances also wait for finality
([receipts and outcomes](chain.md#receipts-and-outcomes)). A local chain never
settles a swap unless `LOCAL_CHAIN_FINALITY_DEPTH` is set
([configuration](../operations/configuration.md#chain)).

## What PostgreSQL freezes

`shared/0002_database_guards` installs these guards on a fresh database from
`backend/tokens/database_guards.sql` and `backend/blockchain/database_guards.sql`; this map is not an
old-database upgrade procedure.

| Subject                                               | Freezes |
| ----------------------------------------------------- | ------- |
| Settlement context and swap identity                  | The settlement context, digest and `order_hash` cannot be replaced, and the fifteen-field swap identity (uuid, both parents, both wallets, token, payment asset, both addresses, both amounts, nonce, order hash, expiry, creation) is immutable; new swaps must carry protocol 1 and name both parent orders with matching tokens, types, wallets and addresses; a recorded settlement identity cannot be deleted |
| Order owner identity and the captured-party signature | Each order's owner identity (uuid, account, wallet, address) cannot change, and a referenced parent order cannot be replaced; a captured party's signature is permitted through either currently authorised participant while the other order and wallet stay private; case-only address spelling, economic and status updates and unreferenced order deletion remain available; an unchanged V1 update must prove one current captured participant to avoid both-parent derivation, and INSERT, legacy and the original operator or both-visible path keep their checks |
| V0 rows                                               | Every V0 row is held: all UPDATE and DELETE attempts on it, including operator writes and parent cascades, are rejected |
| Execution admission                                   | Exact addresses, supported exact integers, both original 65-byte signatures and the original chain; transaction identity, admission and arguments are immutable, the first receipt summary, first submission time and original nonce are kept, and historical transactions gain no new signing authority; admission requires its original actor and participant, its original V1 order, arguments equal to the original settlement and signatures, an unclaimed ready order and an empty journal; failure requires proof that the original operation never signed; the original claim cannot restart, including after a revert |
| Swap status transitions                               | Fresh swaps start without signatures or execution claims; claimed swaps keep their journal, signatures and execution hash; `executing` becomes `completed` only with a confirmed admitted journal, its confirmed operation, a matching hash and a completion time, or `failed` with a reverted journal or a proved unsigned failure whose journal holds no hash; `completed` and `failed` are terminal; signed swaps stay held until finality |
| Outgoing history and nonces                           | Outgoing transaction history cannot be changed or deleted; signer identity and reserved nonces cannot be rewound; outgoing operation identity cannot be changed |
| One operation per swap                                | An admitted swap transaction binds exactly one outgoing operation (one-to-one, protected), and at most one admitted swap transaction exists per swap |

Related, narrower guards freeze order submission identity and terminal outcomes, the recordable
refusal codes and the participant approval journal. Application connections cannot read or write the
private execution journal. Historical unmarked transactions gain no admission or signing authority
and stay held for attribution. The generic monitor does not handle swap transactions, and there is no
direct executor or receipt-driven financial completion.

## Unclaimed expiry

`expire_unclaimed_matches` runs every minute and releases the reserved share quantity of an expired
V1 swap only when the matching service marked it eligible at creation, both orders still name that
match, and no execution claim, transaction record, hash or other active match exists. The sweep
(`expire_unclaimed_swap`) locks both orders in identifier order, then the current swap, as
[the trading lock graph](#the-trading-lock-graph) requires, and
commits each release separately. It keeps previously filled quantities and signed terms, marks the
swap `expired`, and publishes `swap_expired` so both clients refresh their orders and swaps. A retry
cannot release the same reservation twice. Signing still stops at the recorded deadline; the worker
makes eligible orders available on its next sweep, returning the two orders oldest first under the
[one-match rule](../business/trading.md#one-match-never-crossed), and the held-order sweep never
pairs them again.

The expiry-eligibility marker is immutable. Do not backfill it: missing transaction data does not
establish that nothing was sent. The marker describes the current service's durable claim protocol.
Claimed, executing and inconsistent matches keep their reservations for reconciliation. This sweep
does not inspect the chain, refund money, cancel a broadcast or change an existing signature or
deadline.

Next: [trading](../business/trading.md), [contracts and chain](chain.md),
[wallet protocols](wallet-protocols.md) and
[recovery](../operations/recovery.md).
