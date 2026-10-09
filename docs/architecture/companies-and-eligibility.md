# Companies and investor eligibility

[Architecture](README.md) · [Documentation](../README.md)

How company activation and participant eligibility bound access to offers.
Companies [activate themselves](../plans/company-managed-registers/company-activation.md)
and [decide their own participants' eligibility](../plans/company-managed-registers/company-eligibility.md);
company details are provided by the company, never verified by Ledova. A
declaration or checksum-valid ACN does not fabricate success for a separate
configured provider check.

## Company identifiers

An ACN and an ABN are checked for their **check digits**, not only their length,
on validated form and serializer write paths: the fields carry the algorithms as `validators=[...]`, so
the admin's `ModelForm.full_clean` and the serializers both run them and the API
answers 400 rather than 500. **The residual gap is a direct ORM write**:
`Company.objects.create(acn=...)` runs no validator, and the database has no checksum constraint.

`Company.clean()` carries the one rule needing both fields: **an Australian
company's ABN is its ACN with two check digits in front**. That holds for
ASIC-registered companies, which is every `company_type` here, but not for ABNs
in general: the last nine digits of the ABR's own published example, `83 914 571
673`, are not a valid ACN. A test pins that, so no later reader widens the rule
to all ABNs.

The ABN check is a modulus of 89, prime and larger than any weight, so it
catches **every** single-digit error. The ACN check is a weighted modulus of 10
and five of its eight weights share a factor with 10, so it does not: corrupting
one digit of ASIC's published example gives 81 candidates and the check accepts
8, each at a position weighted 8, 6, 5, 4 or 2.
`test_the_acn_check_misses_only_what_a_modulus_of_ten_cannot_see` asserts that
shape rather than a count, and that the set is non-empty so the limitation
cannot quietly disappear.

**A checksum is a typo filter, not verification**: only a registry lookup says a
number belongs to a real company.
`companies/services/activation.py:activate_company` records a distinct activation
attempt and calls `companies/services/registry.py:perform_registry_check`, which
uses `integrations/abr/client.py:lookup_company`. It requires an exact current
personal administrator appointment and accepted declaration for the company.
Owner, draft setup, delegatable capability, staff status and shareholding supply
no activation authority. Identity uses the representative actually instructing
the action, rather than assuming the company's owner is the decision maker.

With `issuer_kyc_required` on, an otherwise current administrator whose profile
is not identity-verified receives 400 with
`issuer_identity_verification_required` before an attempt or provider request.
The service checks the actor and configured requirement again at the effect.
The API redacts activation readiness and attempt details when current personal
administrator access or the configured identity check is absent.

A passing ABR result must match the exact company identity and revision captured
by the attempt. The initial ACTIVE effect and immutable applied receipt commit
atomically. Neither a declaration nor an earlier admission/registry pass can
substitute for this activation check. Same-key retries reuse the recorded attempt;
changed requests conflict. Provider work runs outside SQL locks and transactions.

Technical warning recovery and reinstatement remain bounded staff functions in
`companies/services/company.py:_registry_transition`. They require a fresh registry
pass and either genuine applied initial activation provenance or the retained
legacy officeholder attestation. They do not reintroduce staff initial activation.

Reference: `backend/companies/validators.py`. Gates:
`backend/companies/tests/test_identifier_checksums.py`, whose fixtures are the
**published worked examples** — ASIC's `004 085 616` and the ABR number above —
not numbers this codebase generated, because expected values taken from the
implementation under test agree with themselves for any algorithm, including a
wrong one; and `backend/companies/tests/test_registry_verification.py` for retained technical
recovery and `backend/companies/tests/test_company_activation.py`,
`test_company_activation_scoped.py` and `test_company_activation_migration.py`
for current activation and upgrade controls.

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
`issuer_kyc_required` concerns company representatives: with it on, initial
admission, activation and company decisions require the representative's
verified identity.

Discovery follows the decisions. `directory_admission(user)` admits a
participant to the companies and exact products their current decisions cover,
and the same selector decides who opens the documents of a class's approved
offerings ([offerings](offerings.md)); `secondary_company_ids(user)` bounds the
market the same way, with no widening from an associated-person decision.
Inaccessible list/detail querysets produce empty lists or 404; they do not
confirm a hidden row with 403. Operator payment instructions use eligibility for
at least one company.

Next: [offerings](offerings.md), [subscriptions](subscriptions.md),
[registry verification procedure](../operations/integrations.md#company-registry-verification),
and [legal positions](../legal/positions.md).
