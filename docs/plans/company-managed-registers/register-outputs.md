# Company and member register outputs

[Implementation index](README.md) · [Register architecture](../../architecture/register.md#certificates) · [#871](https://github.com/Ledova/ledova/issues/871)

Companies prepare supported unsigned certificates and core company packs through
current appointments in web/mobile. Members obtain only their own retained
certificate. Generation creates no signature, issue, payment or filing.

## Company certificates

Open a share class's register history on web, or its entries in **Documents** on
mobile, and choose **Prepare unsigned certificate** for an uncorrected ISSUE or
TRANSFER. Enter the company's written instruction
reference, preview the entry and register sequence, then confirm the PDF download
or mobile share. A current personal register-reader appointment is required;
ownership, member association and staff status supply no authority.

The company copy can contain the receiving member's page and the transferor's
remaining-balance page. It records the genuine entry and current recorded
particulars. Source changes invalidate the preview; the exact appointment is
checked again before recording the file digest. The company executes and
delivers the unsigned document separately.

`GET /api/v1/tokens/{uuid}/register/certificate/?sequence=N` previews the source.
`POST` supplies the appointment, sequence, source digest and instruction.
The existing [export record](../../architecture/register.md#export-records)
retains the instruction, sequence and PDF fingerprint.

## Member fulfilment

In **Member access and requests** (Register on web, Company on mobile), a
current company reader previews a requested
receiving certificate using the written instruction, then confirms fulfilment.
This creates one immutable recipient-only PDF with its exact request, producer,
appointment, instruction, export, source digest and file digest/size. Filtering
occurs before another member's particulars are read or rendered.

The requester sees **fulfilled** only after a real file exists. From **My
shares**, they download or share that retained PDF through their current
association. File bytes must match the retained size/digest. Company readers
can also obtain it; revoked member access stops file access while the original
requester retains request status. A fulfilled request cannot be withdrawn.
An uncertain response retains the original operation for recovery; changed
retries conflict and exact retries return the retained result.

`/api/v1/tokens/member-certificate-requests/{uuid}/` adds
`fulfilment-preview/`, `fulfil/` and `file/`. It exposes no private storage path
or source snapshot. See [member access](member-access.md) for association and
particulars requests.

## Core company pack

A current company administrator enters the written instruction and recipient
in **Company pack** under **Documents**, then downloads or shares one captured ZIP.
`POST /api/v1/companies/{uuid}/pack/` records the archive's manifest digest against
each captured class and rechecks the exact administrator before completion.

This company route supports complete opened imported, non-tokenised core
register packs, including company mandates, award/vesting records, external
agreements, company-recorded contributions, approved allotments and their
original supporting files. Private participant identity evidence remains
excluded. If captured publication, chain, wallet, payment/settlement or other
restricted families prevent company access, the whole download is refused;
it does not silently omit records. The retained staff generator supports its
existing broader scope ([company pack](../../architecture/company-pack.md)).

## Verification

One core output API case and the existing five real-app-login controls cover
PDFs, source/retry integrity, file corruption, own privacy, company authority
and revoked access. One company output case per client and the existing member
case cover the UI within the binding suite caps. Fresh PostgreSQL guards,
schema/types and ordinary CI remain required under the
[minimum-test policy](../../development/testing.md). Native builds, chain smoke
and genuine human/device acceptance remain separate.
