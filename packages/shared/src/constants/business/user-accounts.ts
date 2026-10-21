export const IDENTITY_CHECK_COPY = {
  STEP: 'Verify your identity',
  NOTE: 'Your identity check, used where activation or eligibility requires it.',
};

export const IDENTITY_OUTCOME_COPY = {
  verified: { title: 'Already verified', body: 'Your identity has been verified successfully.' },
  pending: {
    title: 'Verification submitted',
    body: "Your documents have been submitted. We'll review them shortly and notify you of the result.",
  },
  onHold: {
    title: 'Verification on hold',
    body: 'Your verification is currently on hold. We may need additional information. Please check back later or contact support.',
  },
  rejected: {
    title: 'Verification rejected',
    body: 'Unfortunately, your verification was not approved. You may retry with different documents or contact support for assistance.',
  },
  retry: {
    title: 'Retry needed',
    body: 'Your previous verification attempt needs to be retried. Please try again with clearer documents.',
  },
} as const;

export const VERIFICATION_TONES = new Map<string, 'done' | 'closed'>([
  ['verified', 'done'],
  ['rejected', 'closed'],
]);

export const SOURCE_OF_FUNDS_OPTIONS = [
  { value: 'employment_income', label: 'Employment income' },
  { value: 'business_income', label: 'Business income' },
  { value: 'savings', label: 'Savings' },
  { value: 'investment_income', label: 'Investment income' },
  { value: 'sale_of_assets', label: 'Sale of assets' },
  { value: 'inheritance', label: 'Inheritance' },
  { value: 'gift', label: 'Gift' },
  { value: 'other', label: 'Other' },
];
