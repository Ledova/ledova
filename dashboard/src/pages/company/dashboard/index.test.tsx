// @vitest-environment jsdom

import { REGISTER_QUERY_KEY, registerKey } from '@hooks/useRegisterAccess';

import {
  COMPANY_TOKEN_ENDPOINTS,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CompanyDashboardPage from '.';
import { companyPreferences, prepareCompanyClient, renderCompanyPage } from '../../../testSupport/company';
import { countBarWidth, ownershipSegments, ownershipSummary } from '@pages/company/shared/summary';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

function register(uuid: string, shares: string): TokenHoldersResponse {
  return {
    token: { uuid, name: `${uuid} shares`, symbol: uuid.toUpperCase(), status: 'draft', totalSupply: shares },
    initialized: true,
    issuedSupply: shares,
    waitingEffects: 0,
    totalHolders: 1,
    holders: [
      {
        member: 'same-member',
        name: 'Example Shareholder',
        balance: shares,
        percentage: 100,
        holderType: 'member',
        enteredOn: '2026-10-11',
        identitySource: 'particulars',
        shareClass: uuid,
        source: 'register',
        wallets: [],
      },
    ],
    formerMembers: [],
    formerMembersAsAt: null,
    formerMembersBlock: null,
    formerMembersStale: false,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('shows exact complete company ownership, refuses incomplete totals and discards old-account register replies', async () => {
  const ordinary = register('ordinary', '9007199254740993');
  const firstHolder = ordinary.holders[0];
  ordinary.holders = ['9007199254740983', '3', '2', '1', '1', '1', '1', '1'].map((balance, index) => ({
    ...firstHolder,
    member: index === 0 ? firstHolder.member : `small-member-${index}`,
    name: index === 0 ? firstHolder.name : `Small holder ${index}`,
    balance,
    percentage: countBarWidth(balance, ordinary.issuedSupply!),
  }));
  ordinary.totalHolders = ordinary.holders.length;
  const preference = register('preference', '7');
  const empty = { ...ordinary, issuedSupply: '0', holders: [], totalHolders: 0 };
  const unopened = {
    ...preference,
    initialized: false,
    issuedSupply: null,
    holders: [],
    totalHolders: 0,
    waitingEffects: null,
  };
  expect(ownershipSummary([ordinary, preference])).toEqual({
    issued: '9007199254741000',
    shareholders: 8,
    classes: 2,
    unopened: 0,
  });
  expect(ownershipSummary([ordinary, unopened])).toEqual({ issued: null, shareholders: null, classes: 2, unopened: 1 });
  expect(() => ownershipSummary([ordinary, { ...preference, issuedSupply: '8' }])).toThrow(/do not agree/);
  expect(() => ownershipSummary([ordinary, ordinary])).toThrow(/more than once/);
  expect(countBarWidth('9007199254740993', '9007199254740993')).toBe(100);
  expect(countBarWidth('0', '0')).toBe(0);
  expect(ownershipSegments(ordinary)).toHaveLength(6);
  expect(ownershipSegments(ordinary).at(-1)).toEqual({
    member: null,
    name: 'Others',
    shares: '3',
    holders: 3,
    percentage: 0,
  });
  expect(ownershipSegments(ordinary).reduce((total, segment) => total + BigInt(segment.shares), 0n)).toBe(
    9007199254740993n,
  );
  expect(ownershipSegments(unopened)).toEqual([]);
  expect(ownershipSegments(empty)).toEqual([]);

  let mode = 'complete';
  const page = (results: unknown[]) => ({ data: { count: results.length, results, next: null, previous: null } });
  api.get.mockImplementation(async (url: string) => {
    if (url === USER_PREFERENCES_ENDPOINTS.BASE)
      return { data: companyPreferences(mode === 'readable-investor' ? 'investor' : 'company') };
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER)
      return page(
        [ordinary, preference].map(({ token }) => ({
          uuid: token.uuid,
          companyUuid: 'company-one',
          companyName: 'Example Company',
        })),
      );
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary')) {
      if (mode === 'failed') throw new Error('Register read failed');
      return { data: mode === 'zero' ? empty : ordinary };
    }
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'))
      return {
        data: ['complete', 'zero', 'readable-investor'].includes(mode) ? preference : unopened,
      };
    return page([]);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  prepareCompanyClient(client);
  const view = renderCompanyPage(client, <CompanyDashboardPage />, 'Dashboard');
  const refresh = async () => {
    await act(async () => {
      await Promise.all([
        client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY }),
        client.refetchQueries({ queryKey: REGISTER_QUERY_KEY }),
      ]);
    });
  };
  const summary = await screen.findByRole('region', { name: 'Company ownership summary' });
  expect(within(summary).getByText('9,007,199,254,741,000')).toBeTruthy();
  expect(within(summary).getByText('Current shareholders').parentElement!.textContent).toBe('Current shareholders8');
  const ordinaryTable = screen.getByRole('table', { name: 'Largest shareholders in ordinary shares' });
  const others = within(ordinaryTable).getByRole('row', { name: /Others/ });
  expect(within(others).getByText('3 shareholders')).toBeTruthy();
  expect(within(others).getByRole('cell', { name: '3' })).toBeTruthy();
  expect(within(others).getByText('<0.01%')).toBeTruthy();
  expect(screen.getByRole('img', { name: /ordinary shares share ownership/ })).toBeTruthy();
  expect(screen.getByRole('img', { name: /preference shares share ownership/ })).toBeTruthy();
  expect(
    within(screen.getByRole('table', { name: 'Largest shareholders in preference shares' })).getByText('100.00%'),
  ).toBeTruthy();

  mode = 'zero';
  await refresh();
  expect(await screen.findByText(/No issued shares or current shareholders/)).toBeTruthy();
  expect(screen.queryByRole('img', { name: /ordinary shares share ownership/ })).toBeNull();
  expect(screen.getByRole('img', { name: /preference shares share ownership/ })).toBeTruthy();

  mode = 'unopened';
  await refresh();
  expect(await screen.findByText(/Company totals are not complete/)).toBeTruthy();
  expect(screen.getAllByText('Not complete')).toHaveLength(2);
  expect(screen.queryByText('9,007,199,254,741,000')).toBeNull();
  expect(screen.getByText(/This share class has no opened register/)).toBeTruthy();
  expect(screen.queryByText('0 issued shares')).toBeNull();
  expect(screen.queryByRole('img', { name: /preference shares share ownership/ })).toBeNull();

  mode = 'failed';
  await refresh();
  expect(await screen.findByText(/couldn't load the complete register/)).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Company ownership summary' })).toBeNull();
  expect(screen.queryByText('Example Shareholder')).toBeNull();
  expect(screen.queryByRole('img', { name: /share ownership/ })).toBeNull();
  mode = 'readable-investor';
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('table', { name: 'Largest shareholders in ordinary shares' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain('/api/v1/companies/');
  view.unmount();
  client.clear();

  for (const delayed of ['classes', 'holders'] as const) {
    const oldRegister = register('old-class', '11');
    oldRegister.holders[0].name = 'Old account shareholder';
    const currentRegister = register('current-class', '13');
    currentRegister.holders[0].name = 'Current account shareholder';
    const currentPreferences = {
      ...companyPreferences(),
      userProfile: 'profile-two',
      userAccount: { ...companyPreferences().userAccount!, uuid: 'account-two' },
    };
    const classesFor = (item: TokenHoldersResponse) =>
      page([{ uuid: item.token.uuid, companyUuid: 'company-one', companyName: 'Example Company' }]);
    let finish!: (response: { data: unknown }) => void;
    const pending = new Promise<{ data: unknown }>((resolve) => {
      finish = resolve;
    });
    let changed = false;
    let requested = false;
    let oldGuard: (() => void) | undefined;
    let currentGuard: (() => void) | undefined;
    api.get.mockImplementation(async (url: string, config?: { ledovaSubmissionGuard?: () => void }) => {
      if (url === USER_PREFERENCES_ENDPOINTS.BASE) return { data: changed ? currentPreferences : companyPreferences() };
      if (
        !requested &&
        (delayed === 'classes'
          ? url === COMPANY_TOKEN_ENDPOINTS.REGISTER
          : url === COMPANY_TOKEN_ENDPOINTS.HOLDERS(oldRegister.token.uuid))
      ) {
        requested = true;
        oldGuard = config?.ledovaSubmissionGuard;
        return pending;
      }
      if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER) return classesFor(changed ? currentRegister : oldRegister);
      if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS(oldRegister.token.uuid)) return { data: oldRegister };
      if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS(currentRegister.token.uuid)) {
        currentGuard = config?.ledovaSubmissionGuard;
        return { data: currentRegister };
      }
      return page([]);
    });
    const sessionClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    prepareCompanyClient(sessionClient);
    const sessionView = renderCompanyPage(sessionClient, <CompanyDashboardPage />, 'Dashboard');
    await waitFor(() => expect(requested).toBe(true));
    expect(oldGuard).toBeTypeOf('function');
    expect(() => oldGuard!()).not.toThrow();
    const oldRoot = registerKey({ userUuid: 'profile-one', ownerAccountUuid: 'account-one' });
    const oldKey = delayed === 'classes' ? [...oldRoot, 'classes'] : [...oldRoot, 'holders', oldRegister.token.uuid];
    await act(async () => {
      changed = true;
      sessionClient.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: currentPreferences });
    });
    expect(await screen.findByText('Current account shareholder')).toBeTruthy();
    expect(() => oldGuard!()).toThrow(/Your signed-in account changed/);
    await act(async () => finish(delayed === 'classes' ? classesFor(oldRegister) : { data: oldRegister }));
    await waitFor(() => expect(sessionClient.getQueryState(oldKey)?.fetchStatus).toBe('idle'));
    expect(sessionClient.getQueryState(oldKey)?.status).toBe('error');
    expect(sessionClient.getQueryData(oldKey)).toBeUndefined();
    expect(screen.queryByText('Old account shareholder')).toBeNull();
    expect(screen.getByText('Current account shareholder')).toBeTruthy();
    expect(currentGuard).toBeTypeOf('function');
    expect(() => currentGuard!()).not.toThrow();
    await act(async () => {
      sessionClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
      sessionClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
    });
    expect(() => currentGuard!()).toThrow(/Your signed-in account changed/);
    sessionView.unmount();
    sessionClient.clear();
  }
});
