// @vitest-environment jsdom

import {
  COMPANY_TOKEN_ENDPOINTS,
  USER_PREFERENCES_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { QueryClient } from '@tanstack/react-query';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import CompanyDashboardPage from '.';
import { companyPreferences, prepareCompanyClient, renderCompanyPage } from '../testSupport';
import { countBarWidth, ownershipSummary } from './summary';
import { APPOINTMENT } from '../../../../../packages/shared/tests/fixtures/employee-awards';

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

it('shows exact complete company ownership, deduplicates shareholders and refuses unopened or failed totals', async () => {
  const ordinary = register('ordinary', '9007199254740993');
  const preference = register('preference', '7');
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
    shareholders: 1,
    classes: 2,
    unopened: 0,
  });
  expect(ownershipSummary([ordinary, unopened])).toEqual({ issued: null, shareholders: null, classes: 2, unopened: 1 });
  expect(() => ownershipSummary([ordinary, { ...preference, issuedSupply: '8' }])).toThrow(/do not agree/);
  expect(() => ownershipSummary([ordinary, ordinary])).toThrow(/more than once/);
  expect(countBarWidth('9007199254740993', '9007199254740993')).toBe(100);
  expect(countBarWidth('0', '0')).toBe(0);

  let mode = 'complete';
  const page = (results: unknown[]) => ({ data: { count: results.length, results, next: null, previous: null } });
  api.get.mockImplementation(async (url: string) => {
    if (url === USER_PREFERENCES_ENDPOINTS.BASE)
      return { data: companyPreferences(mode.startsWith('mixed') ? 'investor' : 'company') };
    if (url === '/api/v1/company-authority/appointments/')
      return page(
        mode.startsWith('mixed')
          ? [
              {
                ...APPOINTMENT,
                company: mode === 'mixed' ? 'company-without-classes' : 'company-one',
                companyName: mode === 'mixed' ? 'New Company' : 'Example Company',
                capabilities: mode === 'mixed-prepare' ? ['prepare'] : ['admin'],
                isEffective: mode !== 'mixed-revoked',
                status: mode === 'mixed-revoked' ? 'revoked' : 'active',
                revokedAt: mode === 'mixed-revoked' ? '2026-10-14T00:00:00Z' : null,
              },
            ]
          : mode === 'complete'
            ? []
            : [{ ...APPOINTMENT, company: 'company-one' }],
      );
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
      return { data: ordinary };
    }
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'))
      return {
        data:
          mode === 'complete'
            ? preference
            : {
                ...unopened,
                token: {
                  ...unopened.token,
                  status: ['deployed', 'paused', 'deploying'].includes(mode) ? mode : 'draft',
                },
              },
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
        client.refetchQueries({ queryKey: ['tokens', 'register'] }),
        client.refetchQueries({ queryKey: ['company-appointments'] }),
      ]);
    });
  };
  const summary = await screen.findByRole('region', { name: 'Company ownership summary' });
  expect(within(summary).getByText('9,007,199,254,741,000')).toBeTruthy();
  expect(within(summary).getByText('Current shareholders').parentElement!.textContent).toBe('Current shareholders1');
  expect(screen.getByRole('table', { name: 'Largest shareholders in ordinary shares' })).toBeTruthy();
  expect(screen.getByText('100.00%')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Shares by class' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'Issue investor shares' })).toBeNull();
  expect(screen.getByRole('link', { name: 'View full register' }).getAttribute('href')).toBe('/company/register');

  mode = 'unopened';
  await refresh();
  expect(await screen.findByText(/Company totals are not complete/)).toBeTruthy();
  expect(screen.getAllByText('Not complete')).toHaveLength(2);
  expect(screen.queryByText('9,007,199,254,741,000')).toBeNull();
  fireEvent.change(screen.getByLabelText('Share class'), { target: { value: 'preference' } });
  expect(screen.getByText(/This share class has no opened register/)).toBeTruthy();
  expect(screen.queryByText('0 issued shares')).toBeNull();
  expect(screen.getByRole('link', { name: 'Set up your share register' }).getAttribute('href')).toBe(
    '/company/register/preference/import',
  );
  for (const status of ['deployed', 'paused']) {
    mode = status;
    await refresh();
    expect(await screen.findByRole('link', { name: 'Open register from chain' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open register from chain' }).getAttribute('href')).toBe(
      '/company/register/preference/open',
    );
    expect(screen.queryByRole('link', { name: 'Set up your share register' })).toBeNull();
  }
  mode = 'deploying';
  await refresh();
  expect(await screen.findByText(/Deployment is in progress/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'View share class' }).getAttribute('href')).toBe(
    '/company/register/preference',
  );
  expect(screen.queryByRole('link', { name: 'Set up your share register' })).toBeNull();
  expect(screen.queryByRole('link', { name: 'Open register from chain' })).toBeNull();

  mode = 'failed';
  await refresh();
  expect(await screen.findByText(/couldn't load the complete register/)).toBeTruthy();
  expect(screen.queryByRole('region', { name: 'Company ownership summary' })).toBeNull();
  expect(screen.queryByText('Example Shareholder')).toBeNull();
  mode = 'mixed';
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  fireEvent.change(await screen.findByLabelText('Share class'), { target: { value: 'ordinary' } });
  expect(await screen.findByRole('table', { name: 'Largest shareholders in ordinary shares' })).toBeTruthy();
  expect(screen.queryByLabelText('Company')).toBeNull();
  expect(screen.queryByRole('link', { name: 'Issue investor shares' })).toBeNull();
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain('/api/v1/companies/');
  mode = 'mixed-prepare';
  await refresh();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.getByRole('link', { name: 'Issue investor shares' }).getAttribute('href')).toBe('/company/register');
  mode = 'mixed-revoked';
  await refresh();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.queryByRole('link', { name: 'Issue investor shares' })).toBeNull();
  view.unmount();
  client.clear();
});
