# Offerings

[Architecture](README.md) · [Documentation](../README.md)

How an issuer publishes an offering and an operator approves its terms.

## Data flow of an offering

1. The owner sets `Company.is_open_to_investors` from `/company/offering`
   through `CompanyUpdateSerializer`. It defaults to `False`, so the directory
   is empty until an owner opts in. Listing is meant to be the owner's act and
   the operator's lever a takedown only, but that is an expectation, not a
   control: `is_open_to_investors` is in `EDITABLE_FIELDS` and `update_company`
   applies it either way (`backend/companies/services/editing.py:28`), and the
   rule is stated only in the fieldset's help text
   (`backend/companies/admin/company.py:313-318`). It is a flag, not a
   `CompanyStatus`, so suspension and reinstatement do not drop the listing.
2. The issuer creates an `Offering` against one deployed share class at `POST
   /api/v1/offerings/`, with price, bounds in whole shares, window, exemption
   relied on, payment rails and the `CompanyDocument`s to attach. Every
   writable FK is scoped in `get_fields()`.
3. `POST /api/v1/offerings/{uuid}/submit/` calls
   `offerings.services.offering.submit_offering`, which takes a
   `select_for_update` on the `ShareToken` row first, so the liveness read and
   the status write are serialised per share class: two simultaneous
   submissions give one submission and one 400, not the `IntegrityError` the
   partial unique index turns into a 503. It then refuses unless the token is
   deployed, the company can issue tokens, the share class has no other live
   offering, `cap_shares` fits inside `total_supply` less the completed supply
   less the caps of other live offerings (naming `CapitalIncreaseRequest` in
   the refusal, because `setAuthorizedShares` cannot go below `totalSupply`),
   every settlement asset resolves through `operators.settlement`, at least one
   payment rail is configured, and, for `s708_8_minimum_amount`, the minimum
   subscription is worth at least AUD 500,000.
4. `transition_offering` is the single chokepoint for every status change and
   fires one push to the owner. It is where `approve` re-runs the headroom
   check, because an issuance completing between submission and approval
   shrinks the headroom the submission measured.
5. The operator reviews in the Django admin — start review, approve, reject,
   close. No approve, reject or close route exists on the API, so there is no
   staff API surface to mis-permission. `OfferingAdmin.get_readonly_fields`
   freezes the share class, exemption, price, bounds, payment rails and window
   past `DRAFT` (`LOCKED_PAST_DRAFT`); freezing them rather than repeating the
   submit checks in the form's `clean` leaves one authority on the economics.
6. There is no `OPEN` status and no scheduler. Open-now is derived by
   `OfferingQuerySet.open_now()`: approved, `opens_at <= now`, `closes_at` null
   or in the future — nothing is left in flight for a sweep to fix. Reaching
   the cap does not close an offering; closing is a deliberate operator act.
7. The directory publishes exactly that set:
   `ShareTokenQuerySet.with_open_offering()` annotates from `open_now()`, so a
   submitted or under-review offering is invisible to investors and approval
   publishes the terms. The annotation carries no status, because only one
   status can ever reach it.
8. Approval also publishes the offering's documents, and this rule is wider
   than the open offering: anyone the directory admits to a share class can
   open the documents attached to its approved offerings, whether they are
   upcoming, open or past their closing time, and to its closed ones
   (`OfferingQuerySet.published()`). Drafts and submitted, under-review,
   rejected and withdrawn offerings publish nothing, and neither does a company
   document that is not attached to such an offering. `GET
   /api/v1/directory/tokens/{uuid}/documents/` lists them, newest first, each
   once however many offerings carry it, with the name, type, size, upload date
   and any validity dates the issuer recorded; `GET
   /api/v1/directory/tokens/{uuid}/documents/{document}/file/` streams one,
   inline for a PDF or image. The class resolves through the directory's own
   selector, so an ineligible investor, a class that has left the directory, a
   document that is not published through that class and an unknown UUID all
   answer 404, the same body for each class. Only a document stored as a file
   of the class's own company is published: never an external link, and never
   another company's document attached by mistake, which the offering
   serializer also refuses. The company document policy stays owner-only, so
   these routes read through one bounded operator query, catalogued in
   [tenancy](tenancy.md#requests-and-jobs), and they record no read, as no read
   of a company document is recorded ([uploaded files](files-and-retention.md)).
   The issuer picks the documents in the offering form on the web and in the
   app while the offering is a draft or after a rejection. The form lists the
   offer documents uploaded under Application (`OFFER_DOCUMENT_TYPES`: the
   prospectus or information memorandum, risk disclosure, business plan,
   financial statements, auditor report, constitution and shareholder
   agreement) and anything already attached, so personal records such as the
   share register or a director's identification are never one click from
   investors; the API itself accepts any document of the class's company.
9. A rejected offering can be withdrawn by its issuer. Withdrawal keeps the
   reviewer, the review time, the notes and the rejection reason; the row stays
   visible as a record and offers no further edit, resubmit or delete.
10. `UniqueConstraint(token)` `WHERE status IN (submitted, under_review,
    approved)` allows one live offering per share class. `submit_offering`
    refuses the second submission by name before the write, so the ordinary
    second-tranche path is a 400 naming the offering in flight; the constraint
    is the backstop against a race. Two tranches at once needs the constraint
    relaxed, which is a migration.

Next: [subscriptions and allotment](subscriptions.md), [eligibility](companies-and-eligibility.md), and [operator worklists](../operations/operator-console.md).
