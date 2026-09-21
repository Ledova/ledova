# Companies and investor eligibility

[Architecture](README.md) · [Documentation](../README.md)

How company verification and investor eligibility bound access to offers.

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
`companies/services/company.py:_registry_transition` starts
`companies/services/registry.py:perform_registry_check`, which calls
`integrations/abr/client.py:lookup_company`, on review, on retry and on every
activation path. Activation fails closed: `Company._require_activation_check`
calls `_require_attestation()` first, so a missing or stale officeholder
attestation raises `OfficeholderAttestationRequiredException`; it then raises
`RegistryVerificationRequiredException` unless the current check PASSED for the
ACTIVATION purpose against this `lifecycle_revision` **and this identity**,
which `companies/identity.py:company_identity` defines as name (NFKC-casefolded,
whitespace-collapsed), ACN, ABN and `company_type`.

With the operator's `issuer_kyc_required` on, the same service refuses to submit
or resubmit a company, or to make it active by activation, warning resolution or
reinstatement, unless the owner's profile is identity-verified (`is_id_verified`).
The refusal is a 400 with code `issuer_identity_verification_required`. Activation
checks it before spending a registry check and again at the transition. Every later
issuer action relies on that gate. With the switch off nothing changes.

Reference: `backend/companies/validators.py`. Gates:
`backend/companies/tests/test_identifier_checksums.py`, whose fixtures are the
**published worked examples** — ASIC's `004 085 616` and the ABR number above —
not numbers this codebase generated, because expected values taken from the
implementation under test agree with themselves for any algorithm, including a
wrong one; and `backend/companies/tests/test_registry_verification.py` for the
activation gate.

## Investor eligibility

[The eligibility service](../../backend/users/services/eligibility.py) owns the
predicate. It requires an investing account in good standing and a live classification.
With `investor_kyc_required` on, pending accounts and an unverified profile are
refused; with it off, pending alone does not refuse. Rejected, suspended and
terminated accounts remain refused. `issuer_kyc_required` gates the company
lifecycle above, not investor eligibility.

`investor_eligibility(user, company=...)` answers discovery questions;
`account_eligibility(account, company=..., amount_aud=...)` binds the actual account.
Subscriptions use `require_subscription_eligibility` so the claim must cover the
issuer and, for product-value claims, the subscription amount. This is distinct
from on-chain recipient whitelisting.

Directory selectors allow a globally eligible investor to discover companies, or
restrict an associated-person investor to the companies their live claims name.
The secondary market uses the unscoped predicate and receives no widening from
associated-person claims. Inaccessible list/detail querysets produce empty lists
or 404; they do not confirm a hidden row with 403. Operator payment instructions
use eligibility for at least one company.

Next: [offerings](offerings.md), [subscriptions](subscriptions.md),
[registry verification procedure](../operations/integrations.md#company-registry-verification),
and [legal positions](../legal/positions.md).
