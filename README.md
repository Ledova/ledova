# Ledova

Ledova is a share registry for private companies. Companies administer their
own registers and deal directly with their investors, shareholders and
employees; Ledova supplies the records, workflows and tools, with optional
on-chain ownership records and an experimental investor marketplace. A private
installation runs the same product. The [product page](docs/product.md) says
what is built and what is planned; the [decisions log](docs/decisions.md)
records why.

> **Experimental and unaudited.** Use only synthetic data on a local development
> chain or supported public testnet. Ledova is not production ready and must not
> be used with real funds, securities, companies, identities, wallets or personal
> information. It makes no claim of regulatory compliance or legal recognition.

Secondary trading is enabled by default on this experimental deployment, on
synthetic data only. Operation with real participants follows the conditions in
the [regulatory pathway](docs/regulatory-pathway.md), and releases require the
human checks in [#624](https://github.com/Ledova/ledova/issues/624). The
[roadmap](docs/roadmap.md) orients the remaining work.

## Main components

| Component | Responsibility |
| --- | --- |
| `contracts/` | Share tokens, whitelist and settlement contracts |
| `backend/` | Django API and admin, PostgreSQL data and background jobs |
| `dashboard/` | React web interface for companies and investors |
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
- [Review the regulatory pathway](docs/regulatory-pathway.md) and the
  [legal positions](docs/legal/README.md).

Report vulnerabilities through the [security policy](SECURITY.md).

## Ownership and license

Ronildo da Rocha Braga Junior created and maintains Ledova. Contributors retain
copyright in their contributions. Blueberry Money sponsors the work and intends
to be its first hosted platform operator; sponsorship transfers neither
ownership nor control over the project.

Ledova is public and source-available under the
[Ledova Noncommercial License 1.0](LICENSE). You may download, study, modify and
share it for the permitted noncommercial purposes, including preparing
contributions. Commercial use, including internal business use and paid services,
and using its code to offer a competing product or service, even for free,
require a separate written license. There is no automatic open-source conversion
under this license, and it grants no general trademark rights.

Developers are welcome to fork the repository and contribute fixes, tests,
documentation and improvements. Read the [contribution terms](CONTRIBUTING.md#licensing-of-contributions)
before submitting work. Contact Ronildo da Rocha Braga Junior through the
[repository](https://github.com/Ledova/ledova) to discuss commercial permission.

Earlier grants remain effective: releases before 2026-09-10 remain under Apache
2.0, and versions published under FSL retain their two-year future Apache grant.
The new terms do not revoke those rights or replace third-party licenses. See
the [licensing position](docs/legal/positions.md#5-software-licensing-and-commercial-permission)
for the transition and operating-company arrangements.
