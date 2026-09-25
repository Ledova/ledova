// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { SignupPreScreening } from './SignupPreScreening';

const hook = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock('./useSignupPreScreening', () => ({ useSignupPreScreening: () => hook.state }));

afterEach(() => {
  cleanup();
});

it('asks each eligibility declaration as a named checkbox that the keyboard can tick', async () => {
  const setFieldValue = vi.fn();
  const toggleWholesaleOnly = vi.fn();
  hook.state = {
    form: { confirmedOver18: false, confirmedAustralianResident: true, confirmedIndividualAccount: false },
    acknowledgedWholesaleOnly: false,
    toggleWholesaleOnly,
    generalError: '',
    isLoading: false,
    isSubmitting: false,
    isFormValid: false,
    setFieldValue,
    handleSubmit: vi.fn(),
    retryLoad: vi.fn(),
  };
  render(
    <MemoryRouter>
      <SignupPreScreening />
    </MemoryRouter>,
  );

  const over18 = screen.getByRole('checkbox', { name: 'I am 18 years or older' });
  expect(over18.getAttribute('aria-checked')).toBe('false');
  expect(
    screen.getByRole('checkbox', { name: 'I am currently an Australian resident' }).getAttribute('aria-checked'),
  ).toBe('true');
  expect(screen.getByRole('checkbox', { name: 'I am acting on my own behalf' })).toBeTruthy();

  over18.focus();
  await userEvent.keyboard(' ');
  expect(setFieldValue).toHaveBeenCalledWith('confirmedOver18', true);

  const wholesale = screen.getByRole('checkbox', { name: 'I understand share offerings here are wholesale only' });
  wholesale.focus();
  await userEvent.keyboard(' ');
  expect(toggleWholesaleOnly).toHaveBeenCalledTimes(1);
});
