# Subscriptions and allotment

[Architecture](README.md) · [Documentation](../README.md)

How payment, refund, scale-back and share allotment fit together.

## Company-managed primary relationship

[AUD is a required payment option for purchasing company shares](../decisions.md#registry-priority-crypto-on-ramp-and-aud-payments),
not merely a price display or an AUDY stablecoin balance.
[#868](https://github.com/Ledova/ledova/issues/868) owns the company-managed
primary payment work. The payment rail/provider, receipt verification,
reconciliation and refund design remain undecided. Do not require a crypto
on-ramp purchase or conversion to use the AUD payment option. The current bank
transfer and stablecoin instructions and staff-attested receipts below are the
existing implementation, not the completed company-managed AUD design.

The [accepted plan](company-managed-registers.md#delivery-sequence) replaces the
admin-only acceptance and receipt/refund recording paths with
company-capability workflows. Company or appointed-provider payment settings
and instruction snapshots must identify the actual primary recipient. Retain
existing instructions as historical evidence; migrate secondary-market deposits
and settlement separately rather than silently retargeting them.

The [paid company issue conversion](../plans/company-managed-registers/company-paid-issues.md)
is under implementation separately: it authorises exact issuance over an existing
recorded PAID subscription without selecting new collection or refund mechanics.

Company finance and issue authority are separate capabilities. A recorded receipt
does not approve an issue, and evidence of a payment must not claim more than
the configured provider/check actually establishes. Allotment must still bind
the exact approved subscription, recipient and shares, with atomic admission,
headroom, refund holds, idempotency, original transaction finality and bounded
recovery. Non-paid grants use genuine non-paid terms and issue authority, not a
fabricated receipt. The [paid-issue increment](../plans/company-managed-registers/company-paid-issues.md)
is under implementation and replaces staff issue admission with exact company
decisions over existing recorded PAID subscriptions. Acceptance and financial
receipt/refund producers remain staff-assisted pending #868, including the bank
and stablecoin attestation limitations below.

## Data flow of a subscription

1. An eligible investor creates a draft at `POST /api/v1/subscriptions/` for a
   whole number of shares. Every writable FK is scoped in `get_fields()`: the
   offering to `Offering.objects.open_now()` inside
   `eligible_investor_companies(user)`, the account to the caller's investing
   account, the wallet to `owned_by(user).verified_evm()` on Base.
   `create_draft` stores the offering price, currency, company display name
   (trading name with legal-name fallback), class name and symbol on the row.
   Later edits do not refresh those values. Existing applications are backfilled
   from their parents by the migration, including hidden and paused classes.
2. The personal list and detail read these stored values without joining the
   offering, class or company. Reads, bank instructions and guarded withdrawal
   remain available after a class is paused or the company leaves the directory,
   is warned or suspended. An unchanged application link can retain its stored
   owner when its parent is hidden; inserts, changed hidden links and owner
   tampering are refused. RLS read scopes are unchanged.
   `POST .../submit/` first re-reads the offering and its class and company under
   the caller's policies. A hidden parent returns 400 and leaves the draft intact.
   It then runs `require_subscription_eligibility(account, company,
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
   Acceptance, confirmation, refund, rejection, technical retry and scale
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
   leaves while the shares it bought stay out. A queued allotment refund retains
   a cancelled private admission and rejects its approved request atomically.
   A delayed task cannot revive it. Once the worker commits its executing claim,
   a refund remains refused until the original operation resolves. Known unsigned
   failures and confirmed reverts permit cancellation; unknown delivery does not.
   Historical failed rows with unresolved hashes or unidentified mint evidence
   retain their holds. An allotted subscription may still return only its excess.
6. Paid issuance needs the exact applied company
   [paid-issue instruction](../plans/company-managed-registers/company-paid-issues.md)
   over the recorded subscription and captured recipient, quantity and payment
   facts. Preparation and approval admit no request or execution. Application
   consumes company approval and admits one private `ShareIssuanceExecution`
   alongside its approved request, original subscription link and exact task
   identity. Initial queued
   work remains refundable until the worker claims it. The shared outgoing journal
   commits the original signed transaction and public associations before send.
   The database protects approved terms, first linkage, money and share quantities
   against stale edits. Fresh signing needs the original current company source;
   technical retry preserves that source and original identity. Recovery of
   accepted signed work is operator-owned after authority loss.
   Retry confirmations bind the subscription, actor and exact failed claim.
   See [issuance boundaries](outgoing-signing.md#share-issuances).
7. The company paid-issue family checks both offering headroom and class capacity
   under the original source locks, with current chain observations taken before
   locking. The offering cap remains a disclosure limit. Existing `scale_back`
   determines paid allotment quantities; the company does not use a retired staff
   bulk-admission path to choose a different quantity. Each exact application
   requires its amount to fit `min(offering headroom, authorized - issued -
   unminted)`, including original reservations and finalised unentered work.
   `totalSupply()` counts what is on chain, not what has been promised, so the
   chain half of that `min()` also subtracts every request for the token that
   can still mint: `approved` and `executing`, plus historical failed issuances
   retaining unresolved hashes. A new command with a confirmed revert retains
   its hash as evidence without holding unminted headroom. Without that subtraction two sequential applications
   each fit alone and jointly do not, stranding the second as a `paid` row whose
   task refuses forever. `scale_back` writes the money it strands: cutting
   `allotted_quantity` leaves `amount_due` and `amount_received` alone by
   design, so the gap between what arrived and what the scaled shares cost
   becomes `refund_amount`, and the clamp floors at zero so a negative headroom
   scales a row to nothing rather than to a quantity the database check
   constraint rejects.
8. New recovery commits the request, issuance and subscription's allotted status
   together after original receipt verification. `reconcile_subscriptions` still
   repairs historical paid subscriptions whose linked request already executed.
   The issuance sweep handles queued and executing private commands, plus
   unresolved historical requests. The daily `expire_unpaid_subscriptions` only
   touches rows with no payment recorded.
9. Both clients expose company preparation and exact approval/application through
   `/api/v1/tokens/register-paid-issues/`, with a narrow ready-source selector for
   current ADMIN/PREPARE in the exact company and class. Approvers and register
   readers can inspect proposals without that selector or the financial ledger.
   The existing subscription API carries create, list, detail, submit and withdraw
   for the investor and no operator financial write route. The issuer reads
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

## When each step happened

Each transition method stamps its own time, so the record shows when the
application moved as well as where it is: `submitted_at`, `accepted_at`,
`payment_instruction_issued_at`, `allotted_at`, `refunded_at`, and `closed_at`
for a rejection or a withdrawal. `payment_received_on` is the date the money
arrived, as staff recorded it. The investor's application page lists these as
its history in workflow step order. Rows from before these fields leave the earlier
steps unstamped, and the page leaves those steps out rather than guessing.

Next: [issuance](contracts-and-issuance.md), [register](register.md), and [subscription recovery](../operations/recovery.md#subscriptions).
