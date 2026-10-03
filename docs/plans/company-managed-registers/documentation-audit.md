# Documentation alignment audit

[Implementation index](README.md) · [Accepted plan](../../architecture/company-managed-registers.md)

Reviewed on 3 October 2026, Australia/Sydney, against the owner's company-managed
registry direction. Scope: all 73 Markdown documents tracked at the audit baseline, including root,
marketing/native guides and the runtime company-pack template, plus the accepted
plan added in this work. Generated dependency/vendor trees are excluded.

The review distinguishes accepted product requirements from current technical
contracts and dated evidence. Updated means the document now explains the target
or superseding decision while preserving accurate implementation facts. Aligned
means its existing controls or subject remain applicable. Historical evidence
keeps its original bytes. Retained implementation means a runtime-generated
output must change with its underlying implementation and tests, not make a
future capability claim today.

Coverage: **74 documents** — 26 aligned, 1 historical, 1 retained implementation, 46 updated.

This table records the documentation baseline before implementation. #861 updates
the current product, operator, retention, standards and upgrade documents as
product-mode retirement lands, while the remaining company workflows stay
planned. [AGENTS.md](../../../AGENTS.md) preserves the owner's standing simplicity,
cleanup and continuity instructions for subsequent increments.

## Findings carried into implementation

- Retire the deployment-mode field and evidence-only branches together across API
  and clients; preserve private files, review restrictions and migration history.
- Add verified company appointments and capabilities independently of staff,
  shareholder records and account navigation. Enforce current mandate through
  services, RLS, triggers and bounded worker commands.
- Replace bootstrap/activation, eligibility, publication, payment and register
  staff gates with evidenced company/provider workflows, not unconditional approval.
- Support genuine non-tokenised register effects and walletless member workflows.
  Current imports alone do not provide later issues, transfers or publications.
  Future tokenisation mirrors existing holdings without double issuance.
- Provide company/member forms, outputs and filing preparation with actor,
  evidence, privacy, sequence/digest and true outcome provenance.
- Preserve earlier legal analyses and staff-assisted recordings as history; the
  product decision does not confirm legal readings or automatic ASIC filing.

## File-by-file coverage

| Document | Result | Review outcome |
| --- | --- | --- |
| [.github/pull_request_template.md](../../../.github/pull_request_template.md) | aligned | Issue ownership and actual validation evidence remain required for all increments; template unchanged. |
| [CODE_OF_CONDUCT.md](../../../CODE_OF_CONDUCT.md) | aligned | Community governance is independent of platform and company authority; the adopted covenant remains unchanged. |
| [CONTRIBUTING.md](../../../CONTRIBUTING.md) | updated | Uses the accepted company-managed sequence rather than the closed earlier programme; preserves issue/PR workflow and separates company appointments from platform privileges. |
| [README.md](../../../README.md) | updated | Introduces one company-managed registry product, private hosting of the same software and pending staff-workflow replacement; current payment and experimental boundaries remain accurate. |
| [SECURITY.md](../../../SECURITY.md) | aligned | Security reporting, current experimental boundaries and dependency controls do not allocate company register authority or define product modes. |
| [backend/tokens/templates/tokens/company_pack_readme.md](../../../backend/tokens/templates/tokens/company_pack_readme.md) | retained implementation | Runtime-generated output still describes actual staff decisions and current contract owners. Changing those claims before source/migration work would misstate records; replacement is assigned to the output/provenance issue with rendering and consumer tests. |
| [docs/README.md](../../README.md) | updated | Links the accepted direction and the audit/backlog route alongside current implementation guides. |
| [docs/architecture/README.md](../../architecture/README.md) | updated | Distinguishes accepted company-managed target from current staff/technical implementation lifecycles and unsupported corporate actions. |
| [docs/architecture/authentication.md](../../architecture/authentication.md) | updated | Separate authenticated sessions/account audiences from verified company appointments; require current authority checks and revocation without requiring admin sessions. |
| [docs/architecture/backend.md](../../architecture/backend.md) | updated | Describe current app/layer ownership and planned company authority services; keep infrastructure Operator and exceptional admin permissions distinct from company mandates. |
| [docs/architecture/clients.md](../../architecture/clients.md) | updated | Specify web/mobile company selection, appointments, supported action forms and own-record access; preserve current owner/read-only screens and coordinate legacy evidence branch removal. |
| [docs/architecture/companies-and-eligibility.md](../../architecture/companies-and-eligibility.md) | updated | Add fresh-signup representative proof, evidenced activation and company/provider eligibility decisions without self-asserted verification; preserve current identity, checksum, expiry and context gates. |
| [docs/architecture/company-managed-registers.md](../../architecture/company-managed-registers.md) | updated | Accepted decision, authority/gate map, genuine non-tokenised workflows, data-preserving delivery sequence and verification; links the implementation backlog and complete audit. |
| [docs/architecture/company-pack.md](../../architecture/company-pack.md) | updated | Plan company-capability pack production and true decision-maker provenance while retaining current admin-only builder, format, privacy exclusions, ceilings and evidence limits. |
| [docs/architecture/contracts-and-issuance.md](../../architecture/contracts-and-issuance.md) | updated | Separate company issue/whitelist/capital authority from technical signer ownership; state non-paid and non-chain implementation gaps and no-double-issue tokenisation requirement. |
| [docs/architecture/files-and-retention.md](../../architecture/files-and-retention.md) | updated | Retire product-mode branches without purging evidence or widening participant private-file access; label current single_issuer behavior and preserve storage, review, audit and retention controls. |
| [docs/architecture/mobile-lifecycles.md](../../architecture/mobile-lifecycles.md) | aligned | Native scanner, provider WebView, upload-copy and session lifetimes are technical controls independent of product modes or routine company staff decisions; retain precise limitations and historical acceptance evidence. |
| [docs/architecture/mobile-security.md](../../architecture/mobile-security.md) | aligned | Transport, session/seed storage, backup and randomness controls remain required for the identical product; no conflicting company authority or product-mode claims. |
| [docs/architecture/offerings.md](../../architecture/offerings.md) | updated | Put target publication/application/closing decisions with company appointments and primary payment recipient with company/provider; label current admin transitions and retain frozen terms, headroom and published-document safeguards. |
| [docs/architecture/outgoing-signing.md](../../architecture/outgoing-signing.md) | updated | Distinguish technical signer/DB authority and infrastructure-only mint/admission tasks from company command authority; preserve cutover/recovery/finality and correct obsolete register-integration claim against existing completion hook. |
| [docs/architecture/register.md](../../architecture/register.md) | updated | Specify company workflow/output capabilities, preserve current staff/API/RLS controls, and explicitly document imported non-chain issue/transfer/publication limits and genuine ledger support needed for non-wallet/non-paid paths. |
| [docs/architecture/shareholder-publications.md](../../architecture/shareholder-publications.md) | updated | Make supported publication, offline ballot and payment-record administration company-authorised; retain frozen rolls, private ballots, audit/retention and current chain-only publication limitation. |
| [docs/architecture/splits-and-consolidations.md](../../architecture/splits-and-consolidations.md) | updated | Qualify earlier prospective staff-run design as historical and superseded by company authority; preserve unsupported consolidation, bytecode/whole-unit/cap limits and unresolved mechanism decisions. |
| [docs/architecture/subscriptions.md](../../architecture/subscriptions.md) | updated | Specify company finance/application/exact-issue capabilities, company/provider primary instructions and non-paid issue terms; preserve current staff attestation limits, refund holds, headroom and recovery. |
| [docs/architecture/tenancy.md](../../architecture/tenancy.md) | updated | Require company appointments through selectors, FKs, RLS, DB guards and bounded worker handoffs; preserve technical BYPASSRLS Operator role and private ledger restrictions. |
| [docs/architecture/trading.md](../../architecture/trading.md) | updated | Replace routine staff transfer-register decisions with company mandates while retaining participant signatures/private orders, automatic matching, finality and the operational trading feature switch. |
| [docs/architecture/transfers.md](../../architecture/transfers.md) | aligned | Current direct crypto/payment-token wallet transfer protocol, participant signatures and durable recovery remain valid; shares are already excluded and no company-admin transfer privilege is implied. |
| [docs/architecture/wallets-and-valuations.md](../../architecture/wallets-and-valuations.md) | updated | Separate participant possession from company registry approval, retain non-wallet member support as a real ledger gap, and avoid granting infrastructure asset/mint/NAV powers to company administrators. |
| [docs/decisions.md](../../decisions.md) | updated | Records the superseding 3 October direction and marks earlier staff-only review/output/publication choices as historical without rewriting owner quotations or legal positions. |
| [docs/development/gates.md](../../development/gates.md) | aligned | Current mechanical gate rules, schema/client contracts, documentation scope and CI controls are technical requirements preserved by the plan; no prospective staff register authority or dual-product claim. |
| [docs/development/ios-distribution.md](../../development/ios-distribution.md) | aligned | Build/distribution procedure and physical-device/release limits do not define issuer authority or hosting product modes; existing claims and commands preserved. |
| [docs/development/mobile-builds.md](../../development/mobile-builds.md) | aligned | Current native toolchain/lifecycle/build-scope facts are independent of register decision authority. Its cold-start incoming-link limitation is a dependency if future invitations require emailed app deep links. |
| [docs/development/native-probes.md](../../development/native-probes.md) | aligned | Describes isolated native controls and physical acceptance, with explicit limits; no routine Ledova register-operation dependency or company authority claim. |
| [docs/development/standards.md](../../development/standards.md) | updated | Adds company mandate versus technical executor boundaries and coordinated service/worker/RLS/trigger transition. Current admin/operator API contracts remain documented pending implementation; private hosting and legacy mode removal are explicit. |
| [docs/development/testing.md](../../development/testing.md) | updated | Adds future-increment validation guidance for both old-mode migrations, scoped company authority, revocation/forgery/retries, issue/payment/finality separation, participant/output privacy and a fresh web/mobile journey without routine staff. Current suite and test claims unchanged. |
| [docs/development/troubleshooting.md](../../development/troubleshooting.md) | aligned | Current operational remedies and technical recovery links remain applicable during the transition; no future company decision mandate is attributed to staff. |
| [docs/getting-started.md](../../getting-started.md) | updated | Labels seeded staff/admin setup as current implementation; links the accepted company-managed target, same private-hosted product and pending replacement of legacy modes/staff gates. Startup, seed, chain and cleanup commands unchanged. |
| [docs/legal/README.md](../../legal/README.md) | updated | Navigation identifies earlier hosting and clerk-service pages as historical responsibility analyses, not maintained product modes; existing sources and sign-off conventions are preserved. |
| [docs/legal/company-hosted-instance.md](../../legal/company-hosted-instance.md) | updated | Historical analysis A and the earlier first-paid-product question are distinguished from private hosting of the same product; the legacy setting is identified as a supporting-payslip control, not tenancy or company authority, without updating legal conclusions. |
| [docs/legal/positions.md](../../legal/positions.md) | updated | Dated readings and sign-off status are preserved with A/B as historical research labels; inaccurate implications that deployment mode enforces the whole clerk-only proposal are corrected, without new legal findings. |
| [docs/legal/registry-service.md](../../legal/registry-service.md) | updated | Historical analysis B and its earlier clerk-service launch sequence are labelled rather than presented as the current staff-operating roadmap; the legacy registry setting does not enforce the whole clerk proposal, and dated legal readings are preserved. |
| [docs/operations/README.md](../../operations/README.md) | updated | Operations index distinguishes current staff runbooks from the accepted company-managed product and same-product private hosting; company users must use scoped appointments. |
| [docs/operations/approval-controls.md](../../operations/approval-controls.md) | updated | Current staff and signer controls are labelled implementation evidence pending company authority replacements; dated test observations are preserved without asserting a fresh run. |
| [docs/operations/chains.md](../../operations/chains.md) | updated | Technical signer ownership is distinguished from company decision authority; the historical #648 fresh-start procedure is explicitly excluded from the planned data-preserving upgrade. |
| [docs/operations/configuration.md](../../operations/configuration.md) | updated | Technical PostgreSQL service identities are distinguished from human company appointments; existing configuration commands and role checks remain accurate runbook references. |
| [docs/operations/demonstration-journey.md](../../operations/demonstration-journey.md) | updated | The existing synthetic staff-assisted chain test is retained as regression evidence and clearly distinguished from the future journey with no routine platform-staff gates. |
| [docs/operations/evidence/base-sepolia-2026-09-25/README.md](../../operations/evidence/base-sepolia-2026-09-25/README.md) | historical | Dated synthetic public-chain observations remain byte-for-byte unchanged; SHA256SUMS validation passed for this README and all four original snapshots. |
| [docs/operations/integrations.md](../../operations/integrations.md) | updated | Current staff company verification and activation remain documented; replacement company bootstrap and provider checks must preserve attributed attempts and unresolved failures. |
| [docs/operations/jobs.md](../../operations/jobs.md) | updated | Current schedules are preserved; company register effects require exact company authority under the plan, while recovery retains already-admitted operation identity and signed history. |
| [docs/operations/keystone-mac.md](../../operations/keystone-mac.md) | aligned | Wallet ownership verification is already participant controlled and needs no company or operator approval; dated vendor references and the source-reviewed, unexecuted status are preserved. |
| [docs/operations/operator-console.md](../../operations/operator-console.md) | updated | Platform organisation, human staff, legacy register-keeper labels and company appointments are distinguished; mode and supporting-payslip controls are marked current pending retirement without a replacement flag. |
| [docs/operations/publications.md](../../operations/publications.md) | updated | Staff publication, resolution and distribution procedures are retained as current implementation; company-controlled replacements must preserve records, member access, votes, privacy and retention. |
| [docs/operations/recovery.md](../../operations/recovery.md) | updated | Technical recovery is bounded to exact authorised work and preserves original actors and signed evidence; missing company-facing replacements are identified without altering the current recovery commands. |
| [docs/operations/register-foundation.md](../../operations/register-foundation.md) | updated | Detailed #647 staff and owner workflows remain current runbooks; the accepted target requires company appointments and company register tools without fabricated director authority or global customer staff grants. |
| [docs/operations/upgrades.md](../../operations/upgrades.md) | updated | Adds a clearly planned, unshipped data-preserving migration and API/client coordination section; retains historical migrations, genuine actors, private evidence and signed operations, with explicit rollback limits. |
| [docs/operations/uploads.md](../../operations/uploads.md) | aligned | Private storage, scanning, access restrictions, independent retention clocks and evidence preservation agree with the accepted plan; no new data-collection or hosting-mode policy is introduced. |
| [docs/product.md](../../product.md) | updated | Defines company/shareholder relationship, company mandates and one product; preserves a separately labelled truthful current-capability table and canonical repository link. |
| [docs/reference/README.md](../../reference/README.md) | updated | Clarifies references describe current protocols, and technical operator aliases/transactions/signers do not establish human company mandate. Links company-managed plan while retaining crypto/payment/recovery contracts. |
| [docs/reference/account-data-export.md](../../reference/account-data-export.md) | aligned | Documents current own-account export contents, exclusions and read-only evidence/privacy limits. It does not promise company register particulars or future certificates through this route. |
| [docs/reference/bitcoin-transfers.md](../../reference/bitcoin-transfers.md) | aligned | Current user-signed Bitcoin admission, immutable bytes/reservations and isolated chain-test evidence are crypto execution controls preserved by the plan. |
| [docs/reference/evm-transfers.md](../../reference/evm-transfers.md) | aligned | Current user-signed EVM admission/recovery and stablecoin whitelist/operator receiving-wallet conditions belong to separately scoped crypto/payment operations; they do not authorise company register decisions. |
| [docs/reference/gate-internals.md](../../reference/gate-internals.md) | aligned | Exact checker scopes, limitations and app/operator alias verification are technical implementation facts; the plan preserves these boundaries rather than converting DB operator roles into company appointments. |
| [docs/reference/native-scanner-probe.md](../../reference/native-scanner-probe.md) | aligned | Current scanner session ownership and native/physical proof limits are independent of register governance; all test/source claims retained. |
| [docs/reference/order-submissions.md](../../reference/order-submissions.md) | aligned | Current participant-owned trading intent, bounded operator transactions and lock/replay rules represent automated technical execution with principal checks, not platform-staff issuer decisions. |
| [docs/reference/outgoing-history.md](../../reference/outgoing-history.md) | aligned | Current legacy signer inventory and future guarded cutover retain immutable historical evidence and technical attribution holds. Such exceptional crypto recovery remains permitted; inventory cannot grant company mandate. |
| [docs/reference/private-storage-migrations.md](../../reference/private-storage-migrations.md) | aligned | Existing file relocation, rollback, private evidence and MIME-audit procedures preserve data needed by the accepted migration. Technical operator repair is not routine register administration. |
| [docs/reference/reviewed-intent.md](../../reference/reviewed-intent.md) | aligned | Current frozen swap context, participant signing and legacy attribution/recovery limits are preserved. Operator settlement-asset configuration is a crypto/payment concern, separate from company register authority. |
| [docs/reference/swap-settlement.md](../../reference/swap-settlement.md) | aligned | Current participant admission, bounded execution, signer recovery, receipt/finality and immutable legacy history remain necessary technical contracts; no dual product or routine platform-staff register decisions asserted. |
| [docs/reference/transaction-evidence.md](../../reference/transaction-evidence.md) | aligned | Only-operator evidence writes mean a technical database role; current canonicality/finality, attribution and privacy controls remain applicable without conferring company decision authority. |
| [docs/reference/wallet-reconciliation.md](../../reference/wallet-reconciliation.md) | aligned | Current owner-scoped wallet imports, principal-bearing confirmation, bounded operator evidence recording and conservative legacy recovery are crypto/accounting controls preserved by the plan. |
| [docs/regulatory-pathway.md](../../regulatory-pathway.md) | updated | Separates the September assessment from the October product direction and updates proposed company, participant and bounded platform responsibilities; actual functions still require assessment, with no new legal conclusion. |
| [docs/roadmap.md](../../roadmap.md) | updated | Uses the canonical six-phase company-managed plan and links implementation work; closed previous app/iOS preparation work is history, not an open task. |
| [marketing/README.md](../../../marketing/README.md) | updated | Product-copy guidance follows one registry product and company register responsibility; current and planned capability claims must be distinguished. |
| [mobile/assets/fonts/README.md](../../../mobile/assets/fonts/README.md) | aligned | Font provenance and licensing have no hosting-mode or company-authority implications; unchanged. |

## Preserved local journey package

The three local journey Markdown files (`README.md`, `CLAUDE-IMPORT.md` and
`demo-documents/README.md`) in `artifacts/user-journey-2026-10-03` were reviewed
as dated evidence. Their guide, captions, original 62 screenshots, gallery,
PDF, embedded artifact and fixture descriptions preserve the actual staff-assisted
flow and labelled simulations. They were not rewritten to portray future
self-service. These local artifacts are outside the tracked documentation set;
this audit does not publish them or retry Claude artifact publication. The new
implementation index and this audit report were also reviewed before delivery;
they are additional documents rather than part of the 74-document baseline.

The checksummed Base Sepolia evidence folder is also unchanged. Its five stored
SHA-256 digests were verified. The runtime company-pack Markdown template stays
accurate about current staff reviewers and technical contract owners; the output
implementation issue owns changes to its provenance, format and consumer tests.

## Validation and limits

The documentation gate checks local links/headings, the exact periodic schedule
and the gate inventory. `make check-docs` and `git diff --check` are required for
this documentation increment. The inventory comparison verifies every tracked
Markdown path is covered exactly once. Independent review checks target/current
boundaries and the implementation ticket dependencies.

No application, database migration, permissions or generated runtime template is
implemented in this documentation pass. Future tickets own their meaningful
backend, SQL, migration, client and chain evidence; this audit is not proof that
those workflows already work. Existing physical-device release acceptance stays
on [#624](https://github.com/Ledova/ledova/issues/624).
