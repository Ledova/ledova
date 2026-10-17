# Member records and register outputs

[Business processes](README.md) · [Documentation](../README.md)

How members reach their own records, and how a company obtains copies of its register: inspection
copies, certificates, notice figures and the company pack. It is for company representatives,
support and platform staff, and engineers learning the domain, and it includes the staff procedures
done on a company's written instruction. The file formats are in
[output formats](../engineering/records.md#output-formats), and how each output is recorded is in
[export records](../engineering/records.md#export-records).

Contents:

- [Outputs at a glance](#outputs-at-a-glance)
- [Member access](#member-access)
- [Member requests](#member-requests)
- [Inspection copies](#inspection-copies)
- [Certificates](#certificates)
- [Notice figures](#notice-figures)
- [The due list](#the-due-list)
- [The company pack](#the-company-pack)
- [The Wallet shares page](#the-wallet-shares-page)

## Outputs at a glance

Ledova prepares records from the stored register; the company decides whether a request is proper,
executes what needs signing, delivers it and lodges its own notices. Preparing an output creates no
signature, issue, payment or filing, and the company's own legal register stays its source
([what Ledova does and what stays with the company](README.md)). The statutory
limits below are the company's obligations, listed with their sources in
[legal position 6](../legal/positions.md#6-where-and-in-what-form-the-register-is-kept).

A register reader, in this page, is a person with a current appointment for the exact company
holding company administration or any register capability (read, prepare, approve or apply).
Owning the company, holding its shares, member access and platform staff permissions give no
output authority, except where the table says the company owner may read the register.

| Output                | Who prepares it                                          | Where                                          | Company's limit                                                | What Ledova keeps                                               |
| --------------------- | -------------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- |
| Register CSV          | The company owner or a register reader                   | **Register**, **Documents**: **Download CSV**  | None                                                           | Who took it, the class, the register entry it runs to, row counts |
| Inspection copy       | A register reader                                        | **Register**, **Documents**: **Inspection copy** | 7 days after a proper request (s173(3))                      | Its SHA-256, the instruction, request date, recipient and late flag |
| Certificate           | A register reader                                        | A class's register history (web), **Documents** (mobile) | 2 months after an issue, 1 month after a transfer is lodged (s1071H) | Its SHA-256 and the instruction                       |
| Member's certificate  | A register reader, on the member's request               | **Member access and requests**                 | As for a certificate                                           | The recipient-only PDF itself, and a certificate record        |
| Notice figures        | Platform staff, on the company's written instruction     | Admin, **Register outputs**                    | 28 days (s254X; s178A, s178C and s178D)                        | Their SHA-256, the period and the instruction                   |
| Core company pack     | A company administrator                                  | **Register**, **Documents**: **Company pack**  | None                                                           | The SHA-256 of its manifest, the instruction and recipient, per class |
| Broader company pack  | Platform staff, on the company's written instruction     | Admin, **Company packs**                       | None                                                           | As for a core pack                                              |

Staff procedures on a company's written instruction:
[preparing notice figures](#preparing-notice-figures),
[working the due list](#working-the-due-list) and
[producing the broader pack](#producing-the-broader-pack-in-admin).

Ledova keeps a fingerprint, not the file, except for a member's certificate, which the member
downloads later. Records of outputs cannot be rewritten, are read only by platform staff and are
kept for the register's seven-year floor (2,557 days) before the daily purge
([retention](../engineering/security.md#retention-clocks)). A refused or failed output records
nothing. Each output reads one consistent moment of the register, so nothing recorded while it is
prepared can make its parts disagree. Ledova prepares the certificate unsigned and the company
executes it; the [decision](../decisions.md#the-stored-register) records why outputs work this
way.

## Member access

Member access links one signed-in account to one member of one company's register, so the person
can read their own records without a wallet. The company invites one exact member, and the
recipient accepts with their own account. Member access gives no company appointment, holding,
wallet link or investment eligibility
([decision](../decisions.md#member-invitations-and-account-association)).

### Inviting a member

1. A company administrator opens **Member access and requests**: on web, **Settings**, **Member
   access** (or the **Member access** link in **Register**); on mobile, **Company**.
2. Under **Invite a member**, they choose a named member or award recipient, enter the intended
   recipient's email and choose **Create member invitation**. An award recipient can be invited
   before any shares are issued, and sees their own award.
3. Ledova shows a one-time member invitation code. The company gives it to the recipient privately;
   Ledova sends no email.

The invitation keeps the company's member identity and the administrator's authority. It expires
at the displayed deadline, 7 days by default and never more than 30. Retrying a recorded invitation
returns its record without showing the code again.

### Accepting an invitation

The recipient signs in, enters the code under **Get access to your shares** on **Dashboard** (web)
or **My shares** (mobile), confirms they accept access with their signed-in account and chooses
**Accept member invitation**. Their verified email must match the invitation. Acceptance binds one
current account to one member in that company. An expired invitation, a changed recorded identity,
a revoked administrator appointment, another person's account or a conflicting association is
refused.

### What a member can read

An accepted member reads their own company-recorded particulars, share-class balances, the entries
that changed their holding, and their employee-award terms with recorded vesting and separately
issued quantities. Company totals, other members, private company decisions, financial documents
and other members' parts of an entry are never shown. An award is an entitlement, not a holding,
and no wallet or company approval is needed for these records. Editing the personal Profile does
not change the company's register; a change reaches it only through a
[particulars request](#particulars-requests).

**Dashboard** is the web personal home and **My shares** the native one. Both show the person's
issued shares by class, separate from award entitlements, with a status bar splitting each award
into unvested, vested but unissued, and issued quantities; issued award shares already belong to
the holding. They also show available certificates, recent own changes and request status.
**Documents** (web) focuses on the person's certificates and certificate requests. Particulars and
longer history stay reachable; wallet holdings are on
[the Wallet shares page](#the-wallet-shares-page).

### Revoking member access

A company administrator can revoke access under **Current member access**, giving a reason that
is recorded against them. A new invitation is needed to link the member again. After revocation
the person's own-record access, file access and new requests stop; the original requester can
still read the status of requests they made.

Every action rechecks the person's account, session, association and the company's authority. A
failed refresh hides cached private records. If a reply is uncertain, keep the original request
and retry it before starting another
([uncertain outcomes](README.md#how-a-company-decision-works)).

## Member requests

### Particulars requests

A member with an issued holding can ask the company to change their recorded name and residential
address: **Request a particulars update** on **Dashboard** (**Request a particulars change** on
**My shares**), then confirm and choose **Send particulars request**. Sending changes no
particulars or holding. Award-only recipients cannot send one until they hold issued shares.

The company sees the request under **Particulars requests**, which needs a current personal
appointment. A preparer adds supporting evidence, a reason and an as-at date and records it as an
ordinary [particulars change](register.md#changing-a-members-particulars);
approval and application stay separate company decisions. The request keeps the exact particulars
the member asked for, and its status follows the change: prepared, approved, applied or rejected.
A revoked association or a changed source record blocks a new change or its application.

### Certificate requests

A member can request a certificate for an issue or transfer that gave them shares and that no
correction has reversed (**Request certificate for entry** in their share history), and can
withdraw the request (**Withdraw certificate request**) until it is fulfilled. The company fulfils
it as described under
[fulfilling a member's certificate request](#fulfilling-a-members-certificate-request).
The request reads **fulfilled** only once a real file exists. The member then downloads or shares
it (**Download unsigned certificate** on web, **Share unsigned certificate** on mobile) through
their current access, and Ledova checks the file
against its recorded size and digest. There is no automatic signing and no claim of legal
recognition.

## Inspection copies

Anyone may ask a company for a copy of its register, and the company must provide it within 7
days of a proper request (s173(3)). A register reader prepares the copy in **Register**; the
company decides whether the request is proper and how to deliver the copy. Generation supplies no
signature, legal determination or delivery receipt, and platform staff cannot generate one.

The copy is the register CSV, with current members, the supply summary and former members, plus a
section giving the request date, the instruction's reference, the recipient, the date the copy was
produced and whether that is more than 7 days after the request. Days are counted in Sydney's
calendar. No state or territory capital's date is ever ahead of Sydney's, so for a company
elsewhere the late flag can only err towards late, and a request dated that company's today is
never refused as a future date. The flag counts calendar days and does not extend a limit that ends
on a weekend or public holiday, which also errs towards late.

### Preparing an inspection copy

1. Keep the company's written instruction, and note its reference, the date the request was made
   and who the copy is for.
2. In **Register**, open **Documents**, select the company and open the share class. Enter the
   reference, recipient and request date under **Inspection copy** (on mobile, choose **Prepare
   inspection copy**).
3. Choose **Preview inspection copy**, check the request and register sequence, then **Confirm and
   download inspection copy** (web) or **Confirm and share inspection copy** (mobile).

The web download is named `register-<symbol>-inspection-copy.csv`; mobile shares
`inspection-<class id>.csv`. A register with no opening, a request date after today and a blank
field are refused. The preview is bound to the person's appointment and the register as it stood:
if the register changes or the appointment ends, confirmation is refused and the person previews
again. Editing, closing, changing account or class, and refreshing the register retire a prepared
request, and a failed preview delivers no file.

## Certificates

A company must have a certificate ready within 2 months after an issue and within 1 month after a
transfer is lodged (s1071H). A register reader prepares it in **Register** on the company's written
instruction. Ledova prepares it unsigned and the company executes and delivers it (owner decision,
22 September 2026). Platform staff no longer prepare certificates.

### What a certificate shows

Only an issue or a transfer has a certificate. The PDF has a page for the member the entry moved
shares to (the allottee of an issue or the transferee of a transfer) and, for a transfer, a balance
certificate for the transferor when they still hold shares afterwards. Pages are numbered from the
entry, the moved shares first (12-1, 12-2), so no separate counter is kept. Each page shows the
company and its ACN, the share class, the member's name and residential address, the shares it
certifies, the member's holding in the class after the entry, and the entry's number, date and
fingerprint, then an unsigned execution block.

The holdings are those immediately after the certified entry, so a later entry does not change
them. Names and addresses are the ones the register gives when the certificate is prepared, not
the ones current when the entry was made. Preparing the same entry again gives the same file while
the register and the particulars stay the same.

The whole certificate is refused when a member's wallets resolve to different people, a member has
no name or residential address on record, the entry is not an issue or transfer, the class's
register has no such entry, or a correction has since reversed the entry (the refusal names the
correction, so a certificate never certifies shares the register has taken back).

### Preparing a certificate in the Register

1. Keep the company's written instruction and note its reference.
2. On web, open the share class in **Register**, then **Other changes and register history**, and
   choose **Prepare unsigned certificate** on an issue or transfer. On mobile, open the class's
   entries in **Documents**.
3. Enter the reference and choose **Preview unsigned certificate**. Check the entry, register
   sequence and page count, then choose **Confirm and download unsigned PDF** (web) or **Confirm
   and share unsigned certificate** (mobile).

A change to the register after the preview invalidates it, and the appointment is checked again
before the file's fingerprint is recorded.

### Fulfilling a member's certificate request

1. In **Member access and requests**, under **Certificate requests**, choose **Preview certificate
   for** the member, entering the company's written instruction reference.
2. Check the preview, then choose **Confirm recipient certificate fulfilment**.

This creates one recipient-only PDF of a single page, which cannot be changed, with its request,
producer, appointment, instruction and fingerprint, and records it as a certificate for the entry.
Only the requesting member's page is produced, and another member's particulars are never read for
it. Company readers can download it too. A
fulfilled request cannot be withdrawn.

## Notice figures

A company notifies ASIC of a share issue within 28 days (s254X), and a proprietary company notifies
changes to its members and share structure with that notice or otherwise within 28 days (s178A,
s178C and s178D). Platform staff prepare the figures for those notices in admin, only on the
company's written instruction. The company, or the accountant who lodges its notices, decides
which notices the figures support and lodges them: Ledova prepares figures, not a notice, and names
no ASIC form (owner decision, 22 September 2026). Moving notice figures to company appointments is
not built.

### What the figures contain

The figures cover every issue, transfer and correction entered on or after the first day of the
period the company asks for, up to the register's latest entry. The CSV lists:

1. What the figures are for, the share class, the first day of the period, the register entry they
   run to, the instruction's reference and the day they were produced.
2. Each entry in the period, one row for each member it changed, with the signed change in shares
   and, for an issue, the amount paid.
3. The class at the latest entry: issued shares, the number of members holding shares and the
   total amount paid.
4. Each member those entries changed, at the latest entry: name, residential address, shares held
   (0 for one who no longer holds any) and amount paid.

The opening is never listed. Amount paid reads `not recorded` where Ledova cannot establish it
exactly, as for shares received by transfer, and never reads zero for an unknown amount; the class
total reads `not recorded` unless every current member's amount is established. A transfer or
correction carries no amount paid. Names and addresses are the ones the register gives when the
figures are prepared; an unidentified or ambiguous member is printed as the register prints them
rather than refused. A period with no entries is not refused: it lists none. Column details are in
[notice figures format](../engineering/records.md#notice-figures-format).

### Preparing notice figures

You need **Can change register outputs**, and the share class needs an applied opening.

1. Keep the company's written instruction, and note its reference and the first day of the period
   it asks for. An entry is dated the UTC day it was made, which on a Sydney morning is the day
   before, so start the period no later than the date of the first entry the company has not yet
   notified; [the due list](#the-due-list) shows every entry no
   figures cover yet.
2. In **Admin → Tokens → Register outputs**, find the share class and choose **Prepare notice
   figures**.
3. Enter the first day of the period and the instruction's reference, then choose **Prepare and
   download**.

The download is named `notice-figures-SYMBOL-DATE-to-N.csv`, for the figures from DATE to register
entry N. Check the figures against the instruction and give the file to the company unchanged. The
page refuses, and records nothing, when the class has no applied opening, the first day is after
today in Sydney's calendar or a field is blank. Each preparation is recorded once in **Admin →
Tokens → Register exports** as kind **Notice figures**, with the period, the instruction and the
file's SHA-256, which you can confirm with `sha256sum` on the downloaded file.

## The due list

The **Register outputs due** page in admin shows platform staff every certificate and set of notice
figures still due across all companies and share classes, earliest due first, then by company,
class and entry number. Each company pack carries its own company's rows.

- **Certificates.** Each issue or transfer entry that no correction has reversed is listed until a
  certificate is recorded for its number. An issue's certificate is due two calendar months after
  its effective date. A transfer's is due one calendar month after its lodgement date for a
  transfer the company recorded, or after its settlement order was created (by Sydney's date) for a
  settled market transfer; that order precedes the transfer's lodgement, so the date errs early.
- **Notice figures.** Each issue entry, and each transfer entry of a proprietary company, that no
  correction has reversed is listed until notice figures cover it: figures whose period starts on
  or before the entry's effective date and that run to the entry's number or later. They are due
  28 days after the effective date.

A calendar month ends on the same day number, or on the month's last day when that month is
shorter, so 31 January plus one month is 28 or 29 February. An item is overdue once its due date
is before today in Sydney's calendar. Openings and corrections are never listed.

The list stores and records nothing, and knows what Ledova prepared, not what the company lodged or
delivered. An output the company produced elsewhere, or a certificate it does not need, stays
listed, and an entry whose output record the daily purge removed after the 2,557-day floor is listed
again.

### Working the due list

You need **Can change register outputs**.

1. In **Admin → Tokens → Register outputs**, choose **Register outputs due**.
2. Read each row: the company, share class, entry number, kind and effective date, what is due,
   the due date and whether it is overdue.
3. Tell the company what is due and when. The obligations are the company's, and the company lodges
   its notices and delivers its certificates.
4. For notice figures, on the company's written instruction, follow the row's link and
   [prepare the notice figures](#preparing-notice-figures). A
   certificate row has no link and reads **Certificate (company register)**: the company prepares
   it in its own Register.

## The company pack

The company pack is the one archive in which a company's records leave Ledova: for the company's
own administration, for a provider that takes over its register, or in answer to a lawful
information request ([product §6](../product.md#6-privacy-and-portability)). The owner chose
one archive rather than separate data, evidence and portability exports
([decision](../decisions.md#the-company-pack)). Its figures and chain evidence are records with
stated limits, not proof of a bank payment, current contract ownership or a lodged ASIC filing.

### What the pack carries

- The company, its business-register checks and its documents, with the evidence copy each
  register change relied on when it was submitted.
- Every share class with its register: the register CSV, every entry with the fingerprints that
  chain it, former members with the date s169(3) keeps each until, reconciliations with the chain
  and their acknowledgements, completed effects still waiting to be recorded, and the certificates
  and notice figures still due.
- The company's decision records: appointments, openings, imports, corrections, wallet links,
  particulars changes, grants, transfers, employee awards and vesting, external agreements,
  contributions and allotments, register instructions, deployments, capital increases, pause
  changes, and wallet nominations and instructions, each with who prepared and decided it under
  which appointment, its decisions and, where Ledova retained one, its supporting file
  ([which records carry files](../engineering/records.md#company-decision-records)). Capital
  increases, pause changes and the terms of a chain grant name a file the pack does not carry;
  deployments and wallet nominations and instructions have none.
- Issues, and subscriptions with a recorded payment still to be allotted or refunded. Payment is
  labelled as recorded by staff, not proved: the company inherits an obligation to allot or refund.
- Wallet approvals, the transactions Ledova sent for the company and the settlements it executed.
- What the company published to its members, with each resolution's result, each dividend's payment
  records and read counts.
- The contract information a successor needs, and a README that explains the files, how to check
  them and how control of the contracts would be handed over. The pack explains the handover and
  does not perform it; the handover itself is not built.

The README ends with the owner's statement: "The company, and a provider it names in writing, may
use the records and the contract interface files in this pack to operate and move the company's
own register and contracts." The file layout is in
[company pack format](../engineering/records.md#archive-and-manifest).

### What never leaves, and why

Of a member, only what the register holds leaves: name, residential address, holding, linked wallets
and identity source.

| Excluded                                                                                                        | Why                                                                                                        |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Members' email, phone, date of birth, citizenship, financial profile, account numbers and platform account ids  | What members gave Ledova, not the register's particulars ([position 10](../legal/positions.md#10-privacy)) |
| Identity checks, classification claims and evidence, payslips and their extractions                             | The person's records with Ledova, which the company never reads and which run on their own retention clock |
| A ballot's member and choice, and who opened which publication                                                  | The company sees resolution tallies and read counts only                                                   |
| Unmatched orders                                                                                                | Investors' private orders                                                                                  |
| Records of who took register outputs                                                                            | Nothing the company can open shows them ([position 2](../legal/positions.md#2-section-168-who-is-obliged-to-keep-the-register)) |
| Signed transaction bytes                                                                                        | They could still be broadcast                                                                              |
| The company owner's email                                                                                       | Contact details of a platform account, not company records                                                 |
| A company document's staff notes, rejection reason, verifier and verification fingerprint                       | Ledova's own review of the document, which the company's own view does not show                            |
| Ledova's source code                                                                                            | The software licence is noncommercial; the pack carries the contract interface files and the owner's statement ([position 5](../legal/positions.md#5-software-licensing-and-commercial-permission)) |

No file is built from these areas apart from the register's own particulars, and the only stored
files the pack opens are the company's own documents and evidence copies. Company decision records
do name the people who prepared and decided each decision, with their platform account number, and
each register entry's fingerprint input carries the number of the account that recorded it, because
the entries cannot be checked without it.

### Producing a core pack in the Register

A company administrator produces the pack in **Register**, **Documents**, **Company pack**: enter
the company's written instruction and the recipient, then choose **Prepare and download company
pack** (web) or **Prepare and share company pack** (mobile). The appointment is checked again before
the pack is recorded.

This route supports a complete core pack: every share class is an opened imported register that has
never been put on chain, with no chain issues, subscriptions awaiting allotment or settlements, and
the company has no wallet approvals, wallet nominations, instructions or links, retained register
instructions, deployments, capital increases, pause changes or publications. Such a pack carries
the company's decisions, awards and vesting, external agreements, contributions and allotments with
their original supporting files. If the captured records include anything else, the whole download
is refused rather than silently leaving records out; the company then asks platform staff for the
broader pack.

### Producing the broader pack in admin

Platform staff produce the full pack only on the company's written instruction naming who it is
for, or on a document that legally compels disclosure, referenced in its place (owner decision,
23 September 2026). You need an active staff account with **Can change company pack** and **Can
view company document**; company permissions do not include the first. The company needs at least
one share class.

1. Keep the instruction or the compelling document, and note its reference and who the pack is for.
2. In **Admin → Companies → Company packs**, find the company and choose **Produce a company pack**.
3. Enter the reference and the recipient, then choose **Produce and download**.

The download, `company-pack-ACN-YYYYMMDDTHHMMSSZ.zip`, is named for the moment the records were read,
in UTC. It carries every current and former member's name and residential address, the names of
those who reviewed or decided the company's register changes, the company's documents and each
publication's roll. Give it unchanged to the recipient the instruction names.

### Recording and refusals

Each pack is recorded in **Admin → Tokens → Register exports** as kind **Company pack**, once for
each share class it carries, with who produced it, the instruction, the recipient and the SHA-256
of the pack's manifest. Records are written only once the archive is complete, so a failure while
it is written records nothing. Either route refuses, and records nothing, when:

- the company has no share classes or a field is blank;
- a register entry no longer matches its stored fingerprint (the refusal names the class and entry;
  do not produce a pack until the register
  [verifies](../operations/recovery.md#verifying-stored-records));
- a publication's events or roll no longer verify (the refusal names the publication);
- the stored files it would carry exceed 256 MiB (the refusal names the total; background
  production is built the first time a real pack goes over the ceiling);
- a document's or evidence copy's file is missing from private storage, or a stored file no longer
  matches its recorded SHA-256 (the refusal names the record: restore the file and find out how it
  changed first).

### Checking a pack

Ledova keeps no copy of the pack. Unzip it and compare the SHA-256 of `manifest.json` with the
recorded digest; the manifest lists the SHA-256 of every other file. A reader then checks the
register offline with a JSON parser and SHA-256, as the README describes: each entry against its
fields, each link to the entry before it, the last fingerprint against the manifest, and the
entries replayed into the current members. No offline checking tool ships with Ledova.

### Limits of the pack

- The README's recipe checks the current members against the entries. It does not recompute the
  supply summary or the former members, which come from records the entries do not carry.
- The pack reads no chain. A contract's owner, a registry's owner and what the README lists as
  unresolved are what Ledova's records say at the time the pack was read; ownership moved outside
  Ledova would not show.
- An approval change still executing is carried with its status but not its transaction attempts;
  the README counts it as unresolved.
- A company document has no fingerprint of its own apart from the manifest's, so a reader can check
  an evidence copy against its record but a document only against the manifest. A document held
  only as a web address is listed, not fetched.
- The README predates the company's decision records: it does not describe them, and it says no
  platform account numbers leave, although those records carry them
  ([technical limits](../engineering/records.md#technical-limits-of-the-pack)).
- A withheld ballot's fingerprint cannot be recomputed and a tally cannot be recounted from the
  pack: a reader checks the ballots' links, the close and the tally against the roll and the number
  of ballots, and the division between for, against and abstain rests on Ledova's own verifier. A
  roll's audience fingerprint covers account numbers that do not leave, so a reader checks its row
  count and its rows against the register instead.
- In a small company a tally, set against the roll's holdings, can show how members voted.
  Withholding ballots adds nothing to what the company can already infer from Ledova.

## The Wallet shares page

**Wallet shares** (reached from **Wallets**: **View shares in your wallets** on the web, **Wallet
shares** on mobile) lists the share-class tokens in the person's own wallets, by company and class,
one row per class across networks, expanding into each network's and wallet's balance. A holding whose class details cannot be read is still listed under the asset's
name. Company-recorded shares, including those held without a wallet, are on **Dashboard** or **My
shares** instead.

Below the shares:

- **Needs you** lists draft applications and payment instructions, and counts resolutions awaiting
  the person's vote with the first close.
- **In progress** lists applications under way and counts dividends awaiting a payment record from
  the company, which is not proof of a bank transfer.
- **Recently published to you** lists the three latest notices, each with its company, kind, date
  and, for a resolution, until when voting is open.

Only an investing account sees applications. Actions open the application or
[Notices](publications.md#the-notices-page); nothing submits, pays or votes from
this page.

Next: [the register of members](register.md),
[shareholder publications](publications.md),
[legal positions](../legal/positions.md) and
[register output formats](../engineering/records.md#output-formats).
