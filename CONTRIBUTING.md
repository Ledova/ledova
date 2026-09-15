# Contributing to Ledova

How to set up, what the gates are, and what a pull request has to look like.

Ledova is an early-stage, experimental, unaudited, testnet-only reference
implementation, so contributions that make it more correct, more secure, better
tested and better documented are especially welcome. Please read this whole page
before opening your first pull request.

## Ground rules

- **Testnet and synthetic data only.** Never contribute code, configuration,
  tests or docs that assume real funds, real securities, real personal data or a
  mainnet deployment target. The chain guards that fail closed on unsupported
  chain ids are intentional; do not weaken them.
- **No secrets, ever.** No `.env` files, private keys, seed phrases, API tokens,
  real personal data or internal infrastructure identifiers. Only `.env.example`
  templates with blank values belong in the repository.
- **Trading routes are disabled by default** while the
  [`deferred-hardening`](https://github.com/RonildoBraga/ledova/issues?q=is%3Aopen+label%3Adeferred-hardening) issues are open. That default is containment,
  not a bug to "fix" by enabling them.
- Be respectful and constructive. Assume good faith.
  See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## Where to start

- Issues are tracked on GitHub, not in this repository. Browse the
  [open issues](https://github.com/RonildoBraga/ledova/issues); the ones labeled
  [`deferred-hardening`](https://github.com/RonildoBraga/ledova/issues?q=is%3Aopen+label%3Adeferred-hardening) are the known high-risk work, each naming
  where it lives in the code. They need redesigns, not patches.
- Every work item, including owner-requested changes, is tracked in a GitHub
  issue. Reuse an existing issue when its scope fits; otherwise create one before
  implementation.
- Keep issues concise: the problem or context, intended outcome, and short
  completion checks. The assistant may open, update and triage issues without a
  separate approval step.
- Link pull requests to their issues and close an issue only when its work is
  complete. Record distinct problems discovered along the way in follow-up
  issues, checking for an existing issue first.

## Development setup

Follow [local setup](docs/getting-started.md), then the
[engineering standards](docs/development/standards.md) and
[testing guide](docs/development/testing.md). Native builds have their own
[mobile guide](docs/development/mobile-builds.md).

## Making changes

1. Branch from `main` (`fix/whitelist-check`, `docs/quickstart`). Contributors
   without repository write access use a fork.
2. Keep pull requests small and focused: one logical change each.
3. Add or update tests for any behaviour change. Security and correctness fixes
   come with a regression test. A new detail route or custom action also needs a
   cross-tenant row in `backend/shared/tests/test_cross_tenant_routes.py`.
4. Follow the coding rules in
   [engineering standards](docs/development/standards.md#the-rules). The one that
   surprises people most: **source carries no comments and no docstrings**. Only
   functional directives the tooling reads (`# noqa`, `eslint-disable`,
   `// SPDX-License-Identifier` and the rest of the list) are allowed, and that
   list is closed. There is no "unless it is really needed" exception: if a line
   seems to need explaining, rename it or add a test. `make check-comments`
   fails on anything else, so run it before you push. Configuration and
   documentation files keep their comments.
5. Write a clear pull request description: what changed, why, and how you
   verified it. Follow the title and issue-reference format below.

### Pull request titles and issue ownership

Every PR, including Dependabot and other automated PRs, has one owning issue in
this repository. Use `type(#issue): description` for its title, for example
`feat(#123): add portfolio export`, `fix(#124): reject expired signatures`, or
`deps(#518): update marketing dependencies`.

| Type | Change |
| --- | --- |
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Internal restructuring |
| `perf` | Performance improvement |
| `docs` | Documentation |
| `test` | Tests or test tooling |
| `build` | Build tooling or packaging |
| `ci` | Continuous integration |
| `deps` | Dependency updates |
| `chore` | Other maintenance |
| `revert` | Reversal of a previous change |

Start the body with `Refs #issue` on its own line, matching the title. Use
`Closes #issue` instead only when this PR completes the entire issue. For several
PRs sharing an issue, keep the remaining work listed there and reserve `Closes`
for the final one. A PR number or an upstream dependency's issue is not an owning
issue in this repository. Additional related issues can be linked in the body.

An automated PR arrives as a proposal. During triage, reuse an issue whose scope
fits or create a focused one, then correct its title and body before review and
merge. Bots have no exemption and do not create tracking issues automatically.
Recheck metadata after a bot refreshes its PR. The
[PR metadata gate](docs/development/gates.md#the-pr-metadata-gate) verifies the format, the
referenced issue and that a `Refs` PR's title, body, sidebar and commit messages
close no issue; reviewers establish that the issue actually owns the work.

## Review and merge

The owner and assistant work as a small team. Within agreed work, the assistant
may choose implementation details, branches and task-specific delegation, and
carry changes through testing, pull requests and merge without repeated owner
permission. This applies to all engineering paths, including authentication,
wallets and payments.

This workflow records the required reviews and checks on the PR without requiring
enforced branch-protection or approval settings; revisit enforcement if the team
grows.

1. **Everything lands through a pull request.** Nothing is pushed to `main`
   directly, documentation included.
2. **The author records what they checked** in the description before asking for
   review: the commands run and their results, what could not be reproduced, and
   what was deliberately not checked. An unstated gap reads as a checked one.
3. **One independent review, at the commit that will merge.** The reviewer is
   another human or agent, not the author. A PR comment recording the reviewer's
   identity, verdict and head SHA is sufficient; a separate GitHub account or
   formal GitHub approval is not required by project policy. If the branch
   moves, either show the content is unchanged or have the delta read.
   Blocking is ordinary, and a block stands until its author clears it on that
   pull request; a later passing review from someone else does not lift it.
4. **Required CI green, on a branch up to date with `main`.** Green on the branch
   and green on `main` separately do not establish that the two are green
   together.
5. **Product and legal decisions remain the repository owner's.** Live
   deployment, live database migrations, signer activation and real-funds use
   also require the owner's explicit direction.

How to establish that a change does what it claims is a separate question, and is
in [testing and review](docs/development/testing.md).

## Gates

Run the checks appropriate to the change before opening a pull request.
The [gate inventory](docs/development/gates.md#every-gate-and-where-its-rule-is-written)
owns source rules, commands and CI coverage. The [testing command table](docs/development/testing.md#commands)
covers workspace, backend, chain and device checks, including local-only formatting.

## Reporting security issues

Do not open a public issue for a vulnerability. Use GitHub's private
vulnerability reporting on this repository (Security, then *Report a
vulnerability*). See [SECURITY.md](SECURITY.md).

## Licensing of contributions

By submitting a contribution you agree that it is licensed under the project's
[Functional Source License, Version 1.1, ALv2 Future License](LICENSE) and that
you have the right to submit it under that license. Like every other release,
your contribution becomes available under the Apache License 2.0 two years after
it is published.

Ledova is source-available rather than open source in the OSI sense: the licence
permits any use except competing with the project commercially, and converts to
Apache 2.0 on a fixed two-year schedule. Copyright is held by Ronildo da Rocha
Braga Junior. The full terms are set out in [LICENSE](LICENSE), with a summary in
[README.md](README.md#ownership-and-license).

Ledova makes no claim of regulatory compliance or legal recognition.
Contributions are volunteered on that basis.
