/** @jest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { QueryClient } from '@tanstack/react-query';

import {
  SIGNUP_COMPLETION_FAILED,
  SIGNUP_LOAD_FAILED,
  SIGNUP_NETWORK_ERROR,
} from '../../src/constants/business/signup';
import { useSignupReview } from '../../src/hooks/useSignupReview';
import type { AccountRole } from '../../src/types';
import { axiosFailure, deferred, providers, queryClient, refusal, signupApi, unanswered } from '../fixtures/signup';

const api = signupApi();

const summaryA = { uuid: 'company-a', name: 'Saved A', companyType: 'pty', acn: '000000019' };
const summaryB = { ...summaryA, uuid: 'company-b', name: 'Saved B' };
const detailA = { ...summaryA, abn: '51824753556' };
const detailB = { ...summaryB, abn: '53004085616' };
const list = (rows = [summaryA]) => ({ data: { count: rows.length, next: null, previous: null, results: rows } });
const financial = {
  data: { results: [{ uuid: 'financial-a', occupation: 'Engineer', sourceOfFunds: [], intendedUse: 'savings' }] },
};
let client: QueryClient;
let wrapper: ReturnType<typeof providers>;
let companyList: () => Promise<ReturnType<typeof list>>;
let companyA: () => Promise<{ data: typeof detailA }>;
let companyB: () => Promise<{ data: typeof detailB }>;
let financialRows: () => Promise<typeof financial>;
let onComplete: jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  client = queryClient();
  wrapper = providers(api, client);
  onComplete = jest.fn();
  companyList = () => Promise.resolve(list());
  companyA = () => Promise.resolve({ data: detailA });
  companyB = () => Promise.resolve({ data: detailB });
  financialRows = () => Promise.resolve(financial);
  api.get.mockImplementation((url: string) => {
    if (url === '/api/user-profiles/')
      return Promise.resolve({
        data: {
          results: [
            { uuid: 'profile-a', fullName: 'Synthetic Person', phoneNumber: '00000000', residentialAddress: null },
          ],
        },
      });
    if (url === '/api/financial-profiles/') return financialRows();
    if (url === '/api/v1/companies/') return companyList();
    if (url === '/api/v1/companies/company-a/') return companyA();
    if (url === '/api/v1/companies/company-b/') return companyB();
    throw new Error(`Unexpected request: ${url}`);
  });
  api.patch.mockResolvedValue({ data: { uuid: 'profile-a' } });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

function review(role: AccountRole = 'company') {
  return renderHook(() => useSignupReview(role, onComplete), { wrapper });
}

it('waits for company detail before review can complete', async () => {
  const pending = deferred<{ data: typeof detailA }>();
  companyA = () => pending.promise;
  const { result } = review();
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/v1/companies/company-a/'));
  expect(result.current.isLoading).toBe(true);
  expect(result.current.company).toBeNull();
  await act(() => result.current.completeSignup());
  expect(api.patch).not.toHaveBeenCalled();
  await act(() => pending.resolve({ data: detailA }));
  await waitFor(() => expect(result.current.company?.abn).toBe(detailA.abn));
  expect(result.current.canCompleteSignup).toBe(true);
  await act(() => result.current.completeSignup());
  await waitFor(() => expect(onComplete).toHaveBeenCalled());
  expect(api.patch).toHaveBeenCalledWith('/api/user-profiles/profile-a/', {
    termsAndConditions: true,
    isSignupCompleted: true,
  });
});

it('does not show a late A detail after first-list selection moves to B', async () => {
  const pending = deferred<{ data: typeof detailA }>();
  companyA = () => pending.promise;
  const { result } = review();
  await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/v1/companies/company-a/'));
  companyList = () => Promise.resolve(list([summaryB, summaryA]));
  await act(() => {
    client.setQueryData(['signup', 'company'], list([summaryB, summaryA]));
  });
  await waitFor(() => expect(result.current.company?.abn).toBe(detailB.abn));
  await act(() => pending.resolve({ data: detailA }));
  expect(result.current.company?.uuid).toBe('company-b');
  expect(result.current.company?.abn).toBe(detailB.abn);
});

it('rejects mismatched detail and keeps completion unavailable', async () => {
  companyA = () => Promise.resolve({ data: detailB });
  const { result } = review();
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.company).toBeNull();
  expect(result.current.canCompleteSignup).toBe(false);
  await act(() => result.current.completeSignup());
  expect(api.patch).not.toHaveBeenCalled();
});

it('does not confuse an empty company list with completed company review', async () => {
  companyList = () => Promise.resolve(list([]));
  const { result } = review();
  await waitFor(() => expect(result.current.isLoading).toBe(false));
  expect(result.current.company).toBeNull();
  expect(result.current.canCompleteSignup).toBe(false);
  expect(api.get).not.toHaveBeenCalledWith('/api/v1/companies/company-a/');
});

it('ignores a cached company error while retaining investor completion', async () => {
  await client
    .fetchQuery({
      queryKey: ['signup', 'company'],
      queryFn: () => Promise.reject(new Error('Cached company failure')),
      retry: false,
    })
    .catch(() => undefined);
  const { result } = review('investor');
  await waitFor(() => expect(result.current.canCompleteSignup).toBe(true));
  expect(result.current.error).toBeNull();
  expect(result.current.company).toBeNull();
  expect(api.get).not.toHaveBeenCalledWith('/api/v1/companies/');
  await act(() => result.current.completeSignup());
  await waitFor(() => expect(onComplete).toHaveBeenCalled());
});

it('reviews an account that is both investor and company as a company', async () => {
  const { result } = review('both');
  await waitFor(() => expect(result.current.company?.abn).toBe(detailA.abn));
  expect(result.current.isCompany).toBe(true);
  expect(result.current.data.financialProfile).toBeNull();
  expect(result.current.canCompleteSignup).toBe(true);
});

it('refreshes the preferences the new role changes before handing over to the client', async () => {
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  onComplete.mockImplementation(() => {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['userPreferences'] });
  });
  const { result } = review('investor');
  await waitFor(() => expect(result.current.canCompleteSignup).toBe(true));

  await act(() => result.current.completeSignup());

  await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
  expect(result.current.completionError).toBeNull();
});

it('says sign-up could not be finished when the client cannot finish it, and allows another try', async () => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  onComplete.mockRejectedValue(refusal(401, { detail: 'Session expired.' }));
  const { result } = review('investor');
  await waitFor(() => expect(result.current.canCompleteSignup).toBe(true));

  await act(() => result.current.completeSignup());

  await waitFor(() => expect(result.current.completionError).toBe(SIGNUP_COMPLETION_FAILED));
  expect(result.current.isSubmitting).toBe(false);
  expect(result.current.canCompleteSignup).toBe(true);
  expect(console.error).toHaveBeenCalledWith('Signup completion failed: status=401');
});

it.each(unanswered(SIGNUP_NETWORK_ERROR))('says why sign-up was not finished after %s', async (_, failure, shown) => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.patch.mockRejectedValue(failure);
  const { result } = review('investor');
  await waitFor(() => expect(result.current.canCompleteSignup).toBe(true));

  await act(() => result.current.completeSignup());

  await waitFor(() => expect(result.current.completionError).toBe(shown));
  expect(onComplete).not.toHaveBeenCalled();
});

it.each<[string, unknown, string]>([
  ['a 404 that gives no reason', axiosFailure(404), SIGNUP_LOAD_FAILED],
  ...unanswered(SIGNUP_LOAD_FAILED),
])(
  'says why the details could not be loaded, not what axios said, after %s, and retries them',
  async (_, failure, shown) => {
    financialRows = () => Promise.reject(failure);
    const { result } = review('investor');
    await waitFor(() => expect(result.current.error).toBe(shown));
    expect(result.current.canCompleteSignup).toBe(false);

    financialRows = () => Promise.resolve(financial);
    await act(() => result.current.retryLoad());

    await waitFor(() => expect(result.current.canCompleteSignup).toBe(true));
    expect(result.current.error).toBeNull();
  },
);

it('shows the reason a load was refused and retries the company', async () => {
  companyA = () => Promise.reject(refusal(503, { detail: 'Company details are being updated.' }));
  const { result } = review('company');
  await waitFor(() => expect(result.current.error).toBe('Company details are being updated.'));

  companyA = () => Promise.resolve({ data: detailA });
  await act(() => result.current.retryLoad());

  await waitFor(() => expect(result.current.company?.abn).toBe(detailA.abn));
  expect(result.current.error).toBeNull();
});
