/** @jest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';

import { useSignupUser } from '../../src/hooks/useSignupUser';
import { providers, signupApi } from '../fixtures/signup';

const api = signupApi();
const wrapper = providers(api);

beforeEach(() => {
  jest.clearAllMocks();
  api.post.mockResolvedValue({ data: {} });
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

function fill(result: { current: ReturnType<typeof useSignupUser> }, email: string, password: string) {
  act(() => result.current.setFieldValue('email', email));
  act(() => result.current.setFieldValue('password', password));
}

it('creates the account, has the client remember the email, and only then moves on', async () => {
  const steps: string[] = [];
  const remember = jest.fn(async (email: string) => {
    steps.push(`remember ${email}`);
  });
  const { result } = renderHook(() => useSignupUser(remember), { wrapper });
  fill(result, 'synthetic@example.test', 'long enough');

  await act(() => result.current.handleSubmit(() => steps.push('move on')));

  expect(api.post).toHaveBeenCalledWith('/api/signup/', {
    email: 'synthetic@example.test',
    password: 'long enough',
    passwordConfirm: 'long enough',
  });
  expect(steps).toEqual(['remember synthetic@example.test', 'move on']);
  expect(result.current.isLoading).toBe(false);
});

it('checks the password before asking the server', async () => {
  const remember = jest.fn();
  const { result } = renderHook(() => useSignupUser(remember), { wrapper });
  fill(result, 'synthetic@example.test', '1234');

  await act(() => result.current.handleSubmit(jest.fn()));

  expect(result.current.errors.password).toEqual([
    'Password must be at least 8 characters long',
    'Password cannot be entirely numeric',
  ]);
  expect(api.post).not.toHaveBeenCalled();
  expect(remember).not.toHaveBeenCalled();
});

it('marks what the server refused, says it, and logs the failure without its body', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.post.mockRejectedValue({
    response: { status: 400, data: { email: ['A user with that email already exists.'] } },
    config: { method: 'post', url: '/api/signup/' },
  });
  const remember = jest.fn();
  const moveOn = jest.fn();
  const { result } = renderHook(() => useSignupUser(remember), { wrapper });
  fill(result, 'synthetic@example.test', 'long enough');

  await act(() => result.current.handleSubmit(moveOn));

  expect(result.current.errors).toEqual({ email: ['A user with that email already exists.'] });
  expect(result.current.generalError).toBe('A user with that email already exists.');
  expect(console.error).toHaveBeenCalledWith('Account creation failed: status=400 request=POST /api/signup/');
  expect(remember).not.toHaveBeenCalled();
  expect(moveOn).not.toHaveBeenCalled();
});
