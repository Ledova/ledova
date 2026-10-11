# Security Policy

How to report a vulnerability in Ledova, and what is in scope.

## Dependency advisories

CI fails on a new production advisory. `make ci-checks` runs
`npm audit --omit=dev --audit-level=low --json` at the repository root and in
`marketing/`, `contracts/` and `mobile/`. The first three must stay completely
clean. `make backend-test` runs strict `pip-audit` against
`backend/requirements.txt` before creating its scratch database. `make preflight`
inherits each audit once. `make audit` runs both audits locally. Dependabot's
existing configuration remains separate from these gates.

The gate accepts only the fixed package and advisory pairs below. A different
package, a new advisory ID, a critical npm finding, an audit tool failure or
missing or malformed output fails the check. It does not add exceptions from
the current audit result.

These mobile exceptions preserve the accepted findings recorded on 5 October 2026. Most belong to the Expo and Metro developer toolchain, whose SDK upgrade
remains separate work. `elliptic` and a second `uuid` ancestry also reach the
experimental testnet chain. The earlier toolchain and testnet risk acceptance
does not authorise additional advisories in those categories.

| Package           | Accepted advisory ID  |
| ----------------- | --------------------- |
| `brace-expansion` | `GHSA-6j4f-fj2g-mc7p` |
| `brace-expansion` | `GHSA-q2hr-2g5m-vwhr` |
| `brace-expansion` | `GHSA-qhr7-859c-m2p7` |
| `braces`          | `GHSA-vfj7-8cjw-p6xm` |
| `elliptic`        | `GHSA-848j-6mx2-7j84` |
| `fast-uri`        | `GHSA-hrr3-gc8f-f4qj` |
| `image-size`      | `GHSA-5p2g-fcmc-qvqq` |
| `image-size`      | `GHSA-w3rx-r6r6-pgpr` |
| `node-forge`      | `GHSA-86w9-cpqp-85rv` |
| `postcss`         | `GHSA-6g55-p6wh-862q` |
| `postcss`         | `GHSA-fxqj-rqcc-2cmp` |
| `postcss`         | `GHSA-qx2v-qp2m-jg93` |
| `postcss`         | `GHSA-r28c-9q8g-f849` |
| `uuid`            | `GHSA-w5hq-g745-h8pq` |

The backend exception is the exact pair `pytest` / `PYSEC-2026-1845`.
`bitcoin-message-tool` declares `pytest` as a runtime dependency, but the
application never imports it and the advisory needs it to be running. This
preserves the existing accepted exception without adding an unimported package
to production requirements.

Newly reported `compression` and `pbkdf2` advisories are fixed through compatible
patch releases. The new `sprintf-js` advisory has no patched release; a scoped
`@istanbuljs/load-nyc-config` override to `js-yaml` 4 removes its obsolete
`argparse` 1 dependency. These three findings are not exceptions.

Every accepted exception must be revisited before any mainnet or
store-distributed build.

## Reporting a vulnerability

Report vulnerabilities privately through
[GitHub's private vulnerability reporting](https://github.com/Ledova/ledova/security/advisories/new)
for this repository. Do **not** open a public issue for a security problem.

You should receive an acknowledgement within a few days. This is a spare-time
source-available project, so please allow a reasonable window for a fix before any
public disclosure.

## Scope and expectations

Ledova is an experimental, unaudited reference implementation intended for local
and public-testnet use only. It is not operated as a hosted service, and it
makes no production-security or compliance claims.

Known open security work is tracked publicly in the issues labeled
[`hardening`](https://github.com/Ledova/ledova/issues?q=is%3Aopen+label%3Ahardening).
Reports that duplicate an item already listed there are still welcome, but will
likely be folded into the existing issue rather than fixed immediately.

## Out of scope

- Vulnerabilities in third-party dependencies without a demonstrated impact on
  this codebase. Please report those upstream.
- Findings that only apply when the software is deployed contrary to its
  documented testnet-only, non-production intent.
