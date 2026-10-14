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
  USER_PREFERENCES_QUERY_KEY,
  type AccountRole,
  type TokenHoldersResponse,
  type OwnCompanyAppointment,
  type RegisterTransferMember,
} from '@ledova/shared';
import SettingsPage from '@pages/settings';
import apiClient from '@services/apiClient';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import CompanyRegisterPage from '.';
import CompanyDashboardPage from '../dashboard';
import CompanyRegisterImportPage from './import';
import { ImportForm } from './import/ImportForm';
import { REGISTER_CSV_COLUMNS, readRegisterCsv, registerCsvTemplate } from './import/csv';
import { blankAllotment, blankMember, memberIdentityProblems, preparationProblems } from './import/preparation';
import { APPOINTMENT as CURRENT_APPOINTMENT } from '../../../../../packages/shared/tests/fixtures/employee-awards';
import { companyRecord, companyPreferences, prepareCompanyClient, renderCompanyPage } from '../testSupport';

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

it('reads every register class page and renders exact stored shares with each member and linked wallet', async () => {
  api.get.mockImplementation(async (url: string, config?: { params?: { page: number } }) => {
    if (url === REGISTER)
      return config?.params?.page === 2
        ? page([harbour('preference')])
        : page([harbour('ordinary')], 'https://example.test/tokens/register/?page=2');
    return noCommands(url) ?? { data: register(url.includes('preference') ? 'preference' : 'ordinary') };
  });
  show();
  expect(await screen.findByRole('heading', { name: /^Preference shares ·/ })).toBeTruthy();
  expect(api.get).toHaveBeenCalledWith(REGISTER, { params: { page: 1 } });
  expect(api.get).toHaveBeenCalledWith(REGISTER, { params: { page: 2 } });
  expect(screen.queryByLabelText('Company')).toBeNull();
  expect(screen.getAllByRole('heading', { name: 'Current members · 1' })).toHaveLength(2);
  expect(screen.queryByRole('button', { name: /Ordinary shares|Preference shares/ })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Download CSV' })).toBeNull();
  expect(screen.getAllByText('9,007,199,254,740,993 shares')).toHaveLength(2);
  expect(screen.getAllByText('9,007,199,254,740,999')).toHaveLength(2);
  expect(screen.getAllByText('Example Member')).toHaveLength(2);
  for (const name of [/^Ordinary shares ·/, /^Preference shares ·/]) {
    const section = screen.getByRole('heading', { name }).closest('section')!;
    const wallet = within(section).getByText('Optional wallet links').closest('details')!;
    const history = within(section).getByText('Other changes and register history').closest('details')!;
    expect(wallet.open).toBe(false);
    expect(history.open).toBe(false);
    fireEvent.click(within(wallet).getByText('Optional wallet links'));
    fireEvent.click(within(history).getByText('Other changes and register history'));
    expect(wallet.open).toBe(true);
    expect(history.open).toBe(true);
    expect(within(wallet).getByText(`0x${'1'.repeat(40)} · Active`)).toBeTruthy();
  }
  expect(screen.getAllByRole('link', { name: 'Share class' }).map((link) => link.getAttribute('href'))).toEqual([
    '/company/register/ordinary',
    '/company/register/preference',
  ]);
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'));
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'));
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.BASE);
});

it('brings complete mirror records, recovers uncertain requests and confirms one snapshot with separate company appointments', async () => {
  const header = REGISTER_CSV_COLUMNS.join(',');
  const row =
    'H001,"Example Shareholder","1 Example Street, Sydney NSW 2000",2020-01-01,600,2015-01-01,400,400,0,yes,no,1-400,CERT-001';
  const second = row.replace('2015-01-01,400,400', '2016-01-01,200,200').replace('1-400,CERT-001', '401-600,CERT-002');
  const csv = `${header}\r\n${row}\r\n${second}\r\n`;
  expect(readRegisterCsv(csv)).toHaveLength(1);
  expect(readRegisterCsv(csv)[0].allotments).toHaveLength(2);
  const existingMembers = readRegisterCsv(csv);
  const existingId = existingMembers[0].member;
  expect(() => readRegisterCsv(csv, existingMembers, true)).toThrow(/keep its holder_reference/);
  const currentTemplate = registerCsvTemplate(existingMembers);
  expect(readRegisterCsv(currentTemplate, existingMembers, true)[0].member).toBe(existingId);
  const renamed = readRegisterCsv(
    currentTemplate.replace(/Example Shareholder/g, 'Renamed Shareholder'),
    existingMembers,
    true,
  );
  expect(renamed[0].member).toBe(existingId);
  expect(renamed[0].name).toBe('Renamed Shareholder');
  const literalCases = [
    '=Company',
    '+Company',
    '-Company',
    '@Company',
    "'=Company",
    "'+Company",
    "'-Company",
    "'@Company",
    "'Company",
    "''=Company",
    "'\tCompany",
    "'\rCompany",
  ];
  for (const literal of literalCases) {
    const source = readRegisterCsv(csv);
    source[0].name = literal;
    source[0].residentialAddress = literal;
    source[0].allotments[0].shareReference = literal;
    source[0].allotments[0].certificateReference = literal;
    const roundTrip = readRegisterCsv(registerCsvTemplate(source), source, true)[0];
    expect(roundTrip.name).toBe(literal);
    expect(roundTrip.residentialAddress).toBe(literal);
    expect(roundTrip.allotments[0].shareReference).toBe(literal);
    expect(roundTrip.allotments[0].certificateReference).toBe(literal);
  }
  for (const prefix of ['\t', '\r']) {
    const source = readRegisterCsv(csv);
    const literal = `${prefix}Company`;
    source[0].name = literal;
    source[0].residentialAddress = literal;
    source[0].allotments[0].shareReference = literal;
    source[0].allotments[0].certificateReference = literal;
    const template = registerCsvTemplate(source);
    expect(template).toContain(`"'${literal}"`);
    const canonical = readRegisterCsv(template, source, true)[0];
    expect(canonical.name).toBe(literal.trim());
    expect(canonical.residentialAddress).toBe(literal.trim());
    expect(canonical.allotments[0].shareReference).toBe(literal.trim());
    expect(canonical.allotments[0].certificateReference).toBe(literal.trim());
    expect(() => readRegisterCsv(template.split(`'${prefix}`).join(prefix), source, true)).toThrow(/safety prefixes/);
  }
  expect(readRegisterCsv(csv.replace(/Example Shareholder/g, "'=Company"))[0].name).toBe("'=Company");
  expect(() => readRegisterCsv(currentTemplate.replace('ledova-excel-safe-v1', 'unknown'))).toThrow(
    /value_encoding marker/,
  );
  expect(() => readRegisterCsv(currentTemplate.replace('ledova-excel-safe-v1', ''))).toThrow(/value_encoding marker/);
  expect(() => readRegisterCsv(currentTemplate.replace('Example Shareholder', "'literal"))).toThrow(
    /invalid escaped value/,
  );

  expect(() => readRegisterCsv(csv.replace('400,0,yes', '400,,yes'))).toThrow(/explicitly/);
  expect(() => readRegisterCsv(`${header}\n${row}\n${second.replace('2020-01-01,600', '2020-01-01,601')}`)).toThrow(
    /same name/,
  );
  expect(() => readRegisterCsv(`${header}\n${Array(501).fill(row).join('\n')}`)).toThrow(/500/);
  expect(() => readRegisterCsv(`duplicate,duplicate\n1,2`)).toThrow(/column names/);
  expect(blankAllotment().beneficiallyHeld).toBeNull();
  const manual = readRegisterCsv(csv);
  manual[0].allotments[0].beneficiallyHeld = null;
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
    if (url.endsWith('/decision-preview/'))
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
  expect(await screen.findByRole('heading', { name: `${company.name} · Ordinary shares (ORD)` })).toBeTruthy();
  expect(screen.queryByLabelText('Authorised shares')).toBeNull();
  expect(screen.queryByLabelText('Reason')).toBeNull();
  expect(screen.queryByLabelText('Record source')).toBeNull();
  const recordDate = (screen.getByLabelText('Record date') as HTMLInputElement).value;
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
  expect((screen.getByRole('button', { name: 'Save draft and review' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel shareholder edit' }));
  expect(screen.getByText('No shareholders added yet.')).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add a shareholder' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Example Shareholder' } });
  fireEvent.change(screen.getByLabelText('Address'), { target: { value: '1 Example Street, Sydney NSW 2000' } });
  fireEvent.change(screen.getByLabelText('Original membership date'), { target: { value: '2020-01-01' } });
  fireEvent.change(screen.getByLabelText('Current holding (shares)'), { target: { value: '600' } });
  fireEvent.change(screen.getByLabelText('Allotment date'), { target: { value: '2015-01-01' } });
  fireEvent.change(screen.getByLabelText('Allotted shares in this holding'), { target: { value: '400' } });
  fireEvent.change(screen.getByLabelText('Amount paid'), { target: { value: '400' } });
  fireEvent.change(screen.getByLabelText('Amount unpaid'), { target: { value: '0' } });
  fireEvent.change(screen.getByLabelText('Held beneficially'), { target: { value: 'no' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add allotment for shareholder 1' }));
  fireEvent.change(screen.getAllByLabelText('Allotment date')[1], { target: { value: '2016-01-01' } });
  fireEvent.change(screen.getAllByLabelText('Allotted shares in this holding')[1], { target: { value: '200' } });
  fireEvent.change(screen.getAllByLabelText('Amount paid')[1], { target: { value: '200' } });
  fireEvent.change(screen.getAllByLabelText('Amount unpaid')[1], { target: { value: '0' } });
  fireEvent.change(screen.getAllByLabelText('Held beneficially')[1], { target: { value: 'no' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Add to draft' }).closest('form')!);
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add to draft' }));
  expect(screen.getByText('Example Shareholder')).toBeTruthy();
  expect(screen.queryByLabelText('Name')).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit shareholder 1' }));
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Discarded edit' } });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel shareholder edit' }));
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
  expect(await screen.findByRole('button', { name: 'Continue to confirmation' })).toBeTruthy();
  const preparations = api.post.mock.calls.filter(([url]) => url === IMPORTS).map(([, body]) => body);
  expect(preparations).toHaveLength(2);
  expect(preparations[0]).toEqual(preparations[1]);
  expect(proposal!.sourceReference).toBe('Company-provided share records');
  expect(proposal!.members[0].enteredOn).toBe('2020-01-01');
  expect(proposal!.members[0].allotments?.[0].allottedOn).toBe('2015-01-01');
  await waitFor(() =>
    expect(
      api.get.mock.calls.filter(([url]) => url === COMPANY_TOKEN_ENDPOINTS.HOLDERS(token.uuid)).length,
    ).toBeGreaterThan(1),
  );
  await waitFor(() => expect(client.isFetching()).toBe(0));
  expect((screen.getByRole('button', { name: 'Continue to confirmation' }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: 'Edit records' }) as HTMLButtonElement).disabled).toBe(true);
  const importPath = DESTINATIONS.companyRegisterImport.path.replace(':uuid', token.uuid);
  reopen('apply', importPath);
  expect(await screen.findByText('Example Shareholder')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Continue to confirmation' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText(/review access must review them/)).toBeTruthy();
  reopen('approve', `${importPath}?record=${proposal!.uuid}`);
  expect(await screen.findByText('Example Shareholder')).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Edit records' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole('button', { name: 'Save draft and review' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Continue to confirmation' }));
  const review = await screen.findByRole('button', { name: 'Record review' });
  await waitFor(() => expect((review as HTMLButtonElement).disabled).toBe(false));
  const previewGuard = api.post.mock.calls.find(([url]) => url.endsWith('/decision-preview/'))![2]
    .ledovaSubmissionGuard;
  visibleClass = false;
  await act(async () => {
    await client.invalidateQueries({ predicate: (query) => query.queryKey.at(-1) === 'classes' });
  });
  expect(await screen.findByText(/Refresh current company access before showing these records/)).toBeTruthy();
  expect(screen.queryByText('Company-provided share records')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Record review' })).toBeNull();
  expect(() => previewGuard()).toThrow(/company, authority or source records changed/);
  expect(api.post.mock.calls.filter(([url]) => url.endsWith('/decide/'))).toHaveLength(0);
  visibleClass = true;
  await act(async () => {
    await client.invalidateQueries({ predicate: (query) => query.queryKey.at(-1) === 'classes' });
  });
  expect(await screen.findByRole('button', { name: 'Record review' })).toBeTruthy();
  appointment = { ...appointment, status: 'revoked', isEffective: false, revokedAt: '2026-10-14T00:00:00Z' };
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['company-appointments'] });
  });
  expect(await screen.findByText(/Refresh current company access before showing these records/)).toBeTruthy();
  expect(screen.queryByText('Company-provided share records')).toBeNull();
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
  fireEvent.click(screen.getByRole('button', { name: 'Continue to confirmation' }));
  const confirm = await screen.findByRole('button', { name: 'Confirm mirror' });
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
  const showReplacement = (uuid: string) => {
    cleanup();
    client.clear();
    const preparationAppointment: OwnCompanyAppointment = {
      ...appointment,
      uuid,
      capabilities: ['prepare'],
    };
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ImportForm
            owner={{ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }}
            guard={() => {}}
            company={company.uuid}
            register={holders()}
            companyMembers={[]}
            appointment={preparationAppointment}
            steps={{ prepare: preparationAppointment }}
            saved={rejected}
            blocked={false}
            onConflict={() => {}}
          />
        </MemoryRouter>
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
  expect(rejected.registerEvidence).toBe('original-register-copy');
  expect(rejected.asicEvidence).toBe('original-asic-copy');
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
  expect(screen.getByRole('heading', { name: `${company.name} · Company A shares (A)` })).toBeTruthy();
  expect((screen.getByLabelText('Class code') as HTMLInputElement).maxLength).toBe(5);
  fireEvent.change(selector, { target: { value: 'preference' } });
  expect(screen.getByRole('heading', { name: `${company.name} · Preference shares (PRF)` })).toBeTruthy();
  expect(screen.queryByLabelText('Class name')).toBeNull();
  expect(screen.queryByLabelText('Class code')).toBeNull();
  expect(screen.queryByLabelText('Class type')).toBeNull();
  fireEvent.change(selector, { target: { value: 'redeemable' } });
  expect(screen.getByRole('heading', { name: `${company.name} · Redeemable shares (RED)` })).toBeTruthy();
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
  const memberCsv = csv.replace(/H001/g, companyMembers[0].member);
  const unresolved = readRegisterCsv(csv, [], false, companyMembers);
  expect(unresolved[0].member).not.toBe(companyMembers[0].member);
  expect(memberIdentityProblems(unresolved, companyMembers, true)).toEqual(
    expect.arrayContaining([expect.stringMatching(/explicitly choose/)]),
  );
  expect(readRegisterCsv(memberCsv, [], false, companyMembers)[0].member).toBe(companyMembers[0].member);
  expect(() =>
    readRegisterCsv(memberCsv.replace(/Example Shareholder/g, 'Different person'), [], false, companyMembers),
  ).toThrow(/keep this existing company shareholder/);
  const sameHolder = readRegisterCsv(memberCsv, [], false, companyMembers)[0];
  expect(memberIdentityProblems([sameHolder, sameHolder], companyMembers, true)).toEqual(
    expect.arrayContaining([expect.stringMatching(/only once/)]),
  );
  const opaque = crypto.randomUUID();
  expect(readRegisterCsv(csv.replace(/H001/g, opaque))[0].member).not.toBe(opaque);
  const placeholder = {
    ...blankMember(),
    name: sameHolder.name,
    residentialAddress: sameHolder.residentialAddress,
    enteredOn: sameHolder.enteredOn,
    shares: sameHolder.shares,
    allotments: sameHolder.allotments,
  };
  const ownTemplate = registerCsvTemplate([placeholder]);
  const ownUnresolved = readRegisterCsv(ownTemplate, [], false, companyMembers);
  expect(ownUnresolved[0].member).not.toBe(placeholder.member);
  expect(ownUnresolved[0].identityChoice).toBeUndefined();
  expect(memberIdentityProblems(ownUnresolved, companyMembers, true)).toEqual(
    expect.arrayContaining([expect.stringMatching(/explicitly choose/)]),
  );
  expect(() => readRegisterCsv(ownTemplate, existingMembers, true)).toThrow(/keep its holder_reference/);
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
  expect((screen.getByLabelText('Original membership date') as HTMLInputElement).value).toBe('');
  expect((screen.getByLabelText('Current holding (shares)') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('button', { name: 'Add to draft' })).toBeTruthy();
  expect((screen.getByRole('button', { name: 'Save draft and review' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Cancel shareholder edit' }));
  const secondClassFile = new File([ownTemplate], 'second-class.csv', { type: 'text/csv' });
  Object.defineProperty(secondClassFile, 'arrayBuffer', {
    value: async () => new TextEncoder().encode(ownTemplate).buffer,
  });
  fireEvent.change(screen.getByLabelText('Bring a CSV'), { target: { files: [secondClassFile] } });
  await waitFor(() => expect(screen.getByText('Example Shareholder')).toBeTruthy());
  fireEvent.click(screen.getByRole('button', { name: 'Edit shareholder 1' }));
  expect((screen.getByLabelText('Company shareholder') as HTMLSelectElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  expect(screen.getByText(/explicitly choose a new shareholder/)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Company shareholder'), { target: { value: companyMembers[0].member } });
  expect((screen.getByLabelText('Original membership date') as HTMLInputElement).value).toBe('2020-01-01');
  expect(screen.getByRole('button', { name: 'Done editing' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel shareholder edit' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  expect(screen.getByText(/explicitly choose a new shareholder/)).toBeTruthy();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit shareholder 1' }));
  expect((screen.getByLabelText('Company shareholder') as HTMLSelectElement).value).toBe('');
  fireEvent.change(screen.getByLabelText('Company shareholder'), { target: { value: companyMembers[0].member } });
  fireEvent.click(screen.getByRole('button', { name: 'Done editing' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save draft and review' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledOnce());
  expect((api.post.mock.calls[0][1] as RegisterImportPreparation).members[0].member).toBe(companyMembers[0].member);
});

it('shows an account without register access a calm empty state, reads no members or CSV and offers no entry', async () => {
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
  expect(within(preference.closest('section')!).getByText(/^Inland Example Pty Ltd ·/)).toBeTruthy();
  expect(screen.queryByRole('heading', { name: /^Ordinary shares ·/ })).toBeNull();
  expect(readUrls()).toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('preference'));
  expect(readUrls()).not.toContain(COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary'));

  fireEvent.change(select, { target: { value: 'harbour' } });
  const ordinary = await screen.findByRole('heading', { name: /^Ordinary shares ·/ });
  expect(within(ordinary.closest('section')!).getByText(/^Harbour Example Pty Ltd ·/)).toBeTruthy();
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
    return { data: register(url.includes('preference') ? 'preference' : 'ordinary') };
  });
  show('investor');
  fireEvent.change(await screen.findByLabelText('Company'), { target: { value: 'inland' } });
  expect(await screen.findByRole('heading', { name: /^Preference shares ·/ })).toBeTruthy();

  let finish!: (response: ReturnType<typeof page>) => void;
  api.get.mockImplementation((url: string) =>
    url === REGISTER
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ data: register(url.includes('preference') ? 'preference' : 'ordinary') }),
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
  await act(async () => finish(page([harbour('ordinary'), inland('preference')])));
  expect(((await screen.findByLabelText('Company')) as HTMLSelectElement).value).toBe('');
  expect(screen.queryByRole('heading', { name: /^Preference shares ·/ })).toBeNull();
  expect(screen.getByText('Select a company to show its register.')).toBeTruthy();
  expect(readUrls().filter((url) => url === REGISTER)).toHaveLength(2);
});
