# Company-authorised capital increases

[Accepted plan](../../architecture/company-managed-registers.md) · [Implementation index](README.md) · [#867](https://github.com/Ledova/ledova/issues/867)

**Status:** Fourth #867 increment implements bounded company-authorised capital
increases after the empty deployment, company-wallet and non-paid grant increments.
[PR #948](https://github.com/Ledova/ledova/pull/948) records independent source
review, actual checks and remaining limits.
Paid issuance and company pause/unpause conversion remain later increments.

## Exact capital decision

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

## Preparation, approval and application

Current personal `admin` may prepare, approve, apply and reject. The existing
narrower step capabilities remain; rejection uses `approve`. Ownership, staff
permissions and technical signer configuration supply no company mandate.
Current register access permits bounded proposal, history and evidence reads.

Preparation retains the exact authority copy and immutable terms against one
existing capital request in `UNDER_REVIEW`. Human approval records the exact
decision and admits no execution. Application consumes that approval and admits
the original capital execution and its durable job atomically. Rejection retains
its reason and rejects the original request in the same command.

The API family is `/api/v1/tokens/register-capital-increases/`, with preparation,
list, detail, decision preview, decision and retained authority-file operations.
Both clients use the same exact preview and confirmed decision. An uncertain
preparation or decision retains its original body and key; current private read
is still required to recover that receipt. Unavailable reads or changed current
cap do not justify constructing a different retry.

## Execution and original recovery

The existing `CapitalIncreaseExecution` and outgoing transaction journals remain
the execution path. Fresh signing rechecks the captured company decision,
current personal authority, evidence, unchanged terms and configuration before
outgoing and signer effects. The shared class-first lock order and deferred
database guards remain required.

Temporary source, configuration, provider or lock unavailability keeps the same
unsigned claim without a signature or nonce. Explicit revocation or database-clock
expiry of a consumed approval/application appointment fails the original request
and PREPARING operation only when no signed attempt ever existed, releasing the
class slot and retaining its intent and journal. A definite technical preparation
failure keeps the existing failed-attempt and retry semantics.

The technical call is `setAuthorizedShares(new_authorized_total)`. Completion
requires the original successful transaction, matching contract and actual
`AuthorizedSharesUpdated` event under the configured finality policy. A matching
current cap alone does not establish that the original execution completed.
The clients distinguish approval, admitted work, original transaction status and
the projected result.

Retained legacy actors, intents, signatures and historical arithmetic remain
unchanged. Already signed work recovers its original bytes and receipt after
human authority loss. Unsigned contention, refused source, failed-original retry,
superseded terms and historical attribution must retain their actual meanings;
no replacement approval or transaction is inferred from a later current state.

## Delivery boundaries

The coherent replacement retires fresh owner/staff capital creation, submission,
review and admission when the company workflow works. Existing private owner
histories, original technical recovery, migration history and retained evidence
remain. Pause controls, genuine paid and transfer records and investor-only
provider guards remain until their own increments replace them.

Meaningful authority, isolation, evidence, quantity, deferred effect, atomic
queue, contention, retained-history, original event/finality and both-client
transport/receipt checks accompany this work. Actual landed dependency/main
integration, wholly nonauthor review at the merging head and green required CI
remain delivery gates. This increment supplies no member-binding, payment,
treasury, populated-mirror, live-operation or physical-device acceptance policy.
