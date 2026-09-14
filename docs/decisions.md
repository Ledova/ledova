# Product and technical decisions

[Documentation](README.md) · [Roadmap](roadmap.md)

These are recorded owner choices and their reasons. Current mechanisms live in
architecture guides. This page makes no new product, licensing or legal decision.

## Eligibility and ownership records

The first offerings target wholesale and sophisticated investors. The four
classification categories and the deliberately excluded experienced-investor
category are recorded in [legal positions](legal.md#4-the-excluded-category-and-why-this-one-stays-unanswered).
Those positions were taken without advice; deployment stays on test networks
with synthetic data pending the required advice.

An `associated_person` claim reaches only its named issuer's directory entries;
it does not widen the secondary market. A holder who lacks market eligibility
cannot see the market for shares they own. Revisit that trade-off before enabling
trading. [Eligibility](architecture/companies-and-eligibility.md) owns enforcement details.

The register leaves amount paid blank when it cannot be established exactly;
zero would assert an amount that is not known. Classification evidence has a
fixed retention horizon, independent of account deletion. The legal basis and
uncertain clock are in [legal positions](legal.md); implementation belongs to
[the register](architecture/register.md) and [file retention](architecture/files-and-retention.md).

## Payments and settlement

Payment confirmation is stored on the subscription. The initial expected volume
is small and admin history records changes. There is no separate payment-per-tranche
model: a second payment updates the cumulative total with a note. A future
`SubscriptionPayment` table is additive if automated reconciliation needs it.

The bank-feed/payment provider is deliberately undecided until Phase 3. Incoming
AUD transfers must carry their reference text unchanged through a webhook or a
poll. References use the operator prefix plus an eight-character Crockford code
within an 18-character field. See [B7c](https://github.com/RonildoBraga/ledova/issues/115#issuecomment-5574962513)
and [operator configuration](operations/operator-console.md).

Shares are issued through allotment; generic wallet send endpoints refuse share
tokens. On-chain recipient whitelisting and the register's Transfer-event read
also account for subsequent share movements. Bitcoin sends remain externally
built and signed; the backend now decodes and verifies them before admission.
See [transfers](architecture/transfers.md).

## Assets and portfolio presentation

Share classes stay out of the general asset list. Discovery belongs to the
eligible investor directory, while holders can read their own holdings.
A share Asset has no current price: nominal issue price is not a market valuation
of an unlisted security.

The intended portfolio presentation is one line and allocation slice per asset,
summed across chains, with an expandable per-chain split. Sending and receiving
still select a chain. A sum must identify its value sources and explicitly identify
unpriced holdings. This is a display requirement, not a claim that every client
has completed it; see [B7d](https://github.com/RonildoBraga/ledova/issues/115#issuecomment-5574975348)
and [valuation presentation work](https://github.com/RonildoBraga/ledova/issues/346).

## Tenancy, sessions and deployment

Registry and single-issuer modes share one operator model and tenancy boundary.
PostgreSQL RLS enforces row isolation; product selectors still distinguish issuer
management, personal accounts and discovery. See [tenancy](architecture/tenancy.md).

There is one authentication path: simplejwt sessions with browser and mobile
transports. The unused v2 session design was withdrawn; its historical ADRs remain
in [the earlier tree](https://github.com/RonildoBraga/ledova/tree/963c686/backend/docs/adr).
Email is read-only to customers; staff changes revoke their sessions.

The published compliance seed intentionally uses public figures. Operational
thresholds and evasion-sensitive rules belong outside this repository.

## Clients and API types

Both clients compile `@ledova/shared` from source, without a package build step.
The mobile investor directory and subscription journey are scheduled for Phase 4;
shared hooks created earlier must accommodate both clients. The primary issuer
workflow remains dashboard-led. See [B7b](https://github.com/RonildoBraga/ledova/issues/115#issuecomment-5574947880)
and [B2](https://github.com/RonildoBraga/ledova/issues/115#issuecomment-5574848881).

Shared API types are generated from the committed OpenAPI snapshot. The owner
accepted PR #562 as the clean-release checkpoint on 2026-09-14; its reviewed head
and merge had identical trees, and all CI checks passed. The handwritten API
counterparts and partial drift parser retire with their generated replacements;
client state and cryptographic utilities retain their own types. See
[B7e](https://github.com/RonildoBraga/ledova/issues/115#issuecomment-5575002254),
[the checkpoint approval](https://github.com/RonildoBraga/ledova/issues/115#issuecomment-5656632666)
and [API gates](development/gates.md#the-api-type-drift-gate).

The source no-comments/no-docstrings rule remains an explicit repository choice;
[development standards](development/standards.md) defines its scope.
