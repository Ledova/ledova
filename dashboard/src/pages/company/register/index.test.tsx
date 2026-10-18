// @vitest-environment jsdom

import {
  COMPANY_TOKEN_ENDPOINTS,
  COMPANY_ENDPOINTS,
  ApiClientProvider,
  DESTINATIONS,
  type RegisterImport,
  type RegisterImportPreparation,
  type RegisterDecideRequest,
  REGISTER_COPY,
  REGISTER_PARTICULARS_COPY,
  HOLDER_TYPE_LABELS,
  formatDate,
  USER_PREFERENCES_QUERY_KEY,
  USER_PREFERENCES_ENDPOINTS,
  type AccountRole,
  type TokenHoldersResponse,
  type OwnCompanyAppointment,
  type RegisterTransferMember,
} from '@ledova/shared';
import SettingsPage from '@pages/settings';
import apiClient from '@services/apiClient';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CompanyRegisterPage from '.';
import CompanyDashboardPage from '../dashboard';
import { ShareClass } from './detail/ShareClass';
import CompanyRegisterImportPage from './import';
import { ImportForm } from './import/ImportForm';
import { blankAllotment, blankMember, preparationProblems, type MemberDraft } from './import/preparation';
import { APPOINTMENT as CURRENT_APPOINTMENT } from '../../../testSupport/company';
import {
  companyRecord,
  companyPreferences,
  prepareCompanyClient,
  renderCompanyPage,
} from '../../../testSupport/company';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const REGISTER = COMPANY_TOKEN_ENDPOINTS.REGISTER;
const IMPORTS = COMPANY_TOKEN_ENDPOINTS.REGISTER_IMPORTS;
const GRANTS = COMPANY_TOKEN_ENDPOINTS.REGISTER_GRANTS;
const TRANSFERS = COMPANY_TOKEN_ENDPOINTS.REGISTER_TRANSFERS;
const OPENINGS = COMPANY_TOKEN_ENDPOINTS.REGISTER_OPENINGS;
const CORRECTIONS = COMPANY_TOKEN_ENDPOINTS.REGISTER_CORRECTIONS;
const RECONCILIATIONS = COMPANY_TOKEN_ENDPOINTS.REGISTER_RECONCILIATIONS;
const PARTICULARS = COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGES;
const LINKS = COMPANY_TOKEN_ENDPOINTS.REGISTER_LINKS;
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const NO_REGISTER = REGISTER_COPY.NO_REGISTER;
let client: QueryClient;

interface Listed {
  uuid: string;
  companyUuid: string;
  companyName: string;
}

const harbour = (uuid: string): Listed => ({ uuid, companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' });
const inland = (uuid: string): Listed => ({ uuid, companyUuid: 'inland', companyName: 'Inland Example Pty Ltd' });

function register(uuid = 'ordinary', overrides: Partial<TokenHoldersResponse> = {}): TokenHoldersResponse {
  return {
    token: {
      uuid,
      name: uuid === 'ordinary' ? 'Ordinary shares' : 'Preference shares',
      symbol: uuid.toUpperCase(),
      status: 'deployed',
      totalSupply: '9007199254740999',
    },
    initialized: true,
    issuedSupply: '9007199254740993',
    waitingEffects: 0,
    holders: [
      {
        member: 'member-one',
        name: 'Example Member',
        holderType: 'member',
        balance: '9007199254740993',
        shareClass: 'Ordinary shares',
        source: 'register',
        identitySource: 'stamp',
        enteredOn: '2026-09-01',
        percentage: 100,
        wallets: [{ address: `0x${'1'.repeat(40)}`, whitelistStatus: 'Active' }],
      },
    ],
    totalHolders: 1,
    formerMembers: [],
    formerMembersAsAt: null,
    formerMembersBlock: null,
    formerMembersStale: false,
    ...overrides,
  };
}

function page(classes: Listed[] = [harbour('ordinary')], next: string | null = null) {
  return { data: { results: classes, count: classes.length, next, previous: null } };
}

function noCommands(url: string) {
  return [
    OPENINGS,
    IMPORTS,
    GRANTS,
    TRANSFERS,
    CORRECTIONS,
    RECONCILIATIONS,
    PARTICULARS,
    LINKS,
    APPOINTMENTS,
  ].includes(url) || url.endsWith('/register/entries/')
    ? { data: { results: [], count: 0, next: null, previous: null } }
    : null;
}

function show(role: AccountRole = 'company', content: ReactNode = <CompanyRegisterPage />, title = 'Register') {
  prepareCompanyClient(client, role);
  client.setQueryData(['userAccount'], { data: { role } });
  return renderCompanyPage(client, content, title);
}

function readUrls() {
  return api.get.mock.calls.map(([url]) => String(url));
}

beforeEach(() => {
  api.get.mockReset();
  api.post.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('reads every class page and groups exact holdings by member identity with search, filtering, paging and private details', async () => {
  const original = register();
  const shared = original.holders[0];
  const ordinary = register('ordinary', {
    token: { ...original.token, totalSupply: '9007199254741999' },
    issuedSupply: '9007199254741003',
    totalHolders: 11,
    formerMembers: [
      {
        uuid: 'former-record',
        member: 'former-member-private',
        name: 'Departed Shareholder',
        residentialAddress: '2 Former Street, Sydney NSW 2000',
        sharesAtCessation: '7',
        ceasedOn: '2026-08-01',
        identitySource: 'recorded',
        identitySourceDisplay: 'Company records',
        identityRecordedAt: '2026-08-01T00:00:00Z',
        sourceEntry: 'former-entry',
        sourceEntrySequence: 1,
        sourceEntryKind: 'transfer',
        sourceEffectiveOn: '2026-08-01',
        corrects: null,
        correctedBy: null,
        returnedOn: null,
        returnedEntry: null,
        walletAddress: `0x${'2'.repeat(40)}`,
        ceasedAtBlock: null,
      },
    ],
    holders: [
      shared,
      {
        ...shared,
        member: 'member-two',
        holderType: 'unidentified',
        balance: '1',
        percentage: 0,
        wallets: [],
      },
      ...Array.from({ length: 9 }, (_, index) => ({
        ...shared,
        member: `member-${index + 3}`,
        name: `Zed Member${String(index + 1).padStart(2, '0')}`,
        balance: '1',
        percentage: 0,
        wallets: [],
      })),
    ],
  });
  const former = ordinary.formerMembers[0];
  const preference = register('preference', {
    holders: [{ ...shared, name: 'Preference Member Name', shareClass: 'Preference shares', enteredOn: '2026-09-03' }],
  });
  api.get.mockImplementation(async (url: string, config?: { params?: { page: number } }) => {
    if (url === REGISTER)
      return config?.params?.page === 2
        ? page([harbour('preference')])
        : page([harbour('ordinary')], 'https://example.test/tokens/register/?page=2');
    return noCommands(url) ?? { data: url.includes('preference') ? preference : ordinary };
  });
  show();
  const table = await screen.findByRole('table', { name: 'Company shareholders' });
  expect(api.get).toHaveBeenCalledWith(REGISTER, {
    params: { page: 1 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(api.get).toHaveBeenCalledWith(REGISTER, {
    params: { page: 2 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(screen.queryByLabelText('Company')).toBeNull();
  expect(screen.getAllByRole('heading', { name: 'Shareholders' })).toHaveLength(1);
  for (const name of ['Record investor share issue', 'Transfer shares', 'History'])
    expect(screen.getByRole('button', { name })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /^Ordinary shares ·/ })).toBeNull();
  expect(screen.queryByRole('heading', { name: /^Preference shares ·/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
  expect(within(table).getAllByRole('row')).toHaveLength(11);
  const namesakes = within(table).getAllByRole('row', { name: /Example Member/ });
  expect(namesakes).toHaveLength(2);
  expect(within(namesakes[0]).getAllByText('9,007,199,254,740,993')).toHaveLength(2);
  expect(within(namesakes[1]).getByText('1')).toBeTruthy();
  expect(within(namesakes[1]).getByText('<0.01%')).toBeTruthy();
  expect(within(namesakes[1]).getByLabelText('No PREFERENCE holding')).toBeTruthy();
  expect(within(namesakes[1]).getByText('Identity needs review')).toBeTruthy();
  expect(screen.getByText(/1 shareholder needs identity review/)).toBeTruthy();
  expect(screen.getByText('1–10 of 11 shareholders')).toBeTruthy();
  expect(within(table).queryByText('Zed Member09')).toBeNull();
  expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();

  fireEvent.click(within(namesakes[0]).getByRole('button', { name: 'Details (Example Member)' }));
  const details = await screen.findByRole('dialog', { name: 'Example Member' });
  expect(within(details).getAllByText('9,007,199,254,740,993')).toHaveLength(2);
  for (const [name, date] of [
    [/^Ordinary shares ·/, '2026-09-01'],
    [/^Preference shares ·/, '2026-09-03'],
  ] as const) {
    const holding = within(details).getByRole('heading', { name }).closest('section')!;
    expect(within(holding).getByText(formatDate(date))).toBeTruthy();
    expect(within(holding).getByText(HOLDER_TYPE_LABELS.member)).toBeTruthy();
    expect(within(holding).getByText(`0x${'1'.repeat(40)} · Active`)).toBeTruthy();
  }
  expect(within(details).getByText('Preference Member Name')).toBeTruthy();
  fireEvent.click(within(details).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  fireEvent.click(within(namesakes[1]).getByRole('button', { name: 'Details (Example Member)' }));
  const otherDetails = await screen.findByRole('dialog', { name: 'Example Member' });
  expect(within(otherDetails).getByText('1')).toBeTruthy();
  expect(within(otherDetails).getByText('<0.01%')).toBeTruthy();
  expect(within(otherDetails).getByText(HOLDER_TYPE_LABELS.unidentified)).toBeTruthy();
  expect(within(otherDetails).getByText(REGISTER_COPY.UNIDENTIFIED_NOTE)).toBeTruthy();
  expect(within(otherDetails).getByText(REGISTER_COPY.NO_WALLET)).toBeTruthy();
  expect(within(otherDetails).queryByText('9,007,199,254,740,993')).toBeNull();
  expect(within(otherDetails).queryByRole('heading', { name: /^Preference shares ·/ })).toBeNull();
  fireEvent.click(within(otherDetails).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

  const pages = screen.getByRole('navigation', { name: 'Shareholder pages' });
  expect(within(pages).getByRole('button', { name: 'Previous' }).matches(':disabled')).toBe(true);
  fireEvent.click(within(pages).getByRole('button', { name: 'Next' }));
  expect(within(table).getByText('Zed Member09')).toBeTruthy();
  expect(within(table).queryByText('Example Member')).toBeNull();
  expect(screen.getByText('11–11 of 11 shareholders')).toBeTruthy();
  expect(within(pages).getByRole('button', { name: 'Next' }).matches(':disabled')).toBe(true);

  const search = screen.getByLabelText('Search shareholders');
  const filter = screen.getByLabelText('Share class');
  fireEvent.change(search, { target: { value: ' eXaMpLe MeMbEr ' } });
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(2);
  expect(screen.getByText('1–2 of 2 shareholders')).toBeTruthy();
  fireEvent.change(filter, { target: { value: 'preference' } });
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(1);
  expect(within(table).getAllByText('9,007,199,254,740,993')).toHaveLength(1);
  expect(within(table).queryByText('<0.01%')).toBeNull();
  expect(screen.getByText('1 shareholder')).toBeTruthy();
  expect(screen.getByText(/1 shareholder needs identity review/)).toBeTruthy();
  fireEvent.change(filter, { target: { value: 'ordinary' } });
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(2);
  fireEvent.change(filter, { target: { value: 'all' } });
  fireEvent.change(search, { target: { value: ' preference member NAME ' } });
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(1);
  expect(within(table).getAllByText('9,007,199,254,740,993')).toHaveLength(2);
  fireEvent.change(filter, { target: { value: 'preference' } });
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(1);
  expect(within(table).getAllByText('9,007,199,254,740,993')).toHaveLength(1);
  fireEvent.change(search, { target: { value: 'No such shareholder' } });
  expect(within(table).getByText('No shareholders found.')).toBeTruthy();
  fireEvent.change(filter, { target: { value: 'all' } });
  fireEvent.change(search, { target: { value: '' } });
  expect(screen.getByText('1–10 of 11 shareholders')).toBeTruthy();
  expect(within(table).getAllByRole('row')).toHaveLength(11);
  expect(api.post).not.toHaveBeenCalled();
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'));
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'));
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.BASE);

  cleanup();
  client.clear();
  let pauseHolders = false;
  let releaseHolders!: () => void;
  api.get.mockReset().mockImplementation(async (url: string) => {
    if (url === COMPANY_TOKEN_ENDPOINTS.DETAIL('ordinary'))
      return {
        data: {
          ...ordinary.token,
          company: 'harbour',
          companyUuid: 'harbour',
          companyName: 'Harbour Example Pty Ltd',
          isOwner: false,
          statusDisplay: 'Deployed',
          tokenTypeDisplay: 'Ordinary shares',
          isTransferable: false,
          isDivisible: false,
          decimals: 0,
        },
      };
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'))
      return pauseHolders
        ? new Promise((resolve) => {
            releaseHolders = () => resolve({ data: ordinary });
          })
        : { data: ordinary };
    return { data: { results: [], count: 0, next: null, previous: null } };
  });
  show('investor', <ShareClass uuid="ordinary" />, 'Share class');
  const classTable = await screen.findByRole('table', { name: 'Company shareholders' });
  const classNamesakes = within(classTable).getAllByRole('row', { name: /Example Member/ });
  expect(classNamesakes).toHaveLength(2);
  expect(within(classNamesakes[0]).getByText('9,007,199,254,740,993')).toBeTruthy();
  expect(within(classNamesakes[1]).getByText('1')).toBeTruthy();
  expect(within(classNamesakes[1]).getByText('<0.01%')).toBeTruthy();
  expect(within(classTable).queryByRole('columnheader', { name: /PREFERENCE/ })).toBeNull();
  const formerHistory = screen.getByText(`${REGISTER_COPY.FORMER_TITLE} · 1`).closest('details')!;
  expect(formerHistory.open).toBe(false);
  fireEvent.click(formerHistory.querySelector('summary')!);
  expect(formerHistory.open).toBe(true);
  expect(within(formerHistory).getByText(former.name)).toBeTruthy();
  expect(within(formerHistory).getByText(former.member!)).toBeTruthy();
  expect(within(formerHistory).getByText(former.walletAddress!)).toBeTruthy();
  fireEvent.click(within(classNamesakes[0]).getByRole('button', { name: 'Details (Example Member)' }));
  const classDetails = await screen.findByRole('dialog', { name: 'Example Member' });
  expect(within(classDetails).getByText('9,007,199,254,740,993')).toBeTruthy();
  expect(within(classDetails).getByText(formatDate('2026-09-01'))).toBeTruthy();
  expect(within(classDetails).getByText(`0x${'1'.repeat(40)} · Active`)).toBeTruthy();
  expect(within(classDetails).queryByRole('link', { name: REGISTER_PARTICULARS_COPY.PREPARE })).toBeNull();

  pauseHolders = true;
  const holderKey = ['token', 'ordinary', 'profile-one', 'account-one', 'holders'];
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = client.refetchQueries({ queryKey: holderKey, exact: true });
  });
  await waitFor(() => expect(releaseHolders).toBeTypeOf('function'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull();
  expect(screen.queryByText('Example Member')).toBeNull();
  expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();
  for (const text of [former.name, former.member!, former.walletAddress!]) expect(screen.queryByText(text)).toBeNull();
  await act(async () => {
    releaseHolders();
    await refreshing;
  });
  expect(await screen.findByRole('table', { name: 'Company shareholders' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  const refreshedHistory = screen.getByText(`${REGISTER_COPY.FORMER_TITLE} · 1`).closest('details')!;
  expect(refreshedHistory.open).toBe(false);
  fireEvent.click(refreshedHistory.querySelector('summary')!);
  expect(refreshedHistory.open).toBe(true);
  const preferenceResponse = client.getQueryData(USER_PREFERENCES_QUERY_KEY);
  const classRead = api.get.getMockImplementation()!;
  let pausePreferences = true;
  let refusePreferences!: () => void;
  api.get.mockImplementation((url: string, config?: unknown) => {
    if (url === USER_PREFERENCES_ENDPOINTS.BASE)
      return pausePreferences
        ? new Promise((_resolve, reject) => {
            refusePreferences = () => reject(new Error('Synthetic current account read refused'));
          })
        : Promise.resolve(preferenceResponse);
    return classRead(url, config);
  });
  const refreshedTable = screen.getByRole('table', { name: 'Company shareholders' });
  fireEvent.click(within(refreshedTable).getAllByRole('button', { name: 'Details (Example Member)' })[0]);
  expect(await screen.findByRole('dialog', { name: 'Example Member' })).toBeTruthy();
  let refreshingPreferences!: Promise<void>;
  act(() => {
    refreshingPreferences = client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true });
  });
  await waitFor(() => expect(refusePreferences).toBeTypeOf('function'));
  expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Example Member')).toBeNull();
  expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();
  for (const text of [former.name, former.member!, former.walletAddress!]) expect(screen.queryByText(text)).toBeNull();
  await act(async () => {
    refusePreferences();
    await refreshingPreferences;
  });
  expect(client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status).toBe('error');
  expect(client.getQueryData(USER_PREFERENCES_QUERY_KEY)).toBe(preferenceResponse);
  expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Example Member')).toBeNull();
  expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();
  for (const text of [former.name, former.member!, former.walletAddress!]) expect(screen.queryByText(text)).toBeNull();
  pausePreferences = false;
  await act(async () => {
    await client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true });
  });
  expect(await screen.findByRole('table', { name: 'Company shareholders' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  const recoveredHistory = screen.getByText(`${REGISTER_COPY.FORMER_TITLE} · 1`).closest('details')!;
  expect(recoveredHistory.open).toBe(false);
  fireEvent.click(recoveredHistory.querySelector('summary')!);
  expect(recoveredHistory.open).toBe(true);
  pauseHolders = false;
  try {
    const resumedTable = screen.getByRole('table', { name: 'Company shareholders' });
    fireEvent.click(within(resumedTable).getAllByRole('button', { name: 'Details (Example Member)' })[0]);
    expect(await screen.findByRole('dialog', { name: 'Example Member' })).toBeTruthy();
    await act(async () => {
      onlineManager.setOnline(false);
      await client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true });
    });
    expect(client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status).toBe('success');
    expect(client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.fetchStatus).toBe('paused');
    expect(client.getQueryData(USER_PREFERENCES_QUERY_KEY)).toBe(preferenceResponse);
    await waitFor(() => expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByText('Example Member')).toBeNull();
    expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();
    for (const text of [former.name, former.member!, former.walletAddress!])
      expect(screen.queryByText(text)).toBeNull();
    await act(async () => onlineManager.setOnline(true));
    await waitFor(() => expect(client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.fetchStatus).toBe('idle'));
    expect(await screen.findByRole('table', { name: 'Company shareholders' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText(`${REGISTER_COPY.FORMER_TITLE} · 1`).closest('details')!.open).toBe(false);
  } finally {
    act(() => onlineManager.setOnline(true));
  }
  expect(api.post).not.toHaveBeenCalled();
});

it('brings complete mirror records, recovers uncertain requests and confirms one snapshot with separate company appointments', async () => {
  const manual: MemberDraft[] = [
    {
      ...blankMember(),
      name: 'Example Shareholder',
      residentialAddress: '1 Example Street, Sydney NSW 2000',
      enteredOn: '2020-01-01',
      shares: '600',
      allotments: [
        {
          ...blankAllotment(),
          allottedOn: '2015-01-01',
          shares: '400',
          amountPaid: '400',
          amountUnpaid: '0',
          shareReference: '1–400',
          certificateReference: 'CERT-001',
        },
        {
          ...blankAllotment(),
          allottedOn: '2016-01-01',
          shares: '200',
          amountPaid: '200',
          amountUnpaid: '0',
          beneficiallyHeld: false,
        },
      ],
    },
  ];
  expect(
    preparationProblems(
      {
        registerFile: null,
        asicFile: null,
        asAt: '2026-02-31',
        reference: 'Original company register',
        reason: 'Mirror',
        members: manual,
        former: [],
        statedTotal: '',
        statedCount: '',
      },
      '2026-10-14',
    ),
  ).toEqual(expect.arrayContaining([expect.stringMatching(/record date/), expect.stringMatching(/beneficially/)]));
  let visibleClass = false;
  let createdClass = false;
  let opened = false;
  let firstPreparation = true;
  let failNextPreview = false;
  let interruptNextApply = false;
  let proposal: RegisterImport | undefined;
  let companyMembers: RegisterTransferMember[] = [];
  let membersUnavailable = false;
  const company = companyRecord();
  let appointment: OwnCompanyAppointment = {
    ...CURRENT_APPOINTMENT,
    company: company.uuid,
    uuid: 'prepare-only',
    capabilities: ['prepare'],
  };
  const token = {
    uuid: 'mirror-class',
    company: company.uuid,
    companyUuid: company.uuid,
    companyName: company.name,
    name: 'Ordinary shares',
    symbol: 'ORD',
    tokenType: 'ordinary',
    totalSupply: (2n ** 256n - 1n).toString(),
    status: 'draft',
    contractAddress: null,
  };
  const dataPage = (results: unknown[]) => ({ data: { results, count: results.length, next: null, previous: null } });
  const holders = (): TokenHoldersResponse => ({
    token: { ...token },
    initialized: opened,
    issuedSupply: opened ? '600' : null,
    totalHolders: opened ? 1 : 0,
    waitingEffects: opened ? 0 : null,
    holders: opened
      ? [
          {
            member: proposal!.members[0].member,
            name: 'Example Shareholder',
            balance: '600',
            percentage: 100,
            holderType: 'member',
            enteredOn: '2020-01-01',
            identitySource: 'particulars',
            shareClass: token.uuid,
            source: 'register',
            wallets: [],
          },
        ]
      : [],
    formerMembers: [],
    formerMembersAsAt: null,
    formerMembersBlock: null,
    formerMembersStale: false,
  });
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/user-preferences/') return { data: companyPreferences() };
    if (url === COMPANY_ENDPOINTS.BASE) return dataPage([company]);
    if (url === COMPANY_ENDPOINTS.DETAIL(company.uuid)) return { data: company };
    if (url === APPOINTMENTS) return dataPage([appointment]);
    if (url === REGISTER || url === COMPANY_TOKEN_ENDPOINTS.BASE) return dataPage(visibleClass ? [token] : []);
    if (url === COMPANY_TOKEN_ENDPOINTS.DETAIL(token.uuid)) return { data: token };
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS(token.uuid)) return { data: holders() };
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBERS(token.uuid)) {
      if (membersUnavailable) throw new Error('Member choices unavailable');
      return { data: { members: companyMembers } };
    }
    if (url === IMPORTS) return dataPage(proposal ? [proposal] : []);
    return dataPage([]);
  });
  api.post.mockImplementation(async (url: string, body: RegisterImportPreparation | RegisterDecideRequest) => {
    if (url === COMPANY_TOKEN_ENDPOINTS.BASE) {
      createdClass = true;
      throw new Error('Interrupted class creation response');
    }
    if (url === IMPORTS) {
      const request = body as RegisterImportPreparation;
      expect(request.appointment).toBe('prepare-only');
      proposal ??= {
        uuid: request.operationId,
        company: company.uuid,
        token: token.uuid,
        asAt: request.asAt,
        registerEvidence: null,
        sourceDocument: null,
        asicEvidence: null,
        asicDocument: null,
        asicIssuedTotal: null,
        asicMemberCount: null,
        asicSnapshot: {},
        asicFingerprint: '',
        evidenceSnapshot: {},
        evidenceFingerprint: '',
        providedBy: 'company',
        authority: 'company_records',
        approvingDirector: '',
        authorityReference: request.sourceReference,
        sourceReference: request.sourceReference,
        sourceConfirmed: true,
        correctionOf: null,
        correctionAllowed: false,
        reason: request.reason,
        members: request.members.map((member) => ({ ...member, amountPaid: '600.00' })),
        formerMembers: [],
        preparingAppointment: request.appointment,
        preparedByName: 'Example Director',
        submittedBy: 1,
        createdAt: '2026-10-14T00:00:00Z',
        stage: 'submitted',
        status: 'submitted',
        decisions: [],
        rejectionReason: '',
        reviewedAt: null,
        reviewedBy: null,
        registerSequence: null,
      };
      if (firstPreparation) {
        firstPreparation = false;
        throw new Error('Interrupted preparation response');
      }
      return { data: proposal };
    }
    const request = body as RegisterDecideRequest;
    expect(request.appointment).toBe(appointment.uuid);
    expect(appointment.capabilities).toContain(request.kind);
    if (url.endsWith('/decision-preview/')) {
      if (failNextPreview) {
        failNextPreview = false;
        throw new Error('Interrupted preview response');
      }
      return {
        data: {
          canDecide: true,
          unmetRequirements: [],
          previewDigest: 'a'.repeat(64),
          comparison: [],
          opensRegister: !opened,
          registerSequence: 0,
          importedTotal: '600',
          importedMemberCount: 1,
          statedTotal: null,
          statedMemberCount: null,
          sourceReference: proposal!.sourceReference,
          correctionOf: null,
          correctionAllowed: false,
        },
      };
    }
    if (url.endsWith('/decide/')) {
      if (proposal!.decisions.some((decision) => decision.idempotencyKey === request.idempotencyKey))
        return { data: proposal };
      proposal = {
        ...proposal!,
        stage: request.kind === 'approve' ? 'approved' : 'applied',
        status: request.kind === 'approve' ? 'submitted' : 'applied',
        reviewedAt: request.kind === 'approve' ? null : '2026-10-14T00:00:00Z',
        decisions: [
          ...proposal!.decisions,
          {
            uuid: crypto.randomUUID(),
            appointment: request.appointment,
            idempotencyKey: request.idempotencyKey,
            kind: request.kind,
            digest: request.previewDigest,
            reason: request.reason ?? '',
            decidedAt: '2026-10-14T00:00:00Z',
            decidedBy: 1,
            decidedByName: 'Example Director',
          },
        ],
      };
      if (request.kind === 'apply') {
        opened = true;
        if (interruptNextApply) {
          interruptNextApply = false;
          throw new Error('Interrupted confirmation response');
        }
      }
      return { data: proposal };
    }
    throw new Error(`Unexpected write ${url}`);
  });
  const showJourney = (path = '/') => {
    prepareCompanyClient(client);
    render(
      <QueryClientProvider client={client}>
        <ApiClientProvider client={apiClient}>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/" element={<CompanyDashboardPage />} />
              <Route path="/company/dashboard" element={<CompanyDashboardPage />} />
              <Route path={DESTINATIONS.companyRegisterSetup.path} element={<CompanyRegisterImportPage />} />
              <Route path={DESTINATIONS.companyRegisterImport.path} element={<CompanyRegisterImportPage />} />
            </Routes>
          </MemoryRouter>
        </ApiClientProvider>
      </QueryClientProvider>,
    );
  };
  const reopen = (capability: 'approve' | 'apply', path: string) => {
    cleanup();
    client.clear();
    appointment = { ...appointment, uuid: `${capability}-only`, capabilities: [capability] };
    showJourney(path);
  };
  showJourney();
  fireEvent.click(await screen.findByRole('link', { name: 'Set up your share register' }));
  expect(await screen.findByText(`${company.name} · Ordinary shares (ORD)`)).toBeTruthy();
  expect(screen.queryByLabelText('Authorised shares')).toBeNull();
  expect(screen.queryByLabelText('Reason')).toBeNull();
  expect(screen.queryByLabelText('Record source')).toBeNull();
  const recordDate = (screen.getByLabelText('Record date') as HTMLInputElement).value;
  const displayedRecordDate = formatDate(recordDate);
  const futureImport = screen.getByRole('button', { name: 'Import' });
  expect(futureImport.getAttribute('aria-disabled')).toBe('true');
  expect(futureImport.getAttribute('title')).toMatch(/Coming soon.*Review and correct/);
  expect(futureImport.getAttribute('type')).toBe('button');
  fireEvent.click(futureImport);
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Record date')).toBeTruthy();
  expect(screen.queryByRole('link', { name: /Back to dashboard/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText('No shareholders added yet.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  expect(screen.queryByRole('button', { name: 'Save draft and review' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel (shareholder edit)' }));
  expect(screen.getByText('No shareholders added yet.')).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Example Shareholder' } });
  fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 Example Street, Sydney NSW 2000' } });
  fireEvent.change(screen.getByLabelText('Date first added to register'), { target: { value: '2020-01-01' } });
  fireEvent.change(screen.getByLabelText('Shares held'), { target: { value: '600' } });
  fireEvent.change(screen.getByLabelText('Allotment date'), { target: { value: '2015-01-01' } });
  fireEvent.change(screen.getByLabelText('Shares in allotment'), { target: { value: '400' } });
  fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '400' } });
  fireEvent.change(screen.getByLabelText('Amount unpaid'), { target: { value: '0' } });
  expect((screen.getByLabelText('Held for someone else?') as HTMLSelectElement).value).toBe('');
  expect(screen.queryByText('Payment status')).toBeNull();
  fireEvent.change(screen.getByLabelText('Held for someone else?'), { target: { value: 'no' } });
  expect((screen.getByLabelText('Held for someone else?') as HTMLSelectElement).value).toBe('no');
  const references = screen.getByText('References (optional)').closest('details')!;
  expect(references.open).toBe(false);
  fireEvent.click(screen.getByText('References (optional)'));
  fireEvent.change(screen.getByLabelText('Share numbers or reference'), { target: { value: '1–400' } });
  fireEvent.change(screen.getByLabelText('Certificate reference'), { target: { value: 'CERT-001' } });
  expect(references.open).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Add allotment (shareholder 1)' }));
  fireEvent.change(screen.getAllByLabelText('Allotment date')[1], { target: { value: '2016-01-01' } });
  fireEvent.change(screen.getAllByLabelText('Shares in allotment')[1], { target: { value: '200' } });
  fireEvent.change(screen.getAllByLabelText('Amount paid')[1], { target: { value: '200' } });
  fireEvent.change(screen.getAllByLabelText('Amount unpaid')[1], { target: { value: '0' } });
  fireEvent.change(screen.getAllByLabelText('Held for someone else?')[1], { target: { value: 'yes' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Add to draft' }).closest('form')!);
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add to draft' }));
  expect(screen.getByText('Example Shareholder')).toBeTruthy();
  expect(screen.queryByLabelText('Name')).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit (shareholder 1)' }));
  expect((screen.getAllByLabelText('Share numbers or reference')[0] as HTMLInputElement).value).toBe('1–400');
  expect(screen.getAllByText('References (optional)')[0].closest('details')!.open).toBe(true);
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Discarded edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel (shareholder edit)' }));
  expect(screen.getByText('Example Shareholder')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Back to share details' }));
  fireEvent.change(screen.getByLabelText('Record date'), { target: { value: '2010-01-01' } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  expect(screen.getByText(/original membership date no later than the record date/)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Back to share details' }));
  fireEvent.change(screen.getByLabelText('Record date'), { target: { value: recordDate } });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  const recover = await screen.findByRole('button', { name: 'Recover saved records' });
  expect(createdClass).toBe(true);
  expect(screen.queryByRole('button', { name: 'Back to share details' })).toBeNull();
  fireEvent.click(recover);
  await screen.findByText(/original class creation result is still uncertain/);
  expect(api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.BASE)).toHaveLength(1);
  visibleClass = true;
  fireEvent.click(screen.getByRole('button', { name: 'Recover saved records' }));
  await waitFor(() => expect(api.post.mock.calls.filter(([url]) => url === IMPORTS)).toHaveLength(1));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Recover saved records' }) as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Recover saved records' }));
  await waitFor(() =>
    expect(
      api.get.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.HOLDERS(token.uuid)).length,
    ).toBeGreaterThan(1),
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const shareholderTable = await screen.findByRole('table', { name: 'Shareholders' });
  expect(within(shareholderTable).getByText('Example Shareholder')).toBeTruthy();
  expect(within(shareholderTable).getByText('1 Example Street, Sydney NSW 2000')).toBeTruthy();
  expect(within(shareholderTable).getByText('100.00%')).toBeTruthy();
  fireEvent.click(within(shareholderTable).getByRole('button', { name: 'Details (Example Shareholder)' }));
  const shareholderDetails = await screen.findByRole('dialog', { name: 'Example Shareholder' });
  expect(within(shareholderDetails).getByText('CERT-001')).toBeTruthy();
  expect(within(shareholderDetails).getByText('1 Example Street, Sydney NSW 2000')).toBeTruthy();
  fireEvent.click(within(shareholderDetails).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const setupSteps = await screen.findByRole('list', { name: 'Share register setup steps' });
  expect(within(setupSteps).getAllByRole('listitem')).toHaveLength(3);
  expect(within(setupSteps).getAllByRole('listitem')[2].getAttribute('aria-current')).toBe('step');
  expect(screen.queryByRole('button', { name: 'Continue to confirmation' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Back to review' })).toBeNull();
  const preparations = api.post.mock.calls.filter(([url]) => url === IMPORTS).map(([, body]) => body);
  expect(preparations).toHaveLength(2);
  expect(preparations[0]).toEqual(preparations[1]);
  expect(proposal!.sourceReference).toBe('Company-provided share records');
  expect(proposal!.members[0].enteredOn).toBe('2020-01-01');
  expect(proposal!.members[0].allotments?.[0].allottedOn).toBe('2015-01-01');
  expect(proposal!.members[0].allotments?.map((allotment) => allotment.beneficiallyHeld)).toEqual([true, false]);
  expect(proposal!.members[0].allotments?.[0].shareReference).toBe('1–400');
  expect(proposal!.members[0].allotments?.[0].certificateReference).toBe('CERT-001');
  expect((screen.getByRole('button', { name: 'Record review' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Edit records' }) as HTMLButtonElement).disabled).toBe(true);
  const importPath = DESTINATIONS.companyRegisterImport.path.replace(':uuid', token.uuid);
  reopen('apply', importPath);
  expect(await screen.findByText('Example Shareholder')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/review access must review them/)).toBeTruthy();
  reopen('approve', `${importPath}?record=${proposal!.uuid}`);
  expect(await screen.findByText('Example Shareholder')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Edit records' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Save draft and review' })).toBeNull();
  const review = await screen.findByRole('button', { name: 'Record review' });
  await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
  const previewGuard = api.post.mock.calls.find(([url]) => url.endsWith('/decision-preview/'))![2]
    .ledovaSubmissionGuard;
  expect(screen.getAllByText(displayedRecordDate).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Details (Example Shareholder)' }));
  expect(await screen.findByRole('dialog', { name: 'Example Shareholder' })).toBeTruthy();
  visibleClass = false;
  await act(async () => {
    await client.invalidateQueries({ predicate: (query) => query.queryKey.at(-1) === 'classes' });
  });
  expect(await screen.findByText(/Refresh current company access before showing these records/)).toBeTruthy();
  expect(screen.queryAllByText(displayedRecordDate)).toHaveLength(0);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryAllByText('1 Example Street, Sydney NSW 2000')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Record review' })).toBeNull();
  expect(() => previewGuard()).toThrow(/company, authority or source records changed/);
  expect(api.post.mock.calls.filter(([url]) => url.endsWith('/decide/'))).toHaveLength(0);
  visibleClass = true;
  await act(async () => {
    await client.invalidateQueries({ predicate: (query) => query.queryKey.at(-1) === 'classes' });
  });
  expect(await screen.findByRole('button', { name: 'Record review' })).toBeTruthy();
  expect(screen.getAllByText(displayedRecordDate).length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole('button', { name: 'Details (Example Shareholder)' }));
  expect(await screen.findByRole('dialog', { name: 'Example Shareholder' })).toBeTruthy();
  appointment = { ...appointment, status: 'revoked', isEffective: false, revokedAt: '2026-10-14T00:00:00Z' };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['company-appointments'] });
  });
  expect(await screen.findByText(/Refresh current company access before showing these records/)).toBeTruthy();
  expect(screen.queryAllByText(displayedRecordDate)).toHaveLength(0);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryAllByText('1 Example Street, Sydney NSW 2000')).toHaveLength(0);
  expect(screen.queryByRole('button', { name: 'Record review' })).toBeNull();
  expect(api.post.mock.calls.filter(([url]) => url.endsWith('/decide/'))).toHaveLength(0);
  appointment = { ...appointment, status: 'active', isEffective: true, revokedAt: null };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['company-appointments'] });
  });
  const restoredReview = await screen.findByRole('button', { name: 'Record review' });
  await waitFor(() => expect((restoredReview as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(restoredReview);
  expect(await screen.findByText(/These records are reviewed/)).toBeTruthy();
  expect(opened).toBe(false);
  expect(proposal!.decisions.map((decision) => decision.kind)).toEqual(['approve']);
  reopen('apply', importPath);
  expect(await screen.findByText('Example Shareholder')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Edit records' }) as HTMLButtonElement).disabled).toBe(true);
  const confirm = await screen.findByRole('button', { name: 'Confirm' });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(confirm);
  const summary = await screen.findByRole('region', { name: 'Company ownership summary' });
  expect(within(summary).getByText('600')).toBeTruthy();
  expect(screen.getByText('100.00%')).toBeTruthy();
  expect(proposal!.status).toBe('applied');
  expect(proposal!.decisions.map((decision) => decision.kind)).toEqual(['approve', 'apply']);
  expect(proposal!.decisions.map((decision) => decision.appointment)).toEqual(['approve-only', 'apply-only']);
  expect(api.post.mock.calls.filter(([url]) => url === IMPORTS)).toHaveLength(2);
  expect(api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.BASE)).toHaveLength(1);
  cleanup();
  client.clear();
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'History' }));
  const copiedSummary = await screen.findByText(/^Copied opening ·/);
  const copiedOpening = copiedSummary.closest('details')!;
  expect(copiedOpening.open).toBe(false);
  fireEvent.click(copiedSummary);
  expect(copiedOpening.open).toBe(true);
  const copiedMembers = within(copiedOpening).getByRole('table', { name: 'Shareholders' });
  expect(within(copiedMembers).getByText('Example Shareholder')).toBeTruthy();
  expect(within(copiedMembers).getByText('600')).toBeTruthy();
  expect(within(copiedMembers).getByText(formatDate('2020-01-01'))).toBeTruthy();
  const transferTask = screen.getByRole('button', { name: 'Transfer shares' });
  fireEvent.click(within(copiedMembers).getByRole('button', { name: 'Details (Example Shareholder)' }));
  const copiedDetails = await screen.findByRole('dialog', { name: 'Example Shareholder' });
  expect(within(copiedDetails).getByText('CERT-001')).toBeTruthy();
  expect(within(copiedDetails).getAllByRole('heading', { name: /^Allotment / })).toHaveLength(2);
  fireEvent.click(transferTask);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('table', { name: 'Shareholders' })).toBeNull();
  expect(proposal!.status).toBe('applied');
  expect(proposal!.decisions.map((decision) => decision.kind)).toEqual(['approve', 'apply']);
  cleanup();
  client.clear();
  api.post.mockClear();
  opened = false;
  proposal = { ...proposal!, status: 'submitted', stage: 'submitted', decisions: [] };
  appointment = { ...appointment, uuid: 'combined-confirmer', capabilities: ['prepare', 'approve', 'apply'] };
  failNextPreview = true;
  interruptNextApply = true;
  showJourney(`${importPath}?record=${proposal.uuid}`);
  expect(await screen.findByRole('table', { name: 'Shareholders' })).toBeTruthy();
  expect(await screen.findByText('Interrupted preview response')).toBeTruthy();
  expect(api.post.mock.calls.filter(([url]) => url.endsWith('/decision-preview/'))).toHaveLength(1);
  expect(api.post.mock.calls.filter(([url]) => url.endsWith('/decide/'))).toHaveLength(0);
  expect((screen.getByRole('button', { name: 'Confirm' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Load confirmation' }));
  const oneConfirm = await screen.findByRole('button', { name: 'Confirm' });
  await waitFor(() => expect((oneConfirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(oneConfirm);
  await screen.findByRole('button', { name: 'Recover confirmation' });
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Recover confirmation' }) as HTMLButtonElement).disabled).toBe(false),
  );
  expect(proposal.decisions.map((decision) => decision.kind)).toEqual(['approve', 'apply']);
  expect(screen.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect((screen.getByRole('button', { name: 'Edit records' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Recover confirmation' }));
  expect(await screen.findByRole('region', { name: 'Company ownership summary' })).toBeTruthy();
  const applications = api.post.mock.calls
    .filter(([url, body]) => url.endsWith('/decide/') && body.kind === 'apply')
    .map(([, body]) => body);
  expect(applications).toHaveLength(2);
  expect(applications[0]).toEqual(applications[1]);
  expect(proposal.decisions.map((decision) => decision.kind)).toEqual(['approve', 'apply']);
  cleanup();
  client.clear();
  proposal = { ...proposal, correctionAllowed: true };
  showJourney(`${importPath}?record=${proposal.uuid}`);
  const recorded = await screen.findByRole('region', { name: 'Recorded share register' });
  expect(within(recorded).getByRole('heading', { name: 'Recorded' })).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Share register setup steps' })).toBeNull();
  expect(within(recorded).queryByText(/Editing retires this prepared draft/)).toBeNull();
  expect(within(recorded).queryByRole('button', { name: 'Confirm' })).toBeNull();
  const ownership = within(recorded).getByRole('button', { name: 'View company ownership' });
  fireEvent.click(ownership);
  expect(await screen.findByRole('region', { name: 'Company ownership summary' })).toBeTruthy();
  const rejected: RegisterImport = {
    ...proposal!,
    uuid: 'rejected-copy',
    sourceReference: 'Retained source label',
    preparingAppointment: 'original-preparer',
    status: 'rejected',
    stage: 'rejected',
    registerEvidence: 'original-register-copy',
    asicEvidence: 'original-asic-copy',
    asicIssuedTotal: '600',
    asicMemberCount: 1,
  };
  const showReplacement = (uuid: string, correction?: RegisterImport) => {
    cleanup();
    client.clear();
    const preparationAppointment: OwnCompanyAppointment = {
      ...appointment,
      uuid,
      capabilities: ['prepare'],
    };
    render(
      <QueryClientProvider client={client}>
        <ApiClientProvider client={apiClient}>
          <MemoryRouter>
            <ImportForm
              owner={{ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }}
              guard={() => {}}
              company={company.uuid}
              register={holders()}
              companyMembers={[]}
              appointment={preparationAppointment}
              steps={{ prepare: preparationAppointment }}
              saved={correction ? undefined : rejected}
              correction={correction}
              blocked={false}
              onConflict={() => {}}
            />
          </MemoryRouter>
        </ApiClientProvider>
      </QueryClientProvider>,
    );
  };
  showReplacement('original-preparer');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText(/retained source copy will be reused/)).toBeTruthy();
  expect(screen.getByText(/retained ASIC copy and figures will be reused/)).toBeTruthy();
  showReplacement('another-preparer');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText(/earlier source copies stay with the earlier snapshot/)).toBeTruthy();
  expect(screen.queryByText(/will be reused/)).toBeNull();
  expect((screen.getByLabelText('Issued shares in the comparison source (optional)') as HTMLInputElement).value).toBe(
    '600',
  );
  api.post.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  expect(screen.getByText(/Attach the optional ASIC extract/)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Leave out ASIC comparison' }));
  expect((screen.getByLabelText('Issued shares in the comparison source (optional)') as HTMLInputElement).value).toBe(
    '',
  );
  expect(
    (screen.getByLabelText('Shareholders listed in the comparison source (optional)') as HTMLInputElement).value,
  ).toBe('');
  api.post.mockImplementation(async (url: string, request: RegisterImportPreparation) => {
    expect(url).toBe(IMPORTS);
    return {
      data: {
        ...rejected,
        uuid: request.operationId,
        preparingAppointment: request.appointment,
        status: 'submitted',
        stage: 'submitted',
        decisions: [],
        registerEvidence: null,
        asicEvidence: null,
        asicIssuedTotal: null,
        asicMemberCount: null,
        correctionOf: request.correctionOf ?? null,
        reason: request.reason,
        members: request.members.map((member) => ({ ...member, amountPaid: '600.00' })),
      },
    };
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  const replacement = api.post.mock.calls[0][1] as RegisterImportPreparation;
  expect(replacement.appointment).toBe('another-preparer');
  expect(replacement.sourceReference).toBe('Retained source label');
  expect(replacement.registerEvidence).toBeUndefined();
  expect(replacement.asicEvidence).toBeUndefined();
  expect(replacement.asicIssuedTotal).toBeUndefined();
  expect(replacement.asicMemberCount).toBeUndefined();
  expect(replacement.members[0].member).toBe(rejected.members[0].member);
  expect(rejected.registerEvidence).toBe('original-register-copy');
  expect(rejected.asicEvidence).toBe('original-asic-copy');
  api.post.mockClear();
  const opening: RegisterImport = { ...rejected, uuid: 'confirmed-opening', status: 'applied', stage: 'applied' };
  showReplacement('another-preparer', opening);
  fireEvent.change(screen.getByLabelText('Reason for correcting the mirror'), {
    target: { value: 'Correct the copied shareholder name' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit (shareholder 1)' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Renamed Shareholder' } });
  fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  const correction = api.post.mock.calls[0][1] as RegisterImportPreparation;
  expect(correction.correctionOf).toBe(opening.uuid);
  expect(correction.members[0].member).toBe(opening.members[0].member);
  expect(correction.members[0].name).toBe('Renamed Shareholder');
  expect(correction.sourceReference).toBe(opening.sourceReference);
  expect(correction.asAt).toBe(opening.asAt);
  expect(correction.members[0].enteredOn).toBe(opening.members[0].enteredOn);
  expect(opening.members[0].name).toBe('Example Shareholder');
  cleanup();
  client.clear();
  api.post.mockClear();
  opened = false;
  proposal = undefined;
  appointment = { ...appointment, capabilities: ['prepare'] };
  const setupClasses = [
    token,
    { ...token, uuid: 'deployed-class', name: 'Deployed shares', symbol: 'DEP', status: 'deployed' },
    { ...token, uuid: 'paused-class', name: 'Paused shares', symbol: 'PAU', status: 'paused' },
    { ...token, uuid: 'deploying-class', name: 'Deploying shares', symbol: 'ING', status: 'deploying' },
  ];
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/user-preferences/') return { data: companyPreferences() };
    if (url === COMPANY_ENDPOINTS.BASE) return dataPage([company]);
    if (url === COMPANY_ENDPOINTS.DETAIL(company.uuid)) return { data: company };
    if (url === APPOINTMENTS) return dataPage([appointment]);
    if (url === REGISTER || url === COMPANY_TOKEN_ENDPOINTS.BASE) return dataPage(setupClasses);
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS(token.uuid)) return { data: holders() };
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBERS(token.uuid)) {
      if (membersUnavailable) throw new Error('Member choices unavailable');
      return { data: { members: companyMembers } };
    }
    if (url === IMPORTS) return dataPage(proposal ? [proposal] : []);
    return dataPage([]);
  });
  showJourney(DESTINATIONS.companyRegisterSetup.path);
  const selector = (await screen.findByLabelText('Share class')) as HTMLSelectElement;
  expect([...selector.options].map((option) => option.value)).toEqual([
    token.uuid,
    'ordinary',
    'preference',
    'redeemable',
    'custom',
  ]);
  expect(selector.value).toBe('ordinary');
  expect(screen.queryByLabelText('Class code')).toBeNull();
  fireEvent.change(selector, { target: { value: 'custom' } });
  fireEvent.change(screen.getByLabelText('Class name'), { target: { value: 'Company A shares' } });
  fireEvent.change(screen.getByLabelText('Class code'), { target: { value: 'A' } });
  expect(screen.getByText(`${company.name} · Company A shares (A)`)).toBeTruthy();
  expect((screen.getByLabelText('Class code') as HTMLInputElement).maxLength).toBe(5);
  fireEvent.change(selector, { target: { value: 'preference' } });
  expect(screen.getByText(`${company.name} · Preference shares (PRF)`)).toBeTruthy();
  expect(screen.queryByLabelText('Class name')).toBeNull();
  expect(screen.queryByLabelText('Class code')).toBeNull();
  expect(screen.queryByLabelText('Class type')).toBeNull();
  fireEvent.change(selector, { target: { value: 'redeemable' } });
  expect(screen.getByText(`${company.name} · Redeemable shares (RED)`)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'open Register' }).getAttribute('href')).toBe('/company/register');
  fireEvent.change(selector, { target: { value: token.uuid } });
  await waitFor(() => expect(screen.queryByLabelText('Class code')).toBeNull());
  expect(await screen.findByLabelText('Record date')).toBeTruthy();
  for (const status of ['deployed', 'paused', 'deploying']) {
    cleanup();
    client.clear();
    token.status = status;
    showJourney(importPath);
    expect(await screen.findByText(/This class cannot open from copied records/)).toBeTruthy();
    expect(screen.queryByLabelText('Record date')).toBeNull();
    expect(screen.getByRole('link', { name: 'Open Register' }).getAttribute('href')).toBe('/company/register');
  }
  cleanup();
  client.clear();
  showJourney(DESTINATIONS.companyRegisterSetup.path);
  const noDraftClasses = (await screen.findByLabelText('Share class')) as HTMLSelectElement;
  expect([...noDraftClasses.options].map((option) => option.value)).toEqual([
    'ordinary',
    'preference',
    'redeemable',
    'custom',
  ]);
  expect(screen.queryByLabelText('Class code')).toBeNull();
  cleanup();
  client.clear();
  token.status = 'deployed';
  proposal = rejected;
  opened = true;
  showJourney(importPath);
  expect(await screen.findByLabelText('Record date')).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  cleanup();
  client.clear();
  opened = false;
  proposal = undefined;
  token.status = 'draft';
  companyMembers = [
    {
      member: rejected.members[0].member,
      name: rejected.members[0].name,
      residentialAddress: rejected.members[0].residentialAddress,
      currentShares: '500',
      enteredOn: '1990-01-01',
      lastCeasedOn: null,
      walletless: true,
      particularsRetained: true,
    },
  ];
  membersUnavailable = true;
  showJourney(DESTINATIONS.companyRegisterSetup.path);
  const retryChoices = await screen.findByRole('button', { name: 'Try again' });
  expect(screen.queryByLabelText('Company shareholder')).toBeNull();
  membersUnavailable = false;
  fireEvent.click(retryChoices);
  const useExistingDraft = await screen.findByLabelText('Share class');
  fireEvent.change(useExistingDraft, { target: { value: token.uuid } });
  await waitFor(() => expect(screen.queryByLabelText('Class code')).toBeNull());
  expect(await screen.findByLabelText('Record date')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  const existing = screen.getByLabelText('Company shareholder');
  expect((existing as HTMLSelectElement).value).toBe('');
  fireEvent.change(existing, { target: { value: companyMembers[0].member } });
  expect((screen.getByLabelText('Name') as HTMLInputElement).readOnly).toBe(true);
  expect((screen.getByLabelText('Address') as HTMLInputElement).readOnly).toBe(true);
  expect((screen.getByLabelText('Date first added to register') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('Shares held') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('button', { name: 'Add to draft' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Save draft and review' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel (shareholder edit)' }));
  const enterHolding = () => {
    act(() => {
      for (const [label, value] of [
        ['Date first added to register', '2020-01-01'],
        ['Shares held', '600'],
        ['Allotment date', '2015-01-01'],
        ['Shares in allotment', '600'],
        ['Amount paid', '600'],
        ['Amount unpaid', '0'],
        ['Held for someone else?', 'no'],
      ])
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
    });
  };
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: companyMembers[0].name } });
  fireEvent.change(screen.getByLabelText('Address'), { target: { value: companyMembers[0].residentialAddress } });
  enterHolding();
  fireEvent.click(screen.getByRole('button', { name: 'Add to draft' }));
  expect(screen.getByText(/explicitly choose a new shareholder/)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Company shareholder'), { target: { value: companyMembers[0].member } });
  expect((screen.getByLabelText('Date first added to register') as HTMLInputElement).value).toBe('2020-01-01');
  expect(screen.getByRole('button', { name: 'Add to draft' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel (shareholder edit)' }));
  expect(screen.getByText('No shareholders added yet.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  fireEvent.change(screen.getByLabelText('Company shareholder'), { target: { value: companyMembers[0].member } });
  enterHolding();
  fireEvent.click(screen.getByRole('button', { name: 'Add to draft' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  const duplicateChoice = screen.getByLabelText('Company shareholder') as HTMLSelectElement;
  expect([...duplicateChoice.options].find((option) => option.value === companyMembers[0].member)?.disabled).toBe(true);
  fireEvent.change(duplicateChoice, { target: { value: companyMembers[0].member } });
  expect(duplicateChoice.value).toBe('');
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel (shareholder edit)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  expect((api.post.mock.calls[0][1] as RegisterImportPreparation).members[0].member).toBe(companyMembers[0].member);
});

it('shows an account without register access a calm empty state, reads no members and offers no entry', async () => {
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER || url === COMPANY_ENDPOINTS.BASE) return page([]);
    throw new Error(`Unexpected read ${url}`);
  });
  show('investor');
  expect(await screen.findByText(NO_REGISTER)).toBeTruthy();
  expect(screen.queryByLabelText('Company')).toBeNull();
  expect(screen.queryByRole('button', { name: /shares/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
  cleanup();
  show('investor', <SettingsPage />, 'Settings');
  expect(await screen.findByRole('link', { name: 'Team and appointments' })).toBeTruthy();
  await waitFor(() => expect(readUrls()).toEqual([REGISTER, REGISTER, COMPANY_ENDPOINTS.BASE]));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(screen.queryByRole('link', { name: 'Register' })).toBeNull();
});

it("retains a dashboard's validated company/class context and reads only the chosen company's members", async () => {
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER) return page([harbour('ordinary'), inland('preference')]);
    return noCommands(url) ?? { data: register(url.includes('preference') ? 'preference' : 'ordinary') };
  });
  show(
    'investor',
    <>
      <CompanyRegisterPage />
      <Link to="/" state={{ registerCompany: 'inland', registerToken: 'ordinary' }}>
        Open mismatched dashboard class
      </Link>
      <Link to="/" state={{ registerCompany: 'inland', registerToken: 'preference', registerHistory: true }}>
        Open dashboard class
      </Link>
    </>,
  );
  const select = (await screen.findByLabelText('Company')) as HTMLSelectElement;
  expect([...select.options].map((option) => option.textContent)).toEqual([
    'Select a company',
    'Harbour Example Pty Ltd',
    'Inland Example Pty Ltd',
  ]);
  expect(select.value).toBe('');
  expect(screen.getByText('Select a company to show its register.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /shares/ })).toBeNull();
  expect(readUrls()).toEqual([REGISTER]);

  fireEvent.click(screen.getByRole('link', { name: 'Open mismatched dashboard class' }));
  expect(select.value).toBe('');
  expect(readUrls()).toEqual([REGISTER]);
  fireEvent.click(screen.getByRole('link', { name: 'Open dashboard class' }));
  const preference = await screen.findByRole('heading', { name: /^Preference shares ·/ });
  await waitFor(() => expect(document.activeElement).toBe(preference.closest('li')));
  expect(preference.closest('li')!.querySelector<HTMLDetailsElement>('details[data-register-history]')!.open).toBe(
    true,
  );
  expect(screen.getByText('Inland Example Pty Ltd', { selector: 'p' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /^Ordinary shares ·/ })).toBeNull();
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'));
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'));
  const table = await screen.findByRole('table', { name: 'Company shareholders' });
  fireEvent.click(within(table).getByRole('button', { name: 'Details (Example Member)' }));
  expect(await screen.findByRole('dialog', { name: 'Example Member' })).toBeTruthy();

  fireEvent.change(select, { target: { value: 'harbour' } });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();
  await screen.findByRole('table', { name: 'Company shareholders' });
  fireEvent.click(screen.getByRole('button', { name: 'History' }));
  await screen.findByRole('heading', { name: /^Ordinary shares ·/ });
  expect(screen.getByText('Harbour Example Pty Ltd', { selector: 'p' })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /^Preference shares ·/ })).toBeNull();
  expect(
    readUrls().filter(
      (url) =>
        url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference') || url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'),
    ),
  ).toEqual([COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'), COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary')]);
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.BASE);
  for (const read of [PARTICULARS, LINKS])
    expect(api.get.mock.calls.filter(([url]) => url === read).map(([, config]) => config.params.company)).toEqual([
      'inland',
      'harbour',
    ]);
});

it("starts again for another signed-in account without showing the previous account's register or choice", async () => {
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER) return page([harbour('ordinary'), inland('preference')]);
    return noCommands(url) ?? { data: register(url.includes('preference') ? 'preference' : 'ordinary') };
  });
  show('investor');
  fireEvent.change(await screen.findByLabelText('Company'), { target: { value: 'inland' } });
  const table = await screen.findByRole('table', { name: 'Company shareholders' });
  fireEvent.click(screen.getByRole('button', { name: 'History' }));
  expect(await screen.findByRole('heading', { name: /^Preference shares ·/ })).toBeTruthy();
  fireEvent.click(within(table).getByRole('button', { name: 'Details (Example Member)' }));
  const details = await screen.findByRole('dialog', { name: 'Example Member' });
  expect(within(details).getByText(`0x${'1'.repeat(40)} · Active`)).toBeTruthy();

  let finish!: (response: ReturnType<typeof page>) => void;
  api.get.mockImplementation((url: string) =>
    url === REGISTER
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(noCommands(url) ?? { data: register(url.includes('preference') ? 'preference' : 'ordinary') }),
  );
  const other = companyPreferences('investor');
  act(() =>
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { ...other, userProfile: 'profile-two', userAccount: { ...other.userAccount!, uuid: 'account-two' } },
    }),
  );
  expect(screen.getByRole('status').textContent).toBe('Loading your register…');
  expect(screen.queryByRole('heading', { name: /^Preference shares ·/ })).toBeNull();
  expect(screen.queryByLabelText('Company')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByText('Example Member')).toBeNull();
  expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();
  await act(async () => finish(page([harbour('ordinary'), inland('preference')])));
  expect(((await screen.findByLabelText('Company')) as HTMLSelectElement).value).toBe('');
  expect(screen.queryByRole('heading', { name: /^Preference shares ·/ })).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByText('Select a company to show its register.')).toBeTruthy();
  expect(readUrls().filter((url) => url === REGISTER)).toHaveLength(2);
});
