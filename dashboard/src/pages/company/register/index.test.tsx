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
  TECHNICAL_SHARE_LIMIT,
  formatDate,
  USER_PREFERENCES_QUERY_KEY,
  USER_PREFERENCES_ENDPOINTS,
  type AccountRole,
  type TokenHoldersResponse,
  type OwnCompanyAppointment,
  type RegisterTransferMember,
  type CompanyShareToken,
  type ClassRightsRevision,
  type ClassRightsRequest,
  shortReference,
} from '@ledova/shared';
import SettingsPage from '@pages/settings';
import apiClient from '@services/apiClient';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CompanyRegisterPage from '.';
import CompanyShareholderPage from './member';
import CompanyDashboardPage from '../dashboard';
import { ShareClass } from './detail/ShareClass';
import { ClassReconciliation } from './ClassReconciliation';
import CompanyRegisterImportPage from './import';
import { ImportForm } from './import/ImportForm';
import { useNewShareClass } from './import/useNewShareClass';
import { peopleKey, readPeople } from './shared/usePeople';
import {
  blankAllotment,
  blankMember,
  canOpenEmptyRegister,
  preparationProblems,
  type MemberDraft,
} from './import/preparation';
import { APPOINTMENT as CURRENT_APPOINTMENT } from '../../../testSupport/company';
import {
  choose,
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
const PROFILES = '/api/user-profiles/';
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

function show(
  role: AccountRole = 'company',
  content: ReactNode = <CompanyRegisterPage />,
  title = 'Register',
  route?: { entry?: string; path?: string },
) {
  prepareCompanyClient(client, role);
  client.setQueryData(['userAccount'], { data: { role } });
  return renderCompanyPage(client, content, title, route);
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
    issuedSupply: '9007199254741018',
    totalHolders: 26,
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
      ...Array.from({ length: 24 }, (_, index) => ({
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
  show('company', <CompanyRegisterPage />, 'Register', { entry: '/#shareholders' });
  const table = await screen.findByRole('table', { name: 'Company shareholders' });
  expect(api.get).toHaveBeenCalledWith(REGISTER, {
    params: { page: 1 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(api.get).toHaveBeenCalledWith(REGISTER, {
    params: { page: 2 },
    ledovaSubmissionGuard: expect.any(Function),
  });
  expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();
  expect(screen.getByRole('heading', { level: 1, name: 'Shareholders' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Current shareholders' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Member access and requests' })).toBeTruthy();
  for (const name of ['Issue shares', 'Transfer shares', 'History'])
    expect(screen.queryByRole('button', { name })).toBeNull();
  const formerSection = screen.getByRole('heading', { name: 'Former shareholders' }).closest('section')!;
  expect(within(formerSection).getByRole('heading', { name: /^Ordinary shares ·/ })).toBeTruthy();
  expect(within(formerSection).queryByRole('heading', { name: /^Preference shares ·/ })).toBeNull();
  fireEvent.click(within(formerSection).getByRole('button', { name: `${REGISTER_COPY.FORMER_TITLE} · 1` }));
  expect(within(formerSection).getByRole('link', { name: 'Details (Departed Shareholder)' }).getAttribute('href')).toBe(
    '/company/register/members/former-member-private?company=harbour',
  );
  expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
  expect(within(table).getAllByRole('row')).toHaveLength(26);
  const namesakes = within(table).getAllByRole('row', { name: /Example Member/ });
  expect(namesakes).toHaveLength(2);
  expect(within(namesakes[0]).getAllByText('9,007,199,254,740,993')).toHaveLength(2);
  expect(within(namesakes[1]).getByText('1')).toBeTruthy();
  expect(within(namesakes[1]).getByText('<0.01%')).toBeTruthy();
  expect(within(namesakes[1]).getByText('No PREFERENCE holding')).toBeTruthy();
  expect(within(namesakes[1]).getByText('Identity needs review')).toBeTruthy();
  expect(screen.getByText(/1 shareholder needs identity review/)).toBeTruthy();
  expect(screen.getByText('1–25 of 26 shareholders')).toBeTruthy();
  expect(within(table).queryByText('Zed Member24')).toBeNull();
  expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();

  for (const [row, member] of [
    [namesakes[0], 'member-one'],
    [namesakes[1], 'member-two'],
  ] as const)
    expect(within(row).getByRole('link', { name: 'Details (Example Member)' }).getAttribute('href')).toBe(
      `/company/register/members/${member}?company=harbour`,
    );

  const pages = screen.getByRole('navigation', { name: 'Shareholder pages' });
  expect(
    within(pages)
      .getByRole('button', { name: /^Previous/ })
      .matches(':disabled'),
  ).toBe(true);
  fireEvent.click(within(pages).getByRole('button', { name: /^Next/ }));
  expect(within(table).getByText('Zed Member24')).toBeTruthy();
  expect(within(table).queryByText('Example Member')).toBeNull();
  expect(screen.getByText('26–26 of 26 shareholders')).toBeTruthy();
  expect(within(pages).getByRole('button', { name: /^Next/ }).matches(':disabled')).toBe(true);

  const search = screen.getByLabelText('Search shareholders');
  const filter = screen.getByLabelText('Share class');
  fireEvent.change(search, { target: { value: ' eXaMpLe MeMbEr ' } });
  expect(await screen.findByText('1–2 of 2 shareholders')).toBeTruthy();
  expect(screen.getByText('2 shareholders match your search.')).toBeTruthy();
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(2);
  fireEvent.change(filter, { target: { value: 'preference' } });
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(1);
  expect(within(table).getAllByText('9,007,199,254,740,993')).toHaveLength(1);
  expect(within(table).queryByText('<0.01%')).toBeNull();
  expect(screen.getByText('1–1 of 1 shareholder')).toBeTruthy();
  expect(screen.getByText(/1 shareholder needs identity review/)).toBeTruthy();
  fireEvent.change(filter, { target: { value: 'ordinary' } });
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(2);
  fireEvent.change(filter, { target: { value: '' } });
  fireEvent.change(search, { target: { value: ' preference member NAME ' } });
  expect(await screen.findByText('1–1 of 1 shareholder')).toBeTruthy();
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(1);
  expect(within(table).getAllByText('9,007,199,254,740,993')).toHaveLength(2);
  fireEvent.change(filter, { target: { value: 'preference' } });
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(1);
  expect(within(table).getAllByText('9,007,199,254,740,993')).toHaveLength(1);
  fireEvent.change(search, { target: { value: 'No such shareholder' } });
  expect(await screen.findByText('No shareholders match your search.')).toBeTruthy();
  expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull();
  fireEvent.change(filter, { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Search shareholders'), { target: { value: '' } });
  expect(await screen.findByText('1–25 of 26 shareholders')).toBeTruthy();
  expect(within(screen.getByRole('table', { name: 'Company shareholders' })).getAllByRole('row')).toHaveLength(26);
  expect(api.post).not.toHaveBeenCalled();
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'));
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'));
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.BASE);

  cleanup();
  client.clear();
  let pauseHolders = false;
  let releaseHolders!: () => void;
  let rights: ClassRightsRevision[] = [];
  let rightsAppointment: string | null = 'rights-administrator';
  let pauseRights = false;
  let failRights = false;
  let releaseRights!: () => void;
  const rightsResponse = (key?: unknown) => ({
    data: {
      results: key ? rights.filter((revision) => revision.idempotencyKey === key) : rights,
      count: key ? rights.filter((revision) => revision.idempotencyKey === key).length : rights.length,
      next: null,
      previous: null,
      current: rights[0] ?? null,
      administrationAppointment: rightsAppointment,
    },
  });
  api.get.mockReset().mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === COMPANY_TOKEN_ENDPOINTS.CLASS_RIGHTS('ordinary')) {
      if (failRights) throw new Error('Synthetic class rights read refused');
      return pauseRights
        ? new Promise((resolve) => {
            releaseRights = () => resolve(rightsResponse(config?.params?.idempotency_key));
          })
        : rightsResponse(config?.params?.idempotency_key);
    }
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
  await screen.findByText('No summary recorded.');
  fireEvent.click(screen.getByRole('button', { name: 'Edit (Class rights)' }));
  let rightsDialog = within(await screen.findByRole('dialog', { name: 'Edit class rights' }));
  expect(rightsDialog.queryByLabelText(/upload/i)).toBeNull();
  fireEvent.change(rightsDialog.getByLabelText('Summary (optional)'), {
    target: { value: '  Each share has one vote.  ' },
  });
  fireEvent.change(rightsDialog.getByLabelText('Document reference (optional)'), {
    target: { value: '  Company constitution, 1 October 2026  ' },
  });
  api.post.mockImplementation(async (url: string, request: ClassRightsRequest) => {
    if (url !== COMPANY_TOKEN_ENDPOINTS.CLASS_RIGHTS('ordinary')) throw new Error(`Unexpected POST ${url}`);
    const revision: ClassRightsRevision = {
      uuid: `rights-${request.previousRevision + 1}`,
      token: 'ordinary',
      revision: request.previousRevision + 1,
      summary: request.summary,
      documentReference: request.documentReference,
      idempotencyKey: request.idempotencyKey,
      appointment: request.appointment,
      recordedBy: 1,
      recordedByName: 'Example Director',
      createdAt: '2026-10-21T00:00:00Z',
    };
    rights = [revision, ...rights];
    if (rights.length === 1) throw new Error('Synthetic interrupted class rights response');
    return { data: revision };
  });
  fireEvent.click(rightsDialog.getByRole('button', { name: 'Save' }));
  await rightsDialog.findByRole('button', { name: 'Retry original save' });
  expect((rightsDialog.getByLabelText('Summary (optional)') as HTMLTextAreaElement).disabled).toBe(true);
  expect((rightsDialog.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  pauseRights = true;
  let refreshingRights!: Promise<void>;
  act(() => {
    refreshingRights = client.refetchQueries({ queryKey: ['class-rights'] });
  });
  await waitFor(() => expect(releaseRights).toBeTypeOf('function'));
  expect(screen.queryByRole('dialog', { name: 'Edit class rights' })).toBeNull();
  expect(document.body.textContent).not.toContain('Each share has one vote.');
  pauseRights = false;
  await act(async () => {
    releaseRights();
    await refreshingRights;
  });
  rightsDialog = within(await screen.findByRole('dialog', { name: 'Edit class rights' }));
  rightsAppointment = null;
  fireEvent.click(rightsDialog.getByRole('button', { name: 'Retry original save' }));
  await screen.findByText('Class rights saved.');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(rights[0].summary).toBe('Each share has one vote.');
  expect(rights[0].documentReference).toBe('Company constitution, 1 October 2026');
  expect(screen.queryByRole('button', { name: 'Edit (Class rights)' })).toBeNull();
  rightsAppointment = 'rights-administrator';
  await act(async () => {
    await client.refetchQueries({ queryKey: ['class-rights'] });
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit (Class rights)' }));
  rights = [
    { ...rights[0], uuid: 'rights-2', revision: 2, idempotencyKey: 'another-edit', summary: 'Updated rights.' },
    ...rights,
  ];
  await act(async () => {
    await client.refetchQueries({ queryKey: ['class-rights'] });
  });
  rightsDialog = within(await screen.findByRole('dialog', { name: 'Edit class rights' }));
  expect((rightsDialog.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  await rightsDialog.findByText(/The class rights or your administrator access changed/);
  fireEvent.click(rightsDialog.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Edit (Class rights)' }));
  rightsDialog = within(await screen.findByRole('dialog', { name: 'Edit class rights' }));
  for (const label of ['Summary (optional)', 'Document reference (optional)'])
    fireEvent.change(rightsDialog.getByLabelText(label), { target: { value: '' } });
  fireEvent.click(rightsDialog.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(rights[0].summary).toBe('');
  expect(rights[0].documentReference).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Previous versions' }));
  expect(screen.getByText('Each share has one vote.')).toBeTruthy();
  failRights = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: ['class-rights'] });
  });
  await screen.findByText('The class rights could not be loaded. They may be unavailable to this account.');
  expect(screen.queryByText('Each share has one vote.')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit (Class rights)' })).toBeNull();
  failRights = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByText('No summary recorded.');
  const ownership = await screen.findByRole('region', { name: 'Current ownership' });
  expect(within(ownership).getByText('9,007,199,254,741,018')).toBeTruthy();
  expect(within(ownership).getByText('26')).toBeTruthy();
  expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull();
  expect(screen.queryByText('Example Member')).toBeNull();
  expect(screen.queryByText(former.name)).toBeNull();
  expect(screen.getByRole('link', { name: 'Back to Register' }).getAttribute('href')).toBe('/company/register');
  const technical = screen.getByRole('button', { name: 'Technical details and chain workflows' });
  expect(technical.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(technical);
  expect(technical.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(technical);
  expect(technical.getAttribute('aria-expanded')).toBe('false');

  pauseHolders = true;
  const holderKey = ['token', 'ordinary', 'profile-one', 'account-one', 'holders'];
  let refreshing!: Promise<void>;
  act(() => {
    refreshing = client.refetchQueries({ queryKey: holderKey, exact: true });
  });
  await waitFor(() => expect(releaseHolders).toBeTypeOf('function'));
  expect(screen.queryByRole('region', { name: 'Current ownership' })).toBeNull();
  expect(screen.queryByText('Example Member')).toBeNull();
  expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();
  for (const text of [former.name, former.member!, former.walletAddress!]) expect(screen.queryByText(text)).toBeNull();
  await act(async () => {
    releaseHolders();
    await refreshing;
  });
  expect(await screen.findByRole('region', { name: 'Current ownership' })).toBeTruthy();
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
  expect(screen.getByRole('region', { name: 'Current ownership' })).toBeTruthy();
  let refreshingPreferences!: Promise<void>;
  act(() => {
    refreshingPreferences = client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true });
  });
  await waitFor(() => expect(refusePreferences).toBeTypeOf('function'));
  expect(screen.queryByRole('region', { name: 'Current ownership' })).toBeNull();
  expect(screen.queryByText('Example Member')).toBeNull();
  expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();
  for (const text of [former.name, former.member!, former.walletAddress!]) expect(screen.queryByText(text)).toBeNull();
  await act(async () => {
    refusePreferences();
    await refreshingPreferences;
  });
  expect(client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status).toBe('error');
  expect(client.getQueryData(USER_PREFERENCES_QUERY_KEY)).toBe(preferenceResponse);
  expect(screen.queryByRole('region', { name: 'Current ownership' })).toBeNull();
  expect(screen.queryByText('Example Member')).toBeNull();
  expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();
  for (const text of [former.name, former.member!, former.walletAddress!]) expect(screen.queryByText(text)).toBeNull();
  pausePreferences = false;
  await act(async () => {
    await client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true });
  });
  expect(await screen.findByRole('region', { name: 'Current ownership' })).toBeTruthy();
  pauseHolders = false;
  try {
    expect(screen.getByRole('region', { name: 'Current ownership' })).toBeTruthy();
    await act(async () => {
      onlineManager.setOnline(false);
      await client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true });
    });
    expect(client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status).toBe('success');
    expect(client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.fetchStatus).toBe('paused');
    expect(client.getQueryData(USER_PREFERENCES_QUERY_KEY)).toBe(preferenceResponse);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Current ownership' })).toBeNull());
    expect(screen.queryByText('Example Member')).toBeNull();
    expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();
    for (const text of [former.name, former.member!, former.walletAddress!])
      expect(screen.queryByText(text)).toBeNull();
    await act(async () => onlineManager.setOnline(true));
    await waitFor(() => expect(client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.fetchStatus).toBe('idle'));
    expect(await screen.findByRole('region', { name: 'Current ownership' })).toBeTruthy();
  } finally {
    act(() => onlineManager.setOnline(true));
  }

  pauseRights = true;
  let lateRights!: Promise<void>;
  act(() => {
    lateRights = client.refetchQueries({ queryKey: ['class-rights'] });
  });
  await waitFor(() => expect(releaseRights).toBeTypeOf('function'));
  const releasePreviousRights = releaseRights;
  failRights = true;
  const nextPreferences = companyPreferences('investor');
  act(() =>
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: {
        ...nextPreferences,
        userProfile: 'profile-two',
        userAccount: { ...nextPreferences.userAccount!, uuid: 'account-two' },
      },
    }),
  );
  await act(async () => {
    releasePreviousRights();
    await lateRights;
  });
  expect(screen.queryByText('Each share has one vote.')).toBeNull();
  expect(screen.queryByText('Company constitution, 1 October 2026')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit (Class rights)' })).toBeNull();

  cleanup();
  client.clear();
  let pauseMemberHolders = false;
  let releaseMemberHolders!: () => void;
  let revoked = false;
  const empty = { data: { results: [], count: 0, next: null, previous: null } };
  const reader = { ...CURRENT_APPOINTMENT, company: 'harbour', capabilities: ['read_register'] };
  api.get.mockReset().mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    if (url === REGISTER)
      return config?.params?.page === 2
        ? page([harbour('preference')])
        : page([harbour('ordinary')], 'https://example.test/tokens/register/?page=2');
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'))
      return pauseMemberHolders
        ? new Promise((resolve) => {
            releaseMemberHolders = () => resolve({ data: ordinary });
          })
        : { data: ordinary };
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference')) return { data: preference };
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBERS('ordinary'))
      return {
        data: {
          members: [
            {
              member: 'member-one',
              name: 'Example Member',
              residentialAddress: '1 Example Street, Sydney NSW 2000',
              currentShares: '9007199254740993',
              enteredOn: '2026-09-01',
              lastCeasedOn: null,
              walletless: false,
              particularsRetained: true,
            },
          ],
          awardRecipients: [],
        },
      };
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_ENTRIES('ordinary') && config?.params?.member === 'member-one')
      return {
        data: {
          results: [
            {
              uuid: 'entry-one',
              sequence: 1,
              kind: 'issue',
              effectiveOn: '2026-09-01',
              companyEventOn: '2026-09-01',
              recordedAt: '2026-09-01T00:00:00Z',
              changes: [{ member: 'member-one', name: 'Example Member', shares: '9007199254740993' }],
              corrects: null,
              correctedBy: null,
              correctable: true,
            },
          ],
          count: 1,
          next: null,
          previous: null,
        },
      };
    if (url === APPOINTMENTS)
      return revoked ? empty : { data: { results: [reader], count: 1, next: null, previous: null } };
    if (
      url === COMPANY_TOKEN_ENDPOINTS.REGISTER_AWARDS ||
      url.endsWith('/register/entries/') ||
      url.includes('member-particulars-requests') ||
      url.includes('member-certificate-requests')
    )
      return empty;
    throw new Error(`Unexpected read ${url}`);
  });
  show('company', <CompanyShareholderPage />, 'Shareholder', {
    entry: '/company/register/members/member-one?company=harbour',
    path: DESTINATIONS.companyShareholder.path,
  });
  expect(await screen.findByRole('heading', { level: 1, name: 'Example Member' })).toBeTruthy();
  expect(await screen.findByText('1 Example Street, Sydney NSW 2000')).toBeTruthy();
  for (const [name, date] of [
    [/^Ordinary shares ·/, '2026-09-01'],
    [/^Preference shares ·/, '2026-09-03'],
  ] as const) {
    const holding = screen.getByRole('heading', { name }).closest('section')!;
    expect(within(holding).getByText(formatDate(date))).toBeTruthy();
    expect(within(holding).getByText(HOLDER_TYPE_LABELS.member)).toBeTruthy();
    expect(within(holding).getByText(`0x${'1'.repeat(40)} · Active`)).toBeTruthy();
  }
  expect(screen.getByText('Preference Member Name')).toBeTruthy();
  expect(await screen.findByText('+9,007,199,254,740,993 shares')).toBeTruthy();
  for (const token of ['ordinary', 'preference'])
    expect(api.get).toHaveBeenCalledWith(
      COMPANY_TOKEN_ENDPOINTS.REGISTER_ENTRIES(token),
      expect.objectContaining({ params: { member: 'member-one', page: 1 } }),
    );
  expect(screen.queryByRole('link', { name: REGISTER_PARTICULARS_COPY.PREPARE })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Employee awards' })).toBeNull();
  pauseMemberHolders = true;
  let refreshingMember!: Promise<void>;
  act(() => {
    refreshingMember = client.refetchQueries({ predicate: ({ queryKey }) => queryKey.includes('holders') });
  });
  await waitFor(() => expect(releaseMemberHolders).toBeTypeOf('function'));
  expect(screen.queryByText('1 Example Street, Sydney NSW 2000')).toBeNull();
  expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Example Member' })).toBeNull();
  await act(async () => {
    releaseMemberHolders();
    await refreshingMember;
  });
  expect(await screen.findByText('1 Example Street, Sydney NSW 2000')).toBeTruthy();
  revoked = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: ['company-appointments'] });
  });
  await waitFor(() => expect(screen.queryByText('1 Example Street, Sydney NSW 2000')).toBeNull());
  expect(screen.queryByText('+9,007,199,254,740,993 shares')).toBeNull();
  expect(screen.getAllByText(/current company register appointment/)).toHaveLength(2);
  expect(screen.getByRole('heading', { level: 1, name: 'Example Member' })).toBeTruthy();
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(api.post.mock.calls.every(([url]) => url === COMPANY_TOKEN_ENDPOINTS.CLASS_RIGHTS('ordinary'))).toBe(true);

  cleanup();
  client.clear();
  const issue = '12345678-1234-1234-1234-123456789abc';
  const transfer = 'abcdefab-1234-1234-1234-123456789abc';
  const transaction = `0x${'7'.repeat(64)}`;
  const address = `0x${'8'.repeat(40)}`;
  const attribution =
    'has no verified final chain inclusion. It requires operator attribution ' +
    'before a register boundary can represent or exclude it.';
  const knownDetails = [
    `The completed issue ${issue} ${attribution}`,
    `The completed transfer ${transfer} ${attribution}`,
    `The completed issue ${issue} was finally included in block 20, after the captured boundary block 10, ` +
      'so this boundary does not represent it. Prepare a fresh opening.',
    `The completed transfer ${transfer} is not in the captured boundary's canonical history at block 20, ` +
      'so this boundary does not represent it. Prepare a fresh opening.',
  ];
  const unrelatedDetail = `The completed issue ${issue} needs another review. Transaction ${transaction}.`;
  const retainedReconciliation = {
    uuid: 'retained-reconciliation',
    token: 'ordinary',
    blockNumber: 20,
    blockHash: transaction,
    registerSequence: 1,
    createdAt: '2026-10-20T00:00:00Z',
    status: 'discrepant',
    failure: '',
    latest: true,
    discrepancies: [...knownDetails, unrelatedDetail].map((detail) => ({
      kind: 'attribution',
      detail,
      source: issue,
      transaction,
      address,
      acknowledgeable: false,
      acknowledgement: null,
    })),
  };
  const retainedSnapshot = JSON.stringify(retainedReconciliation);
  api.get.mockReset().mockImplementation(async (url: string) => ({
    data: {
      results: url === APPOINTMENTS ? [reader] : url === RECONCILIATIONS ? [retainedReconciliation] : [],
      count: 1,
      next: null,
      previous: null,
    },
  }));
  show(
    'company',
    <ClassReconciliation
      owner={{ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }}
      guard={() => {}}
      token="ordinary"
      company="harbour"
      holders={[]}
      status="deployed"
    />,
  );
  for (const detail of knownDetails) {
    expect(
      await screen.findByText(detail.replace(issue, shortReference(issue)).replace(transfer, shortReference(transfer))),
    ).toBeTruthy();
    expect(screen.queryByText(detail)).toBeNull();
  }
  expect(screen.getByText(unrelatedDetail)).toBeTruthy();
  expect(screen.getAllByText(transaction)).toHaveLength(5);
  expect(screen.getAllByText(address)).toHaveLength(5);
  expect(JSON.stringify(retainedReconciliation)).toBe(retainedSnapshot);
  expect(api.post).toHaveBeenCalledTimes(2);
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
  const emptyDraft = {
    registerFile: null,
    asicFile: null,
    asAt: '2026-10-14',
    reference: 'Company-provided share records',
    reason: 'Record an empty opening',
    members: [],
    former: [],
    statedTotal: '',
    statedCount: '',
  };
  expect(preparationProblems(emptyDraft, '2026-10-14', true)).toEqual([]);
  expect(preparationProblems(emptyDraft, '2026-10-14')).toContain('Add at least one current shareholder.');
  expect(preparationProblems({ ...emptyDraft, members: [blankMember()] }, '2026-10-14', true).length).toBeGreaterThan(
    0,
  );
  expect(
    preparationProblems(
      {
        ...emptyDraft,
        former: [
          {
            id: 'former',
            name: 'Earlier Member',
            residentialAddress: '1 Example Street',
            shares: '1',
            ceasedOn: '2026-01-01',
          },
        ],
      },
      '2026-10-14',
      true,
    ),
  ).toContain('Add at least one current shareholder.');
  let visibleClass = false;
  let createdClass = false;
  let opened = false;
  let firstPreparation = true;
  let failNextPreview = false;
  let interruptNextApply = false;
  let proposal: RegisterImport | undefined;
  let companyMembers: RegisterTransferMember[] = [];
  let membersUnavailable = false;
  let classCreationGuard = () => {};
  const company = companyRecord({ isOwner: false, administrativeAccess: { capabilities: [], draftSetup: false } });
  let appointment: OwnCompanyAppointment = {
    ...CURRENT_APPOINTMENT,
    company: company.uuid,
    companyName: company.name,
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
    totalSupply: TECHNICAL_SHARE_LIMIT,
    status: 'draft' as CompanyShareToken['status'],
    contractAddress: null,
    chain: null,
    deployedAt: null,
    deploymentTxHash: null,
  };
  const dataPage = (results: unknown[]) => ({ data: { results, count: results.length, next: null, previous: null } });
  const holders = (): TokenHoldersResponse => ({
    token: { ...token },
    initialized: opened,
    issuedSupply: opened ? (proposal?.members.length ? '600' : '0') : null,
    totalHolders: opened && proposal?.members.length ? 1 : 0,
    waitingEffects: opened ? 0 : null,
    holders:
      opened && proposal?.members.length
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
      return { data: { members: companyMembers, awardRecipients: [] } };
    }
    if (url === IMPORTS) return dataPage(proposal ? [proposal] : []);
    return dataPage([]);
  });
  api.post.mockImplementation(async (url: string, body: RegisterImportPreparation | RegisterDecideRequest, config) => {
    if (url === COMPANY_TOKEN_ENDPOINTS.BASE) {
      classCreationGuard = config.ledovaSubmissionGuard;
      classCreationGuard();
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
              <Route path="/" element={<CompanyRegisterPage />} />
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
  fireEvent.click(await screen.findByRole('link', { name: 'Add share class' }));
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
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain(COMPANY_ENDPOINTS.BASE);
  expect(api.get.mock.calls.map(([url]) => url)).not.toContain(COMPANY_ENDPOINTS.DETAIL(company.uuid));
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
  fireEvent.change(screen.getByLabelText('Residential address'), {
    target: { value: '1 Example Street, Sydney NSW 2000' },
  });
  fireEvent.change(screen.getByLabelText('Date first added to register'), { target: { value: '2020-01-01' } });
  fireEvent.change(screen.getByLabelText('Shares held'), { target: { value: '600' } });
  fireEvent.change(screen.getByLabelText('Allotment date'), { target: { value: '2015-01-01' } });
  fireEvent.change(screen.getByLabelText('Shares in allotment'), { target: { value: '400' } });
  fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '400' } });
  fireEvent.change(screen.getByLabelText('Amount unpaid'), { target: { value: '0' } });
  const held = screen.getByRole('group', { name: 'Held for someone else?' });
  expect(within(held).queryByRole('radio', { checked: true })).toBeNull();
  expect(screen.queryByText('Payment status')).toBeNull();
  fireEvent.click(within(held).getByRole('radio', { name: 'No' }));
  expect(within(held).getByRole('radio', { checked: true }).getAttribute('value')).toBe('no');
  const references = screen.getByRole('button', { name: 'References (optional)' });
  expect(references.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(references);
  fireEvent.change(screen.getByLabelText('Share numbers or reference'), { target: { value: '1–400' } });
  fireEvent.change(screen.getByLabelText('Certificate reference'), { target: { value: 'CERT-001' } });
  expect(references.getAttribute('aria-expanded')).toBe('true');
  fireEvent.click(screen.getByRole('button', { name: 'Add allotment (shareholder 1)' }));
  fireEvent.change(screen.getAllByLabelText('Allotment date')[1], { target: { value: '2016-01-01' } });
  fireEvent.change(screen.getAllByLabelText('Shares in allotment')[1], { target: { value: '200' } });
  fireEvent.change(screen.getAllByLabelText('Amount paid')[1], { target: { value: '200' } });
  fireEvent.change(screen.getAllByLabelText('Amount unpaid')[1], { target: { value: '0' } });
  fireEvent.click(
    within(screen.getAllByRole('group', { name: 'Held for someone else?' })[1]).getByRole('radio', { name: 'Yes' }),
  );
  fireEvent.submit(screen.getByRole('button', { name: 'Add to draft' }).closest('form')!);
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add to draft' }));
  expect(screen.getByText('Example Shareholder')).toBeTruthy();
  expect(screen.queryByLabelText('Name')).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit (shareholder 1)' }));
  expect((screen.getAllByLabelText('Share numbers or reference')[0] as HTMLInputElement).value).toBe('1–400');
  expect(screen.getAllByRole('button', { name: 'References (optional)' })[0].getAttribute('aria-expanded')).toBe(
    'true',
  );
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
  appointment = { ...appointment, status: 'revoked', isEffective: false, revokedAt: '2026-10-14T00:00:00Z' };
  await act(async () => client.invalidateQueries({ queryKey: ['company-appointments'] }));
  expect(() => classCreationGuard()).toThrow(/company or authority changed/);
  expect(api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.BASE)).toHaveLength(1);
  appointment = { ...appointment, status: 'active', isEffective: true, revokedAt: null };
  await act(async () => client.invalidateQueries({ queryKey: ['company-appointments'] }));
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
  fireEvent.click(within(shareholderTable).getByRole('button', { name: 'Allotments (Example Shareholder)' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Allotments (Example Shareholder)' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Allotments (Example Shareholder)' }));
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
  const copiedSummary = await screen.findByRole('button', { name: /^Copied opening ·/ });
  expect(copiedSummary.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(copiedSummary);
  expect(copiedSummary.getAttribute('aria-expanded')).toBe('true');
  const copiedOpening = document.getElementById(copiedSummary.getAttribute('aria-controls')!)!;
  const copiedMembers = within(copiedOpening).getByRole('table', { name: 'Shareholders' });
  expect(within(copiedMembers).getByText('Example Shareholder')).toBeTruthy();
  expect(within(copiedMembers).getByText('600')).toBeTruthy();
  expect(within(copiedMembers).getByText(formatDate('2020-01-01'))).toBeTruthy();
  const transferTask = screen.getByRole('button', { name: 'Transfer shares' });
  fireEvent.click(within(copiedMembers).getByRole('button', { name: 'Allotments (Example Shareholder)' }));
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
  fireEvent.click(screen.getByRole('button', { name: 'Keep source copies and former records (optional)' }));
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
      return { data: { members: companyMembers, awardRecipients: [] } };
    }
    if (url === IMPORTS) return dataPage(proposal ? [proposal] : []);
    return dataPage([]);
  });
  showJourney(DESTINATIONS.companyRegisterSetup.path);
  const shareClass = await screen.findByRole('group', { name: 'Share class' });
  const pick = (name: string) => fireEvent.click(within(shareClass).getByRole('radio', { name }));
  expect(
    within(shareClass)
      .getAllByRole('radio')
      .map((radio) => (radio as HTMLInputElement).value),
  ).toEqual(['ordinary', 'preference', 'redeemable', 'custom']);
  expect(within(shareClass).getByRole('radio', { checked: true }).getAttribute('value')).toBe('ordinary');
  expect(screen.queryByLabelText('Class code')).toBeNull();
  pick('Another class');
  fireEvent.change(screen.getByLabelText('Class name'), { target: { value: 'Company A shares' } });
  fireEvent.change(screen.getByLabelText('Class code'), { target: { value: 'A' } });
  expect(screen.getByText(`${company.name} · Company A shares (A)`)).toBeTruthy();
  expect((screen.getByLabelText('Class code') as HTMLInputElement).maxLength).toBe(5);
  pick('Preference (PRF)');
  expect(screen.getByText(`${company.name} · Preference shares (PRF)`)).toBeTruthy();
  expect(screen.queryByLabelText('Class name')).toBeNull();
  expect(screen.queryByLabelText('Class code')).toBeNull();
  expect(screen.queryByRole('group', { name: 'Class type' })).toBeNull();
  pick('Redeemable (RED)');
  expect(screen.getByText(`${company.name} · Redeemable shares (RED)`)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'open Register' }).getAttribute('href')).toBe('/company/register');
  fireEvent.click(screen.getByRole('link', { name: `${token.name} · ${token.symbol}` }));
  await waitFor(() => expect(screen.queryByLabelText('Class code')).toBeNull());
  expect(await screen.findByLabelText('Record date')).toBeTruthy();
  for (const status of ['deployed', 'paused', 'deploying'] as const) {
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
  const noDraftClasses = await screen.findByRole('group', { name: 'Share class' });
  expect(screen.queryByText(/Continue a class you started/)).toBeNull();
  expect(
    within(noDraftClasses)
      .getAllByRole('radio')
      .map((radio) => (radio as HTMLInputElement).value),
  ).toEqual(['ordinary', 'preference', 'redeemable', 'custom']);
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
  expect(screen.queryByRole('combobox', { name: 'Company shareholder' })).toBeNull();
  membersUnavailable = false;
  fireEvent.click(retryChoices);
  fireEvent.click(await screen.findByRole('link', { name: `${token.name} · ${token.symbol}` }));
  await waitFor(() => expect(screen.queryByLabelText('Class code')).toBeNull());
  expect(await screen.findByLabelText('Record date')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  expect((screen.getByRole('combobox', { name: 'Company shareholder' }) as HTMLInputElement).value).toBe('');
  const shareholder = screen.getByRole('combobox', { name: 'Company shareholder' });
  fireEvent.change(shareholder, { target: { value: companyMembers[0].name } });
  await screen.findByRole('option', { name: (name) => name.startsWith(companyMembers[0].name!) });
  fireEvent.keyDown(shareholder, { key: 'Enter' });
  expect((screen.getByLabelText('Name') as HTMLInputElement).readOnly).toBe(true);
  const chosen = screen.getByRole('combobox', { name: 'Company shareholder' });
  fireEvent.change(chosen, { target: { value: 'nobody matches this' } });
  await screen.findByRole('option', { name: 'New person' });
  fireEvent.keyDown(chosen, { key: 'Enter' });
  fireEvent.keyDown(chosen, { key: 'Escape' });
  expect((screen.getByLabelText('Name') as HTMLInputElement).readOnly).toBe(true);
  expect((screen.getByLabelText('Residential address') as HTMLInputElement).readOnly).toBe(true);
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
      ])
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      fireEvent.click(
        within(screen.getByRole('group', { name: 'Held for someone else?' })).getByRole('radio', { name: 'No' }),
      );
    });
  };
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: companyMembers[0].name } });
  fireEvent.change(screen.getByLabelText('Residential address'), {
    target: { value: companyMembers[0].residentialAddress },
  });
  enterHolding();
  fireEvent.click(screen.getByRole('button', { name: 'Add to draft' }));
  expect(screen.getByText(/explicitly choose a new shareholder/)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  await choose('Company shareholder', companyMembers[0].name!);
  expect((screen.getByLabelText('Date first added to register') as HTMLInputElement).value).toBe('2020-01-01');
  expect(screen.getByRole('button', { name: 'Add to draft' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel (shareholder edit)' }));
  expect(screen.getByText('No shareholders added yet.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  await choose('Company shareholder', companyMembers[0].name!);
  enterHolding();
  fireEvent.click(screen.getByRole('button', { name: 'Add to draft' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'Company shareholder' }), {
    target: { value: companyMembers[0].name },
  });
  const duplicate = await screen.findByRole('option', { name: (name) => name.startsWith(companyMembers[0].name!) });
  expect(duplicate.getAttribute('aria-disabled')).toBe('true');
  fireEvent.mouseDown(duplicate);
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel (shareholder edit)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  expect((api.post.mock.calls[0][1] as RegisterImportPreparation).members[0].member).toBe(companyMembers[0].member);
  cleanup();
  client.clear();
  api.post.mockClear();
  opened = false;
  proposal = undefined;
  companyMembers = [];
  const awardOnly = {
    member: 'award-only-recipient',
    name: 'Award Recipient',
    residentialAddress: '2 Example Road, Sydney NSW 2000',
  };
  const trustedRecipient = {
    ...awardOnly,
    currentShares: '0',
    enteredOn: null,
    lastCeasedOn: null,
    walletless: true,
    particularsRetained: true,
    onRegister: false,
  };
  companyMembers = [trustedRecipient];
  const prepareAwardOpening = async (url: string, request: RegisterImportPreparation) => {
    expect(url).toBe(IMPORTS);
    proposal = {
      ...rejected,
      uuid: request.operationId,
      token: request.tokenId,
      preparingAppointment: request.appointment,
      asAt: request.asAt,
      sourceReference: request.sourceReference,
      authorityReference: request.sourceReference,
      registerEvidence: null,
      asicEvidence: null,
      asicIssuedTotal: null,
      asicMemberCount: null,
      status: 'submitted',
      stage: 'submitted',
      correctionOf: null,
      reason: request.reason,
      members: request.members.map((member) => ({ ...member, amountPaid: '600.00' })),
    };
    return { data: proposal };
  };
  api.post.mockImplementation(prepareAwardOpening);
  showJourney(importPath);
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  await choose(
    'Company shareholder',
    `${trustedRecipient.name} · ${trustedRecipient.residentialAddress} · Award recipient without shares`,
    trustedRecipient.name,
  );
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(trustedRecipient.name);
  expect((screen.getByLabelText('Residential address') as HTMLInputElement).value).toBe(
    trustedRecipient.residentialAddress,
  );
  expect((screen.getByLabelText('Name') as HTMLInputElement).readOnly).toBe(true);
  expect((screen.getByLabelText('Residential address') as HTMLInputElement).readOnly).toBe(true);
  for (const label of [
    'Date first added to register',
    'Shares held',
    'Allotment date',
    'Shares in allotment',
    'Amount paid',
  ])
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('');
  enterHolding();
  fireEvent.click(screen.getByRole('button', { name: 'Add to draft' }));
  const preferences = companyPreferences();
  const recipientKey = peopleKey(
    { userUuid: preferences.userProfile, ownerAccountUuid: preferences.userAccount!.uuid },
    token.uuid,
  );
  companyMembers = [{ ...trustedRecipient, name: 'Changed recipient name' }];
  await act(async () => client.invalidateQueries({ queryKey: recipientKey, exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save draft and review' }));
  expect(await screen.findByText(/keep the award recipient’s recorded name and address/)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  companyMembers = [];
  await act(async () => client.invalidateQueries({ queryKey: recipientKey, exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save draft and review' }));
  expect((await screen.findAllByText(/award recipient is no longer available/)).length).toBeGreaterThan(0);
  expect(api.post).not.toHaveBeenCalled();
  companyMembers = [trustedRecipient];
  await act(async () => client.invalidateQueries({ queryKey: recipientKey, exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save draft and review' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  const awardOpening = api.post.mock.calls[0][1] as RegisterImportPreparation;
  expect(awardOpening.members[0]).toMatchObject({
    member: trustedRecipient.member,
    name: trustedRecipient.name,
    residentialAddress: trustedRecipient.residentialAddress,
    enteredOn: '2020-01-01',
    shares: '600',
  });
  expect(awardOpening.members[0].allotments[0].allottedOn).toBe('2015-01-01');
  cleanup();
  client.clear();
  api.post.mockClear();
  proposal = undefined;
  let freshClassCreated = false;
  const freshToken = {
    ...token,
    uuid: 'fresh-award-class',
    name: 'Preference shares',
    symbol: 'PRF',
    tokenType: 'preference',
  };
  const oldReads = api.get.getMockImplementation()!;
  api.get.mockImplementation((url, config) => {
    if (url === REGISTER)
      return Promise.resolve(dataPage([...setupClasses, ...(freshClassCreated ? [freshToken] : [])]));
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS(freshToken.uuid))
      return Promise.resolve({ data: { ...holders(), token: freshToken } });
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBERS(freshToken.uuid))
      return Promise.resolve({ data: { members: companyMembers, awardRecipients: [] } });
    return oldReads(url, config);
  });
  api.post.mockImplementation(async (url, request, config) => {
    config.ledovaSubmissionGuard();
    if (url === COMPANY_TOKEN_ENDPOINTS.BASE) {
      freshClassCreated = true;
      companyMembers = [];
      return { data: freshToken };
    }
    return prepareAwardOpening(url, request);
  });
  showJourney(DESTINATIONS.companyRegisterSetup.path);
  fireEvent.click(
    within(await screen.findByRole('group', { name: 'Share class' })).getByRole('radio', { name: 'Preference (PRF)' }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  await choose('Company shareholder', trustedRecipient.name);
  expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(trustedRecipient.name);
  expect(api.post).not.toHaveBeenCalled();
  enterHolding();
  fireEvent.click(screen.getByRole('button', { name: 'Add to draft' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  expect((await screen.findAllByText(/award recipient is no longer available/)).length).toBeGreaterThan(0);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.BASE)).toHaveLength(1);
  expect(api.post.mock.calls.filter(([url]) => url === IMPORTS)).toHaveLength(0);
  companyMembers = [trustedRecipient];
  await act(async () => client.invalidateQueries({ queryKey: recipientKey, exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save draft and review' }));
  await waitFor(() => expect(api.post.mock.calls.filter(([url]) => url === IMPORTS)).toHaveLength(1));
  expect(api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.BASE)).toHaveLength(1);
  const freshAwardOpening = api.post.mock.calls.find(([url]) => url === IMPORTS)![1] as RegisterImportPreparation;
  expect(freshAwardOpening.tokenId).toBe(freshToken.uuid);
  expect(freshAwardOpening.members[0].member).toBe(trustedRecipient.member);
  expect(freshAwardOpening.members[0].enteredOn).toBe('2020-01-01');
  cleanup();
  client.clear();
  api.post.mockClear();
  opened = false;
  proposal = undefined;
  companyMembers = [];
  api.get.mockImplementation(oldReads);
  appointment = { ...appointment, uuid: 'empty-register-appointee', capabilities: ['prepare', 'approve', 'apply'] };
  const previousReads = api.get.getMockImplementation()!;
  api.get.mockImplementation((url, config) =>
    url === REGISTER ? Promise.resolve(dataPage([token])) : previousReads(url, config),
  );
  expect(canOpenEmptyRegister(holders(), token)).toBe(true);
  expect(canOpenEmptyRegister({ ...holders(), initialized: true }, token)).toBe(false);
  expect(canOpenEmptyRegister({ ...holders(), waitingEffects: 1 }, token)).toBe(false);
  expect(canOpenEmptyRegister(holders(), { ...token, contractAddress: '0x123' })).toBe(false);
  expect(canOpenEmptyRegister(holders(), { ...token, chain: 'base' })).toBe(false);
  expect(canOpenEmptyRegister(holders(), { ...token, deployedAt: '2026-10-14T00:00:00Z' })).toBe(false);
  let interruptedEmpty = false;
  api.post.mockImplementation(async (url: string, body: RegisterImportPreparation | RegisterDecideRequest, config) => {
    config.ledovaSubmissionGuard();
    if (url === IMPORTS) {
      const request = body as RegisterImportPreparation;
      expect(request.members).toEqual([]);
      expect(request.formerMembers).toEqual([]);
      expect(request.correctionOf).toBeUndefined();
      proposal ??= {
        ...rejected,
        uuid: request.operationId,
        preparingAppointment: request.appointment,
        asAt: request.asAt,
        status: 'submitted',
        stage: 'submitted',
        decisions: [],
        reviewedAt: null,
        registerEvidence: null,
        asicEvidence: null,
        asicIssuedTotal: null,
        asicMemberCount: null,
        correctionOf: null,
        reason: request.reason,
        sourceReference: request.sourceReference,
        authorityReference: request.sourceReference,
        members: [],
        formerMembers: [],
      };
      if (!interruptedEmpty) {
        interruptedEmpty = true;
        throw new Error('Interrupted empty opening');
      }
      return { data: proposal };
    }
    const request = body as RegisterDecideRequest;
    expect(request.appointment).toBe(appointment.uuid);
    if (url.endsWith('/decision-preview/'))
      return {
        data: {
          canDecide: true,
          unmetRequirements: [],
          previewDigest: 'e'.repeat(64),
          comparison: [],
          opensRegister: !opened,
          registerSequence: 0,
          importedTotal: '0',
          importedMemberCount: 0,
          statedTotal: null,
          statedMemberCount: null,
          sourceReference: proposal!.sourceReference,
          correctionOf: null,
          correctionAllowed: false,
        },
      };
    if (url.endsWith('/decide/')) {
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
      if (request.kind === 'apply') opened = true;
      return { data: proposal };
    }
    throw new Error(`Unexpected empty-opening write ${url}`);
  });
  showJourney(importPath);
  fireEvent.click(await screen.findByRole('button', { name: 'Continue' }));
  expect(screen.getByText(/continue with no shareholders/)).toBeTruthy();
  expect(screen.getByText('No shareholders added yet.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Recover saved records' }));
  const emptyConfirm = await screen.findByRole('button', { name: 'Confirm' });
  await waitFor(() => expect((emptyConfirm as HTMLButtonElement).disabled).toBe(false));
  expect(proposal!.members).toEqual([]);
  const emptyRequests = api.post.mock.calls.filter(([url]) => url === IMPORTS).map(([, request]) => request);
  expect(emptyRequests).toHaveLength(2);
  expect(emptyRequests[0]).toEqual(emptyRequests[1]);
  fireEvent.click(emptyConfirm);
  expect(await screen.findByText(/No issued shares or current shareholders/)).toBeTruthy();
  expect(proposal!.decisions.map((decision) => decision.kind)).toEqual(['approve', 'apply']);
  expect(proposal!.members).toEqual([]);
  expect(api.post.mock.calls.map(([url]) => url)).not.toContain(COMPANY_TOKEN_ENDPOINTS.BASE);
  cleanup();
  client.clear();
  api.post.mockClear();
  let readRefusal: number | null = null;
  api.get.mockImplementation(async (url, config) => {
    config.ledovaSubmissionGuard();
    expect(url).toBe(REGISTER);
    if (readRefusal !== null)
      throw Object.assign(new Error('Recovery read refused'), { response: { status: readRefusal } });
    return dataPage([]);
  });
  api.post.mockImplementation(async () => {
    throw new Error('Class result lost');
  });
  const createHook = () =>
    renderHook(() => useNewShareClass({ guard: () => {}, checkCurrent: () => {}, company, classes: [], ready: true }));
  const uncertainClass = createHook();
  await act(async () => {
    await expect(uncertainClass.result.current.resolveRegister()).rejects.toThrow('Class result lost');
  });
  for (const status of [400, 409]) {
    readRefusal = status;
    await act(async () => {
      await expect(uncertainClass.result.current.resolveRegister()).rejects.toThrow('Recovery read refused');
    });
    expect(uncertainClass.result.current.classLocked).toBe(true);
  }
  readRefusal = null;
  await act(async () => {
    await expect(uncertainClass.result.current.resolveRegister()).rejects.toThrow(/no second creation request/);
  });
  expect(api.post).toHaveBeenCalledOnce();
  uncertainClass.unmount();
  api.post.mockClear();
  let creationRefusal = 400;
  api.post.mockImplementation(async () => {
    throw Object.assign(new Error('Class creation refused'), { response: { status: creationRefusal } });
  });
  const refusedClass = createHook();
  for (const status of [400, 409]) {
    creationRefusal = status;
    await act(async () => {
      await expect(refusedClass.result.current.resolveRegister()).rejects.toThrow('Class creation refused');
    });
    expect(refusedClass.result.current.classLocked).toBe(false);
    act(() => refusedClass.result.current.setSymbol('EMP'));
  }
  expect(api.post).toHaveBeenCalledTimes(2);
  expect(api.post.mock.calls.map(([, request]) => request.symbol)).toEqual(['ORD', 'EMP']);
  refusedClass.unmount();
  for (const response of [
    null,
    { members: [] },
    { members: [null], awardRecipients: [] },
    { members: [trustedRecipient], awardRecipients: [awardOnly] },
    { members: [{ ...trustedRecipient, currentShares: '1.5' }], awardRecipients: [] },
    { members: [], awardRecipients: [awardOnly, awardOnly] },
    { members: [], awardRecipients: [{ ...awardOnly, name: '' }] },
  ]) {
    api.get.mockResolvedValue({ data: response });
    await expect(readPeople(token.uuid, () => {})).rejects.toThrow(/choices could not be confirmed/);
  }
  const nullableParticulars = { ...trustedRecipient, name: null, residentialAddress: null };
  api.get.mockResolvedValue({ data: { members: [nullableParticulars], awardRecipients: [] } });
  await expect(readPeople(token.uuid, () => {})).resolves.toEqual({
    members: [nullableParticulars],
    awardRecipients: [],
  });
  let ownerStillCurrent = true;
  let completeIdentityRead!: () => void;
  api.get.mockImplementation(
    () =>
      new Promise((resolve) => {
        completeIdentityRead = () => resolve({ data: { members: [trustedRecipient], awardRecipients: [] } });
      }),
  );
  const lateIdentityRead = readPeople(token.uuid, () => {
    if (!ownerStillCurrent) throw new Error('The account changed before recipient choices returned.');
  });
  ownerStillCurrent = false;
  completeIdentityRead();
  await expect(lateIdentityRead).rejects.toThrow(/account changed/);
});

it('shows an account without register access a calm empty state, reads no members and offers no entry', async () => {
  api.get.mockImplementation(async (url: string) => {
    if ([REGISTER, COMPANY_ENDPOINTS.BASE, APPOINTMENTS, PROFILES].includes(url)) return page([]);
    throw new Error(`Unexpected read ${url}`);
  });
  show('investor');
  expect(await screen.findByText(NO_REGISTER)).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();
  expect(screen.queryByRole('button', { name: /shares/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
  cleanup();
  show('investor', <SettingsPage />, 'Settings');
  expect(await screen.findByRole('link', { name: 'Company team' })).toBeTruthy();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(readUrls()).toEqual([REGISTER, APPOINTMENTS, PROFILES]);
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
      <Link to="/" state={{ registerCompany: 'inland', registerToken: 'preference', registerTask: 'history' }}>
        Open dashboard class
      </Link>
      <Link to="/#shareholders" state={{ registerCompany: 'inland' }}>
        Open dashboard shareholders
      </Link>
    </>,
  );
  const company = (await screen.findByRole('combobox', { name: 'Company' })) as HTMLInputElement;
  expect(company.value).toBe('');
  fireEvent.change(company, { target: { value: ' ' } });
  expect((await screen.findAllByRole('option')).map((option) => option.textContent)).toEqual([
    'Harbour Example Pty Ltd',
    'Inland Example Pty Ltd',
  ]);
  fireEvent.keyDown(company, { key: 'Escape' });
  expect(screen.getByText('Select a company to show its register.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /shares/ })).toBeNull();
  expect(readUrls()).toEqual([REGISTER]);

  fireEvent.click(screen.getByRole('link', { name: 'Open mismatched dashboard class' }));
  expect(company.value).toBe('');
  expect(readUrls()).toEqual([REGISTER]);
  fireEvent.click(screen.getByRole('link', { name: 'Open dashboard class' }));
  const preference = (await screen.findAllByRole('heading', { name: /^Preference shares ·/ })).find((heading) =>
    heading.closest('li'),
  )!;
  await waitFor(() => expect(document.activeElement).toBe(preference.closest('li')));
  expect(within(preference.closest('li')!).getByRole('heading', { name: 'Recorded changes' })).toBeTruthy();
  expect(screen.getByText('Inland Example Pty Ltd', { selector: 'p' })).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Class details (Preference shares)' }).getAttribute('href')).toBe(
    '/company/register/preference',
  );
  expect(screen.queryByRole('heading', { name: /^Ordinary shares ·/ })).toBeNull();
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'));
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'));
  expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull();

  await choose('Company', 'Harbour Example Pty Ltd', 'harbour');
  await screen.findByText('Harbour Example Pty Ltd', { selector: 'p' });
  fireEvent.click(screen.getByRole('button', { name: 'History' }));
  expect(
    (await screen.findAllByRole('heading', { name: /^Ordinary shares ·/ })).find((heading) => heading.closest('li')),
  ).toBeTruthy();
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

  fireEvent.click(screen.getByRole('link', { name: 'Open dashboard shareholders' }));
  await screen.findByText('Inland Example Pty Ltd', { selector: 'p' });
  await choose('Company', 'Harbour Example Pty Ltd', 'harbour');
  await screen.findByText('Harbour Example Pty Ltd', { selector: 'p' });
  fireEvent.change(await screen.findByLabelText('Search shareholders'), { target: { value: 'Example' } });
  expect(await screen.findByText(/match(es)? your search\./)).toBeTruthy();
  await act(async () => {});
  expect(screen.getByText('Harbour Example Pty Ltd', { selector: 'p' })).toBeTruthy();
  expect(screen.queryByText('Inland Example Pty Ltd', { selector: 'p' })).toBeNull();
});

it("starts again for another signed-in account without showing the previous account's register or choice", async () => {
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER) return page([harbour('ordinary'), inland('preference')]);
    return noCommands(url) ?? { data: register(url.includes('preference') ? 'preference' : 'ordinary') };
  });
  show('investor', <CompanyRegisterPage />, 'Register', { entry: '/#shareholders' });
  await choose('Company', 'Inland Example Pty Ltd', 'inland');
  const table = await screen.findByRole('table', { name: 'Company shareholders' });
  expect(within(table).getByText('Example Member')).toBeTruthy();

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
  expect(screen.getByRole('status').textContent).toBe('Loading the register…');
  expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();
  expect(screen.queryByText('Example Member')).toBeNull();
  await act(async () => finish(page([harbour('ordinary'), inland('preference')])));
  expect(((await screen.findByRole('combobox', { name: 'Company' })) as HTMLInputElement).value).toBe('');
  expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull();
  expect(screen.getByText('Select a company to show its register.')).toBeTruthy();
  expect(readUrls().filter((url) => url === REGISTER)).toHaveLength(2);
});
