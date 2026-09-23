# Publishing to members

[Operations](README.md) · [Shareholder publications](../architecture/shareholder-publications.md)

A company publishes documents to the members of one share class: today the
annual holding statement and the meeting notice. Ledova staff publish on the
company's written instruction, as
[inspection copies](register-foundation.md#preparing-an-inspection-copy),
certificates and notice figures are prepared today (owner decision,
23 September 2026). The company decides what to publish and when; staff record
the instruction and make the publication.

You need an active staff account with **Can change publication**
(`shareholders.change_publication`) to publish, and **Can view publication**
(`shareholders.view_publication`) to open a published document afterwards. The
share class needs an applied opening, and the company needs a verified company
document carrying the director authority for the publication.

## Making a publication

1. Keep the company's written instruction and note its reference.
2. Confirm the authority document is verified in **Admin → Companies → Company
   documents**. A document verification that has been cleared, or one belonging
   to another company, is refused.
3. In **Admin → Shareholder publications → Publications**, choose **Publish to
   members**.
4. Choose the share class, what is being published, the title members will see,
   the record date and the instruction's reference, choose the verified
   authority document, attach the document as a PDF, PNG or JPEG, and choose
   **Publish**.

The page refuses, and records nothing, when the share class's register has no
applied opening, when the record date is after today in Sydney's calendar, when
no member held shares on that record date, when the instruction or the title is
blank, or when the authority document is not a current verification of a
document of that company. An attachment is size-bounded, scanned and decoded
before it is stored, exactly as every other upload is.

## What a publication records

Each publication is one row in **Admin → Shareholder publications →
Publications**: the company and share class, what was published, the record
date, the instruction's reference, the authority document and its fingerprint,
the SHA-256 of the stored document, the register sequence and head hash the roll
was taken from, the number of members it was addressed to, the roll's own digest
and the staff member who prepared it. Unlike an inspection copy, Ledova keeps
the document itself: a member must be able to reopen it later.

Below it is the roll, one row for each member holding shares on the record date:
the register member, the account it resolved to, the name as at that moment, the
holder type, where the identity came from and the shares held. A member the
register cannot name — whose wallets resolve to different people, a treasury
address, or one never identified — is on the roll with no account. They are on
the audience for the company's records and have no online surface, and the
company reaches them the way it reaches any member it cannot address online.

Nothing on a publication or its roll can be changed afterwards. The database
refuses every update, and there is no admin path to add, change or delete one.

## Opening a published document

Open a publication and choose **Open the published document**. It downloads
rather than rendering. Each read — a member's, the company's, or yours — is
recorded once in **Admin → Shareholder publications → Publication reads**: who
read it, which publication, which roll row where there is one, and in which
capacity. A read that cannot be recorded refuses the download rather than
serving it, so an empty record means nothing was served.

Those records cannot be rewritten or deleted in admin, are read only by staff,
and carry no name, holding or document content. To confirm that a file is the
one published, compare the output of `sha256sum` on it with the publication's
digest.

## Checking a frozen roll

The roll is frozen when the publication is made, and the publication records how
many rows it held and a digest of them. From `backend/`:

```bash
python manage.py publications verify --publication PUBLICATION_UUID
```

Leaving `--publication` out checks every publication. The command prints the row
count and digest it recomputed for each, and fails naming the publication whose
roll no longer matches what it recorded. It reads the stored roll only: it
proves that the audience a publication was addressed to has not changed since,
not that the register itself is sound, which
`register_foundation verify` answers ([the synthetic operator
exercise](register-foundation.md#synthetic-operator-exercise)).

## Retention

Publications, their rolls and their read records are kept for seven years from
the publication and purged together by `purge_publications_past_the_clock`,
daily at 03:50. They share `FORMER_MEMBER_RETENTION_DAYS` with the register's
own outputs, so one clock governs both and a value below 2,557 days refuses the
purge rather than shortening it; see
[retention settings](uploads.md#data-retention). The purge deletes the stored
document with the row. Nothing else removes a publication.
