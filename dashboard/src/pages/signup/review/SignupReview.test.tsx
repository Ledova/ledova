// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, it, vi } from 'vitest';
import { SignupReview } from './SignupReview';
import { useReview } from './useReview';

vi.mock('./useReview', () => ({ useReview: vi.fn() }));

it('reuses saved company details and presents initial authority, retained scopes and confirmed completion', () => {
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
    authorityEvidenceLocked: false,
    authorityError: null,
    setAuthorityEvidence: vi.fn(),
    authorityAccepted: false,
    setAuthorityAccepted: vi.fn(),
    allowTeamDelegation: false,
    setAllowTeamDelegation: vi.fn(),
    resetAuthorityRequest: vi.fn().mockResolvedValue(undefined),
    isResettingAuthority: false,
  };
  vi.mocked(useReview).mockReturnValue(state as never);
  const view = render(
    <MemoryRouter>
      <SignupReview />
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Finish company setup' })).toBeTruthy();
  expect(screen.getByText('Example Company')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Complete company signup' }).hasAttribute('disabled')).toBe(true);
  const delegation = screen.getByRole('checkbox', {
    name: 'Allow me to appoint company administrators',
  }) as HTMLInputElement;
  expect(delegation.checked).toBe(false);
  const file = new File(['example'], 'authority.pdf', { type: 'application/pdf' });
  fireEvent.change(screen.getByLabelText('Supporting document'), { target: { files: [file] } });
  expect(state.setAuthorityEvidence).toHaveBeenCalledWith(file);
  fireEvent.click(screen.getByRole('checkbox', { name: /I am authorised to administer/ }));
  expect(state.setAuthorityAccepted).toHaveBeenCalledWith(true);

  vi.mocked(useReview).mockReturnValue({
    ...state,
    authorityRequest: {
      status: 'pending',
      originalFilename: 'saved.pdf',
      requestedCapabilities: ['admin'],
      delegatableCapabilities: ['admin'],
    },
  } as never);
  view.rerender(
    <MemoryRouter>
      <SignupReview />
    </MemoryRouter>,
  );
  expect(screen.getByText('Saved supporting document: saved.pdf')).toBeTruthy();
  expect(screen.queryByLabelText('Supporting document')).toBeNull();
  expect(screen.getByText(/Permission to delegate: Manage company information and team/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Use different evidence' }));
  expect(state.resetAuthorityRequest).toHaveBeenCalledTimes(1);

  vi.mocked(useReview).mockReturnValue({ ...state, authorityReady: true, canCompleteSignup: true } as never);
  view.rerender(
    <MemoryRouter>
      <SignupReview />
    </MemoryRouter>,
  );
  expect(screen.getByRole('status').textContent).toMatch(/administrator access.*established/);
  expect(screen.queryByLabelText('Supporting document')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Complete company signup' }));
  expect(state.completeSignup).toHaveBeenCalledTimes(1);
  view.unmount();
});
