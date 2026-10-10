# Company-authorised capital increases

[Implementation index](README.md) · [Accepted plan](../../architecture/company-managed-registers.md) · [#867](https://github.com/Ledova/ledova/issues/867)

Delivered by [PR #948](https://github.com/Ledova/ledova/pull/948).

## What the company does

A company appointee prepares an increase to the authorised cap of a supported
deployed Base whole-share class, including a currently paused deployed class.
The proposal captures the exact company, class, contract, current cap, additional
whole shares and new authorised total. New company preparation requires the new
total to equal the captured cap plus the additional shares. The additional
quantity and target stay within the existing positive integer range,
1 to 2,147,483,647.

The company supplies a purpose, board resolution reference, any applicable
shareholder approval reference and its own retained authority evidence. The
optional shareholder reference does not establish a new approval threshold.
Company information and documents remain provided by the company. Ledova does
not verify a corporate resolution through this workflow.

Raising the cap mints zero shares and changes no holding or register quantity.
It does not approve a grant, allotment or payment. The participant nomination,
wallet proof and finite ADD requirements of a grant are separate workflows.

A current `admin` appointment may prepare, approve, apply and reject, with
`prepare`, `approve` and `apply` as the narrower delegate capabilities, under
the [owner's authority rules](../../decisions.md#company-run-register-authority-and-evidence);
ownership, platform staff permissions and technical signer configuration supply
no company mandate. Current register-read capability permits bounded proposal,
history and evidence reads.

## What is recorded

Preparation retains the exact authority copy and immutable terms against one
existing capital request in `UNDER_REVIEW`. Approval records the exact decision
and admits no execution. Application consumes that approval and admits the
original capital execution and its durable job atomically. Rejection retains
its reason and rejects the original request in the same command.

The existing `CapitalIncreaseExecution` and outgoing transaction journals remain
the execution path. The technical call is
`setAuthorizedShares(new_authorized_total)`. Completion requires the original
successful transaction, matching contract and actual `AuthorizedSharesUpdated`
event under the configured finality policy. A matching current cap alone does
not establish that the original execution completed. The clients distinguish
approval, admitted work, original transaction status and the projected result.

Fresh signing rechecks the captured company decision, current personal
authority, evidence, unchanged terms and configuration. Unsigned holds,
never-signed retirement and signed work after authority loss follow the
[capital increase rules](../../architecture/outgoing-signing.md#capital-increases),
and uncertain replies the
[company decision rule](../../architecture/outgoing-signing.md#company-decisions-and-signer-authority);
an unavailable read or a changed current cap does not justify constructing a
different retry.

## API

The family is `/api/v1/tokens/register-capital-increases/`, with preparation,
list, detail, decision preview, decision and retained authority-file operations.
Both clients use the same exact preview and confirmed decision.

## Boundaries

Fresh capital creation, submission, review and admission under ownership and
platform-staff permissions are retired. Existing private owner histories,
original technical recovery, migration history and retained evidence remain,
and retained legacy actors, intents, signatures and historical arithmetic are
unchanged. Pause and paid-issue authority use their own guides. Genuine payment
and transfer records and the investor-only provider guards remain; #868 records
externally arranged capital and company-approved allotments, and new integrated
payment and transfer mechanics are deferred under the
[9 October priority](../../decisions.md#essential-registry-and-development-workflow-priority).
This increment supplies no member-binding, payment, treasury or
populated-mirror policy.
