# Identity verification

[Architecture](README.md) · [Provider configuration](../operations/integrations.md)

How a KYC provider's result is mapped onto the profile. Which provider is
configured, and what a crypto screening records, is in
[provider configuration](../operations/integrations.md#kyc-providers).

## Profile fields

Both providers write the same profile fields: `verification_status`, one of
`init`, `pending`, `queued`, `prechecked`, `onHold` and `completed`;
`review_result`, which is `GREEN`, `RED` or `YELLOW`, or null while there is no
result (never an empty string); `rejection_labels`; the identity document's
type and country; and, for an approval, the PEP type the risk policy reads.

| The provider reports   | KYCAID                                                                                                               | Sum&Sub                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Not started            | `unused`, recorded as `init`                                                                                         | `init`, from the created webhook                                                         |
| In progress, no result | `pending`                                                                                                            | `pending`, `queued`, `prechecked` or `onHold`, from the pending and on-hold webhooks too |
| Finished               | `completed`: `verified` true is `GREEN`, false is `RED`, null is no result                                           | `completed` with its `reviewAnswer`                                                      |
| A status poll          | the applicant's last verification: `pending`; `valid` is `completed` and `GREEN`; `invalid` is `completed` and `RED` | the review status, normalized through the same mapping as a webhook                      |
| Reasons                | each check's `decline_reasons` and the applicant's, once each                                                        | `reviewResult.rejectLabels`                                                              |
| Identity document      | the type of the applicant's latest valid identity document; no country                                               | approved `IDENTITY` steps from `requiredIdDocsStatus`, including the issuing country     |
| PEP evidence           | the applicant's `pep` flag, or a failed `pep` check                                                                  | with `RED`, the `PEP` label or `pep` button; with `GREEN`, the fetched AML case          |

## When a result counts

A result counts only once the provider reports the check completed. Sum&Sub says
so of `reviewAnswer`, so an answer reported beside another status, such as a
provisional `GREEN` while `awaitingService`, or with no `reviewStatus` at all, is
not recorded, and a status poll that brings no result writes nothing. KYCAID's
`verified` is read as a JSON boolean or the string `true` or `false`; anything
else is no result. A verification status KYCAID does not document is recorded as
`pending` with no result, and a status-changed callback carrying one changes
nothing; both are logged. A callback and an applicant record are read by separate
mappings, so neither is mistaken for the other. Sum&Sub's created, pending and
on-hold webhooks record their status in `verification_status`, the field the apps
read, as well as in `sumsub_verification_status`, unless the profile has since
moved to KYCAID.

## Identity documents

KYCAID's document objects carry a type, a number, dates and an issuing authority
but no country, so the foreign-passport factor remains unset. Neither provider's
applicant country or nationality is inferred as an issuing country. On a Sum&Sub
approval, the integration reads [verification step results](https://docs.sumsub.com/reference/get-status-of-verification-steps)
and records an approved identity document, preferring a passport. Its alpha-3
issuing country is converted to alpha-2 where ISO defines it.
When a completed GREEN result has no current identity document, either provider
clears the stored type and issuing country. Pending results with no current
identity document retain earlier verified evidence. A valid KYCAID document
records its type with no issuing country, including when an earlier result had
supplied a country.

## The Sum&Sub AML case

The same approval then reads [the applicant's AML case](https://docs.sumsub.com/reference/get-aml-case-data).
The token needs **View applicants** and **View AML screening** permissions. The
AML endpoint allows ten requests per minute; a shared Redis window applies that
limit across applicants and workers. Exhaustion, unavailable Redis, a failed
provider request or malformed evidence leaves the approval unapplied. The
webhook answers 500 for Sum&Sub to resend; a status poll retains the cached
pending result and can try again. Provider calls happen before the apply
transaction, and each completed GREEN approval makes both reads. Rejections and
unfinished reviews make neither extra read.

A PEP hit in that fetched case counts unless it is marked `false_positive` or
`no_match`; a case that omits its hits can supply the `pep` case label. Only the
hit ID, match status and labels are retained as evidence, without names or source
URLs. Sum&Sub does not provide the PEP's locality or category here, so the risk
assessment records **PEP category not provided** (`unknown`) with
`approved_by_provider`, and adds the existing accepted-PEP customer score
adjustment of two under `provider_approved_pep`. It does not invent a domestic
category or overturn Sum&Sub's completed approval. This is the owner's decision
to respect the officer's clearance and retain the PEP risk weighting. FATF
black-list rejection still applies. The authenticated callback always replaces
any supplied AML or document fields with fetched evidence; unsigned callbacks
never cause a read.

## PEP rules

Rejected PEP evidence from either provider still uses the shared classifier in
`integrations/kyc/pep.py`, and KYCAID's yes-or-no PEP flag remains a foreign PEP
under its existing rejection policy. Known foreign, international-organisation,
family and associate categories are rejected; existing domestic categories keep
their existing score adjustment. No sanctions rejection is overridden.

## What applicants see

Applicants never see a screening reason. The identity status and the profile
show `UNABLE_TO_VERIFY` in place of the reject labels and decline reasons that
report a list match (`PEP`, `SANCTIONS`, `COMPROMISED_PERSONS`, `ADVERSE_MEDIA`,
`CRIMINAL`, `BLOCKLIST` and `RESTRICTED_PERSON` from Sum&Sub, `COMPROMISED_PERSON`
from KYCAID), once, and every other reason as it is. The stored labels keep every
reason, staff see them in the admin, and the identity notifications name none.

## KYCAID approvals and screening callbacks

A KYCAID approval is recorded only once the applicant's `pep` flag is read as
true or false, accepting a JSON boolean or the existing strings `true` and
`false`. The [Get applicant reference](https://docs.kycaid.com/objects/applicants/applicant-get)
types this flag as boolean or null; null does not establish that the person is
not a PEP. When the callback's applicant is missing, is not an object, has no
`pep` key or carries a null or uninterpretable flag, the applicant record is read
first; if that read fails the callback answers 500, KYCAID retries it, and the
user's next status poll applies the result as well. An approval whose applicant
record still supplies no interpretable flag, by callback or by poll, is recorded
as `pending` with no result and logged. Every result is applied with the
profile's row locked, so a callback and a poll that arrive together activate the
account, assess its risk and notify the person once; no provider is called while
that lock is held.

KYCAID's `DATABASE_SCREENING` callback reports a match that its monitoring finds
on a sanctions, PEP, wanted, lost-or-stolen-document or internal list. Each one
raises a compliance alert under rule `KYC-SCREEN` for staff review, and the
account, the identity result and the risk assessment are left as they are. A
sanctions match is a critical `sanctions_match`, a wanted-list match a critical
`watchlist_match`, a PEP match a high `pep_match`, and any other list a high
`watchlist_match`; `sync_procedure_templates` loads a staff procedure for each of
the three types. The alert keeps the list types, the databases, the accuracy,
the verification and document ids and the matched person's details. A callback
repeating a match already raised, whatever that alert's status, raises nothing:
the account is locked while the alert is looked for, so retried or concurrent
deliveries raise one alert. The callback is authenticated as every KYCAID
callback is.

## Provider documentation

KYCAID's documentation disagrees with itself in two places. The current
reference types the applicant's `verification_status` as `any`; only the legacy
reference lists `pending`, `valid` and `invalid`, which is what the poll reads.
The current Verification completed page says that callback is sent when a user
submits the form, with the status `pending`, and the Verification status changed
page says that one is sent when a status is set, with `completed`. The callbacks
overview and the legacy reference say the opposite. The mapping does not depend
on either reading: each callback is read by the status it carries.

Sources, read on 2 October 2026: KYCAID's
[Verification completed](https://docs.kycaid.com/callbacks/verification-completed),
[Verification status changed](https://docs.kycaid.com/callbacks/verification-status-changed),
[Database screening](https://docs.kycaid.com/callbacks/database-screening),
[callbacks overview](https://docs.kycaid.com/callbacks/overview),
[form integration](https://docs.kycaid.com/guides/form-integration),
[decline reasons](https://docs.kycaid.com/decline-reasons) and the
[legacy API reference](https://docs-v1.kycaid.com/) for the verification,
applicant and document objects and database screening; Sum&Sub's
[Get applicant review status](https://docs.sumsub.com/reference/get-applicant-review-status),
[applicant statuses](https://docs.sumsub.com/docs/applicant-statuses),
[rejection labels](https://docs.sumsub.com/docs/rejection-labels),
[rejection explanatory buttons](https://docs.sumsub.com/reference/rejected),
[AML screening](https://docs.sumsub.com/docs/aml-how-it-works),
[applicant risk labels](https://docs.sumsub.com/docs/applicant-risk-labels) and
[AML case data](https://docs.sumsub.com/reference/get-aml-case-data).
