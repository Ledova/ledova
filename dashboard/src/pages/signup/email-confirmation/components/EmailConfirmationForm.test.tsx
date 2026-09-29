// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMAIL_VERIFICATION_FIELDS } from '@ledova/shared';

import { EmailConfirmationForm } from './EmailConfirmationForm';

const A_MESSAGE: Record<string, string> = { token: 'Invalid email or verification code.' };

describe('every field EMAIL_VERIFICATION_FIELDS names is one this form actually renders', () => {
  afterEach(cleanup);

  it.each(EMAIL_VERIFICATION_FIELDS)('renders the error it is handed for %s', (field) => {
    render(
      <EmailConfirmationForm
        verificationCode="123456"
        errors={{ [field]: [A_MESSAGE[field]] }}
        generalError=""
        successMessage=""
        isLoading={false}
        isResending={false}
        setVerificationCode={vi.fn()}
        onSubmit={vi.fn()}
        onResendCode={vi.fn()}
        onBack={vi.fn()}
      />,
    );

    expect(screen.getByText(A_MESSAGE[field])).toBeDefined();
  });
});
