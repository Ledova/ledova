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
8. A rejected offering can be withdrawn by its issuer. Withdrawal keeps the
   reviewer, the review time, the notes and the rejection reason; the row stays
   visible as a record and offers no further edit, resubmit or delete.
9. `UniqueConstraint(token)` `WHERE status IN (submitted, under_review,
   approved)` allows one live offering per share class. `submit_offering`
   refuses the second submission by name before the write, so the ordinary
   second-tranche path is a 400 naming the offering in flight; the constraint
   is the backstop against a race. Two tranches at once needs the constraint
   relaxed, which is a migration.

Next: [subscriptions and allotment](subscriptions.md), [eligibility](companies-and-eligibility.md), and [operator worklists](../operations/operator-console.md).
