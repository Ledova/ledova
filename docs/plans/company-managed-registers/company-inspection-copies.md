# Company inspection copies

The first #871 increment exposes the existing inspection CSV in the Register in
web and mobile. It requires a current personal appointment for the exact company
holding administration or a register capability. Ownership, shareholding and
platform staff permissions supply no inspection-copy authority.

Open an initialized class, enter the company's instruction reference, recipient
and request date, and preview the copy. Confirm the request and register sequence,
then download in web or share in mobile. Editing, closing, changing accounts or
classes, and refreshing the register retire the prepared request. Failed previews
and unexpected responses deliver no file. The ordinary register CSV remains
available through its existing guarded read route.

`GET /api/v1/tokens/{uuid}/register/inspection-copy/` captures the current
appointment, register sequence and a fingerprint of the actual register CSV
source. `POST` supplies that appointment and fingerprint with the instruction,
recipient and request date. A locked company operation checks the personal
appointment and register, refuses a changed source, and checks authority again
after generation. Expiry during generation rolls back the audit record and
serves no copy. The fingerprint includes the class and sequence as well as the
CSV source, so a particulars change can invalidate it without changing holdings.

The existing generator retains walletless and imported rows, former-member
history, reconciliation information, CSV formula protection and Sydney calendar
dating. The API and browser use `register-SYMBOL-inspection-copy.csv`; mobile shares
`inspection-CLASS-UUID.csv`. Its immutable
`RegisterExport` record retains the actual requester, sequence, row counts,
instruction, recipient, request date, late flag and SHA-256 of the exact served
bytes. The source fingerprint is distinct from this final file digest. Ledova
retains the audit record rather than the file; operator-only audit access and
retention remain unchanged. Residential addresses belong in the authorised
company copy; this is not a member's own-record route.

The company decides whether a request is proper and how to provide the copy to
its recipient. Generation supplies no signature, legal determination or delivery
receipt. The replaced staff inspection form is retired; historical audit records,
migrations and the remaining certificate/notice/pack workflows are retained.
#871 remains open for those other supported outputs and provenance work. Member
fulfilment still requires #866's selected association/access policy and delivered
own-record capability. No new payment, chain or live operation is authorised.
