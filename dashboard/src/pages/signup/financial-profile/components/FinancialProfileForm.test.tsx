// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FINANCIAL_PROFILE_FIELDS } from '@ledova/shared';

import { FinancialProfileForm } from './FinancialProfileForm';

const A_MESSAGE: Record<string, string> = {
  sourceOfFunds: 'Choose at least one source of funds.',
  sourceOfFundsOtherText: 'Describe the other source in fewer words.',
  intendedUse: 'Choose how you will use the platform.',
  intendedUseOtherText: 'Describe the other use in fewer words.',
  occupation: 'Ensure this field has no more than 200 characters.',
};

describe('every field FINANCIAL_PROFILE_FIELDS names is one this form actually renders', () => {
  afterEach(cleanup);

  it.each(FINANCIAL_PROFILE_FIELDS)('renders the error it is handed for %s', (field) => {
    render(
      <FinancialProfileForm
        form={{
          userProfileId: 'profile-1',
          occupation: 'Engineer',
          sourceOfFunds: ['savings', 'other'],
          sourceOfFundsOtherText: 'Consulting',
          intendedUse: 'other',
          intendedUseOtherText: 'Research',
        }}
        errors={{ [field]: [A_MESSAGE[field]] }}
        generalError=""
        isSubmitting={false}
        setFieldValue={vi.fn()}
        onSubmit={vi.fn()}
      />,
    );

    expect(screen.getByText(A_MESSAGE[field])).toBeDefined();
  });
});
