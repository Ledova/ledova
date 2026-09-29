// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SIGNUP_USER_FIELDS } from '@ledova/shared';
import { SignupUser } from './SignupUser';

const hook = vi.hoisted(() => ({
  state: {} as Record<string, unknown>,
  remember: undefined as undefined | ((email: string) => unknown),
}));
vi.mock('@ledova/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ledova/shared')>()),
  useSignupUser: (remember: (email: string) => unknown) => {
    hook.remember = remember;
    return hook.state;
  },
}));

afterEach(cleanup);

it('lists the password rules as marked lines under the field, not in a box, and marks a broken rule', () => {
  hook.state = {
    form: { email: '', password: '1234', passwordConfirm: '1234' },
    errors: {},
    generalError: '',
    isLoading: false,
    showPassword: false,
    passwordValidation: { isValid: false, lengthValid: false, notNumeric: false },
    setFieldValue: vi.fn(),
    togglePassword: vi.fn(),
    handleSubmit: vi.fn(),
  };
  render(
    <MemoryRouter>
      <SignupUser />
    </MemoryRouter>,
  );

  const rules = screen.getByText('Password must:').parentElement!;
  expect(rules.className).not.toMatch(/\b(bg-|border|rounded|p-)/);
  const length = screen.getByText('Be at least 8 characters long');
  expect(length.className).toContain('text-error-light');
  expect(length.previousElementSibling!.className).toContain('bg-error-light');
});

it('keeps the email for the confirmation step under signup_email, where that step reads it', () => {
  hook.state = {
    form: { email: 'synthetic@example.test', password: 'long enough', passwordConfirm: 'long enough' },
    errors: {},
    generalError: '',
    isLoading: false,
    showPassword: false,
    passwordValidation: { isValid: true, lengthValid: true, notNumeric: true },
    setFieldValue: vi.fn(),
    togglePassword: vi.fn(),
    handleSubmit: vi.fn(),
  };
  render(
    <MemoryRouter>
      <SignupUser />
    </MemoryRouter>,
  );
  localStorage.clear();

  hook.remember!('synthetic@example.test');

  expect(localStorage.getItem('signup_email')).toBe('synthetic@example.test');
});

const A_MESSAGE: Record<string, string> = {
  email: 'A user with that email already exists.',
  password: 'This password is too common.',
};

describe('every field SIGNUP_USER_FIELDS names is one this page actually renders', () => {
  it.each(SIGNUP_USER_FIELDS)('renders the error it is handed for %s', (field) => {
    hook.state = {
      form: { email: 'synthetic@example.test', password: 'long enough', passwordConfirm: 'long enough' },
      errors: { [field]: [A_MESSAGE[field]] },
      generalError: '',
      isLoading: false,
      showPassword: false,
      passwordValidation: { isValid: true, lengthValid: true, notNumeric: true },
      setFieldValue: vi.fn(),
      togglePassword: vi.fn(),
      handleSubmit: vi.fn(),
    };
    render(
      <MemoryRouter>
        <SignupUser />
      </MemoryRouter>,
    );

    expect(screen.getByText(A_MESSAGE[field])).toBeDefined();
  });
});
