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

const REFUSABLE = [
  'userProfileId',
  'occupation',
  'sourceOfFunds',
  'sourceOfFundsOtherText',
  'intendedUse',
  'intendedUseOtherText',
  'nonFieldErrors',
];

function formWith(errors: Record<string, string[]>) {
  return (
    <FinancialProfileForm
      form={{
        userProfileId: 'profile-1',
        occupation: 'Engineer',
        sourceOfFunds: ['savings', 'other'],
        sourceOfFundsOtherText: 'Consulting',
        intendedUse: 'other',
        intendedUseOtherText: 'Research',
      }}
      errors={errors}
      generalError=""
      isSubmitting={false}
      setFieldValue={vi.fn()}
      onSubmit={vi.fn()}
    />
  );
}

describe('FINANCIAL_PROFILE_FIELDS names the fields this form renders a refusal under', () => {
  afterEach(cleanup);

  it.each(FINANCIAL_PROFILE_FIELDS)('renders the error it is handed for %s', (field) => {
    render(formWith({ [field]: [A_MESSAGE[field]] }));

    expect(screen.getByText(A_MESSAGE[field])).toBeDefined();
  });

  it('names every field the form renders one under while both "other" details show, and nothing else', () => {
    render(formWith(Object.fromEntries(REFUSABLE.map((key) => [key, [`Refused ${key}.`]]))));

    const rendered = REFUSABLE.filter((key) => screen.queryByText(`Refused ${key}.`));
    expect(new Set(rendered)).toEqual(new Set(FINANCIAL_PROFILE_FIELDS));
  });
});
