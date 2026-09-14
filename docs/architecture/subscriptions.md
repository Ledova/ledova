# Subscriptions and allotment

[Architecture](README.md) · [Documentation](../README.md)

How payment, refund, scale-back and share allotment fit together.

## Data flow of a subscription

1. An eligible investor creates a draft at `POST /api/v1/subscriptions/` for a
   whole number of shares. Every writable FK is scoped in `get_fields()`: the
   offering to `Offering.objects.open_now()` inside
   `eligible_investor_companies(user)`, the account to the caller's investing
   account, the wallet to `owned_by(user).verified_evm()` on Base.
   `create_draft` snapshots the offering price onto the row, so a later price
   edit cannot move a live subscription.
2. `POST .../submit/` runs `require_subscription_eligibility(account, company,
   amount_due)`; `accept` in the admin runs it again, because a certificate can
   lapse between submission and acceptance and eligibility must still hold at acceptance. Both name the subscription's own account and issuer, so the
   qualification is checked against the record being accepted. An account may hold several live claims, so the test is whether
   *any* supports the offer; with no amount in play the newest live claim is
   reported.
3. Accepting issues the payment instruction in the same click.
   `offerings.services.payments.generate_reference` builds
   `Operator.payment_reference_prefix` plus an eight-character Crockford base32
   code, retried on `IntegrityError` against the partial unique index.
   `shared.payment_references` derives the prefix ceiling from the 18-character
   field budget minus the code; an overlong normalized prefix is refused even
   when a write bypassed model validation, and the random code is never
   truncated. `normalize_reference` runs on generation and on admin lookup, so a
   mangled bank narrative still matches. `build_instruction` returns the
   rail-dependent payload — the operator's bank fields, or the receiving wallet
   plus the settlement asset's contract address and decimals from
   `operators.settlement.require_deployment`, which refuses when the asset has
   no active deployment on `Operator.receiving_wallet_chain`.
4. Payment confirmation is columns on the subscription, not a second model.
   Received equal to due moves the row to `paid`; above due, `paid` with a
   refund owed; below due it stays `awaiting_payment` unless the operator
   accepts it as final, which scales `allotted_quantity` to `floor(received /
   price)` and records the residual as a refund. On the stablecoin rail the
   transfer hash is required, lower-cased, and refused unless it is `0x` plus 64
   hexadecimal characters; the partial unique index is on
   `Lower("payment_tx_hash")`, because a hash carries no checksum case and the
   same transfer pasted from two explorers must not fund two subscriptions. Two
   operators confirming that hash at once both pass the pre-check, so
   `confirm_payment` also catches the index's `IntegrityError` and returns the
   same refusal rather than a 500 for whoever loses. The hash is **not verified
   against the chain**: `confirm_payment` never checks that it exists, moves the
   right amount, or reaches the operator's wallet — the operator is trusted
   throughout this admin. The bank rail has no such key: settlement there is
   operator-attested, so a statement line already recorded against another
   subscription is a **warning** naming the other references, not a refusal.
   Acceptance, confirmation, refund, rejection, retry, bulk allotment and scale
   back each write a `LogEntry`, so a restated
   `amount_received` leaves the earlier figure in the object's history though
   the column holds only the latest; restating downwards warns as well.
5. Reject and withdraw are refused while money is recorded and unrefunded, and
   the test is arithmetic, not a flag: `has_money_in` compares `amount_received`
   against refunds that have actually gone back. A refund must be above zero and
   cannot exceed what is still returnable; `refund_amount` accumulates once
   `refunded_at` is set, and the row is closeable only when every cent is back.
   Before allotment the whole amount is returnable and the refund unwinds the
   allotment; after allotment only the residual no allotted share paid for can
   come back — a cent more is refused as a claimed mint, because money never
   leaves while the shares it bought stay out. Recording a refund rejects a
   still-executable issuance request in the same transaction — a compare-and-set
   against `EXECUTABLE_STATUSES`, so the worker's `mark_executing` and the
   refund cannot both win — and any refund, rejection, withdrawal or restated
   payment is refused once the request is `executing` or `executed`. Status
   alone is not the test, because `EXECUTABLE_STATUSES` includes `failed` and a
   mint that was broadcast and then lost its receipt fails the request with the
   shares already out. `ShareIssuance.mark_reverted` clears `tx_hash` and
   `mark_failed` keeps it, so a linked issuance with a `tx_hash` means a mint is
   out and every money move is refused by `share_token_service.broadcast_mint`
   until the executing sweep resolves it — completing it if it was mined, or
   clearing the hash if it reverted, which reopens the refund.
6. Allotment reuses the issuance machinery unchanged:
   `share_token_service.create_issuance_request`, `request.approve(...)`, the
   `OneToOne` link, then a task on the untouched `execute_request`. Three
   mechanisms guard against duplicate allotment: the `OneToOne`, claimed under
   `select_for_update` so two simultaneous clicks end in one request and one
   refusal; the unique `ShareIssuance.idempotency_key` derived from the request
   uuid; and the compare-and-set in `ReviewableRequest.mark_executing`.
7. The headroom test lives in `allot()`, the exported single-subscription entry
   point, so the offering cap — a disclosure limit, not an internal convenience
   — is guarded however the shares are raised. Bulk allotment groups by
   offering, takes `select_for_update` on the offering row as
   `_execute_capital_increase` does on the share class, drops the rows `allot()`
   would refuse anyway — already linked to a request, not `paid`, scaled to
   nothing — before it sums, so one stale row does not poison the batch, makes
   one `share_supply()` read and hands that headroom to each `allot()` call, and
   refuses the **whole** remaining batch when the total exceeds `min(offering
   headroom, authorized - issued - unminted)`, because part-filling first-come
   would destroy the pro-rata fairness `scale_back` exists to give.
   `totalSupply()` counts what is on chain, not what has been promised, so the
   chain half of that `min()` also subtracts every request for the token that
   can still mint — `approved`, `executing`, and `failed` while its issuance
   still carries a `tx_hash`. Without that subtraction two sequential batches
   each fit alone and jointly do not, stranding the second as a `paid` row whose
   task refuses forever. `scale_back` writes the money it strands: cutting
   `allotted_quantity` leaves `amount_due` and `amount_received` alone by
   design, so the gap between what arrived and what the scaled shares cost
   becomes `refund_amount`, and the clamp floors at zero so a negative headroom
   scales a row to nothing rather than to a quantity the database check
   constraint rejects.
8. `reconcile_subscriptions` runs every five minutes and is the mirror of
   `check_executing_issuance_requests`: the latter finishes the request a killed
   worker left, and without the mirror the subscription sits `paid` forever with
   the shares already on chain. That sweep takes `executing` requests and also
   `failed` ones whose issuance still carries a `tx_hash`, because nothing else
   looks at a `failed` request whose mint is out. The daily
   `expire_unpaid_subscriptions` only touches rows with no payment recorded.
9. Allotment stays an admin action. The API carries create, list, detail, submit
   and withdraw for the investor and no operator write route. The issuer reads
   its own offering's subscriptions at `GET
   /api/v1/offerings/{uuid}/subscriptions/`, scoped by the offering's own
   `subscribed_by(user)` and read-only, so payment confirmed and allotment pending
   are visible without a second writable surface. `ShareIssuanceListSerializer`
   carries `subscriptionReference`, so an allotment links back to the payment
   that bought it.
10. `Subscription.offering`, `.user_account` and `.wallet` are `PROTECT`, so a
    money record cannot be destroyed by a cascade. The handler turns the
    resulting `ProtectedError` into a 409 that says how many rows hold the
    target, rather than the 503 a raw database error produced.

Next: [issuance](contracts-and-issuance.md), [register](register.md), and [subscription recovery](../operations/recovery.md#subscriptions).
