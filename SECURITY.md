# Security Policy

How to report a vulnerability in Ledova, and what is in scope.

## Dependency advisories

CI fails on a new production advisory. The
[dependency-advisory gate](docs/engineering/gates.md#dependency-advisories) says
which commands run the npm and `pip-audit` checks and when; Dependabot's
configuration remains separate from them.

The gate accepts only the fixed package and advisory pairs below. A different
package, a new advisory ID, a critical npm finding, an audit tool failure or
missing or malformed output fails the check. It does not add exceptions from
the current audit result.

The npm exceptions apply to `mobile/` only; the root, `site/` and
`contracts/` audits must stay completely clean. The original entries preserve the
findings accepted on 5 October 2026, less `elliptic`, which left with the mobile
wallet libraries, and `node-forge`, which 1.4.2 fixes. All belong to the Expo and
Metro developer toolchain, whose SDK upgrade remains separate work. The earlier toolchain risk acceptance does
not authorise additional advisories in that category.

| Package           | Accepted advisory ID  |
| ----------------- | --------------------- |
| `brace-expansion` | `GHSA-6j4f-fj2g-mc7p` |
| `brace-expansion` | `GHSA-q2hr-2g5m-vwhr` |
| `brace-expansion` | `GHSA-qhr7-859c-m2p7` |
| `deepmerge`       | `GHSA-gcqx-w48m-w2h4` |
| `image-size`      | `GHSA-5p2g-fcmc-qvqq` |
| `image-size`      | `GHSA-w3rx-r6r6-pgpr` |
| `minimatch`       | `GHSA-g3hv-75wg-m249` |
| `postcss`         | `GHSA-6g55-p6wh-862q` |
| `postcss`         | `GHSA-fxqj-rqcc-2cmp` |
| `postcss`         | `GHSA-qx2v-qp2m-jg93` |
| `postcss`         | `GHSA-r28c-9q8g-f849` |
| `uuid`            | `GHSA-w5hq-g745-h8pq` |

The owner separately accepted the mobile-only `deepmerge` / `GHSA-gcqx-w48m-w2h4`
pair on 28 October 2026. It covers Expo configuration merging in the development
and native-build toolchain; malicious project or plugin configuration remains a
risk. No patched upstream release is available. Reconsider this exception when a
fixed release or Expo SDK upgrade is available, and before a store-distributed
build. It does not apply to the web, backend or another advisory.

The owner separately accepted the mobile-only `minimatch` / `GHSA-g3hv-75wg-m249`
pair on 31 October 2026. The vulnerable `minimatch` 3.1.5 comes through `glob` 7
in React Native 0.81's build tooling (codegen, Metro, Jest instrumentation and a
Chromium launcher's cleanup), which matches patterns from project files only.
`minimatch` 3 exports a different module API from the patched 11.0.1, so no
override can apply it, and the 9.x copies come from Expo's own packages, which
still require `^9`. Reconsider this exception with the React Native and Expo
SDK upgrade, and before a store-distributed build. It does not apply to the web,
backend or another advisory.

The backend exception is the exact pair `pytest` / `PYSEC-2026-1845`.
`bitcoin-message-tool` declares `pytest` as a runtime dependency, but the
application never imports it and the advisory needs it to be running. This
preserves the existing accepted exception without adding an unimported package
to production requirements.

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
