// @vitest-environment jsdom

import { TestRouter } from '../../../testSupport/TestRouter';
import { CERTIFICATES_PATH } from '@utils/paths';

import {
  COMPANY_TOKEN_ENDPOINTS,
  COMPANY_ENDPOINTS,
  ApiClientProvider,
  DESTINATIONS,
  type RegisterImport,
  type RegisterImportPreparation,
  type RegisterEntry,
  type RegisterCorrection,
  type RegisterParticularsChange,
  type RegisterDecideRequest,
  REGISTER_COPY,
  REGISTER_PARTICULARS_COPY,
  HOLDER_TYPE_LABELS,
  TECHNICAL_SHARE_LIMIT,
  formatDate,
  USER_PREFERENCES_QUERY_KEY,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_ENDPOINTS,
  type AccountRole,
  type TokenHoldersResponse,
  type OwnCompanyAppointment,
  type RegisterTransferMember,
  type CompanyShareToken,
  type ClassRightsRevision,
  type ClassRightsDocument,
  type ClassRightsRequest,
  type RegisterMemberDocument,
  type RegisterMemberDocumentRequest,
  shortReference,
} from '@ledova/shared';
import SettingsPage from '@pages/settings';
import apiClient from '@services/apiClient';
import { QueryClient, QueryClientProvider, focusManager, onlineManager } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CompanyRegisterPage from '.';
import CompanyShareholderPage from './member';
import CompanyDashboardPage from '@pages/home';
import { CompanyContextProvider } from '@components/CompanyContextProvider';
import { LedgerNavigationProvider } from '@components/LedgerNavigationProvider';
import { ShareClass } from './detail/ShareClass';
import { MemberDocuments } from './shared/MemberDocuments';
import { ClassReconciliation } from './ClassReconciliation';
import CompanyRegisterImportPage from './import';
import { ImportForm } from './import/ImportForm';
import { useNewShareClass } from './import/useNewShareClass';
import { useShareClass } from './detail/useShareClass';
import { useDeploymentFlow } from './detail/useDeploymentFlow';
import { ownAppointmentsKey } from '@hooks/useOwnAppointments';
import { peopleKey, readPeople } from './shared/usePeople';
import {
  blankAllotment,
  blankMember,
  canOpenEmptyRegister,
  preparationProblems,
  memberRows,
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

function LedgerLocation() {
  const location = useLocation();
  return <output aria-label="Ledger location">{JSON.stringify(location)}</output>;
}

function CompanyContextLinks() {
  const location = useLocation();
  return (
    <>
      <Link to={{ search: '?company=harbour', hash: location.hash }}>Use Harbour company</Link>
      <Link to={{ search: '?company=inland', hash: location.hash }}>Use Inland company</Link>
    </>
  );
}

function show(
  role: AccountRole = 'company',
  content: ReactNode = <CompanyRegisterPage />,
  title = 'Register',
  route?: { entry?: string; path?: string },
) {
  prepareCompanyClient(client, role);
  client.setQueryData(['userAccount'], { data: { role } });
  return renderCompanyPage(
    client,
    <>
      {content}
      <CompanyContextLinks />
    </>,
    title,
    route,
  );
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
  focusManager.setFocused(undefined);
});

it('reads every class page and groups exact holdings by member identity with search, filtering, paging and private details', async () => {
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
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
  expect(screen.queryByRole('heading', { name: 'Member access' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Member requests' })).toBeNull();
  for (const name of ['Issue shares', 'Transfer shares', 'Corrections'])
    expect(screen.queryByRole('button', { name })).toBeNull();
  const formerSection = screen.getByRole('heading', { name: 'Former shareholders' }).closest('section')!;
  expect(within(formerSection).getByRole('heading', { name: /^Ordinary shares ·/ })).toBeTruthy();
  expect(within(formerSection).queryByRole('heading', { name: /^Preference shares ·/ })).toBeNull();
  fireEvent.click(within(formerSection).getByRole('button', { name: `${REGISTER_COPY.FORMER_TITLE} · 1` }));
  expect(within(formerSection).getByRole('link', { name: 'Details (Departed Shareholder)' }).getAttribute('href')).toBe(
    '/company/ledger/members/former-member-private?company=harbour',
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
  expect(screen.getByText('1–25 of 26 people')).toBeTruthy();
  expect(within(table).queryByText('Zed Member24')).toBeNull();
  expect(screen.queryByText(`0x${'1'.repeat(40)} · Active`)).toBeNull();

  for (const [row, member] of [
    [namesakes[0], 'member-one'],
    [namesakes[1], 'member-two'],
  ] as const)
    expect(within(row).getByRole('link', { name: 'Details (Example Member)' }).getAttribute('href')).toBe(
      `/company/ledger/members/${member}?company=harbour`,
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
  expect(screen.getByText('26–26 of 26 people')).toBeTruthy();
  expect(within(pages).getByRole('button', { name: /^Next/ }).matches(':disabled')).toBe(true);

  const openFilters = () => {
    const toggle = screen.getByRole('button', { name: 'Filters' });
    if (toggle.getAttribute('aria-expanded') === 'false') fireEvent.click(toggle);
  };
  const searchPeople = (value: string) => {
    openFilters();
    fireEvent.change(screen.getByLabelText('Search people'), { target: { value } });
  };
  const filterClass = (value: string) => {
    openFilters();
    fireEvent.change(screen.getByLabelText('Share class'), { target: { value } });
  };
  searchPeople(' eXaMpLe MeMbEr ');
  expect(await screen.findByText('1–2 of 2 people')).toBeTruthy();
  expect(screen.getByText('2 people match your search.')).toBeTruthy();
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(2);
  filterClass('preference');
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(1);
  expect(within(table).getAllByText('9,007,199,254,740,993')).toHaveLength(1);
  expect(within(table).queryByText('<0.01%')).toBeNull();
  expect(screen.getByText('1–1 of 1 person')).toBeTruthy();
  expect(screen.getByText(/1 shareholder needs identity review/)).toBeTruthy();
  filterClass('ordinary');
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(2);
  filterClass('');
  searchPeople(' preference member NAME ');
  expect(await screen.findByText('1–1 of 1 person')).toBeTruthy();
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(1);
  expect(within(table).getAllByText('9,007,199,254,740,993')).toHaveLength(2);
  filterClass('preference');
  expect(within(table).getAllByRole('row', { name: /Example Member/ })).toHaveLength(1);
  expect(within(table).getAllByText('9,007,199,254,740,993')).toHaveLength(1);
  searchPeople('No such shareholder');
  expect(await screen.findByText('No people match your search.')).toBeTruthy();
  fireEvent.keyDown(screen.getByLabelText('Search people'), { key: 'Escape' });
  expect(screen.getByText('No people match these filters.')).toBeTruthy();
  expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull();
  filterClass('');
  searchPeople('');
  expect(await screen.findByText('1–25 of 26 people')).toBeTruthy();
  expect(within(screen.getByRole('table', { name: 'Company shareholders' })).getAllByRole('row')).toHaveLength(26);
  expect(api.post).not.toHaveBeenCalled();
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'));
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'));
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.BASE);

  cleanup();
  client.clear();
  const personCompany = companyRecord({ uuid: 'harbour' });
  const personAppointment = { ...CURRENT_APPOINTMENT, company: 'harbour', capabilities: ['prepare'] };
  let savedPerson: RegisterTransferMember | undefined;
  let lostPersonReply = true;
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER) return page([]);
    if (url === COMPANY_ENDPOINTS.BASE)
      return { data: { results: [personCompany], count: 1, next: null, previous: null } };
    if (url === APPOINTMENTS) return { data: { results: [personAppointment], count: 1, next: null, previous: null } };
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_PEOPLE)
      return { data: { company: 'harbour', members: savedPerson ? [savedPerson] : [] } };
    return noCommands(url) ?? page([]);
  });
  api.post.mockImplementation(async (url, request) => {
    expect(url).toBe(COMPANY_TOKEN_ENDPOINTS.REGISTER_PEOPLE);
    savedPerson = {
      member: request.member,
      name: request.name,
      residentialAddress: request.residentialAddress,
      currentShares: '0',
      enteredOn: null,
      lastCeasedOn: null,
      walletless: true,
      particularsRetained: true,
      onRegister: false,
      hasAwards: false,
    };
    if (lostPersonReply) {
      lostPersonReply = false;
      throw new Error('Synthetic lost person response');
    }
    return {
      data: {
        uuid: request.operationId,
        company: request.company,
        member: request.member,
        name: request.name,
        residentialAddress: request.residentialAddress,
        preparingAppointment: request.appointment,
        submittedBy: 1,
        createdAt: '2026-10-22T00:00:00Z',
      },
    };
  });
  show(
    'company',
    <>
      <CompanyRegisterPage />
      <Link to="/#awards">Open ESS during recovery</Link>
      <Link to="/#shareholders">Return to people recovery</Link>
    </>,
    'Shareholders',
    { entry: '/#shareholders' },
  );
  const addPerson = await screen.findByRole('button', { name: 'Add person' });
  await waitFor(() => expect(addPerson.matches(':disabled')).toBe(false));
  fireEvent.click(addPerson);
  const personForm = () => within(screen.getByRole('form', { name: 'Add person' }));
  fireEvent.click(personForm().getByRole('button', { name: 'Add person' }));
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(personForm().getByLabelText('Name'), { target: { value: 'Taylor Demo' } });
  fireEvent.change(personForm().getByLabelText('Residential address'), {
    target: { value: '3 Fictional Lane, Sydney NSW 2000' },
  });
  fireEvent.click(personForm().getByRole('button', { name: 'Add person' }));
  await personForm().findByRole('alert');
  expect(personForm().getByLabelText('Name').matches(':disabled')).toBe(true);
  expect(personForm().getByRole('button', { name: 'Cancel' }).matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByRole('link', { name: 'Open ESS during recovery' }));
  expect(screen.queryByRole('form', { name: 'Add person' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Return to people recovery' }));
  expect(await screen.findByRole('button', { name: 'Retry original save' })).toBeTruthy();
  fireEvent.click(personForm().getByRole('button', { name: 'Retry original save' }));
  expect(await screen.findByText('Taylor Demo added.')).toBeTruthy();
  const personRequests = api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.REGISTER_PEOPLE);
  expect(personRequests).toHaveLength(2);
  expect(personRequests[1][1]).toEqual(personRequests[0][1]);
  expect(screen.getByRole('heading', { name: 'People without shares' })).toBeTruthy();
  expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull();
  expect(screen.getByText('No current shareholders yet.')).toBeTruthy();
  expect(screen.queryByText('Award recipient without shares')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Taylor Demo' }));
  expect(await screen.findByText('3 Fictional Lane, Sydney NSW 2000')).toBeTruthy();
  cleanup();
  client.clear();
  api.post.mockReset();
  let pauseHolders = false;
  let releaseHolders!: () => void;
  let rights: ClassRightsRevision[] = [];
  const rightsFile = new File(['%PDF-1.4 class rights'], 'constitution.pdf', { type: 'application/pdf' });
  const rightsEvidence = crypto.randomUUID();
  const rightsDocument: ClassRightsDocument = {
    evidence: rightsEvidence,
    company: 'harbour',
    providedBy: 'company',
    documentType: 'class_rights',
    name: rightsFile.name,
    fileSize: rightsFile.size,
    mimeType: rightsFile.type,
    sha256: 'b'.repeat(64),
  };
  let rightsFileGuard = () => {};
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
  api.get
    .mockReset()
    .mockImplementation(
      async (url: string, config?: { params?: Record<string, unknown>; ledovaSubmissionGuard?: () => void }) => {
        if (url === COMPANY_TOKEN_ENDPOINTS.CLASS_RIGHTS_FILE('ordinary')) {
          rightsFileGuard = config?.ledovaSubmissionGuard as () => void;
          rightsFileGuard();
          return { data: new Blob(['%PDF-1.4 class rights'], { type: 'application/pdf' }) };
        }
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
              isOwner: true,
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
      },
    );
  show(
    'investor',
    <>
      <ShareClass uuid="ordinary" />
      <LedgerLocation />
      <Link to="/?company=inland">Open conflicting class company</Link>
      <Link to="/?company=harbour">Open actual class company</Link>
    </>,
    'Share class',
  );
  await screen.findByText('No rights recorded.');
  await waitFor(() =>
    expect(JSON.parse(screen.getByLabelText('Ledger location').textContent!).search).toBe('?company=harbour'),
  );
  fireEvent.click(screen.getByRole('link', { name: 'Open conflicting class company' }));
  expect(await screen.findByText('This share class is not in a register you can read.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Edit (Class rights)' })).toBeNull();
  expect(screen.queryByRole('region', { name: 'Current ownership' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Open actual class company' }));
  await screen.findByText('No rights recorded.');
  fireEvent.click(screen.getByRole('button', { name: 'Edit (Class rights)' }));
  let rightsForm = within(await screen.findByRole('form', { name: 'Edit class rights' }));
  expect(document.activeElement).toBe(rightsForm.getByLabelText('Voting'));
  expect(rightsForm.queryByLabelText(/document reference/i)).toBeNull();
  expect(rightsForm.queryAllByLabelText('Conditions')).toHaveLength(0);
  expect(rightsForm.getAllByLabelText('Additional terms')).toHaveLength(1);
  for (const label of ['Voting', 'Dividends', 'Capital on winding-up', 'Transfers', 'Conversion', 'Redemption'])
    expect((rightsForm.getByLabelText(label) as HTMLSelectElement).value).toBe('not_recorded');
  fireEvent.change(rightsForm.getByLabelText('Voting'), { target: { value: 'general' } });
  fireEvent.change(rightsForm.getByLabelText('Votes per share on a poll'), { target: { value: '1' } });
  fireEvent.change(rightsForm.getByLabelText('Dividends'), { target: { value: 'preferential' } });
  const dividendFields = within(rightsForm.getByRole('group', { name: 'Dividends rights' }));
  fireEvent.change(dividendFields.getByLabelText('Preference measure'), { target: { value: 'rate' } });
  fireEvent.change(dividendFields.getByLabelText('Calculation basis'), { target: { value: 'Paid-up capital' } });
  fireEvent.click(rightsForm.getByRole('button', { name: 'Save' }));
  await dividendFields.findByText('Enter a value for the selected preference measure.');
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(rightsForm.getByLabelText('Dividends'), { target: { value: 'participating' } });
  fireEvent.change(rightsForm.getByLabelText('Capital on winding-up'), { target: { value: 'residual' } });
  fireEvent.change(rightsForm.getByLabelText('Transfers'), { target: { value: 'restricted' } });
  fireEvent.click(rightsForm.getByLabelText('Board consent'));
  fireEvent.change(rightsForm.getByLabelText('Conversion'), { target: { value: 'none' } });
  fireEvent.change(rightsForm.getByLabelText('Redemption'), { target: { value: 'not_redeemable' } });
  fireEvent.change(rightsForm.getByLabelText('Effective date'), { target: { value: '2026-10-21' } });
  fireEvent.change(rightsForm.getByLabelText('Additional terms'), {
    target: { value: '  Each share has one vote.  ' },
  });
  fireEvent.click(rightsForm.getByRole('button', { name: 'Add document' }));
  fireEvent.change(rightsForm.getByLabelText('File'), { target: { files: [rightsFile] } });
  const technicalWhileEditing = screen.getByRole('button', { name: 'Technical details and chain workflows' });
  fireEvent.click(technicalWhileEditing);
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const editingForm = screen.getByRole('form', { name: 'Edit class rights' });
  const termsControl = rightsForm.getByLabelText('Additional terms');
  termsControl.focus();
  const readsBeforeFocus = api.get.mock.calls.length;
  await act(async () => {
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    window.dispatchEvent(new Event('focus'));
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
  expect(api.get.mock.calls).toHaveLength(readsBeforeFocus);
  expect(screen.getByRole('form', { name: 'Edit class rights' })).toBe(editingForm);
  expect(rightsForm.getByText(rightsFile.name)).toBeTruthy();
  expect(document.activeElement).toBe(termsControl);
  expect(screen.queryByRole('button', { name: /^Refresh / })).toBeNull();
  fireEvent.click(technicalWhileEditing);
  api.post.mockImplementation(async (url: string, body: ClassRightsRequest | FormData, config) => {
    config?.ledovaSubmissionGuard();
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE) {
      const upload = body as FormData;
      expect(upload.get('company_id')).toBe('harbour');
      expect(upload.get('appointment')).toBe('rights-administrator');
      expect(upload.get('kind')).toBe('class_rights');
      expect(upload.get('file')).toBe(rightsFile);
      expect(config).toEqual(expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }));
      return {
        data: {
          uuid: rightsEvidence,
          company: 'harbour',
          appointment: 'rights-administrator',
          idempotencyKey: upload.get('idempotency_key'),
          kind: 'class_rights',
          fileSize: rightsFile.size,
          mimeType: rightsFile.type,
          originalFilename: rightsFile.name,
          providedBy: 'company',
          sha256: rightsDocument.sha256,
          createdAt: '2026-10-21T00:00:00Z',
        },
      };
    }
    if (url !== COMPANY_TOKEN_ENDPOINTS.CLASS_RIGHTS('ordinary')) throw new Error(`Unexpected POST ${url}`);
    const request = body as ClassRightsRequest;
    expect(request).not.toHaveProperty('documentReference');
    const revision: ClassRightsRevision = {
      uuid: `rights-${request.previousRevision + 1}`,
      token: 'ordinary',
      revision: request.previousRevision + 1,
      summary: request.summary,
      attributes: request.attributes ?? {},
      effectiveDate: request.effectiveDate ?? null,
      documentReference: request.documentReference ?? '',
      documents:
        request.documents?.map((evidence) => {
          expect(evidence).toBe(rightsEvidence);
          return rightsDocument;
        }) ?? [],
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
  fireEvent.click(rightsForm.getByRole('button', { name: 'Save' }));
  await rightsForm.findByRole('button', { name: 'Retry original save' });
  expect((rightsForm.getByLabelText('Additional terms') as HTMLTextAreaElement).disabled).toBe(true);
  expect((rightsForm.getByLabelText('Voting') as HTMLSelectElement).disabled).toBe(true);
  expect((rightsForm.getByRole('button', { name: 'Add document' }) as HTMLButtonElement).disabled).toBe(true);
  expect((rightsForm.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  pauseRights = true;
  let refreshingRights!: Promise<void>;
  act(() => {
    refreshingRights = client.refetchQueries({ queryKey: ['class-rights'] });
  });
  await waitFor(() => expect(releaseRights).toBeTypeOf('function'));
  expect(screen.queryByRole('form', { name: 'Edit class rights' })).toBeNull();
  expect(document.body.textContent).not.toContain('Each share has one vote.');
  expect(screen.queryByText(rightsFile.name)).toBeNull();
  pauseRights = false;
  await act(async () => {
    releaseRights();
    await refreshingRights;
  });
  rightsForm = within(await screen.findByRole('form', { name: 'Edit class rights' }));
  const originalAttributes = rights[0].attributes;
  rights[0] = { ...rights[0], attributes: { voting: { type: 'general', votesPerShare: '2' } } };
  fireEvent.click(rightsForm.getByRole('button', { name: 'Retry original save' }));
  await rightsForm.findByText('The original class rights receipt did not match. Retry the original save.');
  expect(api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.CLASS_RIGHTS('ordinary'))).toHaveLength(
    1,
  );
  rights[0] = { ...rights[0], attributes: originalAttributes };
  rightsAppointment = null;
  fireEvent.click(rightsForm.getByRole('button', { name: 'Retry original save' }));
  await screen.findByText('Class rights saved.');
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit class rights' })).toBeNull());
  expect(api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE)).toHaveLength(1);
  expect(api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.CLASS_RIGHTS('ordinary'))).toHaveLength(
    1,
  );
  expect(rights[0].summary).toBe('Each share has one vote.');
  expect(rights[0].documentReference).toBe('');
  expect(rights[0].documents).toEqual([rightsDocument]);
  expect(rights[0].attributes).toEqual({
    voting: { type: 'general', votesPerShare: '1' },
    dividends: { type: 'participating' },
    capital: { type: 'residual' },
    transfers: { type: 'restricted', boardConsent: true },
    conversion: { type: 'none' },
    redemption: { type: 'not_redeemable' },
  });
  expect(rights[0].effectiveDate).toBe('2026-10-21');
  expect(screen.getAllByText(rightsFile.name)).toHaveLength(1);
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:class-rights');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(screen.getByRole('button', { name: 'Download (constitution.pdf)' }));
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledOnce());
  expect(api.get).toHaveBeenCalledWith(
    COMPANY_TOKEN_ENDPOINTS.CLASS_RIGHTS_FILE('ordinary'),
    expect.objectContaining({
      params: { revision: rights[0].uuid, evidence: rightsEvidence },
      responseType: 'blob',
      ledovaSubmissionGuard: expect.any(Function),
    }),
  );
  expect(screen.queryByRole('button', { name: 'Edit (Class rights)' })).toBeNull();
  rightsAppointment = 'rights-administrator';
  await act(async () => {
    await client.refetchQueries({ queryKey: ['class-rights'] });
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Edit (Class rights)' }));
  rightsForm = within(await screen.findByRole('form', { name: 'Edit class rights' }));
  expect(rightsForm.getAllByText(rightsFile.name)).toHaveLength(1);
  expect(rightsForm.queryByLabelText('File')).toBeNull();
  const earlierSummary = '📘'.repeat(4000);
  const earlierCapitalTerms = '📄'.repeat(2000);
  const combinedTerms = [
    ...['Voting', 'Dividends', 'Capital on winding-up', 'Transfers', 'Conversion', 'Redemption'].map(
      (label) => `${label}: ${earlierCapitalTerms}`,
    ),
    earlierSummary,
  ].join('\n\n');
  rights = [
    {
      ...rights[0],
      uuid: 'rights-2',
      revision: 2,
      idempotencyKey: 'another-edit',
      summary: earlierSummary,
      attributes: {
        ...rights[0].attributes,
        voting: { type: 'general', votesPerShare: '1', conditions: earlierCapitalTerms },
        dividends: { type: 'participating', conditions: earlierCapitalTerms },
        capital: { type: 'residual', conditions: earlierCapitalTerms },
        transfers: {
          type: 'restricted',
          boardConsent: true,
          preEmption: false,
          conditions: earlierCapitalTerms,
        },
        conversion: { type: 'none', conditions: earlierCapitalTerms },
        redemption: { type: 'not_redeemable', conditions: earlierCapitalTerms },
      },
    },
    ...rights,
  ];
  await act(async () => {
    await client.refetchQueries({ queryKey: ['class-rights'] });
  });
  rightsForm = within(await screen.findByRole('form', { name: 'Edit class rights' }));
  expect((rightsForm.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
  await rightsForm.findByText(/The class rights or your administrator access changed/);
  fireEvent.click(rightsForm.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit class rights' })).toBeNull());
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Edit (Class rights)' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit (Class rights)' }));
  rightsForm = within(await screen.findByRole('form', { name: 'Edit class rights' }));
  expect((rightsForm.getByLabelText('Additional terms') as HTMLTextAreaElement).value).toBe(combinedTerms);
  expect(combinedTerms.length).toBeGreaterThan(20000);
  expect(rightsForm.queryAllByLabelText('Conditions')).toHaveLength(0);
  const editedTerms = `${combinedTerms}\n\nReviewed for the demo.`;
  fireEvent.change(rightsForm.getByLabelText('Additional terms'), { target: { value: editedTerms } });
  fireEvent.click(rightsForm.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit class rights' })).toBeNull());
  expect(rights[0].documents).toEqual([rightsDocument]);
  expect(rights[0].summary).toBe(editedTerms);
  expect(rights[0].attributes.capital).not.toHaveProperty('conditions');
  expect(rights[0].attributes.transfers).not.toHaveProperty('conditions');
  expect(rights[1].summary).toBe(earlierSummary);
  expect(rights[1].attributes.capital?.conditions).toBe(earlierCapitalTerms);
  expect(rights[1].attributes.transfers?.conditions).toBe(earlierCapitalTerms);
  expect(rights[0].attributes.transfers?.preEmption).toBe(false);
  expect(api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Edit (Class rights)' }));
  rightsForm = within(await screen.findByRole('form', { name: 'Edit class rights' }));
  expect((rightsForm.getByLabelText('Additional terms') as HTMLTextAreaElement).value).toBe(editedTerms);
  fireEvent.change(rightsForm.getByLabelText('Additional terms'), { target: { value: '' } });
  fireEvent.click(rightsForm.getByRole('button', { name: 'Remove (document 1)' }));
  fireEvent.click(rightsForm.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit class rights' })).toBeNull());
  expect(rights[0].summary).toBe('');
  expect(rights[0].documentReference).toBe('');
  expect(rights[0].documents).toEqual([]);
  expect(screen.queryByRole('button', { name: 'Download (constitution.pdf)' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Previous versions' }));
  expect(screen.getByText('Each share has one vote.')).toBeTruthy();
  const originalVersion = screen.getByText('Version 1').closest('li')!;
  fireEvent.click(within(originalVersion).getByRole('button', { name: 'Download (constitution.pdf)' }));
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledTimes(2));
  expect(api.get).toHaveBeenLastCalledWith(
    COMPANY_TOKEN_ENDPOINTS.CLASS_RIGHTS_FILE('ordinary'),
    expect.objectContaining({ params: { revision: 'rights-1', evidence: rightsEvidence } }),
  );
  failRights = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: ['class-rights'] });
  });
  await screen.findByText('The class rights could not be loaded. They may be unavailable to this account.');
  expect(screen.queryByText('Each share has one vote.')).toBeNull();
  expect(screen.queryByText(rightsFile.name)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit (Class rights)' })).toBeNull();
  failRights = false;
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('button', { name: 'Edit (Class rights)' });
  const ownership = await screen.findByRole('region', { name: 'Current ownership' });
  expect(within(ownership).getByText('9,007,199,254,741,018')).toBeTruthy();
  expect(within(ownership).getByText('26')).toBeTruthy();
  expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull();
  expect(screen.queryByText('Example Member')).toBeNull();
  expect(screen.queryByText(former.name)).toBeNull();
  expect(screen.getByRole('link', { name: 'Back to Ledger' }).getAttribute('href')).toBe(
    '/company/ledger?company=harbour',
  );
  const technical = screen.getByRole('button', { name: 'Technical details and chain workflows' });
  expect(technical.getAttribute('aria-expanded')).toBe('false');
  await waitFor(() => expect(client.isFetching()).toBe(0));
  const readsBeforeTechnical = api.get.mock.calls.length;
  const writesBeforeTechnical = api.post.mock.calls.length;
  fireEvent.click(technical);
  expect(technical.getAttribute('aria-expanded')).toBe('true');
  await waitFor(() =>
    expect(api.get.mock.calls.slice(readsBeforeTechnical).some(([url]) => url === APPOINTMENTS)).toBe(true),
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(api.post.mock.calls).toHaveLength(writesBeforeTechnical);
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
  expect(screen.queryByText(rightsFile.name)).toBeNull();
  expect(() => rightsFileGuard()).toThrow(/signed-in account changed/);
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
    entry: '/company/ledger/members/member-one?company=harbour',
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
  expect(api.post).toHaveBeenCalledTimes(4);
  expect(
    api.post.mock.calls.every(([url]) =>
      [COMPANY_TOKEN_ENDPOINTS.CLASS_RIGHTS('ordinary'), COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE].includes(url),
    ),
  ).toBe(true);

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
  expect(api.post).toHaveBeenCalledTimes(4);
  cleanup();
  client.clear();
  api.post.mockReset();
  const documentCompany = crypto.randomUUID();
  const documentMember = crypto.randomUUID();
  const documentToken = crypto.randomUUID();
  let documentAppointment: OwnCompanyAppointment = {
    ...CURRENT_APPOINTMENT,
    company: documentCompany,
    uuid: crypto.randomUUID(),
    capabilities: ['prepare'],
  };
  const documentRows: RegisterMemberDocument[] = [];
  let fileGuard = () => {};
  let readDocuments = true;
  const pdf = new File(['%PDF-1.4 agreement'], 'subscription.pdf', { type: 'application/pdf' });
  const uploadedEvidence = crypto.randomUUID();
  api.get.mockImplementation(async (url: string, config) => {
    if (url === APPOINTMENTS)
      return {
        data: {
          results: readDocuments ? [documentAppointment] : [],
          count: readDocuments ? 1 : 0,
          next: null,
          previous: null,
        },
      };
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBER_DOCUMENTS) {
      const rows = config.params.idempotency_key
        ? documentRows.filter((row) => row.idempotencyKey === config.params.idempotency_key)
        : documentRows;
      return { data: { results: [...rows], count: rows.length, next: null, previous: null } };
    }
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBER_DOCUMENT_FILE(documentRows[0]?.uuid ?? '')) {
      fileGuard = config.ledovaSubmissionGuard;
      fileGuard();
      return { data: new Blob(['%PDF-1.4 agreement'], { type: 'application/pdf' }) };
    }
    throw new Error(`Unexpected document read ${url}`);
  });
  api.post.mockImplementation(async (url: string, body) => {
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE) {
      return {
        data: {
          uuid: uploadedEvidence,
          company: documentCompany,
          appointment: documentAppointment.uuid,
          idempotencyKey: body.get('idempotency_key'),
          kind: 'supporting',
          fileSize: pdf.size,
          mimeType: pdf.type,
          originalFilename: pdf.name,
          providedBy: 'company',
          sha256: 'a'.repeat(64),
          createdAt: '2026-10-21T00:00:00Z',
        },
      };
    }
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBER_DOCUMENTS) {
      const request = body as RegisterMemberDocumentRequest;
      documentRows.push({
        uuid: crypto.randomUUID(),
        company: request.companyId,
        member: request.member,
        token: request.token,
        sourceImport: null,
        evidence: request.evidence,
        category: request.category,
        snapshot: {
          providedBy: 'company',
          evidence: request.evidence,
          company: request.companyId,
          documentType: 'supporting',
          name: pdf.name,
          fileSize: pdf.size,
          mimeType: pdf.type,
          sha256: 'a'.repeat(64),
        },
        appointment: request.appointment,
        idempotencyKey: request.idempotencyKey,
        createdAt: '2026-10-21T00:00:00Z',
      });
      throw new Error('Interrupted document receipt');
    }
    throw new Error(`Unexpected document write ${url}`);
  });
  renderCompanyPage(
    client,
    <MemberDocuments
      owner={{ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }}
      guard={() => {}}
      company={documentCompany}
      member={documentMember}
      sourceReady
      holdings={[{ member: documentMember, token: documentToken, label: 'Ordinary shares · ORD' }]}
    />,
    'Shareholder',
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Add documents' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add document' }));
  fireEvent.change(within(screen.getByRole('group', { name: 'Document 1' })).getByLabelText('Category'), {
    target: { value: 'subscription_agreement' },
  });
  fireEvent.change(within(screen.getByRole('group', { name: 'Document 1' })).getByLabelText('File'), {
    target: { files: [pdf] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save documents' }));
  const recoverDocument = await screen.findByRole('button', { name: 'Recover original save' });
  expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
  documentAppointment = { ...documentAppointment, capabilities: ['read_register'] };
  await act(async () => client.invalidateQueries({ queryKey: ['company-appointments'] }));
  fireEvent.click(recoverDocument);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Recover original save' })).toBeNull());
  expect(screen.getByText('subscription.pdf')).toBeTruthy();
  expect(screen.getByText(/Subscription agreement/)).toBeTruthy();
  expect(api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE)).toHaveLength(1);
  expect(api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBER_DOCUMENTS)).toHaveLength(
    1,
  );
  expect(api.get).toHaveBeenCalledWith(
    COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBER_DOCUMENTS,
    expect.objectContaining({
      params: expect.objectContaining({
        company: documentCompany,
        member: documentMember,
        token: documentToken,
        idempotency_key: documentRows[0].idempotencyKey,
      }),
    }),
  );
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:synthetic-document'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  fireEvent.click(await screen.findByRole('button', { name: 'Download (subscription.pdf)' }));
  await waitFor(() => expect(URL.createObjectURL).toHaveBeenCalledOnce());
  readDocuments = false;
  await act(async () => client.invalidateQueries({ queryKey: ['company-appointments'] }));
  await waitFor(() => expect(screen.queryByText('subscription.pdf')).toBeNull());
  expect(() => fileGuard()).toThrow(/Current company register access/);
  readDocuments = true;
  documentAppointment = { ...documentAppointment, capabilities: ['prepare'] };
  await act(async () => client.invalidateQueries({ queryKey: ['company-appointments'] }));
  const previousPost = api.post.getMockImplementation()!;
  api.post.mockImplementation((url: string, body, config) => {
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBER_DOCUMENTS)
      return Promise.reject({ response: { status: 400, data: { detail: 'Choose another document.' } } });
    return previousPost(url, body, config);
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Add documents' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add document' }));
  fireEvent.change(within(screen.getByRole('group', { name: 'Document 1' })).getByLabelText('File'), {
    target: { files: [pdf] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save documents' }));
  await screen.findByText('Choose another document.');
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(false),
  );
  expect(screen.queryByRole('button', { name: 'Recover original save' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(documentRows).toHaveLength(1);

  cleanup();
  client.clear();
  prepareCompanyClient(client);
  const deploymentToken = 'deployment-class';
  api.get.mockReset().mockImplementation(async (url: string) => {
    if (url === COMPANY_TOKEN_ENDPOINTS.DETAIL(deploymentToken))
      return {
        data: {
          ...ordinary.token,
          uuid: deploymentToken,
          company: 'harbour',
          companyUuid: 'harbour',
          status: 'draft',
          isOwner: false,
        },
      };
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS(deploymentToken)) return { data: register(deploymentToken) };
    if (url === APPOINTMENTS)
      return {
        data: {
          results: [{ ...CURRENT_APPOINTMENT, company: 'harbour', capabilities: ['prepare'] }],
          count: 1,
          next: null,
          previous: null,
        },
      };
    return { data: { results: [], count: 0, next: null, previous: null } };
  });
  api.post.mockReset().mockRejectedValue(new Error('Synthetic interrupted deployment preparation'));
  const deployment = renderHook(
    () => {
      const data = useShareClass(deploymentToken);
      return useDeploymentFlow({ uuid: deploymentToken, data });
    },
    {
      wrapper: ({ children }) => (
        <QueryClientProvider client={client}>
          <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
        </QueryClientProvider>
      ),
    },
  );
  await waitFor(() => expect(deployment.result.current.canPrepare).toBe(true));
  await act(async () => {
    await deployment.result.current.prepare();
  });
  expect(deployment.result.current.uncertain).toBe(true);
  expect(api.post).toHaveBeenCalledTimes(1);
  const replacement = companyPreferences();
  act(() =>
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: {
        ...replacement,
        userProfile: 'replacement-profile',
        userAccount: { ...replacement.userAccount!, uuid: 'replacement-account' },
      },
    }),
  );
  await waitFor(() => expect(deployment.result.current.owner?.ownerAccountUuid).toBe('replacement-account'));
  await waitFor(() => expect(deployment.result.current.canPrepare).toBe(true));
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(deployment.result.current.uncertain).toBe(false);
  await act(async () => {
    client.setQueryData(ownAppointmentsKey(deployment.result.current.owner!), []);
    await deployment.result.current.prepare();
  });
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(deployment.result.current.error).toMatch(/appointment before starting this decision/);
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
  ).toEqual(expect.arrayContaining([expect.stringMatching(/record date/)]));
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
  expect(preparationProblems({ ...emptyDraft, members: [{ ...manual[0], allotments: [] }] }, '2026-10-14')).toEqual([]);
  expect(preparationProblems({ ...emptyDraft, members: [{ ...manual[0], shares: '500' }] }, '2026-10-14')).toEqual([]);
  expect(memberRows([{ ...manual[0], allotments: [] }])[0].allotments).toEqual([]);
  const blankAmounts = {
    ...manual[0],
    allotments: [{ ...manual[0].allotments[0], amountPaid: '', amountUnpaid: '', fullyPaid: false }],
  };
  expect(preparationProblems({ ...emptyDraft, members: [blankAmounts] }, '2026-10-14')).toEqual([]);
  expect(memberRows([blankAmounts])[0].allotments[0]).toMatchObject({
    amountPaid: '0.00',
    amountUnpaid: '0.00',
    fullyPaid: true,
    shareReference: '1–400',
    certificateReference: 'CERT-001',
  });
  expect(
    preparationProblems(
      {
        ...emptyDraft,
        members: [{ ...manual[0], allotments: [{ ...manual[0].allotments[0], amountUnpaid: '-1' }] }],
      },
      '2026-10-14',
    ),
  ).toEqual(expect.arrayContaining([expect.stringMatching(/valid paid and unpaid amounts/)]));
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
  let historyEntries: RegisterEntry[] = [];
  let historyCorrections: RegisterCorrection[] = [];
  let historyParticulars: RegisterParticularsChange[] = [];
  let pauseHistory = false;
  let releaseHistory!: () => void;
  const attachment = new File(['%PDF-1.4 synthetic certificate'], 'share-certificate.pdf', { type: 'application/pdf' });
  const agreement = new File(['%PDF-1.4 synthetic agreement'], 'shareholder-agreement.pdf', {
    type: 'application/pdf',
  });
  const uploaded = new Map<string, { uuid: string; name: string; fileSize: number }>();
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
  const ownershipRead = () => {
    const current = holders();
    return {
      data: {
        company: company.uuid,
        companyName: company.name,
        asAt: '2026-10-26T00:00:00Z',
        complete: current.initialized,
        issuedSupply: current.issuedSupply,
        totalHolders: current.initialized ? current.totalHolders : null,
        classes: [
          {
            uuid: token.uuid,
            name: token.name,
            symbol: token.symbol,
            tokenType: token.tokenType,
            initialized: current.initialized,
            issuedSupply: current.issuedSupply,
            totalHolders: current.initialized ? current.totalHolders : null,
            sequence: current.initialized ? 1 : null,
            recordedAt: current.initialized ? '2026-10-26T00:00:00Z' : null,
          },
        ],
      },
    };
  };
  api.get.mockImplementation(async (url: string) => {
    if (url === '/api/user-preferences/') return { data: companyPreferences() };
    if (url === COMPANY_ENDPOINTS.BASE) return dataPage([company]);
    if (url === COMPANY_ENDPOINTS.DETAIL(company.uuid)) return { data: company };
    if (url === APPOINTMENTS) return dataPage([appointment]);
    if (url === REGISTER || url === COMPANY_TOKEN_ENDPOINTS.BASE) return dataPage(visibleClass ? [token] : []);
    if (url === COMPANY_TOKEN_ENDPOINTS.DETAIL(token.uuid)) return { data: token };
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS(token.uuid)) return { data: holders() };
    if (url === COMPANY_TOKEN_ENDPOINTS.OWNERSHIP) return ownershipRead();
    if (url === COMPANY_TOKEN_ENDPOINTS.OWNERSHIP_HOLDERS(token.uuid)) {
      const current = holders();
      return {
        data: {
          count: current.totalHolders,
          next: null,
          previous: null,
          token: token.uuid,
          sequence: 1,
          issuedSupply: current.issuedSupply,
          asAt: '2026-10-26T00:00:00Z',
          results: current.holders.map(({ member, name, balance }) => ({
            member,
            name,
            balance,
            percentage: '100.00',
          })),
        },
      };
    }
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_MEMBERS(token.uuid)) {
      if (membersUnavailable) throw new Error('Member choices unavailable');
      return { data: { members: companyMembers, awardRecipients: [] } };
    }
    if (url === IMPORTS) return dataPage(proposal ? [proposal] : []);
    if (url === CORRECTIONS) return dataPage(historyCorrections);
    if (url === PARTICULARS) return dataPage(historyParticulars);
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_ENTRIES(token.uuid)) {
      if (pauseHistory)
        return new Promise((resolve) => {
          releaseHistory = () => resolve(dataPage(historyEntries));
        });
      return dataPage(historyEntries);
    }
    return dataPage([]);
  });
  api.post.mockImplementation(async (url: string, body: RegisterImportPreparation | RegisterDecideRequest, config) => {
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE) {
      const form = body as unknown as FormData;
      const file = form.get('file') as File;
      const key = String(form.get('idempotency_key'));
      const saved = uploaded.get(key) ?? { uuid: crypto.randomUUID(), name: file.name, fileSize: file.size };
      uploaded.set(key, saved);
      return {
        data: {
          uuid: saved.uuid,
          company: company.uuid,
          appointment: String(form.get('appointment')),
          idempotencyKey: key,
          kind: 'supporting',
          fileSize: saved.fileSize,
          mimeType: file.type,
          originalFilename: file.name,
          providedBy: 'company',
          sha256: 'a'.repeat(64),
          createdAt: '2026-10-21T00:00:00Z',
        },
      };
    }
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
        members: request.members.map((member) => ({
          ...member,
          amountPaid: null,
          ...(member.documents
            ? {
                documents: member.documents.map((document) => {
                  const file = [...uploaded.values()].find((value) => value.uuid === document.evidence)!;
                  return {
                    ...document,
                    snapshot: {
                      providedBy: 'company',
                      evidence: file.uuid,
                      company: company.uuid,
                      documentType: 'supporting',
                      name: file.name,
                      fileSize: file.fileSize,
                      mimeType: 'application/pdf',
                      sha256: 'a'.repeat(64),
                    },
                  };
                }),
              }
            : {}),
        })),
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
    if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER_PARTICULARS_CHANGE_PREVIEW('retained-particulars-change'))
      return {
        data: {
          canDecide: true,
          unmetRequirements: [],
          previewDigest: 'd'.repeat(64),
          member: historyParticulars[0].member,
          name: historyParticulars[0].name,
          residentialAddress: historyParticulars[0].residentialAddress,
          asAt: historyParticulars[0].asAt,
          current: {
            name: 'Example Shareholder',
            residentialAddress: '1 Example Street, Sydney NSW 2000',
            asAt: '2026-10-21',
            sourceImport: proposal!.uuid,
            sourceChange: null,
            sourceGrant: null,
            sourceTransfer: null,
            sourceAllotment: null,
            sourceAward: null,
            sourceRegistration: null,
          },
        },
      };
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
          <TestRouter initialEntries={[path]}>
            <Routes>
              <Route path="/" element={<CompanyRegisterPage />} />
              <Route
                path="/company/dashboard"
                element={
                  <LedgerNavigationProvider>
                    <CompanyContextProvider>
                      <CompanyDashboardPage />
                    </CompanyContextProvider>
                  </LedgerNavigationProvider>
                }
              />
              <Route path={DESTINATIONS.companyRegisterSetup.path} element={<CompanyRegisterImportPage />} />
              <Route path={DESTINATIONS.companyRegisterImport.path} element={<CompanyRegisterImportPage />} />
            </Routes>
          </TestRouter>
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
  expect(await screen.findByText('Ordinary shares (ORD)')).toBeTruthy();
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
  fireEvent.change(screen.getByLabelText('Current shares held'), { target: { value: '600' } });
  expect(screen.getByRole('heading', { name: 'Allocation history' })).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Allocation 1' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add shareholder' }));
  expect(screen.queryByLabelText('Name')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Edit (shareholder 1)' }));
  expect(screen.queryByRole('group', { name: 'Allocation 1' })).toBeNull();
  const allotmentFields = (number: number) => within(screen.getByRole('group', { name: `Allocation ${number}` }));
  const addAllotment = () => fireEvent.click(screen.getByRole('button', { name: 'Add allocation (shareholder 1)' }));
  addAllotment();
  expect((allotmentFields(1).getByLabelText('Amount paid') as HTMLInputElement).value).toBe('0.00');
  expect((allotmentFields(1).getByLabelText('Amount unpaid') as HTMLInputElement).value).toBe('0.00');
  fireEvent.click(screen.getByRole('button', { name: 'Remove (allocation 1)' }));
  expect(screen.queryByRole('group', { name: 'Allocation 1' })).toBeNull();
  addAllotment();
  addAllotment();
  expect(screen.queryByRole('group', { name: 'Allocation 2' })).toBeNull();
  fireEvent.change(allotmentFields(1).getByLabelText('Date'), { target: { value: '2015-01-01' } });
  fireEvent.change(allotmentFields(1).getByLabelText('Shares'), { target: { value: '400' } });
  fireEvent.change(allotmentFields(1).getByLabelText('Amount paid'), { target: { value: '' } });
  fireEvent.blur(allotmentFields(1).getByLabelText('Amount paid'));
  expect((allotmentFields(1).getByLabelText('Amount paid') as HTMLInputElement).value).toBe('0.00');
  fireEvent.change(allotmentFields(1).getByLabelText('Amount paid'), { target: { value: '' } });
  fireEvent.change(allotmentFields(1).getByLabelText('Amount unpaid'), { target: { value: '' } });
  expect(screen.queryByRole('group', { name: 'Held for someone else?' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'References (optional)' })).toBeNull();
  expect(screen.queryByLabelText('Share numbers or reference')).toBeNull();
  expect(screen.queryByLabelText('Certificate reference')).toBeNull();
  expect(screen.queryByText(/Recorded:/)).toBeNull();
  addAllotment();
  expect(allotmentFields(1).queryByRole('textbox', { name: 'Shares' })).toBeNull();
  expect(allotmentFields(1).getByText(/400 shares/)).toBeTruthy();
  expect(allotmentFields(1).getByText('Paid 0.00 · Unpaid 0.00')).toBeTruthy();
  addAllotment();
  expect(screen.queryByRole('group', { name: 'Allocation 3' })).toBeNull();
  fireEvent.change(allotmentFields(2).getByLabelText('Shares'), { target: { value: '200' } });
  fireEvent.change(allotmentFields(2).getByLabelText('Amount paid'), { target: { value: '200' } });
  fireEvent.click(screen.getByRole('button', { name: 'Edit (allocation 1)' }));
  expect(allotmentFields(2).queryByRole('textbox', { name: 'Shares' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect((allotmentFields(2).getByRole('textbox', { name: 'Shares' }) as HTMLInputElement).value).toBe('200');
  expect((allotmentFields(2).getByLabelText('Amount paid') as HTMLInputElement).value).toBe('200');
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit (allocation 1)' }));
  addAllotment();
  expect(screen.queryByRole('group', { name: 'Allocation 3' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Remove (allocation 2)' }));
  expect(screen.queryByRole('group', { name: 'Allocation 2' })).toBeNull();
  expect((allotmentFields(1).getByRole('textbox', { name: 'Shares' }) as HTMLInputElement).value).toBe('400');
  expect(screen.getByRole('button', { name: 'Remove (allocation 1)' })).toBeTruthy();
  addAllotment();
  fireEvent.change(allotmentFields(2).getByLabelText('Date'), { target: { value: '2016-01-01' } });
  fireEvent.change(allotmentFields(2).getByLabelText('Shares'), { target: { value: '9007199254740595' } });
  fireEvent.change(allotmentFields(2).getByLabelText('Amount paid'), { target: { value: '200' } });
  fireEvent.change(allotmentFields(2).getByLabelText('Amount unpaid'), { target: { value: '' } });
  fireEvent.change(screen.getByLabelText('Current shares held'), { target: { value: '9007199254740995' } });
  expect(screen.queryByText(/Recorded:/)).toBeNull();
  fireEvent.change(screen.getByLabelText('Current shares held'), { target: { value: '600' } });
  fireEvent.change(allotmentFields(2).getByLabelText('Shares'), { target: { value: '201' } });
  expect(screen.queryByText(/remaining|over$/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Add document' }));
  fireEvent.change(within(screen.getByRole('group', { name: 'Document 1' })).getByLabelText('Category'), {
    target: { value: 'share_certificate' },
  });
  fireEvent.change(within(screen.getByRole('group', { name: 'Document 1' })).getByLabelText('File'), {
    target: { files: [attachment] },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Add document' }));
  fireEvent.change(within(screen.getByRole('group', { name: 'Document 2' })).getByLabelText('Category'), {
    target: { value: 'shareholder_agreement' },
  });
  fireEvent.change(within(screen.getByRole('group', { name: 'Document 2' })).getByLabelText('File'), {
    target: { files: [agreement] },
  });
  fireEvent.submit(screen.getByRole('button', { name: 'Save changes' }).closest('form')!);
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
  expect(screen.getByText('Example Shareholder')).toBeTruthy();
  expect(screen.queryByLabelText('Name')).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit (shareholder 1)' }));
  expect(screen.queryByLabelText('Share numbers or reference')).toBeNull();
  expect(screen.getByText('share-certificate.pdf')).toBeTruthy();
  expect(screen.getByText('shareholder-agreement.pdf')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Remove (document 1)' }));
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
  expect(api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.REGISTER_EVIDENCE)).toHaveLength(2);
  expect(proposal!.members[0].documents?.map(({ category }) => category)).toEqual([
    'share_certificate',
    'shareholder_agreement',
  ]);
  expect(proposal!.members[0].documents?.map(({ snapshot }) => snapshot?.name)).toEqual([
    'share-certificate.pdf',
    'shareholder-agreement.pdf',
  ]);
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
  expect(within(shareholderDetails).getAllByText('Not recorded')).toHaveLength(2);
  expect(within(shareholderDetails).getByText('1 Example Street, Sydney NSW 2000')).toBeTruthy();
  fireEvent.click(within(shareholderDetails).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const setupSteps = await screen.findByRole('list', { name: 'Ledger setup steps' });
  expect(within(setupSteps).getAllByRole('listitem')).toHaveLength(3);
  expect(within(setupSteps).getAllByRole('listitem')[2].getAttribute('aria-current')).toBe('step');
  expect(screen.queryByRole('button', { name: 'Continue to confirmation' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Back to review' })).toBeNull();
  const preparations = api.post.mock.calls.filter(([url]) => url === IMPORTS).map(([, body]) => body);
  expect(preparations).toHaveLength(2);
  expect(preparations[0]).toEqual(preparations[1]);
  expect(proposal!.sourceReference).toBe('Company-provided share records');
  expect(proposal!.members[0].enteredOn).toBe('2020-01-01');
  expect(proposal!.members[0].allotments?.[0]).toMatchObject({
    allottedOn: '2015-01-01',
    shares: '400',
    amountPaid: '0.00',
    amountUnpaid: '0.00',
    fullyPaid: true,
  });
  expect(proposal!.members[0].allotments?.[1].shares).toBe('201');
  expect(proposal!.members[0].allotments?.map((allotment) => allotment.beneficiallyHeld)).toEqual([null, null]);
  expect(proposal!.members[0].allotments?.[0].shareReference).toBeNull();
  expect(proposal!.members[0].allotments?.[0].certificateReference).toBeNull();
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
  fireEvent.click(screen.getByRole('button', { name: 'Explore Ordinary shares (ORD)' }));
  expect(
    within(await screen.findByRole('list', { name: 'Ordinary shares shareholders' })).getByText('Example Shareholder'),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'All classes' }));
  expect(await screen.findByRole('button', { name: 'Explore Ordinary shares (ORD)' })).toBeTruthy();
  expect(proposal!.status).toBe('applied');
  expect(proposal!.decisions.map((decision) => decision.kind)).toEqual(['approve', 'apply']);
  expect(proposal!.decisions.map((decision) => decision.appointment)).toEqual(['approve-only', 'apply-only']);
  expect(api.post.mock.calls.filter(([url]) => url === IMPORTS)).toHaveLength(2);
  expect(api.post.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.BASE)).toHaveLength(1);
  proposal = {
    ...proposal!,
    members: proposal!.members.map((member) => ({
      ...member,
      allotments: member.allotments?.map((allotment, index) => ({
        ...allotment,
        beneficiallyHeld: index === 0,
        shareReference: index === 0 ? '1–400' : null,
        certificateReference: index === 0 ? 'CERT-001' : null,
      })),
    })),
  };
  historyEntries = [
    {
      uuid: 'transfer-entry',
      sequence: 3,
      kind: 'transfer',
      effectiveOn: '2026-10-21',
      companyEventOn: '2026-10-20',
      recordedAt: '2026-10-21T12:00:00Z',
      changes: [
        { member: proposal!.members[0].member, name: 'Example Shareholder', shares: '-100' },
        { member: 'taylor-demo', name: 'Taylor Demo', shares: '100' },
      ],
      corrects: null,
      correctedBy: null,
      correctable: true,
    },
  ];
  appointment = { ...appointment, capabilities: ['prepare', 'approve', 'apply'] };
  historyCorrections = [
    {
      uuid: 'retained-correction',
      company: company.uuid,
      register: token.uuid,
      corrects: 'transfer-entry',
      effectiveOn: '2026-10-22',
      createdAt: '2026-10-22T01:00:00Z',
      changes: historyEntries[0].changes.map(({ member, shares }) => ({ member, shares: String(-BigInt(shares)) })),
      authority: 'director_resolution',
      approvingDirector: 'Example Director',
      authorityReference: 'Correction instruction',
      authorityEvidence: 'retained-authority',
      reason: 'Retained correction reason',
      preparingAppointment: appointment.uuid,
      preparedByName: 'Example Director',
      providedBy: 'company',
      status: 'submitted',
      stage: 'submitted',
      decisions: [],
      baseHash: 'a'.repeat(64),
      baseSequence: 3,
      appliedEntry: null,
      evidenceFingerprint: 'b'.repeat(64),
      evidenceSnapshot: {},
      sourceDocument: null,
      rejectionReason: '',
      reviewedAt: null,
      reviewedBy: null,
      submittedBy: 1,
    },
  ];
  historyParticulars = [
    {
      uuid: 'retained-particulars-change',
      company: company.uuid,
      member: proposal!.members[0].member,
      memberRequest: null,
      name: 'Example Shareholder',
      residentialAddress: '2 Example Street, Sydney NSW 2000',
      asAt: '2026-10-22',
      reason: 'Address update requested by the member',
      preparingAppointment: appointment.uuid,
      preparedByName: 'Example Director',
      providedBy: 'company',
      status: 'submitted',
      stage: 'submitted',
      decisions: [],
      evidenceFingerprint: 'd'.repeat(64),
      evidenceSnapshot: {},
      supportingEvidence: 'retained-supporting-document',
      rejectionReason: '',
      reviewedAt: null,
      reviewedBy: null,
      submittedBy: 1,
      createdAt: '2026-10-22T02:00:00Z',
    },
  ];
  function RegisterDestination() {
    return useLocation().pathname === CERTIFICATES_PATH ? <h1>Certificates destination</h1> : <CompanyRegisterPage />;
  }
  const decisionAppointment = appointment;
  appointment = { ...appointment, capabilities: ['read_register'] };
  cleanup();
  client.clear();
  show(
    'company',
    <>
      <RegisterDestination />
      <Link to="/#transfer">Transfer shares</Link>
      <Link to="/#documents" state={{ registerCompany: company.uuid, registerToken: token.uuid }}>
        Open Documents
      </Link>
      <Link to="/#ledger-exports">Open Ledger exports</Link>
      <Link to="/#company-pack">Open Company pack</Link>
      <Link
        to="/#history"
        state={{ registerCompany: company.uuid, registerToken: token.uuid, registerTask: 'history', preserved: true }}
      >
        Open old History link
      </Link>
      <LedgerLocation />
      <Link to="/#corrections">Open Corrections</Link>
    </>,
    'Ledger',
    { entry: '/?audit=1#history', path: '*' },
  );
  expect(await screen.findByRole('heading', { name: 'Changes' })).toBeTruthy();
  expect(screen.getByRole('heading', { level: 1, name: 'Corrections' })).toBeTruthy();
  expect(JSON.parse(screen.getByLabelText('Ledger location').textContent!)).toMatchObject({
    hash: '#corrections',
    search: '?audit=1',
  });
  const entryDetails = await screen.findByRole('button', { name: /^Details for entry 3:/ });
  expect(within(entryDetails).getByText('Transfer')).toBeTruthy();
  const transferEntry = entryDetails.closest('li')!;
  expect(entryDetails.getAttribute('aria-expanded')).toBe('false');
  expect(within(entryDetails).getByText('Example Shareholder: -100')).toBeTruthy();
  expect(within(entryDetails).getByText('Taylor Demo: +100')).toBeTruthy();
  expect(within(entryDetails).getByText(formatDate('2026-10-20'))).toBeTruthy();
  expect(document.getElementById(entryDetails.getAttribute('aria-controls')!)!.hidden).toBe(true);
  expect(within(transferEntry).queryByRole('button', { name: 'Prepare unsigned certificate (entry 3)' })).toBeNull();
  fireEvent.click(entryDetails);
  expect(within(transferEntry).getByText('Ledger date')).toBeTruthy();
  expect(within(transferEntry).getByText(formatDate('2026-10-21'))).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Prepare unsigned certificate/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /^Correct this entry/ })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Instruction reference' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Approve|Apply|Acknowledge/ })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: /^Correction of entry 3/ }));
  expect(screen.getByText('Retained correction reason')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Approve|Apply|Reject/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Example Shareholder · Prepared' }));
  expect(screen.getByRole('button', { name: /^Download the supporting document/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Approve|Apply|Reject/ })).toBeNull();
  appointment = decisionAppointment;
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['company-appointments'] });
  });
  fireEvent.click(screen.getByRole('link', { name: 'Open Corrections' }));
  const particularsApproval = await screen.findByRole('button', { name: /^Approve \(change for Example Shareholder/ });
  const beforeParticularsReview = api.post.mock.calls.filter(([url]) => url.endsWith('/decide/')).length;
  fireEvent.click(particularsApproval);
  const particularsReview = await screen.findByRole('region', { name: 'Review particulars change' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(within(particularsReview).getByText('1 Example Street, Sydney NSW 2000')).toBeTruthy();
  expect(within(particularsReview).getByText('2 Example Street, Sydney NSW 2000')).toBeTruthy();
  expect(within(particularsReview).getByText(formatDate('2026-10-22'))).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Particulars changes' })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Details for entry 3:/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /^Approve \(correction of entry 3/ })).toBeNull();
  expect(api.post.mock.calls.filter(([url]) => url.endsWith('/decide/'))).toHaveLength(beforeParticularsReview);
  fireEvent.click(within(particularsReview).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(document.activeElement).toBe(particularsApproval));
  expect(screen.queryByRole('region', { name: 'Review particulars change' })).toBeNull();
  expect(api.post.mock.calls.filter(([url]) => url.endsWith('/decide/'))).toHaveLength(beforeParticularsReview);
  fireEvent.click(screen.getByRole('link', { name: 'Open old History link' }));
  await screen.findByRole('heading', { name: 'Changes' });
  expect(JSON.parse(screen.getByLabelText('Ledger location').textContent!)).toMatchObject({
    hash: '#corrections',
    state: { registerCompany: company.uuid, registerToken: token.uuid, registerTask: 'history', preserved: true },
  });
  const beforeHistoryRead = api.post.mock.calls.length;
  pauseHistory = true;
  let refreshingHistory!: Promise<void>;
  act(() => {
    refreshingHistory = client.refetchQueries({ predicate: (query) => query.queryKey.includes('entries') });
  });
  await waitFor(() => expect(releaseHistory).toBeTypeOf('function'));
  expect(screen.queryByRole('button', { name: /^Details for entry 3:/ })).toBeNull();
  await act(async () => {
    pauseHistory = false;
    releaseHistory();
    await refreshingHistory;
  });
  expect(await screen.findByRole('button', { name: /^Details for entry 3:/ })).toBeTruthy();
  expect(api.post.mock.calls).toHaveLength(beforeHistoryRead);
  fireEvent.click(screen.getByRole('link', { name: 'Open Documents' }));
  expect(await screen.findByRole('heading', { name: 'Certificates destination' })).toBeTruthy();
  expect(JSON.parse(screen.getByLabelText('Ledger location').textContent!)).toMatchObject({
    pathname: CERTIFICATES_PATH,
    search: `?company=${company.uuid}&class=${token.uuid}`,
    hash: '',
    state: { registerCompany: company.uuid, registerToken: token.uuid },
  });
  expect(api.post.mock.calls).toHaveLength(beforeHistoryRead);
  fireEvent.click(screen.getByRole('link', { name: 'Open Ledger exports' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Ledger exports' })).toBeTruthy();
  expect(await screen.findByRole('button', { name: 'Prepare inspection copy' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Download CSV' })).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Certificate records' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Open Company pack' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Company pack' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Share class' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Prepare inspection copy' })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Open Corrections' }));
  const correctionDetails = await screen.findByRole('button', { name: /^Details for entry 3:/ });
  if (correctionDetails.getAttribute('aria-expanded') !== 'true') fireEvent.click(correctionDetails);
  expect(within(correctionDetails.closest('li')!).getByRole('link', { name: /^Correct this entry/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Prepare unsigned certificate/ })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Instruction reference' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Approve (correction of entry 3)' })).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Open old History link' }));
  expect(await screen.findByRole('heading', { name: 'Changes' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Instruction reference' })).toBeNull();
  expect(api.post.mock.calls).toHaveLength(beforeHistoryRead);
  const copiedSummary = await screen.findByRole('button', { name: /^Copied opening ·/ });
  expect(copiedSummary.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(copiedSummary);
  expect(copiedSummary.getAttribute('aria-expanded')).toBe('true');
  const copiedOpening = document.getElementById(copiedSummary.getAttribute('aria-controls')!)!;
  const copiedMembers = within(copiedOpening).getByRole('table', { name: 'Shareholders' });
  expect(within(copiedMembers).getByText('Example Shareholder')).toBeTruthy();
  expect(within(copiedMembers).getByText('600')).toBeTruthy();
  expect(within(copiedMembers).getByText(formatDate('2020-01-01'))).toBeTruthy();
  const transferTask = screen.getByRole('link', { name: 'Transfer shares' });
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
  const recorded = await screen.findByRole('region', { name: 'Recorded ledger' });
  expect(within(recorded).getByRole('heading', { name: 'Recorded' })).toBeTruthy();
  expect(screen.queryByRole('list', { name: 'Ledger setup steps' })).toBeNull();
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
          <TestRouter>
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
          </TestRouter>
        </ApiClientProvider>
      </QueryClientProvider>,
    );
  };
  rejected.asicIssuedTotal = '601';
  showReplacement('original-preparer');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByRole('button', { name: 'Company source copies' }).getAttribute('aria-expanded')).toBe('false');
  api.post.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  expect(
    screen.getByText(
      'The earlier ASIC comparison differs from the shareholder records. Check the source or leave out the comparison.',
    ),
  ).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  rejected.asicIssuedTotal = '600';
  showReplacement('original-preparer');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  expect(screen.getByText(/retained source copy will be reused/)).toBeTruthy();
  expect(screen.getByText(/retained ASIC copy and figures will be reused/)).toBeTruthy();
  showReplacement('another-preparer');
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  fireEvent.click(screen.getByRole('button', { name: 'Company source copies' }));
  expect(screen.getByText(/Earlier source documents remain with their original record/)).toBeTruthy();
  expect(screen.queryByText(/will be reused/)).toBeNull();
  expect(screen.getByRole('group', { name: 'Earlier ASIC comparison' }).textContent).toContain('600 issued shares');
  expect(screen.queryByLabelText('Issued shares in the comparison source (optional)')).toBeNull();
  api.post.mockClear();
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  expect(screen.getByText(/Attach the optional ASIC extract/)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Leave out ASIC comparison' }));
  expect(screen.queryByRole('group', { name: 'Earlier ASIC comparison' })).toBeNull();
  api.post.mockImplementation(async (url: string, request: RegisterImportPreparation) => {
    expect(url).toBe(IMPORTS);
    expect(request.members[0].allotments?.map((allotment) => allotment.beneficiallyHeld)).toEqual([true, false]);
    expect(request.members[0].allotments?.[0].shareReference).toBe('1–400');
    expect(request.members[0].allotments?.[0].certificateReference).toBe('CERT-001');
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
        members: request.members.map((member) => ({ ...member, amountPaid: null })),
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
  fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
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
    if (url === COMPANY_TOKEN_ENDPOINTS.OWNERSHIP) return ownershipRead();
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
  expect(screen.getByText('Company A shares (A)')).toBeTruthy();
  expect((screen.getByLabelText('Class code') as HTMLInputElement).maxLength).toBe(5);
  pick('Preference (PRF)');
  expect(screen.getByText('Preference shares (PRF)')).toBeTruthy();
  expect(screen.queryByLabelText('Class name')).toBeNull();
  expect(screen.queryByLabelText('Class code')).toBeNull();
  expect(screen.queryByRole('group', { name: 'Class type' })).toBeNull();
  pick('Redeemable (RED)');
  expect(screen.getByText('Redeemable shares (RED)')).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByRole('link', { name: 'open Ledger' }).getAttribute('href')).toBe(
    `/company/ledger?company=${company.uuid}`,
  );
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
    expect(screen.getByRole('link', { name: 'Open Ledger' }).getAttribute('href')).toBe(
      `/company/ledger?company=${company.uuid}`,
    );
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
  expect((screen.getByLabelText('Current shares held') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('button', { name: 'Add shareholder' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Save draft and review' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel (shareholder edit)' }));
  const enterHolding = () => {
    if (!screen.queryByRole('group', { name: 'Allocation 1' }))
      fireEvent.click(screen.getByRole('button', { name: 'Add allocation (shareholder 1)' }));
    act(() => {
      for (const [label, value] of [
        ['Date first added to register', '2020-01-01'],
        ['Current shares held', '600'],
        ['Date', '2015-01-01'],
        ['Shares', '600'],
        ['Amount paid', '600'],
        ['Amount unpaid', '0'],
      ])
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
    });
  };
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: companyMembers[0].name } });
  fireEvent.change(screen.getByLabelText('Residential address'), {
    target: { value: companyMembers[0].residentialAddress },
  });
  enterHolding();
  fireEvent.click(screen.getByRole('button', { name: 'Add shareholder' }));
  expect(screen.getByText(/explicitly choose a new shareholder/)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  await choose('Company shareholder', companyMembers[0].name!);
  expect((screen.getByLabelText('Date first added to register') as HTMLInputElement).value).toBe('2020-01-01');
  expect(screen.getByRole('button', { name: 'Add shareholder' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel (shareholder edit)' }));
  expect(screen.getByText('No shareholders added yet.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  await choose('Company shareholder', companyMembers[0].name!);
  enterHolding();
  fireEvent.click(screen.getByRole('button', { name: 'Add shareholder' }));
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
    hasAwards: true,
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
      members: request.members.map((member) => ({ ...member, amountPaid: null })),
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
  for (const label of ['Date first added to register', 'Current shares held'])
    expect((screen.getByLabelText(label) as HTMLInputElement).value).toBe('');
  expect(screen.queryByRole('group', { name: 'Allocation 1' })).toBeNull();
  enterHolding();
  fireEvent.click(screen.getByRole('button', { name: 'Add shareholder' }));
  const preferences = companyPreferences();
  const recipientKey = peopleKey(
    { userUuid: preferences.userProfile, ownerAccountUuid: preferences.userAccount!.uuid },
    token.uuid,
  );
  companyMembers = [{ ...trustedRecipient, name: 'Changed recipient name' }];
  await act(async () => client.invalidateQueries({ queryKey: recipientKey, exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save draft and review' }));
  expect(await screen.findByText(/keep the company person’s recorded name and address/)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  companyMembers = [];
  await act(async () => client.invalidateQueries({ queryKey: recipientKey, exact: true }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save draft and review' }));
  expect((await screen.findAllByText(/company person is no longer available/)).length).toBeGreaterThan(0);
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
  fireEvent.click(screen.getByRole('button', { name: 'Add shareholder' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  expect((await screen.findAllByText(/company person is no longer available/)).length).toBeGreaterThan(0);
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
  expect(await screen.findByText('No issued shares yet.')).toBeTruthy();
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
    if (
      [REGISTER, COMPANY_ENDPOINTS.BASE, APPOINTMENTS, PROFILES, COMPANY_TOKEN_ENDPOINTS.MEMBER_RECORDS].includes(url)
    )
      return page([]);
    throw new Error(`Unexpected read ${url}`);
  });
  show('investor');
  expect(await screen.findByText(NO_REGISTER)).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();
  expect(screen.queryByRole('button', { name: /shares/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
  cleanup();
  show('investor', <SettingsPage />, 'Settings', { entry: '/settings', path: '/settings' });
  expect(await screen.findByRole('heading', { level: 1, name: 'Profile' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Change password' })).toBeTruthy();
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect(readUrls().sort()).toEqual([REGISTER, APPOINTMENTS, COMPANY_TOKEN_ENDPOINTS.MEMBER_RECORDS, PROFILES].sort());
  expect(screen.queryByRole('link', { name: 'Ledger' })).toBeNull();

  cleanup();
  client.clear();
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  let preferencesUnavailable = true;
  api.get.mockImplementation(async (url: string) => {
    if (url === USER_PREFERENCES_ENDPOINTS.BASE) {
      if (preferencesUnavailable) throw new Error('The preferences read failed.');
      return { data: companyPreferences('investor') };
    }
    if ([APPOINTMENTS, COMPANY_TOKEN_ENDPOINTS.MEMBER_RECORDS, PROFILES].includes(url)) return page([]);
    throw new Error(`Unexpected settings recovery read ${url}`);
  });
  renderCompanyPage(client, <SettingsPage />, 'Settings', { entry: '/settings', path: '/settings' });
  const settingsError = await screen.findByText('Your company access could not be loaded.');
  const retry = within(settingsError.closest('[role="alert"]')!).getByRole('button', { name: 'Try again' });
  await waitFor(() => expect(retry.matches(':disabled')).toBe(false));
  preferencesUnavailable = false;
  fireEvent.click(retry);
  await waitFor(() => expect(screen.queryByText('Your company access could not be loaded.')).toBeNull());
  expect(await screen.findByRole('heading', { level: 1, name: 'Profile' })).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
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
      <LedgerLocation />
      <Link to="/" state={{ registerCompany: 'inland', registerToken: 'ordinary' }}>
        Open mismatched dashboard class
      </Link>
      <Link to="/?company=harbour" state={{ registerCompany: 'inland', registerToken: 'preference' }}>
        Open mismatched URL company
      </Link>
      <Link to="/#history" state={{ registerCompany: 'inland', registerToken: 'preference' }}>
        Open dashboard class
      </Link>
      <Link to="/#shareholders" state={{ registerCompany: 'inland' }}>
        Open dashboard shareholders
      </Link>
    </>,
  );
  expect(await screen.findByRole('link', { name: 'Choose company on Dashboard' })).toBeTruthy();
  expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();
  expect(screen.queryByRole('button', { name: /shares/ })).toBeNull();
  expect(readUrls()).toEqual([REGISTER]);

  fireEvent.click(screen.getByRole('link', { name: 'Open mismatched dashboard class' }));
  expect(screen.queryByRole('combobox', { name: 'Company' })).toBeNull();
  expect(readUrls()).toEqual([REGISTER]);
  fireEvent.click(screen.getByRole('link', { name: 'Open mismatched URL company' }));
  expect(screen.getByRole('link', { name: 'Choose company on Dashboard' })).toBeTruthy();
  expect(readUrls()).toEqual([REGISTER]);
  fireEvent.click(screen.getByRole('link', { name: 'Open dashboard class' }));
  const preference = (await screen.findAllByRole('heading', { name: /^Preference shares ·/ })).find((heading) =>
    heading.closest('li'),
  )!;
  await waitFor(() => expect(document.activeElement).toBe(preference.closest('li')));
  expect(within(preference.closest('li')!).getByRole('heading', { name: 'Changes' })).toBeTruthy();
  expect(JSON.parse(screen.getByLabelText('Ledger location').textContent!).state.registerCompany).toBe('inland');
  expect(screen.queryByRole('link', { name: 'Share class' })).toBeNull();
  expect(screen.queryByRole('heading', { name: /^Ordinary shares ·/ })).toBeNull();
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'));
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'));
  expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull();

  fireEvent.click(screen.getByRole('link', { name: 'Use Harbour company' }));
  await waitFor(() =>
    expect(JSON.parse(screen.getByLabelText('Ledger location').textContent!).search).toBe('?company=harbour'),
  );
  expect(
    (await screen.findAllByRole('heading', { name: /^Ordinary shares ·/ })).find((heading) => heading.closest('li')),
  ).toBeTruthy();
  expect(JSON.parse(screen.getByLabelText('Ledger location').textContent!).search).toBe('?company=harbour');
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
  await waitFor(() =>
    expect(JSON.parse(screen.getByLabelText('Ledger location').textContent!).state.registerCompany).toBe('inland'),
  );
  await screen.findByRole('columnheader', { name: /PREFERENCE/ });
  fireEvent.click(screen.getByRole('link', { name: 'Use Harbour company' }));
  await waitFor(() =>
    expect(JSON.parse(screen.getByLabelText('Ledger location').textContent!).search).toBe('?company=harbour'),
  );
  await screen.findByRole('columnheader', { name: /ORDINARY/ });
  fireEvent.click(await screen.findByRole('button', { name: 'Filters' }));
  fireEvent.change(await screen.findByLabelText('Search people'), { target: { value: 'Example' } });
  expect(await screen.findByText(/match(es)? your search\./)).toBeTruthy();
  await act(async () => {});
  expect(
    new URLSearchParams(JSON.parse(screen.getByLabelText('Ledger location').textContent!).search).get('company'),
  ).toBe('harbour');
});

it("starts again for another signed-in account without showing the previous account's register or choice", async () => {
  api.get.mockImplementation(async (url: string) => {
    if (url === REGISTER) return page([harbour('ordinary'), inland('preference')]);
    return noCommands(url) ?? { data: register(url.includes('preference') ? 'preference' : 'ordinary') };
  });
  show('investor', <CompanyRegisterPage />, 'Register', { entry: '/?company=inland#shareholders' });
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
  await act(async () => finish(page([harbour('ordinary')])));
  expect(await screen.findByRole('link', { name: 'Choose company on Dashboard' })).toBeTruthy();
  expect(screen.queryByRole('table', { name: 'Company shareholders' })).toBeNull();
  expect(screen.getByRole('link', { name: 'Choose company on Dashboard' })).toBeTruthy();
  expect(readUrls().filter((url) => url === REGISTER)).toHaveLength(2);
});
