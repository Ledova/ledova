// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { SignupReview } from './SignupReview';
import { useReview } from './useReview';
import {
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  COMPANY_SIGNUP_DECLARATION,
  COMPANY_SIGNUP_DECLARATION_VERSION,
} from '@ledova/shared';
import { APPOINTMENT } from '../../../../../packages/shared/tests/fixtures/employee-awards';
import { appointmentReceipt } from '../../company/team/appointments';

vi.mock('./useReview', () => ({ useReview: vi.fn() }));

it('reuses saved company details and clearly accepts authority and Terms through explicit completion without checkboxes or uploads', () => {
  const state = {
    data: { userProfile: { fullName: 'Example Director', residentialAddress: '' }, financialProfile: null },
    company: { uuid: 'company-a', name: 'Example Company', acn: '123456789', companyType: 'pty' },
    isCompany: true,
    isLoading: false,
    error: null,
    completionError: null,
    completeSignup: vi.fn().mockResolvedValue(undefined),
    isSubmitting: false,
    canCompleteSignup: false,
    retryLoad: vi.fn(),
    authorityRequest: null,
    authorityReady: false,
    authorityError: null,
    resetAuthorityRequest: vi.fn().mockResolvedValue(undefined),
    isResettingAuthority: false,
  };
  vi.mocked(useReview).mockReturnValue(state as never);
  const view = render(
    <MemoryRouter>
      <SignupReview />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Complete company setup' })).toBeTruthy();
  expect(screen.getByText('Example Company')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Complete company setup' }).hasAttribute('disabled')).toBe(true);
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByLabelText('Supporting document')).toBeNull();
  expect(screen.queryByText('Allow me to appoint company administrators')).toBeNull();
  expect(
    screen.getByText(/By completing setup, you confirm that you are authorised to administer Example Company/),
  ).toBeTruthy();
  expect(screen.getByRole('link', { name: /Terms of Service/ }).getAttribute('href')).toMatch(/terms-of-service$/);
  expect(state.completeSignup).not.toHaveBeenCalled();

  vi.mocked(useReview).mockReturnValue({
    ...state,
    authorityError: 'Your saved setup has expired. Update the saved setup to continue.',
    authorityRequest: {
      status: 'pending',
      originalFilename: 'saved.pdf',
      requestedCapabilities: ['admin'],
      delegatableCapabilities: ['admin'],
      requestedExpiresAt: '2020-10-14T00:00:00Z',
    },
  } as never);
  view.rerender(
    <MemoryRouter>
      <SignupReview />
    </MemoryRouter>,
  );
  expect(screen.queryByLabelText('Supporting document')).toBeNull();
  expect(screen.getByRole('alert').textContent).toMatch(/saved setup has expired/);
  fireEvent.click(screen.getByRole('button', { name: 'Update saved setup' }));
  expect(state.resetAuthorityRequest).toHaveBeenCalledTimes(1);

  vi.mocked(useReview).mockReturnValue({ ...state, authorityReady: true, canCompleteSignup: true } as never);
  view.rerender(
    <MemoryRouter>
      <SignupReview />
    </MemoryRouter>,
  );
  expect(screen.queryByLabelText('Supporting document')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Complete company setup' }));
  expect(state.completeSignup).toHaveBeenCalledTimes(1);
  view.unmount();
  const revoked = {
    ...APPOINTMENT,
    source: 'initial' as const,
    status: 'revoked' as const,
    isEffective: false,
    revokedAt: '2026-10-14T00:00:00Z',
    declarationVersion: COMPANY_SIGNUP_DECLARATION_VERSION,
    declarationText: COMPANY_SIGNUP_DECLARATION,
  };
  expect(appointmentReceipt(revoked)).toBe(true);
  expect(appointmentReceipt({ ...revoked, source: 'invitation' })).toBe(false);
  expect(appointmentReceipt({ ...revoked, declarationText: 'Changed terms' })).toBe(false);
  expect(
    appointmentReceipt({
      ...revoked,
      declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION,
      declarationText: COMPANY_AUTHORITY_DECLARATION,
    }),
  ).toBe(true);
});
