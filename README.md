# Ledova

Ledova is a platform for creating and operating digital private equity markets.
It brings company onboarding, investor eligibility, share issuance, payments and
ownership records into one system. Companies can represent share classes as
blockchain tokens and manage their lifecycle through a web dashboard.

A company can operate an instance for its own shares, or a registry provider can
host multiple issuers. Investors interact through the dashboard and mobile app;
operators review applications and manage the deployment through Django admin.
The [product overview](docs/product.md) explains the roles, deployment modes and
which features are available in each client.

> **Experimental and unaudited.** Use only synthetic data on a local development
> chain or supported public testnet. Ledova is not production ready and must not
> be used with real funds, securities, companies, identities, wallets or personal
> information. It makes no claim of regulatory compliance or legal recognition.

Primary subscriptions use operator-confirmed payments and allotment. Secondary
trading remains disabled by default while the
[hardening work](https://github.com/Ledova/ledova/issues?q=is%3Aopen+label%3Ahardening)
is unresolved. The [roadmap](docs/roadmap.md) distinguishes these current limits
from the project's intended scope.

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

- [Understand the product](docs/product.md) and its terminology.
- [Run an instance](docs/operations/README.md): configuration, jobs and recovery.
- [Contribute](CONTRIBUTING.md): workflow, standards and verification.
- [Review assumptions and open legal questions](docs/legal.md).

Report vulnerabilities through the [security policy](SECURITY.md).

## Ownership and license

Ronildo da Rocha Braga Junior builds and maintains Ledova and holds its copyright.
Blueberry Money sponsors the work and
intends to be its first hosted operator. Sponsorship transfers neither ownership
nor control over the project.

Ledova is source-available under [FSL-1.1-ALv2](LICENSE). Each release becomes
Apache 2.0 two years after publication; releases before 2026-09-10 remain under
Apache 2.0. Read the license for permitted uses and commercial restrictions.
It grants no trademark rights beyond identifying the software's origin.
