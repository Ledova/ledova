/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';

import { useSignupFinancialProfile } from '../../src/hooks/useSignupFinancialProfile';
import type { JsonValue } from '../../src/types';
import { providers, signupApi } from '../fixtures/signup';

const api = signupApi();
const wrapper = providers(api);

beforeEach(() => {
  jest.clearAllMocks();
  api.patch.mockResolvedValue({ data: {} });
});

afterEach(async () => {
  await cleanup();
  jest.restoreAllMocks();
});

it.each<{ funds: JsonValue; choices: string[] }>([
  { funds: ['savings', 'historical choice'], choices: ['savings', 'historical choice'] },
  { funds: null, choices: [] },
  { funds: { source: 'legacy value' }, choices: [] },
  { funds: 'savings', choices: [] },
  { funds: 9, choices: [] },
  { funds: false, choices: [] },
  { funds: ['savings', null, 8, { other: true }], choices: ['savings'] },
])('loads editable choices from $funds and submits the selected strings', async ({ funds, choices }) => {
  api.get.mockResolvedValueOnce({ data: { count: 1, results: [{ uuid: 'profile-1' }] } });
  api.get.mockResolvedValueOnce({
    data: {
      count: 1,
      results: [{ uuid: 'financial-1', occupation: 'Engineer', sourceOfFunds: funds, intendedUse: 'savings' }],
    },
  });
  const saved = jest.fn();
  const { result } = renderHook(() => useSignupFinancialProfile(), { wrapper });
  await waitFor(() => expect(result.current.isLoading).toBe(false));

  expect(result.current.form.sourceOfFunds).toEqual(choices);
  expect(api.patch).not.toHaveBeenCalled();
  act(() => result.current.toggleSourceOfFunds('gift'));
  await act(() => result.current.handleSubmit(saved));

  expect(api.patch).toHaveBeenCalledWith('/api/financial-profiles/financial-1/', {
    occupation: 'Engineer',
    sourceOfFunds: [...choices, 'gift'],
    sourceOfFundsOtherText: null,
    intendedUse: 'savings',
    intendedUseOtherText: null,
  });
  expect(saved).toHaveBeenCalledTimes(1);
});

it('retries a failed load from a fresh loading state', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.get.mockRejectedValueOnce(new Error('offline'));
  api.get.mockResolvedValueOnce({ data: { count: 1, results: [{ uuid: 'profile-1' }] } });
  api.get.mockResolvedValueOnce({
    data: { count: 1, results: [{ uuid: 'financial-1', occupation: 'Engineer', sourceOfFunds: [], intendedUse: '' }] },
  });
  const { result } = renderHook(() => useSignupFinancialProfile(), { wrapper });
  await waitFor(() => expect(result.current.generalError).toBe('Failed to load profile. Please try again.'));
  expect(result.current.isLoading).toBe(false);
  expect(console.error).toHaveBeenCalledWith('Failed to load financial profile: Error: offline');

  act(() => result.current.retryLoad());
  expect(result.current.isLoading).toBe(true);
  expect(result.current.generalError).toBe('');
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.existingProfileUuid).toBe('financial-1');
  expect(result.current.form.occupation).toBe('Engineer');
});

const PROXY_PAGE =
  '<!DOCTYPE html><html><head><title>403 Forbidden</title></head><body><h1>403 Forbidden</h1></body></html>';

async function savedProfile(saved: object = {}) {
  api.get.mockResolvedValueOnce({ data: { count: 1, results: [{ uuid: 'profile-1' }] } });
  api.get.mockResolvedValueOnce({
    data: {
      count: 1,
      results: [
        { uuid: 'financial-1', occupation: 'Engineer', sourceOfFunds: ['savings'], intendedUse: 'savings', ...saved },
      ],
    },
  });
  const view = renderHook(() => useSignupFinancialProfile(), { wrapper });
  await waitFor(() => expect(view.result.current.isLoading).toBe(false));
  return view;
}

it.each<[string, number, unknown, string, Record<string, string[]>]>([
  ['a sentence', 409, 'Financial profiles are read-only for now.', 'Financial profiles are read-only for now.', {}],
  [
    'refusals for a field the form shows and one it does not',
    400,
    {
      occupation: ['Ensure this field has no more than 200 characters.'],
      userProfile: ['A financial profile already exists for this user.'],
    },
    'A financial profile already exists for this user.',
    { occupation: ['Ensure this field has no more than 200 characters.'] },
  ],
  ['a proxy error page', 403, PROXY_PAGE, 'Failed to save profile. Please try again.', {}],
  ['an empty answer', 404, '', 'Failed to save profile. Please try again.', {}],
])('shows what a person can read when the server answers with %s', async (_, status, data, shown, marked) => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.patch.mockRejectedValue({ response: { status, data } });
  const { result } = await savedProfile();

  await act(() => result.current.handleSubmit(jest.fn()));

  expect(result.current.generalError).toBe(shown);
  expect(result.current.errors).toEqual(marked);
  expect(console.error).toHaveBeenCalledWith(`Financial profile update failed: status=${status}`);
});

it.each<[string, string[], string, Record<string, string[]>]>([
  ['is marked under it while it shows', ['savings', 'other'], '', { sourceOfFundsOtherText: ['Too long.'] }],
  ['is said at the top once it is hidden', ['savings'], 'Too long.', {}],
])('a refusal for the source-of-funds details %s', async (_, sources, shown, marked) => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.patch.mockRejectedValue({ response: { status: 400, data: { sourceOfFundsOtherText: ['Too long.'] } } });
  const { result } = await savedProfile({ sourceOfFunds: sources, sourceOfFundsOtherText: 'Kept from before' });

  await act(() => result.current.handleSubmit(jest.fn()));

  expect(result.current.generalError).toBe(shown);
  expect(result.current.errors).toEqual(marked);
});

it('still says to check the connection when no answer came back', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.patch.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));
  const { result } = await savedProfile();

  await act(() => result.current.handleSubmit(jest.fn()));

  expect(result.current.generalError).toBe('Network error. Please check your connection.');
  expect(result.current.errors).toEqual({});
});
