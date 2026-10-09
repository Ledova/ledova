# Company-authorised paid share issues

[Implementation index](README.md) · [Accepted plan](../../architecture/company-managed-registers.md) · [#867](https://github.com/Ledova/ledova/issues/867)

Delivered by [PR #951](https://github.com/Ledova/ledova/pull/951).

The company can issue shares from an existing subscription recorded as PAID on
a deployed Base whole-share class. This increment adds no new payment mechanics
or off-chain investor allotment: #868 records externally arranged investor
capital and company-approved allotments, while offering publication,
application funnels, payment collection, receipt verification and refund
mechanics are deferred under the
[9 October priority](../../decisions.md#essential-registry-and-development-workflow-priority).

## What the company does

The company prepares an issue from an existing PAID subscription. The existing
financial producer supplies the subscription, instruction and receipt facts;
this increment does not verify cleared funds or select a bank, provider or
custody model. A recorded payment does not authorise an issue.

Preparation captures the exact subscription, class, recipient, whole-share
allotment quantity, price, payment dates and references, money held and refund
facts. Partial receipts and existing scale-back quantities remain distinct from
the original requested quantity. A refund amount owed is distinct from an
actually recorded refund. Imported registers cannot use this issue workflow.
There is no new
[general eligibility decision](company-eligibility.md#general-associated-person-and-product-value-decisions),
wallet nomination, member selection, grant terms or acceptance prerequisite for
an already instructed paid subscription.

The preparer retains its own exact-company AUTHORITY document and states the
approving director, authority reference and reason. A current `admin`
appointment may prepare, approve, apply and reject, with `prepare`, `approve`
and `apply` as the narrower delegate capabilities, under the
[owner's authority rules](../../decisions.md#company-run-register-authority-and-evidence);
ownership, platform staff permissions, a receipt or technical signer access
supplies no company mandate. The named director and the existing recipient
conflict check follow the [register grant rule](register-grants.md#what-the-company-does).

## API

The family is `/api/v1/tokens/register-paid-issues/`: list, create, detail,
authority file, decision preview and decision. Its bounded `ready-subscriptions`
selector is an unpaginated list for current `admin` or `prepare` in the exact
company and class. Approvers, appliers and register readers can inspect
existing proposals without access to that selector or the wider financial
ledger.

## What is recorded

Preparation and approval create no issuance request, subscription request link,
execution journal, signed attempt or queued issuance job. Application consumes
the exact approval and atomically binds the captured request identity to the
original subscription, company instruction, execution and durable job.

The existing positive whole-share, cap, reservation and offering headroom checks
remain. Finalised allocations awaiting register recording do not silently free
headroom. A request reservation, actual Mint, finality, ALLOTTED status, wallet
holding and register entry remain separately visible outcomes.

Fresh signing rechecks the original consumed company authority, evidence,
subscription and exact transaction. Unsigned holds, permanent authority loss
before any signature, signed work after authority loss, refund holds and
uncertain replies follow the [share issuance rules](../../architecture/outgoing-signing.md#share-issuances).
A genuine finalised Mint and the original paid subscription quantity underpin
ALLOTTED and holding projection. Register recording uses the existing actual
wallet-to-member LINK, retaining a waiting outcome when no link exists. This
workflow does not infer a member or import holdings from names or addresses.
Actual register entry dates and subscription allotment dates remain distinct.

Current exact-company register-read capability controls proposals and retained
authority files. Private account, profile, wallet lock and reserved dispatch
identifiers remain internal. Company administration does not grant the
financial ledger or unrelated participant records. Both clients retain the
original operation key, body, uploads and expected receipt within the current
session; the selected source packet, company, class, account and session guard
uploads, previews, confirmations and final callbacks, and mobile additionally
binds its session epoch.

## Boundaries

Fresh platform-staff paid-issue approval and admission are retired; financial
receipt/refund producers and technical diagnostics remain until #868 changes
them. Historical paid records and migrations retain their actual actors and
source bindings. This increment does not deliver AUD collection or prove that
AUD pricing or a stablecoin is direct AUD payment.
