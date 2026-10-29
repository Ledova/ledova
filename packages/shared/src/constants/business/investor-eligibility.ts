import type { CertifierBody, InvestorCategory, InvestorReadinessReason } from '../../types';

export const CATEGORIES: {
  category: InvestorCategory;
  label: string;
  section: string;
  evidence: string;
}[] = [
  {
    category: 'accountant_certificate',
    label: "Qualified accountant's certificate",
    section: 's708(8)(c)',
    evidence: 'A certificate issued in the last two years by a CA ANZ, CPA Australia or IPA member.',
  },
  {
    category: 'professional_investor',
    label: 'Professional investor',
    section: 's708(11)',
    evidence: 'Your AFS licence, your regulator registration, or proof of AUD 10 million under management.',
  },
  {
    category: 'associated_person',
    label: 'Associated with the issuer',
    section: 's708(12)',
    evidence: 'Proof of your role with the named issuer, such as an ASIC extract naming you.',
  },
];

export const INVESTOR_CATEGORY_LABELS = Object.fromEntries(
  CATEGORIES.map(({ category, label }) => [category, label]),
) as Record<InvestorCategory, string>;

export const CERTIFIER_BODY_LABELS: Record<CertifierBody, string> = {
  ca_anz: 'Chartered Accountants Australia and New Zealand',
  cpa_australia: 'CPA Australia',
  ipa: 'Institute of Public Accountants',
};

export function certifierBodies(caAnzLabel: string): { value: CertifierBody; label: string }[] {
  return [
    { value: 'ca_anz', label: caAnzLabel },
    { value: 'cpa_australia', label: CERTIFIER_BODY_LABELS.cpa_australia },
    { value: 'ipa', label: CERTIFIER_BODY_LABELS.ipa },
  ];
}

export const REASON_TEXT: Record<InvestorReadinessReason, string> = {
  no_investor_account: 'This login has no investor account.',
  account_not_in_good_standing: 'Your account is not in good standing.',
  identity_not_verified: 'Verify your identity from Profile.',
  actor_not_ready: 'Your login must be active and your email verified.',
  principal_required: 'Sign in again to check your own account.',
};

export const COMPANY_ELIGIBILITY_UNMET_COPY: Record<string, string> = {
  participant_account_inactive: 'The investor’s account must be active, with its email verified.',
  participant_investor_account_required: 'The account must be an investor account.',
  participant_identity_required: 'The investor’s identity must be verified first.',
  company_inactive: 'The company must be active.',
  source_not_current: 'The investor classification claim is no longer current.',
  source_expired: 'The investor classification claim has expired.',
  source_declaration_invalid: 'The classification claim’s declaration is missing or out of date.',
  source_not_submitted: 'The classification claim has not been submitted.',
  source_evidence_unavailable: 'The classification claim’s evidence is no longer available.',
  associated_company_mismatch: 'The associated-person claim names a different company.',
  certificate_not_current: 'The accountant’s certificate is not current or is missing the certifier’s details.',
  requested_expiry_not_future: 'Choose an expiry in the future.',
  personal_approve_required: 'Your appointment must include approving eligibility decisions.',
  request_already_resolved: 'This request has already been withdrawn or decided.',
  decision_expiry_invalid: 'Choose an expiry in the future, no later than the request and its claim allow.',
  acceptance_reason_not_empty: 'An acceptance takes no reason.',
  request_evidence_changed: 'The claim’s evidence changed after this request was submitted.',
};
