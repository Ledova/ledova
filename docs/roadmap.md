# Roadmap

[Documentation](README.md) · [Current capabilities](product.md)

This page records remaining outcomes. [Product decisions](decisions.md) explain
constraints that outlive a phase; focused architecture pages describe shipped code.
The [open hardening issues](https://github.com/RonildoBraga/ledova/issues?q=is%3Aopen+label%3Adeferred-hardening)
track security and correctness work. Phase labels are milestones, not dates.

## Phase 0 — Issuance works on chain

Shipped: share-class deployment, whitelisted issuance, authorized caps and recovery
of interrupted requests. See [contracts and issuance](architecture/contracts-and-issuance.md)
and [operator recovery](operations/recovery.md). Shipped mechanisms still have
explicit hardening limits, including signer coordination and receipt finality.

## Phase 1 — Investor directory and primary offering

Shipped: eligibility-gated discovery, offerings, subscriptions, manually recorded
payments/refunds/allotment, current/former register views, private uploads and the
operator console. See [product boundaries](product.md#current-capability-boundaries)
for client availability and [the primary-offering flow](architecture/offerings.md).

## Phase 2 — Eligibility and the register

Part shipped. Eligibility readers, former-member retention and transfer-only
holder discovery exist. Remaining outcomes include:

- An authoritative stored current-members register and a durable, queryable
  record of exports; the current register is derived at read time.
- Enforcement of the issuer KYC switch; investor KYC already affects eligibility.
- Completion of company authority, ownership and capital checks. Identifier
  validation hooks and registry verification do not establish every invariant
  for every write path.

See [eligibility](architecture/companies-and-eligibility.md) and
[register design and gaps](architecture/register.md).

## Phase 3 — Settlement automation

Planned: automate payment matching and the operator's primary-allotment workflow.
Incoming AUD transfers must preserve the issued reference text and arrive through
a webhook or polling. The provider will be selected when this phase is scheduled;
the choices considered are an open-banking feed and a payment service with a PayID
or virtual account per subscription. A stablecoin chain watcher is also planned.
Multi-tranche records can be added if reconciliation needs them.
See [the payment-provider decision](decisions.md#payments-and-settlement).

## Phase 4 — Secondary transfers

Planned and gated on unresolved trading hardening and independent review. The
trading flag remains off by default; [trading](architecture/trading.md) defines
its current scope and links implemented protocols.

The mobile investor directory and subscription flow are scheduled here: offering
detail, both payment rails, payment instructions and allotment views. Existing
shared hooks must support both clients. Current company/token screens should not
be read as a complete mobile issuer or primary-investor workflow.
See [the mobile scope decision](decisions.md#clients-and-api-types).

## Not on the roadmap

No off-ramp, public investor directory, retail offering or mainnet deployment
configuration is planned for the first releases. Register access remains per
share class for its issuer and the operator. The [legal positions](legal.md)
record the unresolved conditions before any real-world use.

## Open questions

- Should modifying an order re-run matching? Creation matches; modification
  does not report a candidate match.
- Should `NotificationPreferences` fold into `UserPreferences` with the next
  settings-screen change?
- The owner must resolve the legal and contractual questions in [legal.md](legal.md).
