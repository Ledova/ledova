# Company inspection copies

[Implementation index](README.md) · [Register architecture](../../architecture/register.md#inspection-copies) · [#871](https://github.com/Ledova/ledova/issues/871)

Delivered by [PR #954](https://github.com/Ledova/ledova/pull/954).

The first #871 increment exposes the existing inspection CSV in the Register in
web and mobile. It requires a current personal appointment for the exact company
holding `admin` or a register capability (`prepare`, `approve`, `apply` or
`read_register`). Ownership, shareholding and platform staff permissions supply
no inspection-copy authority.

## What the company does

1. Keep the company's written instruction, and note its reference, the date the
   request was made and who the copy is for.
2. In the **Register**, select the company and open the share class. Enter the
   instruction reference, request date and recipient in **Inspection copy**
   (or choose **Prepare inspection copy** in mobile).
3. Choose **Preview inspection copy**, review the request and register sequence,
   then **Confirm and download inspection copy** in web or **Confirm and share
   inspection copy** in mobile.

Editing, closing, changing accounts or classes, and refreshing the register
retire the prepared request. Failed previews and unexpected responses deliver no
file. The browser download is `register-<symbol>-inspection-copy.csv`; mobile
shares `inspection-<class uuid>.csv`. The company decides whether a request is
proper and how to provide the copy to its recipient; generation supplies no
signature, legal determination or delivery receipt.

## API

`GET /api/v1/tokens/{uuid}/register/inspection-copy/` captures the current
appointment, register sequence and a fingerprint of the register CSV source.
`POST` supplies that appointment and fingerprint with the instruction, recipient
and request date. The `RegisterExport` record, the refusals and the source and
file digests are described under
[inspection copies](../../architecture/register.md#inspection-copies).
