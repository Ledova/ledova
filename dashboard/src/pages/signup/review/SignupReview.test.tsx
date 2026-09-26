// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { COMPLETION_FAILED, type ReviewHookReturn } from './useReview';
import { SignupReview } from './SignupReview';

const review = vi.hoisted(() => ({ state: {} as Partial<ReviewHookReturn> }));
vi.mock('./useReview', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./useReview')>()),
  useReview: () => review.state,
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@components/AuthLayout', () => ({
  AuthLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

afterEach(cleanup);

it('shows why finishing failed next to the button that retries it', () => {
  review.state = {
    data: { userProfile: null, financialProfile: null },
    company: null,
    signupRole: 'investor',
    isLoading: false,
    error: null,
    completionError: COMPLETION_FAILED,
    completeSignup: vi.fn(),
    isSubmitting: false,
    canCompleteSignup: true,
    retryLoad: vi.fn(),
  };

  render(<SignupReview />);

  expect(screen.getByRole('alert').textContent).toBe(COMPLETION_FAILED);
  expect((screen.getByRole('button', { name: 'Complete Signup' }) as HTMLButtonElement).disabled).toBe(false);
});
