# Register of members

[Business processes](README.md) · [Documentation](../README.md)

How a company keeps the register of members of each share class in Ledova, and what the web Ledger
page shows. It is for company representatives, product owners, support staff and engineers learning
the domain. Issuing shares is in [share classes and issuing shares](issuing-shares.md); copies,
certificates and member access are in [member records and register outputs](member-records.md).

Contents:

- [The register and the company's records](#the-register-and-the-companys-records)
- [Who runs what](#who-runs-what)
- [What the register records](#what-the-register-records)
- [Opening a register](#opening-a-register)
- [Changing the register after the opening](#changing-the-register-after-the-opening)
- [Completed chain effects and waiting entries](#completed-chain-effects-and-waiting-entries)
- [Retained director instructions](#retained-director-instructions)
- [Reconciliation with the chain](#reconciliation-with-the-chain)
- [The Ledger page](#the-register-page)

## The register and the company's records

Ledova keeps one stored register per share class, an ownership mirror of records the company keeps
itself ([what stays with the company](README.md#what-ledova-does-and-what-stays-with-the-company);
[why](../decisions.md#existing-register-mirror-and-simple-setup)). It lists current members with
their holdings and linked wallets, the issued shares and former members. It is read from Ledova's
records, never the chain, so it is available when the chain is not and a wallet balance never stands
in for a holding; a class with a contract is [reconciled](#reconciliation-with-the-chain)
separately.

One member ID serves every class of a company, and names never merge members.

A register is opened once, by an import of the company's records or, for a class with a contract,
from the chain; until then it has no members and no download. A class an import opened takes no
chain opening, chain issue or settled-transfer instruction, even if later
[deployed](issuing-shares.md#deploying-an-empty-class) while empty, and without a contract its
issues and transfers are register entries needing no wallet.
[Tokenising it](issuing-shares.md#planned-tokenising-an-imported-register) is planned. Production
retention of evidence, and undoing a mistaken opening import beyond the bounded correction, are
decided before real data is admitted.

## Who runs what

The company runs its register through its appointees, apart from the owner-submitted
[retained director instructions](#retained-director-instructions)
([how a company decision works](README.md#how-a-company-decision-works);
[capabilities](README.md#company-capabilities);
[why](../decisions.md#company-run-register-authority-and-evidence)). Ledova reconciles each class on
chain every six hours, and the operator can run one on demand
([reconciling on demand](../operations/recovery.md#reconciling-a-register-on-demand)). Platform
staff see imports, openings, corrections and wallet links in admin as read-only history; particulars
changes have no admin page.

### Company evidence

Every change rests on evidence the company provides
([company-provided evidence](README.md#company-provided-evidence)). The authority document behind an
opening, correction, wallet link or transfer is a director resolution naming the approving director
or, except for a transfer, a court order with its reference. Uploads are PDF, PNG or JPEG files
within the upload limit (10 MB by default); evidence downloads are not logged.

## What the register records

### Register entries

Every change is an entry:

| Entry, as the app shows it | What it does                                                                     |
| -------------------------- | -------------------------------------------------------------------------------- |
| Opening state              | Records the holdings when the register was opened, even if there are none        |
| Issue                      | Adds a positive whole number of shares to one member                             |
| Transfer                   | Moves shares between members; issued shares do not change                        |
| Cessation                  | Removes a member's entire holding in this class; no current workflow records one |
| Compensating correction    | Exactly reverses every change of one earlier entry                               |
| Copied opening correction  | Records the exact difference when the company corrects the opening's records     |

Entries are never edited or deleted ([nothing is overwritten](README.md#nothing-is-overwritten)),
and each is linked to the one before, so altered history is detected when the register is verified
([the entry chain](../engineering/records.md#entries-and-the-hash-chain)). Shares are whole numbers,
no change takes a holding below zero, and emptying a holding leaves a zero position. A cessation
covers this class only; recording a cessation or correction burns, seizes or transfers nothing on
chain. Entries name members by member ID, keeping names and residential addresses as particulars.

New non-tokenised grants, investor allotments and direct transfers require the company to supply
the actual issue or transfer date. It is separate from terms, agreement, receipt, signing and
lodgement dates and from Ledova's immutable preparation, approval and recording timestamps. The
company date must be no later than today (UTC) and no earlier than the applicable opening or latest
effective event; an earlier event needs separately scoped correction or reconciliation. The normal
path does not replay history. Chain issues retain their existing execution and finality dates.

Review, details and history show the supplied company date separately from the ledger date where
they differ. Older records and hashes remain unchanged: an unknown company date is shown as not
recorded, never inferred from an older ledger date. An old pending instruction with no company date
can still be read or rejected; it needs rejection and preparation again before any new effect.

### Members, holder types and identity

A register row is a member with a positive holding, its percentage taken of the class's issued
shares; a member can have no linked wallet or several. Holder types:

- Member: resolves to one person, as below.
- Treasury: held at a labelled company treasury address, such as an employee share trust.
- Ambiguous: its wallets point to more than one person, or two wallet records share its address, so
  no name is shown and the shareholder view says the identity needs review.
- Unidentified: no wallet resolves to a named person and no particulars are recorded, so the
  shareholder view suggests asking the participant to add their full name in Profile, or to verify and
  nominate the wallet for approval.

A member's name and residential address come from the first available of: the live verified identity
behind its wallets, if unambiguous; the latest identity recorded when shares were allotted to one of
its wallets (differing recorded identities, like differing live ones, make it Ambiguous); and the
particulars of the import or particulars change with the later "as at" date (or applied later, on a
shared date), shown as "Recorded register particulars". Particulars never replace a live identity or
hide an ambiguous one ([decision](../decisions.md#the-stored-register)), so profile changes reach
the register and conflicts stay visible. Older issues with no recorded identity are not filled in by
guessing.

An email address is never used as a member's name. A wallet owner who has not given a full name in
Profile has no live identity, so without other recorded identity the member shows as Unidentified;
a share issue to them waits until they add their name, as it does for a missing residential
address, and a paid issue records no name or address. A publication roll made meanwhile keeps
them without an account, like any member the register cannot name
([frozen roll](publications.md#the-frozen-roll)). Entries recorded earlier keep what they
recorded.

A treasury label names an address, not a person, and gives no residential address: a member at a
labelled treasury address stays Treasury, named by its recorded particulars or else the label. A
treasury address beside another identity is Ambiguous. Every register output, publication roll and
former-member record reads a member this way.

The shareholder table shows no residential address; addresses appear on a shareholder's page for
someone with a current register appointment, in the recorded downloads and outputs, and in the
import, particulars-change, grant, transfer, allotment and award records.

### Amount paid and date entered

Allotments give consideration, not membership. Amount paid is shown only where Ledova can establish
it exactly, for a holding untouched by transfers that still equals its paid allotments. A transfer
naming the member, or a recorded cessation of one of its wallets between its first allotment and the
opening, touches it; a pre-opening transfer that emptied none of its wallets and kept its quantity
cannot be seen. Unallotted applications, holdings without allotments and quantity mismatches leave
it blank; a pending refund never inflates it, zero never stands for an unknown amount, and non-paid
terms establish none. New opening snapshots leave the current holding's amount paid unknown:
optional historical allotments do not establish it. Earlier recorded imported amounts remain
unchanged. An imported amount paid holds while the holding is unchanged since the import,
plus the AUD consideration of later external investor allotments (blank stays blank; a member the
import did not carry shows the consideration alone); any other later entry for the member, such as a
non-paid grant or transfer, blanks it. An import records amounts paid and unpaid as the company
enters them from its records, without a currency, so the register cannot name a single currency for
them.

Date entered is when the member went from no shares to some. The earliest completed allotment to one
of its wallets replaces it only if earlier, with the holding continuous since; otherwise a member
the opening carried in shows the opening's date. For such a continuing member an applied import's
date entered replaces both rules, and later issues and transfers leave it in place. A member who
entered through a later entry keeps the date the register gives. A recorded cessation counts once
Ledova has read it from the chain.

### Former members

On a register an import opened, a member with no linked wallet who falls to zero keeps a
former-member record of their particulars and holding at exit; a return keeps the member ID and
records the return date. Exit and return use the actual recording day for a company-dated change,
so an earlier company event date or backdated correction cannot shorten retention or date a return
before the exit, and particulars edits and invitations do not reset the exit clock.

For a class on chain, Ledova reads the transfer history every six hours and lists each wallet that
ceases to hold, freezing its particulars at the first recorded cessation: the person's current
profile, else the identity recorded at allotment, else the member's recorded particulars, else a
name recorded at allotment (a labelled treasury address takes its recorded particulars before its
label). Ledova sees wallets, not members, so a wallet emptied into another of the member's wallets
on or after their date entered is left out; an earlier cessation stays, as the member ceased and
holds again and section 169(3) keeps it, and so does a rotation before the opening, which cannot be
told from a cessation. The list is marked as needing a refresh when last read over 24 hours ago.

An import records former members from before Ledova, which the chain cannot rebuild. They must have
ceased no later than the import's register date (and before the opening, where the class was already
opened from the chain) and within the retention period, and
are listed without a wallet address and purged on the same clock from the date they ceased.

Only the company owner, current register appointees and the operator read former members, in the CSV
(with residential addresses), under Former shareholders on Shareholders and on a former member's
own page. Particulars are
kept while a person is a member and for the retention period after they last held shares, at least
seven years, then purged for good ([retention](../engineering/security.md#retention-clocks)).

## Opening a register

### Bringing in existing records

An import mirrors the company's records for one share class. For a class with no entries and no
contract it is the opening, creating the members, the Opening state entry and their particulars
together; for a class opened from the chain it adds particulars and former members from before
Ledova, and its holdings must match the stored register. On the web:

1. On Ledger, choose **Add share class**; or choose Corrections, the class, then Bring records
   under Opening records. Issue shares and Transfer shares also offer **Set up your ledger** for a
   class not yet set up. Share classes are created only through register setup, in Ledger on the
   web and Register on mobile.
2. Share details: open an existing draft class from its link, or choose a common class (Ordinary
   ORD, Preference PRF or Redeemable RED) or Another class with the company's own name, code and
   type. The company choices come from current personal administrator or preparer appointments,
   without granting access to private company Settings
   ([share classes](issuing-shares.md#share-classes)). A class set up here carries a technical share
   limit instead of authorised capital. Repeat for each class.
   With no classes yet, a preparer uses the company sidebar's Ledger and its setup action.
   Preparation access does not change their initial landing page or account role.
3. Shareholders, one at a time: choose a recorded person or New person
   ([choosing a person](#choosing-a-person); names never link records, and existing names and
   addresses are kept), then enter from this
   class's records the name, residential address, original date entered and **Current shares held**.
   **Allocation history** optionally copies available dates, quantities and paid/unpaid amounts;
   these historical quantities need not equal today's holding after transfers or cancellations.
   New web records leave beneficial
   ownership **Not recorded**, with no ownership question or reference inputs; existing answers and
   references stay with saved records and corrections. **Documents** optionally attaches one or more
   files to this shareholder and share class, each with **Category** and **File** fields
   ([supporting documents](#shareholder-documents)).
   **Add allocation** and **Add document** sit beside their respective section headings. One allocation is open
   for editing at a time. Adding another checks the current entry,
   folds it into a date, shares, paid and unpaid summary, and opens any unfinished entry or a new one.
   **Edit** and **Remove** sit beside a collapsed summary; an open entry has **Remove** below its
   full-width fields. Unfinished input is kept when switching entries. Entries do not collapse while typing.
   **Add shareholder**, or **Save changes** when editing, finishes the shareholder and any history
   entered. Removing the final entry leaves no copied history. History never sets
   or limits current holdings. New paid/unpaid fields start at zero; clearing either records zero,
   and fully paid means nothing remains unpaid. Existing unknown amounts remain unknown.
   For a genuinely unopened non-tokenised class
   with no issued shares or earlier members, leave the draft empty to record its empty opening.
4. Review the shares, shareholders and record date in one table, with particulars under Details.
   Confirm loads a fresh preview and records approval and application together; an appointee who may
   only review records the approval for another to apply.

On mobile, setup starts on the Register tab: **Create share class** (or **Set up your share
register** in Getting started) records the class's name, code and type, and **Bring records** under
the class's Register mirror prepares its records for review and confirmation. Once a class exists,
the Getting started step opens that class's register setup.

The register API also accepts an empty opening with no current or former members for a genuinely
unopened draft class without chain activity. It retains the same company confirmation and separate
approval/application, records an empty Opening state and creates no shares or shareholders. It
cannot replace a populated or chain opening or erase records through a correction. The first
subsequent approved issue uses the same register. Web and mobile setup check current class and register
metadata before allowing the empty draft; incomplete entered rows still need correction or removal.

Inviting members is optional ([member access](member-records.md#member-access)). Unsaved edits are
kept only in the open page and are lost if you leave it. After a failed or uncertain response, use Recover saved records or Recover
confirmation in setup ([uncertain outcomes](README.md#when-the-outcome-is-uncertain)); another
appointee can resume review or confirmation without preparation access. Edit records retires a saved
preparation for editing and needs preparation and rejection authority.

Award recipients without shares appear in the same list as members, marked as such. Select the
exact company recipient to keep their ID, current particulars and any accepted member access; enter
their source membership date, current holdings and any optional allotment history yourself.
Changed, unavailable, conflicting or
foreign identities block preparation, review or application; names alone never join people. A first
copied holding records an opening balance, not an award-linked issue.

Web imports are attributed to "Company-provided share records", with a snapshot naming the company,
record date and preparer; the mobile app asks for a source reference and keeps separate Review and
Confirm mirror screens. Confirming is the company's confirmation that the records are its own, not a
new director resolution. On the web, **Company source copies** optionally holds a register copy and ASIC
extract, kept without being read. Fresh setup asks for neither former shareholders nor ASIC
comparison figures. Earlier former-member records remain in saved snapshots, review and history;
an inherited **Earlier ASIC comparison** is read-only, with **Leave out ASIC comparison** available
when revising it. Mobile keeps its optional ASIC comparison fields;
an extract may list only some shareholders. The Import button is marked Coming soon: document
extraction will later fill these forms for review. Earlier imports keep their evidence and
authority, and fields their snapshots lack stay unknown.

An import is refused when the class already has an applied import; once an issue was approved or an
instruction applied for the class (open it from the chain, then import particulars); when its
holdings differ from the stored register of a class opened from the chain; when a former member
ceased after the register date, on or after an existing opening, or before the retention period; and while a deployment of the class
is pending.

### Shareholder documents

On the web, each shareholder can have optional Share certificate, Shareholder agreement,
Subscription agreement or Other supporting document attachments. Add them in the shareholder form
during setup, or afterwards from the shareholder's page or the relevant class's details. Each
attachment belongs to the company, person and share class; a setup attachment also keeps its source
opening record. Recording existing holdings creates no historical share issue. Company source
copies belong to the whole opening and remain separate.

Files and their record links are retained, with the uploader, appointment, category and file
fingerprint. One stored file can support several linked people without duplicating its bytes.
Current company register readers can download them; they are not shared automatically with members
or published. A category describes the company's attachment: uploading a Share certificate neither
generates nor verifies one, and an attachment does not replace an issue's required approval,
agreement or receipt evidence. Mobile attachment entry is deferred.

### Correcting the copied opening

In Ledger's Corrections view, under Opening records, choose Correct copied opening to replace the
latest applied import's shareholder rows in full, in the same forms and keeping each member ID, with a current
source and a reason. Applying keeps the earlier snapshot, decisions and opening entry, adds a Copied
opening correction entry for the exact difference (none when only particulars change) and records
the new particulars. It is refused once the class has later share activity, a deployment, or
member-access or particulars activity; the company then resolves its records and uses the supported
workflow.

### Opening from the chain

A deployed or paused class whose register has no entry is opened from the chain by mapping each
wallet holding shares at one block, the boundary, to a company member. Nothing is typed and no
particulars are stored; a later import adds them.

1. In Ledger's Corrections view, under Openings, choose Open this ledger. The page reads the
   holdings on chain, largest first, or says the chain cannot be read.
2. Assign each address to a member: a linked address keeps its member, others go to an existing or
   new member, and several can share one.
3. Upload the authority document, choose Director resolution (naming the director) or Court order,
   give the reference and reason, and choose Prepare opening, which captures the boundary.
4. Approve, then Apply; both read the chain again.

Applying records the members, their wallet links and the Opening state entry, dated on the boundary
block's date (an explicitly empty register if nothing was held), and changes nothing on chain.

The mapping must cover exactly the addresses holding at the boundary; if holdings moved, reload and
map again. A choice resets, with a notice, only when its address no longer holds or its member is no
longer offered. An address belongs to one member per company, and an existing link must agree. An
opening is refused if a completed issue or transfer is not represented at its boundary, including
one completed after the opening was prepared; if the chain
no longer confirms the boundary, or a mapped wallet was linked elsewhere since, reject it and
prepare another.

## Changing the register after the opening

### Compensating corrections

A correction exactly reverses one entry, which stays and is named by it. An entry can be corrected
once, and a correction can itself be corrected; partial corrections and replacement transactions are
not built.

1. In Ledger's Corrections view, expand the entry and choose Correct this entry,
   which shows the exact inverse.
2. Upload the authority document and give the authority, approving director, reference, reason and
   an effective date of today (UTC) or earlier; a later date would hold back later issues and
   transfers.
3. Approve, then Apply.

A correction is refused for an entry with no changes or already corrected, or an inverse taking a
holding below zero; if a newer entry was recorded after preparation, reject it and prepare another.
On a class on chain the next reconciliation reports member and supply differences for the company to
[acknowledge](#acknowledging-a-discrepancy).

### Changing a member's particulars

The company keeps members' names and residential addresses current; members edit their own profile
and ask for changes separately ([member profile](participants.md#member-profile),
[member requests](member-records.md#member-requests)).

1. Open the shareholder's page from **Shareholders** (Details), or an award recipient's from
   Recipient details on their award, and choose Change particulars.
2. Upload one supporting document, such as a deed poll or the member's notice of a new address, and
   give the new name and residential address, the "as at" date the company's register records (today
   in UTC or earlier) and a reason.
3. Approve, then Apply.

The latest "as at" date wins between imports and changes
([identity order](#members-holder-types-and-identity)). A change is refused if dated before the
current particulars, or for a member who has held no shares in the company for the retention period,
and becomes unusable if later particulars are recorded meanwhile. Names take up to 255 characters,
and addresses and reasons up to 1,000.

### Linking wallets to members

After a class is opened, an issue or transfer completing to a wallet no member owns waits rather
than creating a member ([decision](../decisions.md#the-stored-register)). A wallet link records
which member owns it: a new subscriber's, a first-time buyer's or another of an existing member's
wallets. A [chain grant](issuing-shares.md#non-paid-chain-grants) links its nominated wallet the
same way before minting.

1. Choose Link waiting wallets under Wallet links in Ledger's Corrections view. Only waiting
   wallets are listed, each with the number of issues or transfers waiting for it.
2. Each wallet starts as its own new member; choose the existing or new member who owns it, the same
   one for one person's wallets. For a whitelisted wallet the page shows, for information only,
   whether its holder proved control on Ledova and their name. A choice resets, with a notice, only
   when its wallet stops waiting or its member is no longer offered.
3. Upload the authority document, give the authority, approving director, reference and reason, then
   Approve and Apply.

Links are company-wide: one serves every class and needs no opened register. An address is linked
once; if another member got it meanwhile, reject the link and prepare another. Applying records the
new members and links, then the issues and transfers that waited for them. A link makes no register
entry, changes no whitelist approval and proves no possession; deleting the wallet does not unlink
it.

### Non-paid transfers between members

A company can record a genuine non-paid transfer between members of an imported register whose class
has no contract, when neither has a linked wallet anywhere in the company. It creates no wallet,
account, payment, application or chain transaction.

1. On the web, in Ledger choose Transfer shares, the class, then Prepare a non-paid transfer. For a
   tokenised class the task says its transfers use wallet and chain controls.
2. In **People and shares**, choose the transferor, recipient and shares
   ([choosing a person](#choosing-a-person)), and give the company transfer date. An
   existing company recipient keeps their member ID, including someone holding only another class,
   a former member returning from zero, or someone without shares. Register a first-time recipient
   through **Add person** on Shareholders before preparing the transfer. This creates particulars,
   not shares or member access. If a returning member's particulars were lawfully purged, the
   company supplies current ones against the same existing identity. The API and mobile retain
   their existing new-recipient path; mobile changes remain deferred.
3. In **Transfer documents**, give the separate dates the instrument was signed and lodged,
   the non-paid terms and the signed transfer instrument.
4. In **Company authority and review**, check the transfer summary, choose the approving director,
   give the authority reference and reason, and attach the authority document. **Prepare transfer**
   saves the proposal; it moves no shares. Back and Continue keep the draft fields and selected
   files without saving or uploading.
5. The saved record aligns From, To, Shares, Transfer date and Status, with **Details and documents**
   available on demand. **Review and approve** opens a main-page preview of the parties, ownership
   effect, transfer instrument and company authority, with long terms, particulars and documents
   on demand. Cancel returns to the record and its opener. **Approve** records the company approval
   and ledger transfer together, requiring current approval and application authority. A current
   earlier approval is reused; an approved transfer awaiting its entry shows **Ready to complete**.
   Success shows **Approved** and the recorded entry, without a separate Apply action. A failed
   transaction records no new approval or movement; retrying the same request cannot move the shares
   twice. Rejection also uses page review. The preparation action shares the final record's action
   row, or stands alone when no transfers exist. The API and mobile keep their separate decision steps.

The transferor must hold enough shares, and the director cannot be either party
([named directors](README.md#named-directors)). Applying records one Transfer entry, with the
applier as recorder; the certificate falls due a calendar month after lodgement
([certificates](member-records.md#certificates)), and a holding reaching zero creates a
[former-member record](#former-members). The class's issued shares stay the same. Ledova refuses a
direct transfer while the class is marked non-transferable, rechecking the restriction before
approval and application. The company determines whether its constitution and shareholder
agreements permit the transfer; Ledova does not interpret those documents. Court-directed, paid and chain
transfers are not built;
court-backed [corrections](#compensating-corrections) remain. An imported register takes no
Cessation entry, and its corrections are ordinary company corrections.

## Completed chain effects and waiting entries

### Recording completed issues and transfers

Once a class on chain has an applied opening, each issue completing on chain and each settled market
transfer becomes an entry in chain order: an issue in the name of the appointee who applied the
grant or paid issue, or of the original staff reviewer under a
[retained issue instruction](#retained-issue-instructions); a settled transfer in the name of the
transferor once an applied [instruction](#settled-transfer-instructions) lists it. An effect the
opening already holds records nothing, nor does a settlement between two wallets of one member.

Recording stops at the first effect it cannot record, so the register never skips ahead of the
chain, though the issue or settlement itself still completes; it resumes at the next completion in
the class, applied wallet link or applied instruction. A waiting effect is in no holding until it is
recorded, and the class summary shows how many wait.

### Why a completed effect waits

The waiting list, which is not shown in the app, gives each waiting effect's wallets, shares and
reason in recording order; the first is where recording stopped.

| Reason       | Why it waits                                                                                                                                    | What resolves it                                                   |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Attribution  | The opening's boundary cannot place the completion                                                                                              | An attribution procedure, not yet built                            |
| Unlinked     | A wallet it names is linked to no member                                                                                                        | A [wallet link](#linking-wallets-to-members)                       |
| Unreviewed   | An issue records no approving reviewer, as when that account was deleted                                                                        | Nothing: Ledova does not invent a recorder                         |
| Uninstructed | No applied instruction covers it                                                                                                                | A [retained director instruction](#retained-director-instructions) |
| Refused      | The register refused the entry, for example because the seller's holding no longer covers the transfer or the latest entry is dated after today | The cause; recording tries again at its next run                   |
| Behind       | An earlier effect in the class waits                                                                                                            | Resolving the earlier effect                                       |

## Retained director instructions

A retained instruction is the directors' approval of completed chain effects that no company
decision covers: settled market transfers, and direct issues approved before issues became
company-run. Under one [owner decision](../decisions.md#the-stored-register), both keep a staff
review, for settled transfers until [#869](https://github.com/Ledova/ledova/issues/869):

1. The company owner submits an instruction listing the exact items a named director approved, with
   the authority reference, a reason and a company document that platform staff have
   [verified](companies.md#staff-verification-of-a-company-document), of which Ledova keeps a
   private copy. Neither app has a form for it; it goes through Ledova's API
   ([retained instructions API](../engineering/records.md#retained-register-instructions-api)).
2. Platform staff with permission to change register instructions open it under Register
   instructions in admin, inspect the retained document, the
   director, the reference, the company and each item's exact terms, then confirm within 15 minutes
   and choose Approve and apply, or reject with a reason.

Submission, review and application refuse a director who is a party to a listed transfer or the
recipient of a listed issue, and any instruction for a class an import opened. Applying records
whatever waited for the instruction, in chain order. Instructions are kept unchanged and cannot be
deleted ([retention](../engineering/security.md#retention-clocks)).

### Settled-transfer instructions

Directors decide whether to register a settled market transfer after it completes, while its entry
waits. The order both parties signed, which the settlement keeps, is the instrument of transfer;
whether it is a proper instrument under section 1071B is left open. Only the two parties see a
settlement, so the owner takes each from the waiting list: its settlement, the seller's then the
buyer's wallet, and the shares. Each must be a completed settlement of the class with exactly that
seller, buyer and shares, not already covered or entered. Staff also check each settlement's
wallets, their linked members and the names they identify, the shares, class and completion time; a
director is a party when the account holding either wallet is in their name.

A transfer the directors decline is not modelled yet: no instruction is submitted, and the
settlement keeps waiting as uninstructed, holding back later effects in the class.

### Retained issue instructions

These cover only such issues on a class on chain that still [wait](#why-a-completed-effect-waits)
for register cover, each listed by its request, recipient wallet and whole shares. Each item must
match its request's current recipient and shares, be an earlier approval still awaiting cover and
not be covered by another applied instruction; new grants and paid issues are refused. Listing an
approval adds the cover its entry waits for without approving it again. Earlier paid instructions
stay as history and admit nothing new, and staff can still reject retained review requests.

## Reconciliation with the chain

Every six hours Ledova checks the stored register of each class with an applied chain opening
against the chain at its finality boundary; a class an import opened is not on chain and is not
reconciled. Waiting effects and platform operations still executing count as pending, and transfers
of zero shares, which anyone can send, are ignored.

Each run is kept as Matched, Discrepant or Failed, with the block and register entry compared. An
unreadable chain fails the reconciliation, never the register, and reconciliation never writes a
register entry. The company cannot start a run; it sees the latest in the register view and the CSV
summary. The register cannot follow a divergence it did not cause: no entry records an outside
transfer, and a correction only reverses an existing entry.

### What each discrepancy means

| Discrepancy           | Meaning and next step                                                                                                                                                                                                                                                                              |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unrecognised transfer | A chain transfer after the opening that is neither a recorded or waiting effect nor a platform operation still executing, such as a direct transfer between whitelisted wallets; investigate, then acknowledge it and the rows it causes if the company accepts it, or dispute it with the parties |
| Missing transfer      | A completed effect whose transaction is not on chain in its block: treat it as a reorganisation and do not rely on the register until it is attributed                                                                                                                                             |
| Member                | A member's linked wallets hold a different number of shares from the register plus pending movements                                                                                                                                                                                               |
| Unlinked              | An address linked to no member holds a different number of shares from what pending movements give it                                                                                                                                                                                              |
| Supply                | The issued supply on chain differs from the stored supply plus pending issues                                                                                                                                                                                                                      |
| Attribution           | A completion the evidence cannot place against the opening; attribution is not built                                                                                                                                                                                                               |

Member, unlinked and supply rows accompany another row or follow an applied correction; they are
acknowledged once the cause is understood.

### Acknowledging a discrepancy

Once the company has investigated and accepted a discrepancy, someone whose appointment holds
administration or approve opens Ledger's Corrections view and chooses Acknowledge on its row in
the class's latest reconciliation, with a reason of up to 1,000 characters; there is no staff step
or second person. Only the latest
reconciliation can be acknowledged (for an older one, wait for the next run); attribution and
missing-transfer rows cannot be, and a row is acknowledged once.

Later runs treat an acknowledged row as explained: an unrecognised transfer is not reported again
for that transaction, and a member, unlinked or supply difference is added to what is expected, so a
further change shows as a new difference. Once every row is acknowledged, the next run is Matched.
An acknowledgement records nothing in the register. It is kept with the reconciliation, the row, the
reason, the person, their appointment and the time, and the
[company pack](member-records.md#the-company-pack) lists it as acknowledged by the company.

## The Register page

The web destination is **Ledger**, with the subtitle **Share classes and current ownership.** The
mobile destination remains Register. Ledger is open to every signed-in account and shows the
registers of companies the person owns or where their appointment includes register access. With
none, it offers **Add share class** to someone who can prepare one and otherwise says there are none. A company
selector appears when several companies are readable. Ledger's sidebar label opens the share-class
overview; its separate caret expands Issue shares, Transfer shares, History and Corrections.
Shareholders, ESS and Documents remain beside Ledger. These are views of one page, so switching between them keeps
unfinished forms and their recovery ([the app at a glance](README.md#the-app-at-a-glance)). Ledger starts with the
company's share classes and current structure; who holds the shares is on Shareholders
([decision](../decisions.md#share-classes-shareholders-and-employee-awards)).

The Ledger view shows:

- a card for each class with **Class details**: Issued shares, Current shareholders, Ledger opened or Ledger not
  opened, Authorised shares where applicable, a
  note when completed issues or transfers wait or cannot be checked;
- **Add share class** below the cards, aligned right, for someone who can prepare the register, opening
  [register setup](#bringing-in-existing-records) for the selected company.

Ledger's four sidebar sub-items each open their own focused view, with a shared share-class
selector and without the overview cards: Issue shares
([investor and non-paid issues](issuing-shares.md#ways-to-issue-shares)), Transfer shares
([non-paid transfers](#non-paid-transfers-between-members)), History and Corrections.

History starts with a full-width Changes card, newest entries first, with compact rows aligned under
Change, Date and Share movements. On smaller screens, the kind and date sit above the movements.
Each entry shows its company date for an issue or transfer (ledger effective date for other kinds),
and its first two signed shareholder movements plus a count of the rest. Select the row to expand
its initially closed details: the full movement list, entry number, separate company, ledger and
recording dates, and correction or reversal references. An older issue or transfer with no company
date says Date not recorded in its summary and Not
recorded in its details. Retained source imports, chain openings, corrections, reconciliation,
particulars and wallet-link records remain available on demand, with permitted evidence downloads.
History has no preparation, approval, correction or acknowledgement forms. Certificates are prepared
in [Documents](member-records.md#preparing-a-certificate).

Corrections holds the existing append-only correction and maintenance workflows: source opening
corrections, chain openings, reconciliation acknowledgements, particulars and wallet links. Their
supporting records open on demand to their snapshot, documents and decision trail; a prepared record
starts open. Stages read Prepared, Approved, Applied or Rejected (for an import, Reviewed and
Confirmed), and evidence reads as
provided by the company or, before the work became company-run, "Verified by Ledova staff". A
section that read successfully with nothing to show is left out, but a class on chain without a
reconciliation says so. An unfinished request keeps its class and exact request, and while one is
held the company, task and class cannot be changed; its sidebar link lets the person return from
another view to resume the same request. A failed read withholds the class cards and the
shareholder list rather than implying holdings are zero.

The focused views reuse the existing controllers, authority checks and original-request recovery.
Further workflow refinements remain under [#1165](https://github.com/Ledova/ledova/issues/1165).

The Shareholders view lists Current shareholders: one row per shareholder across classes, with a
name search, a Share class filter and 25 rows per page, giving each class's shares and percentage
and flagging an identity that needs review. The search, the filter and the page stay in the address.
Details opens the shareholder's page. Former shareholders follows, holding each class's
Former-member history 25 at a time, with Details for a former member the register names. Member
access and requests then holds invitations, current access and members' particulars and
certificate requests ([member records](member-records.md)). While register work is unfinished,
Details is unavailable, so the work and its recovery stay on the page.

The Employee share scheme view, ESS in the sidebar, holds each class's
[awards](issuing-shares.md#employee-awards-and-vesting),
each listing the non-paid issues prepared from it; Documents holds each class's CSV download and
inspection copy, unsigned certificate preparation and the company pack.

Issues are prepared in place under Issue shares, and each other preparation has its own page. Each
keeps an uploaded document if the response is interrupted.
Steps follow [how a company decision works](README.md#how-a-company-decision-works); someone whose
appointments allow none sees the history with a read-only note. The mobile app keeps its own
per-class ownership view and separate preparation and decision screens, holds member access under
Company, and hides every register action while it cannot read the person's appointments
([page mechanics](../engineering/frontend.md#page-mechanics)).

### A shareholder's page

Each shareholder has a page, reached from Details on Shareholders, and so does each award recipient,
reached from Recipient details on their award. It shows:

- Particulars: the name and residential address the company has recorded, with **Change
  particulars** for someone who can prepare the register;
- Holdings: per class, Shares held, % of class, Date added, Holder type and any wallet links, then
  any former holding with the shares held when it ended, its date, and whether they returned or the
  cessation was corrected;
- History: every register entry naming them across classes, newest first, with its date, class, kind
  and their change in shares;
- Employee awards, when they have any: per award, the shares promised, vested and issued, with a link
  to Employee share scheme;
- Documents: the shareholder's retained supporting files, with their category and share class;
  someone who can prepare the register can add more for a recorded holding;
- requests from them waiting for the company, with a link to Member access and requests;
- for an administrator, whether they can see their own records, with **Invite to their records**
  when they cannot.

Details show only while the account, the classes and the holdings read are current; a refresh
withholds them rather than showing stale ownership. Particulars, history and awards also need a
current company register appointment and settled reads, as on Ledger.

### Choosing a person

Every register flow chooses its person the same way: register setup, investor and non-paid issues,
transfers, employee awards and member invitations. In the mobile app the list opens in a sheet from
the field, and register setup adds each shareholder from it with **Add a shareholder**. One
searchable list holds the company's members, named by their recorded particulars, and award recipients without shares, marked
as such. Typing part of a name or address narrows it, so a large register stays quick to search.
Each option shows the name above the address, with a short record reference only when two people
share both. Where a flow can add someone, **New person** is offered first and asks for a name and
residential address; it steps aside while a search finds someone.
Each flow keeps its own rule for who can be chosen:

- issues and awards: people without a linked wallet whose particulars are retained;
- a transfer: a transferor holding shares in the class, and a recipient without a linked wallet;
  on the web both must already be recorded by the company;
- register setup: everyone on the list on the web; in the mobile app, award recipients and the
  members without a linked wallet whose name and address are retained;
- invitations: current and former members and award recipients.

**Add person** on web Shareholders records a company person's name and residential address without
a class, shares, an award, a login or an invitation. People without shares remain separate from
current shareholders and can be found with the same search. Recording a person does not add them
to the legal register; a later confirmed opening, share issue or transfer records their holding.
The company's current preparation or administration appointment is required. A retry retrieves
the original person registration instead of creating another identity. Names and addresses can
coincide between different people; the stored member ID distinguishes them.

An award recipient without shares has a person record from their first award. Every flow uses
their member ID and current particulars, so an issue, a transfer or another award reaches the same
person, and the company corrects their particulars with an ordinary particulars change. On a shareholder's
page, **Issue shares to them** and, on each holding, **Transfer shares** start those flows with the
person chosen.

### The Share class page

Each class opens directly from **Class details** on its Ledger card. Its details show the class's
name, code, type, state and current register summary, followed by the company's optional
[Class rights](issuing-shares.md#class-rights), including its summary and optional class documents,
and its separate **Shareholder documents** section. Shareholder management stays on Shareholders and
register downloads on Documents. **Technical details and chain workflows** opens the retained
technical metadata, request history and company-authorised deployment, chain issue, capital and
pause workflows ([share classes](issuing-shares.md#share-classes)).

Next: [share classes and issuing shares](issuing-shares.md),
[member records and register outputs](member-records.md),
[register engineering](../engineering/records.md) and [legal positions](../legal/positions.md).
