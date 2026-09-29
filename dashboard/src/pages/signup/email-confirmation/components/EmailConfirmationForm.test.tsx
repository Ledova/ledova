// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_VERIFICATION_FIELDS } from '@ledova/shared';

import { EmailConfirmationForm } from './EmailConfirmationForm';

const A_MESSAGE: Record<string, string> = { token: 'Invalid email or verification code.' };

const REFUSABLE = ['token', 'email', 'nonFieldErrors'];

function formWith(errors: Record<string, string[]>) {
  return (
    <EmailConfirmationForm
      verificationCode="123456"
      errors={errors}
      generalError=""
      successMessage=""
      isLoading={false}
      isResending={false}
      setVerificationCode={vi.fn()}
      onSubmit={vi.fn()}
      onResendCode={vi.fn()}
      onBack={vi.fn()}
    />
  );
}

describe('EMAIL_VERIFICATION_FIELDS names the fields this form renders a refusal under', () => {
  afterEach(cleanup);

  it.each(EMAIL_VERIFICATION_FIELDS)('renders the error it is handed for %s', (field) => {
    render(formWith({ [field]: [A_MESSAGE[field]] }));

    expect(screen.getByText(A_MESSAGE[field])).toBeDefined();
  });

  it('names every field the form renders one under, and nothing else', () => {
    render(formWith(Object.fromEntries(REFUSABLE.map((key) => [key, [`Refused ${key}.`]]))));

    const rendered = REFUSABLE.filter((key) => screen.queryByText(`Refused ${key}.`));
    expect(new Set(rendered)).toEqual(new Set(EMAIL_VERIFICATION_FIELDS));
  });
});
