# Companies and investor eligibility

[Architecture](README.md) · [Documentation](../README.md)

How company activation and participant eligibility bound access to offers.
Companies [activate themselves](../plans/company-managed-registers/company-activation.md)
and [decide their own participants' eligibility](../plans/company-managed-registers/company-eligibility.md);
company details are provided by the company, never verified by Ledova. A
declaration or checksum-valid ACN does not fabricate success for a separate
configured provider check.

## Company identifiers

An ACN and an ABN are checked for their check digits, not only their length, on
validated form and serializer write paths: the fields carry the algorithms in
`backend/companies/validators.py` as `validators=[...]`, so the admin's
`ModelForm.full_clean` and the serializers both run them and the API answers
400. A direct ORM write runs no validator, and the database has no checksum
constraint. `Company.clean()` carries the one rule needing both fields: an
ASIC-registered company's ABN is its ACN with two check digits in front, which
does not hold for ABNs in general. The ABN check is a modulus of 89 and catches
every single-digit error; the ACN check is a weighted modulus of 10 and does
not. A checksum is a typo filter, not verification: only a registry lookup says
a number belongs to a real company.

## Activation

Companies [activate themselves](../plans/company-managed-registers/company-activation.md).
`companies/services/activation.py:activate_company` records a distinct
activation attempt and calls `companies/services/registry.py:perform_registry_check`,
which uses `integrations/abr/client.py:lookup_company`. It requires an exact
current personal administrator appointment and accepted declaration; owner,
draft setup, delegatable capability, staff status and shareholding supply no
activation authority. With `issuer_kyc_required` on, an administrator whose
profile is not identity-verified receives 400
`issuer_identity_verification_required` before an attempt or provider request,
and the API redacts activation readiness and attempt details without current
administrator access. A passing ABR result must match the company identity and
revision the attempt captured; same-key retries reuse the attempt and changed
requests conflict. Technical warning recovery and reinstatement remain bounded
staff functions in `companies/services/company.py:_registry_transition`, which
require a fresh registry pass and do not reintroduce staff initial activation.

## Participant eligibility

Eligibility is one company's decision about one participant. A participant
submits a classification source and requests a decision from a company; a
current company approver accepts it with a bounded expiry or refuses it, and can
revoke it ([company eligibility](../plans/company-managed-registers/company-eligibility.md)).
`users/services/company_eligibility.py` records those decisions and
`users/services/company_eligibility_consumption.py` consumes them:
`company_eligibility(account, company, purpose=...)` and
`subscription_eligibility(account, offering, quantity)` evaluate the current
decision, standing and evidence at the time of the action, and
`require_subscription_eligibility` and
`require_subscription_acceptance_eligibility` apply them to a subscription, so
the decision must cover the offering's company and, for a product-value claim,
the exact offering, quantity and amount. A decision is per company: an
acceptance by one company supplies no permission with another. This is distinct
from on-chain recipient whitelisting, which is a separate
[company wallet instruction](../plans/company-managed-registers/company-wallet-approvals.md).

Account readiness is separate. `investor_readiness(user)` in
[the eligibility service](../../backend/users/services/eligibility.py) requires an
investing account in good standing; with `investor_kyc_required` on, pending
accounts and an unverified profile are refused, and with it off pending alone
does not refuse. Rejected, suspended and terminated accounts remain refused.
`issuer_kyc_required` concerns company representatives: with it on, every
company-authority act (initial admission, appointment acceptance, activation,
administration, eligibility decisions, and register and wallet decisions)
requires the representative's verified identity.

Discovery follows the decisions. `directory_admission(user)` admits a
participant to the companies and exact products their current decisions cover,
and the same selector decides who opens the documents of a class's approved
offerings ([offerings](offerings.md)); `secondary_company_ids(user)` bounds the
market the same way, with no widening from an associated-person decision.
Inaccessible list/detail querysets produce empty lists or 404; they do not
confirm a hidden row with 403. Operator payment instructions are shown to
platform staff and to holders of a current secondary-market decision from at
least one company.

Next: [offerings](offerings.md), [subscriptions](subscriptions.md),
[registry verification procedure](../operations/integrations.md#company-registry-verification),
and [legal positions](../legal/positions.md).
