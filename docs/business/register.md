# Register of members

[Business processes](README.md) · [Documentation](../README.md)

How a company keeps the register of members of each share class in Ledova: what the register
records, how it is opened and changed, how a class on chain is checked against the chain, and what
the Register page shows. It is for company representatives, product owners, support staff and
engineers learning the domain. Issuing new shares is in
[share classes and issuing shares](issuing-shares.md); copies, certificates and
member access are in [member records and register outputs](member-records.md).

Contents:

- [The register and the company's records](#the-register-and-the-companys-records)
- [Who runs what](#who-runs-what)
- [What the register records](#what-the-register-records)
- [Opening a register](#opening-a-register)
- [Changing the register after the opening](#changing-the-register-after-the-opening)
- [Completed chain effects and waiting entries](#completed-chain-effects-and-waiting-entries)
- [Reconciliation with the chain](#reconciliation-with-the-chain)
- [The Register page](#the-register-page)
- [Limits and work not built](#limits-and-work-not-built)

## The register and the company's records

Ledova keeps one stored register for each share class. It is the platform's ownership mirror: the
company keeps its legal register, historical records, lawful access arrangements and filings
([what stays with the company](README.md#what-ledova-does-and-what-stays-with-the-company)), and the
[mirror decision](../decisions.md#existing-register-mirror-and-simple-setup) records why.
Copying records into Ledova neither establishes legal ownership nor issues shares again.

The register lists current members with their holdings and linked wallets, the class's issued shares
and its former members. It is read from Ledova's own records and never from the chain, so it is
available when the chain is not, and a wallet balance never stands in for a holding. A class that
has a contract is compared with the chain separately
([reconciliation](#reconciliation-with-the-chain)).

A member is a person entered on a company's register, with or without an account or a wallet. One
member ID serves every class of the company, and names never merge two members. A member record is a
shareholder record, not a company appointment: it grants no company authority.

A register is opened once, either by bringing in the company's existing records (an import) or, for
a class that already has a contract, from the chain. Until then the class has no members and its
register cannot be downloaded. A class opened by an import takes no chain opening, chain issue or
settled-transfer instruction, even if an empty one is later
[deployed](issuing-shares.md#deploying-an-empty-class). While it has no contract, its issues and
transfers are register entries only and a wallet is needed only for a chain action. Tokenising it
later is [planned](issuing-shares.md#planned-tokenising-an-imported-register) and must not issue
the shares a second time.

## Who runs what

Since 5 October 2026 the company runs its register itself. Every change is prepared, approved and
applied by people holding current company appointments, as described in
[how a company decision works](README.md#how-a-company-decision-works); the
[owner's decisions](../decisions.md#company-run-register-authority-and-evidence) give the
reasons. Company ownership alone, shareholding and platform staff permissions grant none of these
steps.

| Work                                                                       | Who does it                                                                                                                       |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Read the register, its proposals, decisions and evidence copies            | The company owner, or a current appointment holding administration or any register capability: read, prepare, approve or apply ([company capabilities](README.md#company-capabilities)) |
| Open from the chain, import, correct, link wallets, change particulars      | Company appointees: prepare, approve and apply                                                                                    |
| Record a non-paid transfer between walletless members                       | Company appointees: prepare, approve and apply                                                                                    |
| Acknowledge a reconciliation discrepancy                                   | One step by an appointment holding administration or approve                                                                      |
| Issue shares, deploy a class, raise its authorised shares, pause it        | Company appointees ([issuing shares](issuing-shares.md))                                                          |
| Register a settled market transfer                                         | The company owner submits the directors' instruction; platform staff review and apply it ([below](#settled-transfer-instructions)) |
| Register outputs (CSV, inspection copies, certificates, notice figures, company packs) | See [outputs at a glance](member-records.md#outputs-at-a-glance)                                                    |
| Reconcile a class on chain with the chain                                  | Ledova, every six hours; the operator can also run one ([reconciling on demand](../operations/recovery.md#reconciling-a-register-on-demand)) |

When the operator requires it, every register step also needs the appointee's
[verified identity](companies.md#representative-identity-requirement). Platform staff see imports,
openings, corrections and wallet links in admin as read-only history; particulars changes have no
admin page.

### Company evidence

Each change carries evidence the company provides, shown as "Provided by the company"
([company-provided evidence](README.md#how-a-company-decision-works)):

| Change                                       | Evidence                                                                                                                      |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Opening from the chain, correction, wallet link | An authority document: a director resolution naming the approving director, or a court order with its reference             |
| Import                                       | The company's confirmation that the records are its own; copies of its register and an ASIC extract are optional            |
| Particulars change                           | One supporting document, such as a deed poll or the member's notice of a new address, and a reason                           |
| Non-paid transfer                            | A director resolution and the signed transfer instrument                                                                     |

Uploads are PDF, PNG or JPEG files within the upload limit (10 MB by default). A later change to the
upload cannot change what was decided; if a retained copy no longer matches its record, the
proposal cannot be decided and a new one is needed. Evidence downloads are not logged.

## What the register records

### Register entries

Every change to a register is an entry. The first entry records the opening state, including an
explicitly empty register.

| Entry, as the app shows it   | What it does                                                                                                   |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Opening state                | Records the holdings when the register was opened                                                              |
| Issue                        | Adds a positive whole number of shares to one member                                                           |
| Transfer                     | Moves shares from one member to another; issued shares do not change                                           |
| Cessation                    | Removes a member's entire holding in this class; no current workflow records one                              |
| Compensating correction      | Reverses every change of one earlier entry exactly                                                             |
| Copied opening correction    | Records the exact difference when the company corrects the records it brought in at the opening               |

The rules every entry follows:

- Entries are never edited or deleted. A mistake is put right by a new entry, and the original stays
  with its evidence. Each entry is linked to the one before it, so altering history is detected when
  the register is verified
  ([how the entry chain is kept](../engineering/records.md#entries-and-the-hash-chain)).
- Shares are whole numbers, and no change can take a holding below zero.
- A transfer that empties a holding leaves a zero position. A cessation describes this class only,
  not the member's holdings in the company's other classes.
- Recording a cessation or a correction burns, seizes or transfers nothing on chain.
- Entries name members by member ID only. Names and residential addresses are kept as particulars,
  never inside an entry.
- An issue or transfer is dated the day it is recorded, in UTC. Dates the company supplies, such as
  a terms, agreement, signing or lodgement date, are kept beside it and never backdate it. The
  register never dates an entry before its latest one: while the latest entry is dated after today,
  as an opening dated on its chain block's date can be, the next issue or transfer waits.
- Sending the same request twice records it once; a changed request with the same identity is
  refused.

### Members, holder types and identity

A row on the register is a member with a positive holding. Its percentage is the holding divided by
the class's issued shares. A member can have no linked wallet or several.

| Holder type  | Meaning                                                                                                                 |
| ------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Member       | The member resolves to one person, through a verified identity, the identity recorded when shares were allotted, or recorded register particulars |
| Treasury     | The member is held at a labelled company treasury address, such as an employee share trust                               |
| Ambiguous    | The member's wallets point to more than one person; no name is shown and the Register says the identity needs review     |
| Unidentified | No wallet resolves to a person and no particulars are recorded; the Register suggests asking the participant to verify and nominate the wallet for company approval |

The register chooses a member's name and residential address in this order:

1. The live verified identity of the person behind the member's wallets, when it is present and
   unambiguous.
2. Otherwise, the latest identity recorded when shares were allotted to one of the member's wallets.
   Recorded identities that differ make the member Ambiguous, as differing live identities do.
3. Otherwise, the particulars recorded by an import or a particulars change, whichever has the later
   "as at" date (or was applied later, on a shared date). The identity source reads "Recorded
   register particulars".

Particulars never replace a live identity or hide an ambiguous one (owner decisions, 22 September
and 5 October 2026), so a later profile change reaches the register and a conflict stays visible.
Older issues with no recorded identity are not filled in by guessing.

A treasury label names an address, not a person, and carries no residential address. A member held
at a labelled treasury address takes its recorded particulars when it has them and stays typed
Treasury; without them the label names it with no address. A treasury address beside another
identity is Ambiguous. The CSV, inspection copies, certificates, notice figures, publication rolls
and former-member records all read a member the same way.

The shareholder table and its Details show names, holder types and holdings but no residential
address. Addresses appear in the downloaded CSV and the other register outputs, each of which is
recorded, and in the import, particulars-change, grant, transfer, allotment and award records that
carry them.

### Amount paid and date entered

Allotments give consideration, not membership. Amount paid is shown only where Ledova can establish
it exactly: for a holding that transfers have not touched and that still equals its paid allotments.
A transfer naming the member, or a recorded cessation of one of its wallets between its first
allotment and the opening, touches it; a transfer before the opening that emptied none of its
wallets and left its quantity unchanged cannot be seen. Unallotted applications, holdings without
allotments and quantity mismatches leave it blank. A pending refund never inflates it, zero never
stands in for an unknown amount, and non-paid terms establish none. An imported amount paid applies
while the holding is unchanged since the import. An external investor allotment adds its
consideration: a member the import carried shows the imported amount plus the consideration (blank
if the imported amount was blank), and a member the import did not carry shows the consideration.
This holds while only such allotments have changed the member's holding since the import; any other
later entry for the member, such as a non-paid grant or transfer, leaves it blank.

Date entered is the date the member went from no shares to some. The earliest completed allotment to
one of the member's wallets replaces it only when that allotment is earlier and the holding has been
continuous since; otherwise a member the opening carried in shows the opening's date. An applied
import's date entered replaces both rules for a continuing member the opening carried in, and later
issues and transfers leave it in place. A member who entered through a later entry keeps the date
the register gives. A recorded cessation counts in these rules once Ledova has read it from the
chain.

### Former members

On a register an import opened, when a member with no linked wallet falls to zero, the register
keeps a former-member record of their recorded particulars and the holding at that exit. A later
return keeps the same member ID and records the return date. Exit and return use the actual day of
the change, so a backdated correction cannot shorten retention or date a return before the exit,
and particulars edits and invitations do not reset the exit clock.

For a class on chain, Ledova instead reads the chain's transfer history every six hours and records
each wallet that ceases to hold. Particulars are frozen at the first recorded cessation, taken from
the person's current profile, else the identity recorded at allotment, else the member's recorded
particulars, else a name recorded at allotment; a labelled treasury address takes its recorded
particulars before its label. Reading the history again never rewrites them. Ledova sees wallets,
not members: emptying one linked wallet into another is left out of the former members when it falls
on or after the member's date entered, because the member held throughout. A cessation before that
date stays listed, because the member ceased and holds again, and section 169(3) keeps that
cessation on the register. Before the opening a wallet rotation cannot be told from a cessation, so
it stays listed. Former members are marked as needing a refresh when the history was last read more
than 24 hours ago.

Former members from before Ledova cannot be rebuilt from the chain; an import records them. They
must have ceased before the import's register date or the chain opening, and within the retention
period. They are listed beside the others with no wallet address and purged on the same clock from
the date they ceased.

Only the company owner, current register appointees and the operator read former members. They
appear in the CSV, with residential addresses, and under Former-member history on the Register.
Particulars are kept while a person is a member and then for at least seven years (2,557 days) after
they last held shares; the daily purge then removes them and they cannot be recreated
([retention](../engineering/security.md#retention-clocks)).

## Opening a register

### Bringing in existing records

An import mirrors the company's existing records for one share class. What it does depends on the
class:

- For a class with no register entries and no contract, the import becomes the opening: applying it
  creates the members, the Opening state entry and their particulars together.
- For a class already opened from the chain, the import adds members' particulars and former members
  from before Ledova, and its holdings must match the stored register.

Shareholders need no account or wallet. To set up a register on the web:

1. Choose Set up your share register on the Dashboard (shown while no register exists), or open a
   class's Register mirror section on Register (under Other changes and register history) and choose
   Bring records.
2. Share details: select an existing draft class, a common class (Ordinary ORD, Preference PRF or
   Redeemable RED), or Another class to copy the company's own name, code and type. The choice must
   match the company's records. Codes are one to five letters, such as A, B or ORD, unique within
   the company. Only the company owner creates a class here, and doing so creates no shares and no
   legal registration. Classes set up this way carry a technical share limit rather than asking for
   authorised capital. Repeat setup for each class.
3. Shareholders: add and edit one shareholder at a time. Choose an existing company shareholder
   record or explicitly create a new one; names alone never link records, and existing names and
   addresses are kept. For each shareholder give the name, residential address, original date
   entered and whole-share holding, and each allotment with its date, quantity, total paid and
   unpaid amounts and Held for someone else? (Yes means held non-beneficially). Share and
   certificate references are optional. Allotment quantities must add up to the holding, a fully
   paid allotment must have nothing unpaid, and a blank amount stays unknown rather than becoming
   zero. Membership dates and quantities come from this class's records, not another class's
   holding. Former shareholders can be added.
4. Review: check the copied shares, shareholders and record date in one table, with each person's
   particulars under Details. Holdings are checked against allotments before confirmation. Confirm
   loads a fresh preview and records the approval and application together; someone whose
   appointment allows only review records the approval and leaves application to another appointee.

Completion returns to the ownership Dashboard; inviting members is optional later work
([member access](member-records.md#member-access)). Unsaved shareholder
edits stay on the device. A failed or uncertain response keeps the original request: return to setup
and use Recover saved records or Recover confirmation. Another appointee can resume review or
confirmation without preparation access. Editing a saved preparation first retires it through Edit
records, which needs preparation and rejection authority.

The web setup has no source-reference field: new imports are attributed to "Company-provided share
records", and the retained snapshot names the company, record date and the person who prepared it.
The mobile app keeps separate preparation and decision screens, and its preparation asks for the
existing register or source reference; its decisions are Review and Confirm mirror. Confirming is
the company's confirmation of its own records, not a new director resolution and not a Ledova
verification. Stated ASIC totals are an optional cross-check, and an extract may list only some
shareholders. The Import button beside Continue is inactive and marked Coming soon: future document
extraction will fill these same forms for review. Supporting copies are kept as evidence without
being read. Earlier imports keep their original evidence and authority, and fields an earlier
snapshot did not record stay unknown rather than being invented.

An import is refused when the class already has an applied import; when an issue was approved or an
instruction applied for the class, so the import can no longer open it (open it from the chain, then
import its particulars); when its holdings differ from the stored register of a class opened from
the chain; when a former member ceased on or after the opening, or before the retention period; and
while a deployment of the class is pending.

### Correcting the copied opening

Choose Correct copied opening on the class's Register mirror section to correct the latest applied
import. The correction gives the complete replacement shareholder rows, a current source and a
reason, and its preview compares the imported and stored ownership. Applying it keeps the earlier
snapshot, decisions and opening entry, adds a Copied opening correction entry for the exact
difference and records the new particulars. It is refused once the class has later share activity, a
deployment, or member-access or particulars activity; the company then resolves its records and uses
the supported workflow for the change. The correction uses the same forms and keeps each
shareholder's member ID. One that changes only copied particulars adds no entry and is kept in its
snapshot and decisions. It changes nothing on chain or in the company's legal records, and it is
separate from compensating corrections.

### Opening from the chain

A class that is deployed or paused, and whose register has no entry, is opened from the chain. An
opening maps each wallet holding shares at one chain block, its boundary, to a company member. It
takes no typed quantities or dates and stores no particulars; a later import adds them.

1. On the class's Openings section, choose Open this register. The page reads the holdings on chain,
   largest first. A chain that cannot be read says so; try again later.
2. Assign each address to a member. An address already linked keeps its member; every other address
   goes to an existing member or to a new member, and several addresses can share one member.
3. Upload the authority document, choose the authority (Director resolution, with the approving
   director, or Court order), and give the reference and reason. Choose Prepare opening, which
   captures the boundary.
4. Approve, then Apply. Both read the chain again.

Applying records the members, their wallet links and the Opening state entry, dated on the boundary
block's date; a boundary with no holdings records an explicitly empty register. Nothing changes on
chain. Until an opening is applied, the register reads as not opened.

The mapping must cover exactly the addresses holding at the boundary: if holdings moved, reload them
and map again, keeping the choices that still apply. The holdings are read again only on request or
after a conflict, and Prepare waits while they or the appointments are read again; a choice resets,
with a notice, only when its address no longer holds or its member is no longer offered. One
address belongs to one member in a company, and an existing link must agree with the mapping. An
opening is refused if a completed issue or transfer is not represented at its boundary. If the
chain no longer confirms the boundary, or a mapped wallet has since been linked elsewhere, reject
the opening and prepare a new one.

## Changing the register after the opening

### Compensating corrections

A correction reverses one identified entry exactly. The original entry stays, the new entry names
it, and an entry can be corrected only once (a correction can itself be corrected). Partial
corrections and replacement transactions are not built.

1. In the class's Register entries, choose Correct this entry. The page shows the entry beside the
   exact inverse a correction records.
2. Upload the authority document and give the authority, approving director, reference, reason and
   an effective date of today (UTC) or earlier. A later date is refused because it would hold back
   later issues and transfers.
3. Approve, then Apply.

A correction is refused for an entry with no changes, an entry already corrected, and an inverse
that would take a holding below zero. If the register has a newer entry than the one the correction
was prepared against, reject it and prepare a new one. Applying a correction changes the stored
holdings but nothing on chain, so the next reconciliation of a class on chain reports member and
supply differences, which the company
[acknowledges](#acknowledging-a-discrepancy).

### Changing a member's particulars

A company keeps its members' names and residential addresses up to date itself. Members edit their
own profile and ask the company for changes separately
([member profile](participants.md#member-profile),
[member requests](member-records.md#member-requests)).

1. Open the member's Details on the Register and choose Change particulars.
2. Upload a supporting document and give the new name and residential address, the "as at" date the
   company's register records the change (today in UTC or earlier) and a reason.
3. Approve, then Apply. The preview shows the change beside the current particulars, their date and
   source.

The latest "as at" date wins between imports and changes, and a live verified identity still wins
over both. A change dated before the member's current particulars is refused, and one becomes
unusable if later particulars are recorded in the meantime. A change is also refused for a member
who has held no shares in the company for the retention period, because the register no longer keeps
their particulars. Names are limited to 255 characters, and addresses and reasons to 1,000.

### Linking wallets to members

After a class is opened, an issue or transfer that completes to a wallet no member owns waits rather
than creating a member, and members are never merged by matching names (owner decision, 21 September
2026). A wallet link records which member owns such a wallet: a new subscriber's, a first-time
buyer's, or another wallet of an existing member. A
[chain grant](issuing-shares.md#non-paid-chain-grants) links its nominated wallet
the same way before any shares are minted.

1. When a wallet waits, choose Link waiting wallets. Only waiting wallets are listed, each with the
   number of issues or transfers waiting for it.
2. Each wallet starts as its own new member. Choose the member who owns it, an existing member or a
   new one; choose the same member for wallets that belong to one person. For a wallet on the
   company's whitelist, the page also shows whether its holder proved control on Ledova and the
   holder's name, for information only: a link needs neither, and the company chooses each member.
   A choice resets, with a notice, only when its wallet no longer waits or its member is no longer
   offered.
3. Upload the authority document and give the authority, approving director, reference and reason,
   then Approve and Apply.

Links are company-wide: one link serves every class, and a company needs no opened register to link
a wallet. An address linked once is never linked again; if it was linked to another member in the
meantime, reject the link and prepare a new one. Applying records the new members and links, then
records the issues and transfers that were waiting for them, each dated the day it is recorded. A
link makes no register entry of its own, changes no whitelist approval and proves no possession;
deleting the wallet later does not unlink it.

### Non-paid transfers between members

A company can record a genuine non-paid transfer between members of an imported register whose class
has no contract. Both members must have no linked wallet anywhere in the company. The transfer
creates no wallet, account, payment, application or chain transaction.

1. Choose Prepare a non-paid transfer in the class's Non-paid transfers section.
2. Choose the transferor, the recipient and the shares to transfer. An existing recipient keeps
   their member ID, including a former member returning from zero; a new recipient gets a new member
   ID with the name and residential address the instrument gives. Where a returning member's
   particulars were lawfully purged, the company supplies new ones for the same ID.
3. Give the dates the instrument was signed and lodged with the company, the non-paid terms, the
   approving director, the company authority reference and the reason, and upload the authority
   document and the signed transfer instrument.
4. Approve the preview, which shows both parties, the terms, the documents and dates, each holding
   before and after, and unchanged issued shares. Then Apply.

The transferor must hold enough shares. The approving director cannot be either party
([named directors](README.md#how-a-company-decision-works)). Applying records
one Transfer entry on the actual day, in UTC, with the applier as its recorder; the signing and
lodgement dates stay separate, and the certificate falls due one calendar month after lodgement
([certificates](member-records.md#certificates)). A holding that becomes zero creates
the former-member record described above. Non-paid terms establish no amount paid. Court-directed,
paid and chain transfers are not built; court-backed corrections stay available through
[corrections](#compensating-corrections). An imported register accepts no
Cessation entry, and a correction there goes through the company's correction decision like any
other.

## Completed chain effects and waiting entries

### Recording completed issues and transfers

Once a class on chain has an applied opening, each issue that completes on chain and each settled
market transfer is recorded as an entry in chain order, dated the day it is recorded. An issue is
recorded in the name of the appointee who applied the grant or paid issue, or of the original staff
reviewer under a
[retained instruction](issuing-shares.md#retained-issue-instructions). A settled
transfer is recorded in the name of the transferor, whose signed order is the instrument, once an
applied [instruction](#settled-transfer-instructions) lists it. An effect
the opening already holds records nothing, and so does a settlement between two wallets of one
member.

Recording stops at the first effect it cannot record and records nothing after it, so the register
never skips ahead of the chain. The issue or settlement itself still completes. Recording resumes at
the next completion in the class, the next applied wallet link or the next applied instruction. The
Register states how many completed issues or transfers wait, and says when that cannot be checked; a
waiting effect is in no holding until it is recorded.

### Why a completed effect waits

The waiting list, which register readers read through Ledova's API, gives each waiting effect with
its wallets, shares and reason, in the order recording takes them; the first one is where recording
stopped. The Register itself shows the count.

| Reason       | Why it waits                                                                     | What resolves it                                                                    |
| ------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Attribution  | The opening's boundary cannot place the completion                               | An attribution procedure, not yet built                                             |
| Unlinked     | A wallet it names is linked to no member                                         | A [wallet link](#linking-wallets-to-members)              |
| Unreviewed   | An older issue records no approving reviewer, as when that account was deleted   | Nothing yet: Ledova does not invent a recorder                                      |
| Uninstructed | No applied instruction covers the issue or transfer                               | An [issue instruction](issuing-shares.md#retained-issue-instructions) or a [transfer instruction](#settled-transfer-instructions) |
| Refused      | The register refused the entry, for example because the seller's holding no longer covers the transfer or the latest entry is dated after today | The underlying cause; recording tries again at its next run |
| Behind       | An earlier effect in the class waits                                             | Resolving the earlier effect                                                        |

A count that cannot be computed shows as unknown. A class opened by an import has no chain boundary:
the CSV says "not on chain", and nothing on chain is recorded into it.

### Settled-transfer instructions

Directors decide whether to register a settled market transfer after it completes, while its entry
waits (owner decision, 22 September 2026). The order both parties signed, which the settlement
keeps, is the instrument of transfer; whether it is a proper instrument under section 1071B is left
open. Until [#869](https://github.com/Ledova/ledova/issues/869) these instructions keep a staff
review:

1. A settlement is visible only to its two parties, so the company owner takes each one from the
   waiting list: its settlement, the seller's then the buyer's wallet, and the shares.
2. The company owner submits an instruction listing the exact settlements a named director approved,
   with the authority reference, a reason and a company document that platform staff have
   [verified](companies.md#staff-verification-of-a-company-document). Ledova keeps
   a private copy of it. Neither app has a form for this; it is submitted through Ledova's API
   ([retained instructions API](../engineering/records.md#retained-register-instructions-api)).
3. Platform staff open the instruction under Register instructions in admin, inspect the retained
   document, the named director, the reference and the company, and check each settlement's wallets,
   the member each is linked to and the name it identifies, the shares, the class and the completion
   time. They confirm within 15 minutes and choose Approve and apply, or reject with a reason.

Each settlement must be a completed settlement of the class with exactly its seller, buyer and
shares, not already covered or entered. Submission, review and application refuse a director who is
either party, judged by the name on the account holding that wallet, and any instruction for a class
an import opened. Applying records whatever waited for the instruction, in chain order, each
transfer in the transferor's name. Instructions are kept unchanged and cannot be deleted.

A transfer the directors decline is not modelled yet: the owner submits no instruction, and the
settlement keeps waiting as uninstructed, holding later issues and transfers of the class behind it.

## Reconciliation with the chain

Every six hours Ledova compares the stored register of each class with an applied chain opening
against the chain at its finality boundary; a class an import opened is not on chain and is not
reconciled. Every chain transfer after the opening must be a recorded effect, a waiting effect or a
platform operation still executing; every completed effect must be on chain in its block; each
member's linked wallets must hold their stored shares plus pending movements; and the issued supply
must equal the stored supply plus pending issues. A transfer of zero shares is ignored, because
anyone can send one.

Each run is kept as Matched, Discrepant or Failed, with the block and register entry compared. A
chain that cannot be read fails the reconciliation, never the register, and reconciliation never
writes a register entry. The company cannot start a run; it reads the latest on the Register, and
the CSV summary states it. The register cannot follow a divergence it did not cause: no entry
records an outside transfer, and a correction only reverses an existing entry.

### What each discrepancy means

| Discrepancy            | Meaning                                                                                                     | Next step                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Unrecognised transfer  | A chain transfer after the opening that nothing on the platform accounts for, such as a direct transfer between whitelisted wallets | Investigate; if the company accepts it, acknowledge it and the rows it causes; otherwise dispute it with the parties |
| Missing transfer       | A completed effect whose transaction is not on chain in its block                                           | Treat it as a reorganisation and do not rely on the register until it is attributed; it cannot be acknowledged |
| Member                 | A member's linked wallets hold a different number of shares from the register plus pending movements        | Acknowledge once the cause is understood                                                          |
| Unlinked               | An address linked to no member holds a different number of shares from what pending movements give it      | Acknowledge once the cause is understood                                                          |
| Supply                 | The issued supply on chain differs from the stored supply plus pending issues                              | Acknowledge once the cause is understood                                                          |
| Attribution            | A completion the evidence cannot place against the opening                                                  | Cannot be acknowledged; attribution is not built                                                  |

Member, unlinked and supply rows accompany one of the others, or follow an applied correction, which
changes the register and not the chain.

### Acknowledging a discrepancy

Once the company has investigated a discrepancy and accepted it, a person whose appointment holds
administration or approve chooses Acknowledge on that row of the class's latest reconciliation and
gives a reason of up to 1,000 characters. There is no staff step and no second person.

- Only the latest reconciliation can be acknowledged; for an older one, wait for the next run.
- Attribution and missing-transfer rows cannot be acknowledged, and a row is acknowledged once.
- Later runs treat the row as explained: an acknowledged unrecognised transfer is not reported again
  for that transaction, and an acknowledged member, unlinked or supply difference is added to what
  is expected, so a further change shows as a new difference. Once every row is acknowledged, the
  next run is Matched.
- An acknowledgement records nothing in the register, whose holdings stay as recorded.

Each acknowledgement is kept with the reconciliation, the exact row, the reason, the person, their
appointment and the time, and the [company pack](member-records.md#the-company-pack) lists it.
Acknowledgements made before 5 October 2026 show as given by Ledova staff.

## The Register page

Register is the company's register workspace. On the web it is open to every signed-in account and
shows the registers of companies the person owns or where their appointment includes register
access; otherwise it says there is no company register to show. In the mobile app it is the landing
page for a company account with register access. Where the person can read more than one company, a
company selector chooses one. The web sidebar's Register, Employee awards and Documents items, and
Member access (reached from Settings or the Register), are views of the same page, so switching
between them keeps unfinished forms and their recovery
([the app at a glance](README.md#the-app-at-a-glance)).

The Register view shows:

- A card for each class: Issued shares, Current shareholders, Register opened or Register not
  opened, Authorised shares (or, for a class set up from existing records, a Technical share limit),
  a note when completed issues or transfers wait or cannot be checked, and Former-member history.
- Shareholders: one row per shareholder across classes, with a name search, a Share class filter and
  ten rows per page. Each class column gives the shares and the percentage of that class's issued
  shares; a row whose identity needs review says so. Details shows, per class, Shares held, % of
  class, Date added, Holder type and optional wallet links, with Change particulars for a person who
  may prepare.
- Member access, Particulars and wallet links (Particulars changes and Wallet links), and Register
  guidance.
- Register tasks, one disclosure per class: External investor allotments, then Other changes and
  register history with the class's Share class page, Openings (for a class on chain), Register
  mirror, Non-paid transfers, Corrections with the Register entries (newest first, with Load more
  register entries, Correct this entry and Prepare unsigned certificate), and Reconciliation with
  the chain.

The Employee awards view holds each class's
[awards](issuing-shares.md#employee-awards-and-vesting) and Non-paid share issues.
The Documents view holds each class's CSV download and inspection copy and the company pack, and
Member access holds invitations and requests ([member records](member-records.md)).

A read that fails or is incomplete withholds the table and offers Try again rather than implying
missing holdings are zero, and a failed read hides private details and actions while keeping
unfinished requests. Each proposal shows its stage (Prepared, Approved, Applied or Rejected; an
import shows Reviewed and Confirmed), preparer, dates, terms, authority, decision trail, any
rejection reason and its document, and whether the company provided the evidence or, before the work
became company-run, was "Verified by Ledova staff". A reconciliation shows its status, block,
compared entry, time, any failure and each discrepancy in words with its acknowledgement. Each
preparation opens a page of its own and shows the server's words on a refusal. A form that uploads a
document keeps its upload if the response is interrupted.

The person's own current appointments decide which steps are offered
([how a company decision works](README.md#how-a-company-decision-works)); someone with none of them
sees the history with a read-only note. A rejection takes a reason of up to 1,000 characters. The
mobile app keeps its own per-class ownership view and separate preparation and decision screens,
holds member access under Company, and hides every register action while it cannot read the
person's appointments ([frontend](../engineering/frontend.md#page-mechanics)).

### The Share class page

Share class, reached from a class's register history, shows the class's state, issued shares and
register members, and the history and actions of its company-authorised deployment, chain grants,
paid issues, capital increases and pause changes
([share classes](issuing-shares.md#share-classes)). Share quantities are whole
numbers, and a quantity or resulting total above 2,147,483,647 is refused rather than rounded.

## Limits and work not built

- The register is the company's ownership mirror, not its statutory register or historical archive.
- Ledova runs on synthetic data only. Production retention of evidence, and how a mistaken opening
  import is undone beyond the bounded correction, are decided before real data is admitted.

Work not built is marked in each section.

Next: [share classes and issuing shares](issuing-shares.md),
[member records and register outputs](member-records.md),
[register engineering](../engineering/records.md) and
[legal positions](../legal/positions.md).
