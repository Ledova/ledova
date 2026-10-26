// @vitest-environment jsdom

import { REGISTER_QUERY_KEY, registerKey } from '@hooks/useRegisterAccess';
import {
  COMPANY_TOKEN_ENDPOINTS,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
  ownershipSummary,
  type CompanyOwnershipSummary,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CompanyDashboardPage from '.';
import { companyPreferences, prepareCompanyClient, renderCompanyPage } from '../../../testSupport/company';

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

function overview(registers: TokenHoldersResponse[]): CompanyOwnershipSummary {
  const summary = ownershipSummary(registers);
  return {
    company: 'company-one',
    companyName: 'Example Company',
    asAt: '2026-10-26T00:00:00Z',
    complete: summary.issued !== null,
    issuedSupply: summary.issued,
    totalHolders: summary.shareholders,
    classes: registers.map((row) => ({
      uuid: row.token.uuid,
      name: row.token.name,
      symbol: row.token.symbol,
      tokenType: 'ordinary',
      initialized: row.initialized,
      issuedSupply: row.issuedSupply,
      totalHolders: row.initialized ? row.totalHolders : null,
      sequence: row.initialized ? 1 : null,
      recordedAt: row.initialized ? '2026-10-26T00:00:00Z' : null,
    })),
  };
}

function holderPage(row: TokenHoldersResponse, params: { search?: string; page?: number }) {
  const filtered = row.holders.filter(
    (holder) => !params.search || holder.name!.toLowerCase().includes(params.search.toLowerCase()),
  );
  const page = params.page ?? 1;
  const results = filtered
    .slice((page - 1) * 25, page * 25)
    .map((holder) => ({ member: holder.member, name: holder.name, balance: holder.balance, percentage: '0.00' }));
  return {
    data: {
      count: filtered.length,
      next: page * 25 < filtered.length ? '?page=2' : null,
      previous: page > 1 ? '?page=1' : null,
      token: row.token.uuid,
      sequence: 1,
      issuedSupply: row.issuedSupply,
      asAt: '2026-10-26T00:00:00Z',
      results,
    },
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('explores exact bounded company ownership and withholds incomplete, failed and old-account replies', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const ordinary = register('ordinary', '9007199254740993');
  ordinary.holders = Array.from({ length: 28 }, (_, index) => ({
    ...ordinary.holders[0],
    member: index === 0 ? 'same-member' : `small-${index}`,
    name: index === 0 ? 'Example Shareholder' : `Small holder ${index}`,
    balance: index === 0 ? '9007199254740966' : '1',
    percentage: 0,
  }));
  ordinary.totalHolders = 28;
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
    shareholders: 28,
    classes: 2,
    unopened: 0,
  });
  expect(() => ownershipSummary([ordinary, { ...preference, issuedSupply: '8' }])).toThrow(/do not agree/);
  expect(() => ownershipSummary([ordinary, ordinary])).toThrow(/more than once/);
  const paged = (results: unknown[]) => ({ data: { count: results.length, results, next: null, previous: null } });
  let mode = 'complete';
  api.get.mockImplementation(async (url: string, config?: { params?: { search?: string; page?: number } }) => {
    if (url === USER_PREFERENCES_ENDPOINTS.BASE)
      return { data: companyPreferences(mode === 'readable-investor' ? 'investor' : 'company') };
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER)
      return paged(
        [ordinary, preference].map(({ token }) => ({
          uuid: token.uuid,
          companyUuid: 'company-one',
          companyName: 'Example Company',
        })),
      );
    if (url === COMPANY_TOKEN_ENDPOINTS.OWNERSHIP) {
      if (mode === 'failed') throw new Error('Ownership read failed');
      const data = overview([mode === 'zero' ? empty : ordinary, mode === 'unopened' ? unopened : preference]);
      return { data: mode === 'inconsistent' ? { ...data, issuedSupply: '5' } : data };
    }
    if (url === COMPANY_TOKEN_ENDPOINTS.OWNERSHIP_HOLDERS('ordinary')) {
      if (mode === 'denied') throw { response: { status: 404 } };
      return holderPage(mode === 'zero' ? empty : ordinary, config?.params ?? {});
    }
    if (url === COMPANY_TOKEN_ENDPOINTS.OWNERSHIP_HOLDERS('preference'))
      return holderPage(preference, config?.params ?? {});
    return paged([]);
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
  expect(within(summary).getByText('Current shareholders').parentElement!.textContent).toBe('Current shareholders28');
  expect(api.get.mock.calls.some(([url]) => String(url).endsWith('/ownership-holders/'))).toBe(false);
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'));
  fireEvent.change(screen.getByRole('combobox', { name: 'Explore a class' }), { target: { value: 'ordinary' } });
  const table = await screen.findByRole('table', { name: 'ordinary shares shareholders' });
  expect(within(table).getByText('9,007,199,254,740,966')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Next/ }));
  expect(await screen.findByText('26–28 of 28 shareholders')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search shareholders' }), {
    target: { value: 'Small holder 27' },
  });
  expect(await screen.findByText('1–1 of 1 shareholder')).toBeTruthy();
  expect(screen.queryByText('Example Shareholder')).toBeNull();
  mode = 'denied';
  await act(async () => {
    await client.refetchQueries({
      queryKey: [...registerKey({ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }), 'ownership-holders'],
      type: 'active',
    });
  });
  expect(await screen.findByText('The register could not be loaded.')).toBeTruthy();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.queryByRole('region', { name: 'Company ownership summary' })).toBeNull();
  expect(screen.queryByText('Small holder 27')).toBeNull();
  mode = 'complete';
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('region', { name: 'Company ownership summary' })).toBeTruthy();
  expect(await screen.findByText('Small holder 27')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'All classes' }));
  expect((screen.getByRole('combobox', { name: 'Explore a class' }) as HTMLSelectElement).value).toBe('');

  mode = 'zero';
  await refresh();
  fireEvent.change(screen.getByRole('combobox', { name: 'Explore a class' }), { target: { value: 'ordinary' } });
  expect(await screen.findByText('No current shareholders yet.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'All classes' }));
  mode = 'unopened';
  await refresh();
  expect(await screen.findByText(/Company totals are not complete/)).toBeTruthy();
  expect(screen.getAllByText('Not complete')).toHaveLength(2);
  expect(screen.queryByText('9,007,199,254,741,000')).toBeNull();
  expect(screen.queryByText('0 issued shares')).toBeNull();
  for (const failed of ['failed', 'inconsistent']) {
    mode = failed;
    await refresh();
    expect(await screen.findByText('The register could not be loaded.')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Company ownership summary' })).toBeNull();
    expect(screen.queryByText('Example Shareholder')).toBeNull();
  }
  mode = 'readable-investor';
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('combobox', { name: 'Explore a class' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain('/api/v1/companies/');
  view.unmount();
  client.clear();

  for (const delayed of ['classes', 'overview', 'holders'] as const) {
    const oldRegister = register('old-class', '11');
    oldRegister.holders[0].name = 'Old account shareholder';
    const currentRegister = register('current-class', '13');
    currentRegister.holders[0].name = 'Current account shareholder';
    const currentPreferences = {
      ...companyPreferences(),
      userProfile: 'profile-two',
      userAccount: { ...companyPreferences().userAccount!, uuid: 'account-two' },
    };
    const classesFor = (row: TokenHoldersResponse) =>
      paged([{ uuid: row.token.uuid, companyUuid: 'company-one', companyName: 'Example Company' }]);
    let finish!: (response: { data: unknown }) => void;
    const pending = new Promise<{ data: unknown }>((resolve) => {
      finish = resolve;
    });
    let changed = false;
    let requested = false;
    let oldGuard: (() => void) | undefined;
    let currentGuard: (() => void) | undefined;
    api.get.mockImplementation(
      async (
        url: string,
        config?: { ledovaSubmissionGuard?: () => void; params?: { search?: string; page?: number } },
      ) => {
        if (url === USER_PREFERENCES_ENDPOINTS.BASE)
          return { data: changed ? currentPreferences : companyPreferences() };
        const delayedUrl =
          delayed === 'classes'
            ? COMPANY_TOKEN_ENDPOINTS.REGISTER
            : delayed === 'overview'
              ? COMPANY_TOKEN_ENDPOINTS.OWNERSHIP
              : COMPANY_TOKEN_ENDPOINTS.OWNERSHIP_HOLDERS('old-class');
        if (!requested && !changed && url === delayedUrl) {
          requested = true;
          oldGuard = config?.ledovaSubmissionGuard;
          return pending;
        }
        const row = changed ? currentRegister : oldRegister;
        if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER) return classesFor(row);
        if (url === COMPANY_TOKEN_ENDPOINTS.OWNERSHIP) {
          if (changed) currentGuard = config?.ledovaSubmissionGuard;
          return { data: overview([row]) };
        }
        if (url === COMPANY_TOKEN_ENDPOINTS.OWNERSHIP_HOLDERS(row.token.uuid))
          return holderPage(row, config?.params ?? {});
        return paged([]);
      },
    );
    const sessionClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    prepareCompanyClient(sessionClient);
    const sessionView = renderCompanyPage(sessionClient, <CompanyDashboardPage />, 'Dashboard');
    if (delayed === 'holders')
      fireEvent.change(await screen.findByRole('combobox', { name: 'Explore a class' }), {
        target: { value: 'old-class' },
      });
    await waitFor(() => expect(requested).toBe(true));
    expect(oldGuard).toBeTypeOf('function');
    expect(() => oldGuard!()).not.toThrow();
    const oldRoot = registerKey({ userUuid: 'profile-one', ownerAccountUuid: 'account-one' });
    const oldQuery = sessionClient
      .getQueryCache()
      .findAll({ queryKey: oldRoot })
      .find((query) => query.state.fetchStatus === 'fetching');
    expect(oldQuery).toBeTruthy();
    await act(async () => {
      changed = true;
      sessionClient.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: currentPreferences });
    });
    const choice = await screen.findByRole('combobox', { name: 'Explore a class' });
    await waitFor(() => expect(within(choice).getByRole('option', { name: /current-class shares/ })).toBeTruthy());
    fireEvent.change(choice, { target: { value: 'current-class' } });
    expect(await screen.findByText('Current account shareholder')).toBeTruthy();
    expect(() => oldGuard!()).toThrow(/Your signed-in account changed/);
    await act(async () =>
      finish(
        delayed === 'classes'
          ? classesFor(oldRegister)
          : delayed === 'overview'
            ? { data: overview([oldRegister]) }
            : holderPage(oldRegister, {}),
      ),
    );
    await waitFor(() => expect(oldQuery!.state.fetchStatus).toBe('idle'));
    expect(oldQuery!.state.status).toBe('error');
    expect(oldQuery!.state.data).toBeUndefined();
    expect(screen.queryByText('Old account shareholder')).toBeNull();
    const boundGuard = currentGuard!;
    expect(() => boundGuard()).not.toThrow();
    await act(async () => {
      sessionClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
      sessionClient.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
    });
    expect(() => boundGuard()).toThrow(/Your signed-in account changed/);
    sessionView.unmount();
    sessionClient.clear();
  }
});
