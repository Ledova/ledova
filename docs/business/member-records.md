# Member records and register outputs

[Business processes](README.md) · [Documentation](../README.md)

How members reach their own records, and how a company obtains copies of its register (inspection
copies, certificates, notice figures and the company pack), with the staff procedures done on a
company's written instruction. File formats are in
[output formats](../engineering/records.md#output-formats) and how each output is recorded in
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
signature, legal determination, delivery receipt, issue, payment or filing
([what stays with the company](README.md#what-ledova-does-and-what-stays-with-the-company)). The
statutory time limits given in each section are the company's obligations, with their sources in
[legal position 6](../legal/positions.md#6-where-and-in-what-form-the-register-is-kept).

A register reader is a person with a current appointment for the exact company holding
administration or any register capability (read, prepare, approve or apply). Ownership,
shareholding, member access and staff permissions give no output authority, except that the
company owner may download the register CSV.

| Output               | Who prepares it                            | Where                                                   | What Ledova keeps                                        |
| -------------------- | ------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------- |
| Register CSV         | The company owner or a register reader     | **Documents**: **Download CSV**                         | Who took it, the class, the entry it runs to, row counts |
| Inspection copy      | A register reader                          | **Documents**: **Inspection copy**                      | SHA-256, instruction, request date, recipient, late flag |
| Certificate          | A register reader                          | **Register**, **History** (web); **Documents** (mobile) | SHA-256 and instruction                                  |
| Member's certificate | A register reader, on the member's request | **Member access and requests**                          | The PDF itself, as a certificate record                  |
| Notice figures       | Platform staff, on written instruction     | Admin, **Register outputs**                             | SHA-256, period and instruction                          |
| Core company pack    | A company administrator                    | **Documents**: **Company pack**                         | Manifest SHA-256, instruction, recipient, per class      |
| Broader company pack | Platform staff, on written instruction     | Admin, **Company packs**                                | As for a core pack                                       |

Ledova keeps a fingerprint, not the file, except for a member's certificate. Output records cannot
be rewritten, are read only by platform staff and are kept for the register's seven-year floor
(2,557 days) before the daily purge ([retention](../engineering/security.md#retention-clocks)). A
refused or failed output records nothing, and each output reads one consistent moment of the
register ([decision](../decisions.md#the-stored-register)).

## Member access

Member access links one signed-in account to one member of one company's register, so the person can
read their own records without a wallet. It gives no company appointment, holding, wallet link or
investment eligibility ([decision](../decisions.md#member-invitations-and-account-association)).

### Inviting a member

1. A company administrator opens **Member access and requests**: on web from **Settings**, **Member
   access**; on mobile under **Company**.
2. Under **Invite a member**, they choose a named member or award recipient (who can be invited
   before any shares are issued, and sees their own award), enter the recipient's email and choose
   **Create member invitation**.
3. Ledova shows a one-time code, which the company gives the recipient privately; Ledova sends no
   email. The invitation expires at the displayed deadline, 7 days by default and never more than
   30, and a retry returns the recorded invitation without the code.

### Accepting an invitation

The recipient signs in, enters the code under **Get access to your shares** on **Dashboard** (web)
or **My shares** (mobile), confirms and chooses **Accept member invitation**. Their verified email
must match the invitation, and acceptance binds one current account to one member in that company.
An expired invitation, a changed recorded identity for the member, a revoked appointment of the
inviting administrator, another person's account or a conflicting association is refused.

### What a member can read

An accepted member reads their own company-recorded particulars, share-class balances, the entries
that changed their holding, and their employee-award terms with recorded vesting and issued
quantities; no wallet or company approval is needed. Company totals, other members, private
company decisions, financial documents and other members' parts of an entry are never shown. An
award is an entitlement, not a holding. Editing the personal Profile does not change the register;
only a [particulars request](#particulars-requests) can.

**Dashboard** (web) and **My shares** (mobile) show issued shares by class apart from awards, with
a bar splitting each award into unvested, vested but unissued, and issued quantities (issued award
shares already belong to the holding), then certificates, recent own changes and request status,
with particulars and the longer history in expandable sections on the same page. Wallet holdings
are on [the Wallet shares page](#the-wallet-shares-page).

### Revoking member access

A company administrator revokes access under **Current member access**, with a reason recorded
against them; relinking needs a new invitation. Revocation stops the person's own-record access,
file access and new requests, though they can still read the status of requests they made.

Every action rechecks the person's account, session, association and the company's authority; a
failed refresh hides cached private records, and an uncertain reply is recovered, not resent
([when the outcome is uncertain](README.md#when-the-outcome-is-uncertain)).

## Member requests

### Particulars requests

A member with issued shares (not an award-only recipient) asks the company to change their
recorded name and residential address: **Request a particulars update** on **Dashboard**
(**Request a particulars change** on **My shares**), then **Send particulars request**. Sending
changes nothing on the register.

The company sees it under **Particulars requests** (a current personal appointment is needed). A
preparer adds evidence, a reason and an as-at date and records it as an ordinary
[particulars change](register.md#changing-a-members-particulars). The request keeps the exact
particulars asked for, and its status follows the change: prepared, approved, applied or rejected.
A revoked association or a changed source record blocks a new change or its application.

### Certificate requests

A member can request a certificate for an uncorrected issue or transfer that gave them shares
(**Request certificate for entry** in their share history), and withdraw it (**Withdraw
certificate request**) until the company [fulfils it](#fulfilling-a-members-certificate-request).
It reads **fulfilled** only once a real file exists, which the member downloads or shares
(**Download unsigned certificate** on web, **Share unsigned certificate** on mobile) through their
current access, checked against its record. Nothing is signed automatically and no legal
recognition is claimed.

## Inspection copies

Anyone may ask a company for a copy of its register, and the company must provide it within 7 days
of a proper request (s173(3)). A register reader prepares the copy (platform staff cannot); the
company decides whether the request is proper and how to deliver it.

The copy is the register CSV plus the request's details and whether it was produced more than 7
days after the request ([format](../engineering/records.md#inspection-copy-format)). Days are
counted in Sydney's calendar. No state or territory capital's date is ever ahead of Sydney's, so
for a company elsewhere the late flag can only err towards late, and a request dated that
company's today is never refused as a future date. The flag counts calendar days and does not
extend a limit that ends on a weekend or public holiday, which also errs towards late.

### Preparing an inspection copy

1. Keep the company's written instruction, noting its reference, the request date and the
   recipient.
2. Open **Documents**, select the company and find the share class. Enter the reference, recipient
   and request date under **Inspection copy** (on mobile, choose **Prepare inspection copy**).
3. Choose **Preview inspection copy**, check the request and register sequence, then **Confirm and
   download inspection copy** (web) or **Confirm and share inspection copy** (mobile).

The web file is `register-<symbol>-inspection-copy.csv`; mobile shares `inspection-<class id>.csv`.
A register with no opening, a request date after today and a blank field are refused. If the
register or the person's appointment changes after the preview, confirmation is refused and the
person previews again. Editing, closing, changing account or class, and refreshing the register
retire a prepared request, and a failed preview delivers no file.

## Certificates

A company must have a certificate ready within 2 months after an issue and 1 month after a transfer
is lodged (s1071H). A register reader prepares it, unsigned, on the company's written
instruction; the company executes and delivers it, and platform staff do not prepare certificates
([decision](../decisions.md#the-stored-register)).

### What a certificate shows

Only an issue or a transfer has a certificate. The PDF has a page for the member the entry moved
shares to (the allottee or transferee) and, for a transfer, a balance certificate for the transferor
when they still hold shares. Pages are numbered from the entry, moved shares first (12-1, 12-2),
with no separate counter. Each page shows the company and its ACN, the share class, the member's
name and residential address, the shares it certifies, the member's holding in the class after the
entry, and the entry's number, ledger date and fingerprint, then an unsigned execution block. The
company event date is shown separately where recorded; a retained unknown date stays not recorded.

Holdings are those immediately after the certified entry, so later entries do not change them;
names and addresses are those the register gives when the certificate is prepared. Preparing the
same entry again gives the same file while the register and particulars are unchanged.

The whole certificate is refused when a member's wallets resolve to different people, a member has
no name or residential address on record, the entry is not an issue or transfer in the class's
register, or a correction has since reversed the entry (the refusal names the correction).

### Preparing a certificate in the Register

1. Keep the company's written instruction and note its reference.
2. On web, in **Register** choose **History** and the share class, open an issue or transfer entry
   and choose **Prepare unsigned certificate**. On mobile, open the class's entries in
   **Documents**.
3. Enter the reference and choose **Preview unsigned certificate**. Check the entry, register
   sequence and page count, then choose **Confirm and download unsigned PDF** (web) or **Confirm
   and share unsigned certificate** (mobile).

A register change after the preview invalidates it, and the appointment is rechecked before the
fingerprint is recorded.

### Fulfilling a member's certificate request

1. In **Member access and requests**, under **Certificate requests**, choose **Preview certificate
   for** the member, entering the company's written instruction reference.
2. Check the preview, then choose **Confirm recipient certificate fulfilment**.

This keeps one unchangeable single-page PDF of that member's page only, with its request,
producer, appointment, instruction and fingerprint, recorded as a certificate for the entry; no
other member's particulars are read. Company readers can download it too, and a fulfilled request
cannot be withdrawn.

## Notice figures

A company notifies ASIC of a share issue within 28 days (s254X), and a proprietary company notifies
changes to its members and share structure with that notice or otherwise within 28 days (s178A,
s178C and s178D). Platform staff prepare the figures in admin, only on the company's written
instruction. The company, or the accountant who lodges its notices, decides which notices they
support and lodges them: Ledova prepares figures, not a notice, and names no ASIC form
([decision](../decisions.md#the-stored-register)). Moving notice figures to company appointments is
not built.

### What the figures contain

The figures cover every issue, transfer and correction entered on or after the first day of the
period the company asks for, up to the register's latest entry: each entry's signed change for
each member it changed, the class's issued shares, members and total amount paid at the latest
entry, and each changed member's particulars, shares held (0 for one who no longer holds any) and
amount paid then ([format](../engineering/records.md#notice-figures-format)). The CSV separates the
register entry date, company event date and actual recorded timestamp; an unknown company date is
not inferred from the entry date.

The opening is never listed. Amount paid reads `not recorded` where Ledova cannot establish it
exactly, as for shares received by transfer, and never reads zero for an unknown amount; the class
total reads `not recorded` unless every current member's amount is established. A transfer or
correction carries no amount paid. Names and addresses are those the register gives when the
figures are prepared, and an unidentified or ambiguous member is printed as the register prints
them, not refused. A period with no entries lists none.

### Preparing notice figures

You need **Can change register outputs**.

1. Keep the company's written instruction, and note its reference and the period's first day.
   Start the period no later than the stored entry date of the first entry the company has not yet
   notified; an older entry's UTC recording day can be the previous day in a Sydney morning.
   [The due list](#the-due-list)
   shows every entry no figures cover yet.
2. In **Admin → Tokens → Register outputs**, find the share class and choose **Prepare notice
   figures**.
3. Enter the first day of the period and the instruction's reference, then choose **Prepare and
   download**.

The download, `notice-figures-SYMBOL-DATE-to-N.csv`, runs from DATE to register entry N. Check it
against the instruction and give it to the company unchanged. The page refuses, recording nothing,
when the class has no applied opening, the first day is after today in Sydney's calendar or a field
is blank. Each preparation is recorded once in **Admin → Tokens → Register exports** (kind **Notice
figures**); `sha256sum` on the download confirms its SHA-256.

## The due list

The **Register outputs due** page in admin shows platform staff every certificate and set of notice
figures still due across all companies and classes, earliest known due date first, then by company,
class and entry number. Rows with unknown deadlines follow the dated rows.

- **Certificates.** Each uncorrected issue or transfer entry is listed until a certificate is
  recorded for its number. A non-tokenised issue's is due two calendar months after its recorded
  company issue date. Existing chain-issue clocks remain unchanged. A
  transfer's is due one calendar month after its lodgement date when the company recorded it, or
  after its settlement order was created (by Sydney's date) for a settled market transfer; that
  order precedes lodgement, so the date errs early.
- **Notice figures.** Each uncorrected issue entry, and each uncorrected transfer entry of a
  proprietary company, is listed until figures cover it: figures whose period starts on or before
  its ledger date and that run to its number or later. For a company-dated issue or direct transfer,
  they are due 28 days after the company event date; existing chain clocks remain unchanged.

An older non-tokenised issue or direct transfer with no retained company event date stays listed
with an unknown event-based deadline and overdue status. Its ledger date is not treated as the
company's legal event date. A direct-transfer certificate still uses its retained lodgement date.

A calendar month ends on the same day number, or the month's last day when shorter, so 31 January
plus one month is 28 or 29 February. An item is overdue once its due date is before today in
Sydney's calendar. Openings and corrections are never listed.

The list stores and records nothing, and knows what Ledova prepared, not what the company lodged or
delivered: an output produced elsewhere, or a certificate the company does not need, stays listed,
and an entry whose output record was purged after the retention floor is listed again.

### Working the due list

You need **Can change register outputs**.

1. In **Admin → Tokens → Register outputs**, choose **Register outputs due**.
2. Read each row's company, class, entry, kind and ledger date, what is due, the due date and
   whether it is overdue.
3. Tell the company what is due and when.
4. For notice figures, on the company's written instruction, follow the row's link and
   [prepare the notice figures](#preparing-notice-figures). A certificate row has no link and
   reads **Certificate (company register)**: the company prepares it in its own Register.

## The company pack

The company pack is the one archive in which a company's records leave Ledova: for the company's own
administration, for a provider that takes over its register, or in answer to a lawful information
request ([product §6](../product.md#6-privacy-and-portability);
[decision](../decisions.md#the-company-pack)). Its figures and chain evidence are records with
stated limits, not proof of a bank payment, current contract ownership or a lodged ASIC filing.

### What the pack carries

- The company, its business-register checks and documents, and the evidence copy each register
  change relied on.
- Every share class with its register: the register CSV, every entry with the fingerprints that
  chain it, former members with the date s169(3) keeps each until, reconciliations with the chain
  and their acknowledgements, completed effects still waiting to be recorded, and the certificates
  and notice figures still due.
- The company's decision records: appointments, openings, imports, corrections, wallet links,
  particulars changes, grants, transfers, employee awards and vesting, external agreements,
  contributions and allotments, register instructions, deployments, capital increases, pause
  changes, and wallet nominations and instructions, each with who prepared and decided it, under
  which appointment, and any supporting file Ledova retained
  ([which records carry files](../engineering/records.md#company-decision-records)). Capital
  increases, pause changes and the terms of a chain grant name a file the pack does not carry;
  deployments and wallet nominations and instructions have none.
- Issues, and subscriptions with a payment recorded by staff (not proved) still to be allotted or
  refunded, an obligation the company inherits.
- Wallet approvals, the transactions Ledova sent for the company and the settlements it executed.
- What the company published to its members, with each resolution's result, each dividend's payment
  records and read counts.
- The contract information a successor needs, and a README that explains the files, how to check
  them and how control of the contracts would be handed over. The handover itself is not built.

The README ends with the owner's statement of what the pack grants
([decision](../decisions.md#the-company-pack)). The file layout is in
[company pack format](../engineering/records.md#archive-and-manifest).

### What never leaves, and why

Of a member, only what the register holds leaves: name, residential address, holding, linked wallets
and identity source.

| Excluded                                                                                                       | Why                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Members' email, phone, date of birth, citizenship, financial profile, account numbers and platform account ids | What members gave Ledova, not the register's particulars ([position 10](../legal/positions.md#10-privacy))                                                                                          |
| Identity checks, classification claims and evidence, payslips and their extractions                            | The person's records with Ledova, which the company never reads and which run on their own retention clock                                                                                          |
| A ballot's member and choice, and who opened which publication                                                 | The company sees resolution tallies and read counts only                                                                                                                                            |
| Unmatched orders                                                                                               | Investors' private orders                                                                                                                                                                           |
| Records of who took register outputs                                                                           | Nothing the company can open shows them ([position 2](../legal/positions.md#2-section-168-who-is-obliged-to-keep-the-register))                                                                     |
| Signed transaction bytes                                                                                       | They could still be broadcast                                                                                                                                                                       |
| The company owner's email                                                                                      | Contact details of a platform account, not company records                                                                                                                                          |
| A company document's staff notes, rejection reason, verifier and verification fingerprint                      | Ledova's own review of the document, which the company's own view does not show                                                                                                                     |
| Ledova's source code                                                                                           | The software licence is noncommercial; the pack carries the contract interface files and the owner's statement ([position 5](../legal/positions.md#5-software-licensing-and-commercial-permission)) |

No file is built from these areas except the register's own particulars, and the only stored files
the pack opens are the company's documents and evidence copies. Decision records do name who
prepared and decided each one, with their platform account number, and each entry's fingerprint
input carries the recording account's number, without which the entries cannot be checked.

### Producing a core pack in the Register

A company administrator produces the pack in **Documents**, **Company pack**: enter the company's
written instruction and the recipient, then choose **Prepare and download company pack** (web) or
**Prepare and share company pack** (mobile). The appointment is checked again before the pack is
recorded.

This route produces only a complete core pack: every share class is an opened imported register
never put on chain, and the company has no chain issues, subscriptions awaiting allotment,
settlements, deployments, capital increases, pause changes, wallet approvals, nominations,
instructions or links, retained register instructions or publications. Such a pack carries its
decisions, awards and vesting, external agreements, contributions and allotments with their
original supporting files. Anything else refuses the whole download rather than silently leaving
records out, and the company asks platform staff for the broader pack.

### Producing the broader pack in admin

Platform staff produce the full pack only on the company's written instruction naming who it is
for, or on a document that legally compels disclosure, referenced in its place
([decision](../decisions.md#the-company-pack)). You need an active staff account with **Can change
company pack** and **Can view company document**; company permissions do not include the first.

1. Keep the instruction or the compelling document, and note its reference and who the pack is for.
2. In **Admin → Companies → Company packs**, find the company and choose **Produce a company pack**.
3. Enter the reference and the recipient, then choose **Produce and download**.

The download, `company-pack-ACN-YYYYMMDDTHHMMSSZ.zip`, is named for the moment the records were
read, in UTC. It carries members' names and residential addresses, decision-makers' names, the
company's documents and publication rolls: give it unchanged to the recipient the instruction
names.

### Recording and refusals

Each pack is recorded in **Admin → Tokens → Register exports** as kind **Company pack**, once per
share class and only once the archive is complete. Either route refuses, and records nothing, when:

- the company has no share classes or a field is blank;
- a register entry no longer matches its stored fingerprint (the refusal names the class and entry;
  do not produce a pack until the register
  [verifies](../operations/recovery.md#verifying-stored-records));
- a publication's roll digest or an event's hash no longer matches what was recorded (the refusal
  names the publication);
- the stored files it would carry exceed 256 MiB (the refusal names the total; background
  production is not built until a real pack exceeds it);
- a document's or evidence copy's file is missing from private storage, or a stored file no longer
  matches its recorded SHA-256 (the refusal names the record: restore the file and find out how it
  changed first).

### Checking a pack

Unzip the pack and compare the SHA-256 of `manifest.json` with the recorded digest; the manifest
lists the SHA-256 of every other file. A reader then checks the register offline with a JSON parser
and SHA-256, as the README describes: each entry against its fields, each link to the entry before
it, the last fingerprint against the manifest, and the entries replayed into the current members. No
offline checking tool ships with Ledova.

### Limits of the pack

What a recipient should know (the builder's own limits are in
[technical limits of the pack](../engineering/records.md#technical-limits-of-the-pack)):

- The README's recipe checks the current members against the entries, not the supply summary or
  the former members, which come from records the entries do not carry.
- The pack reads no chain. Contract and registry owners and what the README lists as unresolved
  are what Ledova's records said when the pack was read; ownership moved outside Ledova would not
  show.
- An approval change still executing is carried with its status but not its transaction attempts;
  the README counts it as unresolved.
- A company document has no fingerprint of its own apart from the manifest's, so a reader can check
  an evidence copy against its record but a document only against the manifest. A document held
  only as a web address is listed, not fetched.
- The README predates the company's decision records: it does not describe them, and it says no
  platform account numbers leave, although those records carry them.
- A withheld ballot's fingerprint cannot be recomputed, nor a tally recounted: a reader checks the
  ballots' links, the close and the tally against the roll and the number of ballots, and the split
  between for, against and abstain rests on Ledova's own verifier. A roll's audience fingerprint
  covers account numbers that do not leave, so a reader checks its row count and rows against the
  register instead.
- In a small company a tally, set against the roll's holdings, can show how members voted;
  withholding ballots adds nothing to what the company can infer from Ledova.

## The Wallet shares page

**Wallet shares** (from **Wallets**: **View shares in your wallets** on web, **Wallet shares** on
mobile) lists the share-class tokens in the person's own wallets, one row per company and class
across networks, expanding into each network's and wallet's balance. A holding whose class details
cannot be read is listed under the asset's name. Company-recorded shares, wallet or not, are on
**Dashboard** or **My shares**.

Below the shares:

- **Needs you** lists draft applications and payment instructions, and counts resolutions awaiting
  the person's vote with the first close.
- **In progress** lists applications under way and counts dividends awaiting a payment record from
  the company, which is not proof of a bank transfer.
- **Recently published to you** lists the three latest notices, each with its company, kind, date
  and, for a resolution, until when voting is open.

Only an investing account sees applications. Actions only open the application or
[Notices](publications.md#the-notices-page), which defines what counts as waiting; nothing submits,
pays or votes here.

Next: [the register of members](register.md),
[shareholder publications](publications.md),
[legal positions](../legal/positions.md) and
[register output formats](../engineering/records.md#output-formats).
