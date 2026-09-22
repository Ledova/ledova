# Product and technical decisions

[Documentation](README.md) · [Roadmap](roadmap.md)

These are recorded owner choices and their reasons. Current mechanisms live in
architecture guides. This page makes no new product, licensing or legal decision.

## Eligibility and ownership records

The first offerings target wholesale and sophisticated investors. The four
classification categories and the deliberately excluded experienced-investor
category are recorded in [legal positions](legal/positions.md#4b-issuance-payments-and-transfers-need-a-licence-a-registration-or-relief).
Those positions were taken without advice; deployment stays on test networks
with synthetic data pending the required advice.

An `associated_person` claim reaches only its named issuer's directory entries;
it does not widen the secondary market. A holder who lacks market eligibility
cannot see the market for shares they own. Revisit that trade-off before live
operation with real participants.
[Eligibility](architecture/companies-and-eligibility.md) owns enforcement details.

The register leaves amount paid blank when it cannot be established exactly;
zero would assert an amount that is not known. Classification evidence has a
fixed retention horizon, independent of account deletion. The legal basis and
uncertain clock are in [legal positions](legal/positions.md#3-the-evidence-retention-period); implementation belongs to
[the register](architecture/register.md) and [file retention](architecture/files-and-retention.md).

The operator's issuer KYC switch gates two points only: submitting a company for
review, and activating it once approved. Every later action relies on that gate
rather than checking again, including resolving a warning and reinstating a
suspended company. The owner chose this on 21 September 2026 in
[#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5766230810);
[eligibility](architecture/companies-and-eligibility.md) owns the mechanism.

## The stored register

Wallets become linked to register members only through documentary authority
verified by staff: an opening's mapping, or a later reviewed link request. A
completion to an unlinked wallet waits for that link instead of creating a member,
because one person holding two wallets would otherwise become two members that
the register could never merge. Member particulars are kept while the person is
a member and then for at least the former-member retention floor, so the
register's seven-year obligation and its purge share one clock. Both were
chosen on 21 September 2026 in [#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5755636585).
Register export records, which say who took a copy of the register, follow the
same floor and purge; the owner chose that the same day in
[#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5766230810).
In the same decision, an import of an existing register depends on the class.
For a class already opened from the chain, it adds particulars and pre-platform
former members. For a class not yet on chain, it becomes the opening, and later
tokenising mints mirror it rather than add shares. A staff reviewer enters the
ASIC extract's issued total and member count, and application refuses a mismatch.
An entry recorded automatically names the person who authorised its change: the
staff member who approved an issue, or the transferor whose signed order is a
transfer's instrument, rather than the company owner or a service account that
took no action ([#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5756732848)).
A reconciliation divergence that staff have investigated and accepted is
acknowledged, one discrepancy at a time with a reason, in an append-only record
only the operator writes, and later runs treat it as explained, so a share class
can return to `matched`. Transfers of zero shares are ignored, because anyone
can emit one. Both were chosen on 22 September 2026 in
[#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5767606273).
The same decision settled two import questions. An applied import's reviewed
copy and uploaded register file are evidence, kept like opening and correction
evidence: nothing expires them automatically during the synthetic experiment,
and production retention is decided before any real data. The retention purge
removes only the particulars the register reads and the imported former members.
A linked member's live verified identity is shown when it is present and
unambiguous; imported particulars fill in only for a member with no live
identity, and an ambiguous identity stays ambiguous, so a later profile change
reaches the register and particulars never hide a conflict
([#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5767606273)).

On 22 September 2026 the owner chose one register instruction as the approval
behind issues and transfers, over evidence attached to each workflow and over
standing authorities ([#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5767606273),
decision 2). The company owner submits an instruction listing the exact issuance
requests, offering subscriptions or settlements it approves, with a named
approving director and documentary authority that staff verify and review as
they review openings. Applying an issue instruction is the approval, so the
separate staff Approve action goes and the company's own connection may no
longer write an issuance request's review decision. An issue or transfer is
entered only once an applied instruction covers it, and trading is unchanged.
With it the owner chose that:

- directors decide on a settlement after it, while its entry waits;
- the retained signed order is the instrument of transfer, with s1071B left open;
- a refused settled transfer is not modelled yet, so it keeps waiting and stays
  visible;
- an instruction lists offering allotments by subscription;
- a late entry is dated when it is made;
- the clients stay API-only, plus the issuer's list of waiting entries;
- evidence copies are retained like openings and corrections.

Issue instructions came first, then the issuer's waiting list and the rule that
a late entry is dated the day it is made; transfer instructions follow. Until
then a completed settlement is still recorded without an instruction.
[The register](architecture/register.md) owns the mechanisms.

The same day the owner chose how the register's outputs are produced:
certificates, notice figures and inspection copies
([#647](https://github.com/Ledova/ledova/issues/647#issuecomment-5767606273),
decision 1). Staff prepare each output in admin on the company's written
instruction, and each is recorded as a kind of register export. Ledova keeps a
fingerprint, not the file, and the company signs: a certificate is handed over
unsigned for the company to execute, and only its SHA-256 and register sequence
are kept. One certificate covers the shares one entry moved to one member, with a
balance certificate for a seller who keeps shares, and PyMuPDF renders it. The
alternatives were certificates generated automatically, stored and served to the
issuer, and figures without documents. The work lands in four slices:
inspection copies, certificate PDFs, notice figures, then a list of what is due.
Inspection copies came first; [the register](architecture/register.md#inspection-copies)
owns their mechanism.

## Payments and settlement

Payment confirmation is stored on the subscription. The initial expected volume
is small and admin history records changes. There is no separate payment-per-tranche
model: a second payment updates the cumulative total with a note. A future
`SubscriptionPayment` table is additive if automated reconciliation needs it.

The bank-feed/payment provider remains undecided; selection and settlement
automation are unscheduled in the [current roadmap](roadmap.md#remaining-work). Incoming
AUD transfers must carry their reference text unchanged through a webhook or a
poll. References use the operator prefix plus an eight-character Crockford code
within an 18-character field. See [B7c](https://github.com/Ledova/ledova/issues/115#issuecomment-5574962513)
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
has completed it; see [B7d](https://github.com/Ledova/ledova/issues/115#issuecomment-5574975348)
and [valuation presentation work](https://github.com/Ledova/ledova/issues/346).

## Tenancy, sessions and deployment

Registry and single-issuer modes share one operator model and tenancy boundary.
PostgreSQL RLS enforces row isolation; product selectors still distinguish issuer
management, personal accounts and discovery. See [tenancy](architecture/tenancy.md).

There is one authentication path: simplejwt sessions with browser and mobile
transports. The unused v2 session design was withdrawn; its historical ADRs remain
in [the earlier tree](https://github.com/Ledova/ledova/tree/963c686/backend/docs/adr).
Email is read-only to customers; staff changes revoke their sessions.

The published compliance seed intentionally uses public figures. Operational
thresholds and evasion-sensitive rules belong outside this repository.

## Contracts compiler and toolchain

The compiler settings and the OpenZeppelin pin recorded in
[contracts and issuance](architecture/contracts-and-issuance.md#contracts) are
a contract, not a default: any change to them moves the bytecode of every
contract, so a dependency update that needs one is a toolchain change.

OpenZeppelin stays at 5.4.0 because later releases use the Cancun `mcopy`
opcode in `utils/Bytes.sol` and do not compile under `paris`. Compiling under
`cancun` instead would re-target every contract, including the ones that never
import the affected code, and nothing in the tree needs a feature from 5.5 or
later. What reopens the decision is a needed feature or an advisory against
5.4.0 itself, not a version number going up.

The contracts package declares no runtime dependencies, so `npm audit
--omit=dev`, which is what `make audit` runs for it, reports zero trivially and
proves nothing. The full audit reports advisories across the Hardhat toolchain
that `npm audit fix` cannot change: many have no published fix, some would only
be satisfied by downgrading, and the rest want major moves off the pinned
Hardhat 2 and Toolbox 6 line. That is the same migration TypeScript 7 needs, so Hardhat,
Toolbox and TypeScript are one migration decision rather than three, and the
pinned line stays until it is taken. The exposure this leaves is build
integrity, not deployed code: the deliverable is compiled bytecode, and none of
the toolchain is linked into a contract. The counts measured at the time are in
the [architecture document before the reorganization](https://github.com/Ledova/ledova/blob/dc9e29597e10a7e1cf0f383dd4ac3040acb17529/docs/ARCHITECTURE.md#contracts)
and the dependency reconciliation in [#518](https://github.com/Ledova/ledova/issues/518);
rerun `npm audit` in `contracts/` for the current picture rather than reading
those numbers as current.

## Clients and API types

Both clients compile `@ledova/shared` from source, without a package build step.
The mobile investor directory and subscription journey remain unscheduled in the
[current roadmap](roadmap.md#remaining-work);
shared hooks created earlier must accommodate both clients. The primary issuer
workflow remains dashboard-led. See [B7b](https://github.com/Ledova/ledova/issues/115#issuecomment-5574947880)
and [B2](https://github.com/Ledova/ledova/issues/115#issuecomment-5574848881).

Shared API types are generated from the committed OpenAPI snapshot. The owner
accepted PR #562 as the clean-release checkpoint on 2026-09-14; its reviewed head
and merge had identical trees, and all CI checks passed. The handwritten API
counterparts and partial drift parser retire with their generated replacements;
client state and cryptographic utilities retain their own types. See
[B7e](https://github.com/Ledova/ledova/issues/115#issuecomment-5575002254),
[the checkpoint approval](https://github.com/Ledova/ledova/issues/115#issuecomment-5656632666)
and [API gates](development/gates.md#the-api-type-drift-gate).

The source no-comments/no-docstrings rule remains an explicit repository choice;
[development standards](development/standards.md) defines its scope.
