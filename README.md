# Ledova

Ledova is non-custodial, multi-company share-registry and tokenisation
infrastructure built on public blockchain networks. Companies use Ledova to
administer and represent their shares, but each company remains responsible for
issuing shares, approving and verifying investors, meeting its legal
obligations, approving transfers and maintaining its legal shareholder
register. The agreed [product direction](docs/product-direction.md) is the
source of truth for this positioning and for what is in and out of scope.

> **Experimental and unaudited.** Use only synthetic data on a local development
> chain or supported public testnet. Ledova is not production ready and must not
> be used with real funds, securities, companies, identities, wallets or personal
> information. It makes no claim of regulatory compliance or legal recognition,
> and the direction document itself requires specialist legal review before any
> launch.

Ledova is infrastructure used by companies and investors — not an exchange,
broker, custodian, market operator, investment adviser or counterparty. The
[responsibility boundary](docs/product-direction.md#4-the-responsibility-boundary)
keeps every regulated decision with the issuing company: companies configure
share classes and investor requirements, approve investors and transfers, and
keep the legal register of members; investors control their own wallets and
keys; a public blockchain preserves the verifiable ownership record. The
[scope and exclusions](docs/product-direction.md#9-explicitly-out-of-scope-for-v1)
rule out for V1 the order book, automatic matching, buy and sell flows,
market execution, custody and any platform-issued stablecoin.

## Main components

| Component | Responsibility |
| --- | --- |
| `contracts/` | Share tokens, whitelist and settlement contracts |
| `backend/` | Django API and admin, PostgreSQL data and background jobs |
| `dashboard/` | React web interface for issuers and investors |
| `mobile/` | Expo / React Native client |
| `packages/` | Shared client types, services, hooks and design tokens |
| `marketing/` | Public project website |

The [architecture overview](docs/architecture/README.md) shows how these pieces
work together and links to their technical details.

## Get started

Follow [local setup and first use](docs/getting-started.md) for prerequisites,
starting the stack, signing in and preparing a synthetic demo.

Use the [documentation index](docs/README.md) to choose a route:

- Understand the [product and terminology](docs/product.md) and the
  [product direction](docs/product-direction.md).
- Run an instance: [configuration, jobs and recovery](docs/operations/README.md).
- Contribute: [workflow, standards and verification](CONTRIBUTING.md).
- Review assumptions and open legal questions: [legal positions](docs/legal.md)
  and the direction's [regulatory validation list](docs/product-direction.md#14-regulatory-validation-required).

Report vulnerabilities through the [security policy](SECURITY.md).

## Current state and the direction programme

The codebase still contains an earlier trading and portfolio surface — order
matching, swap settlement, crypto wallet portfolio and pricing screens — which
the product direction places out of scope for V1. Those routes remain disabled
by default, and their removal or retention is being sequenced through the
[direction adoption programme](https://github.com/Ledova/ledova/issues/639),
together with the registry-first V1 the direction defines. Nothing in this
repository should be read as an offer to operate a market.

## Ownership and license

Ronildo da Rocha Braga Junior builds and maintains Ledova and holds its copyright.
Blueberry Money sponsors the work and intends to be its first hosted operator.
Sponsorship transfers neither ownership nor control over the project.

Ledova is source-available under [FSL-1.1-ALv2](LICENSE). Each release becomes
Apache 2.0 two years after publication; releases before 2026-09-10 remain under
Apache 2.0. Read the license for permitted uses and commercial restrictions.
It grants no trademark rights beyond identifying the software's origin.
