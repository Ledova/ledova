/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';

import { useSignupAccountType } from '../../src/hooks/useSignupAccountType';
import { providers, queryClient, signupApi } from '../fixtures/signup';

const api = signupApi();
const COULD_NOT_SAVE = 'We could not save your account type. Please try again.';
const PROXY_PAGE =
  '<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body><h1>403 Forbidden</h1></body></html>';

let client: QueryClient;
let wrapper: ReturnType<typeof providers>;

beforeEach(() => {
  jest.clearAllMocks();
  client = queryClient();
  wrapper = providers(api, client);
  api.get.mockResolvedValue({ data: { uuid: 'account-1', role: 'investor' } });
  api.patch.mockResolvedValue({ data: { uuid: 'account-1', role: 'company' } });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

async function ready() {
  const view = renderHook(() => useSignupAccountType(), { wrapper });
  await waitFor(() => expect(view.result.current.account).not.toBeNull());
  return view;
}

it('saves the role, refreshes the account and preferences, then moves on', async () => {
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  const moveOn = jest.fn();
  const { result } = await ready();

  await act(() => result.current.chooseRole('company', moveOn));

  expect(api.patch).toHaveBeenCalledWith('/api/user-accounts/account-1/', { role: 'company' });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['userAccount'] });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['userPreferences'] });
  expect(moveOn).toHaveBeenCalledTimes(1);
  expect(result.current.error).toBe('');
});

it('saves nothing until the account is known', async () => {
  api.get.mockReturnValue(new Promise(() => {}));
  const moveOn = jest.fn();
  const { result } = renderHook(() => useSignupAccountType(), { wrapper });

  await act(() => result.current.chooseRole('investor', moveOn));

  expect(api.patch).not.toHaveBeenCalled();
  expect(moveOn).not.toHaveBeenCalled();
});

it.each<[string, number, unknown, string]>([
  ['a sentence', 409, 'Account type can no longer be changed.', 'Account type can no longer be changed.'],
  ['a refusal for the role', 400, { role: ['That is not a valid choice.'] }, 'That is not a valid choice.'],
  ['a proxy error page', 403, PROXY_PAGE, COULD_NOT_SAVE],
  ['an empty answer', 404, '', COULD_NOT_SAVE],
])('keeps the person on the step and says why when the server answers with %s', async (_, status, data, shown) => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.patch.mockRejectedValue({ response: { status, data } });
  const moveOn = jest.fn();
  const { result } = await ready();

  await act(() => result.current.chooseRole('company', moveOn));

  expect(result.current.error).toBe(shown);
  expect(result.current.isSubmitting).toBe(false);
  expect(moveOn).not.toHaveBeenCalled();
  expect(console.error).toHaveBeenCalledWith(`Failed to update account role: status=${status}`);
});

it('says to check the connection when no answer came back, and clears that on another try', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.patch.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
  const moveOn = jest.fn();
  const { result } = await ready();

  await act(() => result.current.chooseRole('investor', moveOn));

  expect(result.current.error).toBe('Network error. Please check your connection.');
  expect(moveOn).not.toHaveBeenCalled();

  await act(() => result.current.chooseRole('investor', moveOn));

  expect(result.current.error).toBe('');
  expect(moveOn).toHaveBeenCalledTimes(1);
});
