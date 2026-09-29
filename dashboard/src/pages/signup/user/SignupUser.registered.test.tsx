// @vitest-environment jsdom

import type { AxiosInstance } from 'axios';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ApiClientProvider } from '@ledova/shared';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SignupUser } from './SignupUser';

const api = { post: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function signUpWith(refusal: Record<string, string[]>) {
  api.post.mockRejectedValue({ response: { status: 400, data: refusal } });
  render(
    <MemoryRouter>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <SignupUser />
      </ApiClientProvider>
    </MemoryRouter>,
  );
  fireEvent.change(screen.getByPlaceholderText('your@email.com'), { target: { value: 'synthetic@example.test' } });
  fireEvent.change(screen.getByPlaceholderText('••••••••'), { target: { value: 'long enough' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
}

it('turns the refusal the backend sends for a registered email into a sentence with a way to sign in', async () => {
  signUpWith({ email: ['Email already registered'] });

  const refusal = await screen.findByRole('alert');
  expect(refusal.textContent).toBe('Email already registered. Please sign in or use a different email.');
  expect(screen.getByRole('link', { name: 'sign in' }).getAttribute('href')).toBe('/signin');
});

it('shows any other email refusal as the backend wrote it', async () => {
  signUpWith({ email: ['Enter a valid email address.'] });

  expect((await screen.findByRole('alert')).textContent).toBe('Enter a valid email address.');
  expect(screen.queryByRole('link', { name: 'sign in' })).toBeNull();
});

it('separates two email refusals with a space', async () => {
  signUpWith({ email: ['Enter a valid email address.', 'Ensure this field has no more than 254 characters.'] });

  expect((await screen.findByRole('alert')).textContent).toBe(
    'Enter a valid email address. Ensure this field has no more than 254 characters.',
  );
});
