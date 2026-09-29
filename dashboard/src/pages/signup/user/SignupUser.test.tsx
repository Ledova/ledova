// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { SignupUser } from './SignupUser';

const hook = vi.hoisted(() => ({ state: {} as Record<string, unknown> }));
vi.mock('./useSignupUser', () => ({ useSignupUser: () => hook.state }));

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
