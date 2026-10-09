# Company-authorised paid share issues

[Accepted plan](../../architecture/company-managed-registers.md) · [Implementation index](README.md) · [#867](https://github.com/Ledova/ledova/issues/867)

**Status:** Sixth #867 increment implements company-authorised paid issues through
the API and both clients. It follows the deployment, wallet, non-paid issue,
capital and pause increments. Its pull request must record the final source,
independent review, executed checks and limits before delivery.
Offering publication, application decisions, payment collection, receipt
verification and refund policy remain #868 work.

## Recorded payment and exact company mandate

The company can prepare an issue from an existing subscription recorded as PAID
on a deployed Base whole-share class. The existing financial producer supplies
the subscription, instruction and receipt facts; this increment does not verify
cleared funds or select a bank, provider or custody model. A recorded payment
does not authorise an issue.

Preparation captures the exact subscription, class, recipient, whole-share
allotment quantity, price, payment dates and references, money held and refund
facts. Partial receipts and existing scale-back quantities remain distinct from
the original requested quantity. A refund amount owed is distinct from an
actually recorded refund. Imported registers cannot use this issue workflow.
There is no new GENERAL eligibility, wallet nomination, member selection, grant
terms or acceptance prerequisite for an already instructed paid subscription.

The preparer retains its own exact-company AUTHORITY document and states the
approving director, authority reference and reason. Current personal company
appointments supply preparation, approval and application authority. The named
director and existing recipient conflict check remain separate from the acting
appointee. Ownership, staff permissions, a receipt or technical signer access
supplies no company mandate.

## Preparation, approval and application

Both clients expose the company decision family at
`/api/v1/tokens/register-paid-issues/`: list, create, detail, authority file,
decision preview and decision. Its bounded `ready-subscriptions` selector is an
unpaginated list for current ADMIN/PREPARE in the exact company and class.
Approvers, appliers and register readers can inspect existing proposals without
requiring access to that selector or the wider financial ledger.

Preparation and approval create no issuance request, subscription request link,
execution journal, signed attempt or queued issuance job. Application consumes
the exact approval and atomically binds the captured request identity to the
original subscription, company instruction, execution and durable job. Identical
original command replay recovers its receipt; changed retries conflict.

The existing positive whole-share, cap, reservation and offering headroom checks
remain. Finalised allocations awaiting register recording do not silently free
headroom. A request reservation, actual Mint, finality, ALLOTTED status, wallet
holding and register entry remain separately visible outcomes.

## Execution and retained recovery

Fresh signing rechecks the original consumed company authority, evidence,
subscription and exact transaction. Temporary source contention retains
unsigned work without a signed attempt or new nonce. Original signed or
confirmed work recovers its original bytes, nonce, receipt and projection after
authority loss; recovery does not invent a replacement approval.

An admitted subscription retains its unique original execution and immutable
request binding. Permanent authority loss before any signature cannot renew that
source, bind a second request or automatically refund money. The original history
and diagnostics remain. Existing genuine financial cancellation and retained
technical recovery controls remain bounded by their actual facts; further paid
fund resolution policy belongs to #868.

A genuine finalised Mint and the original paid subscription quantity underpin
ALLOTTED and holding projection. Register recording uses the existing actual
wallet-to-member LINK, retaining a waiting outcome when no link exists. This
workflow does not infer a member or import holdings from names or addresses.
Actual register entry dates and subscription allotment dates remain distinct.

## Privacy and client recovery

Current exact-company register access controls proposals and retained authority
files. Private account, profile, wallet lock and reserved dispatch identifiers
remain internal. Company administration does not grant the financial ledger or
unrelated participant records.

Both clients retain the original operation key, body, uploads and expected
receipt within the current session. The selected source packet, company, class,
account and session guard uploads, previews, confirmations and final callbacks;
mobile additionally binds its session epoch. An unavailable or mismatched read
does not establish completion. Process loss does not promise durable client
replay.

## Verification boundary

This increment owns meaningful ordinary and genuine scoped authority, privacy,
SQL forgery, source change, headroom, rollback, contention and exact replay
controls. Real local-chain checks must exercise a genuine paid producer,
original company admission, finality, holding and waiting/linked register
outcomes, plus original signed recovery and retained financial safeguards.
Historical paid records and migrations retain their actual actors and source
bindings. Fresh staff paid-issue approval and admission are retired; financial
receipt/refund producers and technical diagnostics remain until their owning
workflows change.

Required current-main CI, coordinated schema/types, both clients, native checks
and independent review precede merge. This increment does not deliver AUD
collection or prove that AUD pricing or a stablecoin is direct AUD payment.
The complete company/member journey remains #873; physical-device/live release
acceptance remains #624.
