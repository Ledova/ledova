import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  COMPANY_ENDPOINTS,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  USER_PREFERENCES_QUERY_KEY,
  USER_PROFILE_ENDPOINTS,
  ownershipCompaniesKey,
  type CompanyTeamAppointment,
  type OwnCompanyAppointment,
  type OwnMemberRecord,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { AxiosInstance } from 'axios';
import { MemberRecordsProvider } from '../../contexts';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { MEMBER_CODE, MEMBER_ENTRY, MEMBER_RECORD } from '../../../../packages/shared/tests/fixtures/member-access';
import { destinationOf } from '../../components/notifications/NotificationsPanel';
import { CertificatesScreen } from '../documents/CertificatesScreen';
import { TeamScreen } from '../settings/TeamScreen';
import { DashboardScreen } from './DashboardScreen';
import { InvitationScreen } from './InvitationScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, setOptions: jest.fn(), setParams: jest.fn() }),
  useIsFocused: () => true,
  useFocusEffect: (effect: () => void) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('../../components/AnchoredPanel', () => ({
  ...jest.requireActual('../../components/AnchoredPanel'),
  useAnchor: () => (button: unknown, open: (anchor: { top: number; right: number }) => void) =>
    button && open({ top: 0, right: 0 }),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
const api = { get: jest.mocked(apiClient.get), post: jest.mocked(apiClient.post) };
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
});
afterEach(async () => {
  await cleanup();
  client.clear();
});
const page = (results: unknown[]) => ({ data: { results, next: null, count: results.length } });
const OTHER_CODE = 'B'.repeat(43);
const PROFILE = {
  uuid: 'profile-one',
  email: 'member@example.test',
  fullName: 'Synthetic Profile Person',
  residentialAddress: 'Synthetic personal address',
  citizenshipCountryName: 'Australia',
  isIdVerified: true,
  dateJoined: '2026-10-01T00:00:00Z',
  lastLogin: '2026-10-30T00:00:00Z',
};
const OTHER_MEMBER = '25252525-2525-4525-8525-252525252525';
const PAST_RECORD = {
  ...MEMBER_RECORD,
  uuid: '13131313-1313-4313-8313-131313131313',
  company: { uuid: '14141414-1414-4414-8414-141414141414', name: 'Alpha Former Company', acn: '987654321' },
  member: '15151515-1515-4515-8515-151515151515',
  classes: [
    { ...MEMBER_RECORD.classes[0], uuid: '16161616-1616-4616-8616-161616161616', shares: '0', ceasedOn: '2026-03-31' },
  ],
  awards: [],
};
const OWNED_RECORD = {
  ...MEMBER_RECORD,
  ownership: {
    company: MEMBER_RECORD.company.uuid,
    companyName: MEMBER_RECORD.company.name,
    asAt: '2026-10-31T00:00:00Z',
    complete: true,
    issuedSupply: '40',
    totalHolders: 3,
    classes: [
      {
        uuid: MEMBER_RECORD.classes[0].uuid,
        name: MEMBER_RECORD.classes[0].name,
        symbol: MEMBER_RECORD.classes[0].symbol,
        tokenType: 'ordinary',
        issuedSupply: '40',
        initialized: true,
        totalHolders: 3,
        ownShares: '10',
        recordedAt: '2026-10-30T00:00:00Z',
        sequence: 1,
      },
    ],
  },
};
const ADMINISTERED = {
  uuid: '26262626-2626-4626-8626-262626262626',
  name: 'Synthetic Administered Company',
  isOwner: true,
  status: 'active',
  administrativeAccess: { capabilities: ['admin'], draftSetup: false },
};
const FOUNDERS = { uuid: '27272727-2727-4727-8727-272727272727', name: 'Founders', symbol: 'FND' };
const HOLDERS = Array.from({ length: 26 }, (_, index) => ({
  member: `holder-${index + 1}`,
  name: `Synthetic Holder ${index + 1}`,
  balance: index === 0 ? '5' : '1',
  percentage: '0',
}));
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const ADMINISTRATION: OwnCompanyAppointment = {
  uuid: '28282828-2828-4828-8828-282828282828',
  company: ADMINISTERED.uuid,
  companyName: ADMINISTERED.name,
  companyStatus: 'active',
  companyStatusDisplay: 'Active',
  capabilities: ['admin'],
  delegatableCapabilities: [],
  status: 'active',
  isEffective: true,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  source: 'legacy_owner',
  declarationText: null,
  declarationVersion: null,
  signupTerms: null,
};
const READER: CompanyTeamAppointment = {
  uuid: '29292929-2929-4929-8929-292929292929',
  company: ADMINISTERED.uuid,
  name: 'Synthetic Register Reader',
  email: 'reader@example.test',
  capabilities: ['read_register'],
  delegatableCapabilities: [],
  status: 'active',
  isEffective: true,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-10-20T00:00:00Z',
  source: 'invitation',
};
const REVOKED = { status: 'revoked' as const, revokedAt: '2026-11-03T00:00:00Z', isEffective: false };
const SECOND_ENTRY = {
  ...MEMBER_ENTRY,
  uuid: '19191919-1919-4919-8919-191919191919',
  sequence: 2,
  kind: 'TRANSFER',
  delta: '5',
};

it('associates a member by invitation code, switches to their company on Dashboard with its shared ownership, class and awards, keeps an interrupted acceptance recoverable across screens, opens its certificate records but none from another company for an ended association, reads no company register without register access, lists and opens an administered company’s overview with its paged shareholders, reads its team only with current administration and revokes only the confirmed appointment, refuses cached records after current read loss, and routes each notification to its page and an old certificate or publication notice nowhere', async () => {
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'investor' } };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  let ownRecord: OwnMemberRecord = OWNED_RECORD;
  let associated = false;
  let refused = false;
  let administered = false;
  let appointed = false;
  let revoked = false;
  api.get.mockReset().mockImplementation(async (url, config) => {
    if (url === '/api/user-preferences/') return { data: preferences };
    if (url === USER_PROFILE_ENDPOINTS.BASE) return page([PROFILE]);
    if (url === COMPANY_ENDPOINTS.BASE) return page(administered ? [ADMINISTERED] : []);
    if (url === APPOINTMENTS) return page(appointed ? [ADMINISTRATION] : []);
    if (url === `${APPOINTMENTS}team/`) return { data: [revoked ? { ...READER, ...REVOKED } : READER] };
    if (url === '/api/v1/company-authority/invitations/') return page([]);
    if (url === URLS.REGISTER) return page([{ uuid: FOUNDERS.uuid, companyUuid: ADMINISTERED.uuid }]);
    if (url === URLS.OWNERSHIP) {
      const founders = { ...FOUNDERS, tokenType: 'ordinary', initialized: true, recordedAt: '2026-11-01T00:00:00Z' };
      const totals = { issuedSupply: '30', totalHolders: 26 };
      const classes = [{ ...founders, ...totals, sequence: 1 }];
      return { data: { company: ADMINISTERED.uuid, asAt: '2026-11-01T00:00:00Z', complete: true, ...totals, classes } };
    }
    if (url === URLS.OWNERSHIP_HOLDERS(FOUNDERS.uuid)) {
      const shown = (config?.params as { page: number }).page;
      const results = HOLDERS.slice((shown - 1) * 25, shown * 25);
      return { data: { count: 26, token: FOUNDERS.uuid, sequence: 1, issuedSupply: '30', results } };
    }
    if (url === URLS.MEMBER_ASSOCIATIONS) return page([]);
    if (url === URLS.MEMBER_RECORDS) {
      if (refused) throw Object.assign(new Error('Current member access refused'), { response: { status: 404 } });
      return page(associated ? [PAST_RECORD, ownRecord] : []);
    }
    if (url === URLS.MEMBER_RECORD(MEMBER_RECORD.uuid)) return { data: ownRecord };
    if (url === URLS.MEMBER_ENTRIES(MEMBER_RECORD.uuid))
      return { data: { entries: [{ ...MEMBER_ENTRY, companyEventOn: null }, SECOND_ENTRY] } };
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockReset().mockImplementation(async (url, value) => {
    const body = value as Record<string, string>;
    if (url === URLS.MEMBER_INVITATION_PREVIEW) {
      const other = body.code === OTHER_CODE;
      return {
        data: {
          company: { uuid: MEMBER_RECORD.company.uuid, name: MEMBER_RECORD.company.name },
          member: { uuid: other ? OTHER_MEMBER : MEMBER_RECORD.member, name: MEMBER_RECORD.name },
          intendedEmail: 'member@example.test',
          acceptanceDeadline: '2026-11-30T00:00:00Z',
          status: associated && !other ? 'accepted' : 'pending',
        },
      };
    }
    if (url === URLS.MEMBER_INVITATION_ACCEPT) {
      associated = true;
      if (
        body.code === OTHER_CODE &&
        api.post.mock.calls.filter(
          ([target, sent]) => target === url && (sent as Record<string, string>).code === OTHER_CODE,
        ).length === 1
      )
        throw new Error('Synthetic interrupted acceptance receipt');
      return {
        data: {
          uuid: MEMBER_RECORD.uuid,
          company: MEMBER_RECORD.company.uuid,
          member: MEMBER_RECORD.member,
          userAccount: body.userAccount,
          invitation: 'invite-one',
          current: true,
        },
      };
    }
    if (url === `${APPOINTMENTS}${READER.uuid}/revoke/`) {
      revoked = true;
      const { name: _name, email: _email, ...appointment } = READER;
      return {
        data: {
          ...appointment,
          ...REVOKED,
          companyName: ADMINISTERED.name,
          companyStatus: 'active',
          companyStatusDisplay: 'Active',
          declarationText: COMPANY_AUTHORITY_DECLARATION,
          declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION,
          signupTerms: null,
        },
      };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <MemberRecordsProvider>{children}</MemberRecordsProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
  const dashboard = <DashboardScreen route={{ key: 'dashboard', name: 'Dashboard', params: undefined }} />;
  const view = await render(dashboard, { wrapper });
  await fireEvent.press(await screen.findByRole('button', { name: 'Accept invitation' }));
  expect(mockNavigate).toHaveBeenCalledWith('Invitation');
  await view.rerender(<InvitationScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('Link or code from the email'),
    ` https://ledova.example/member-invitation#${MEMBER_CODE} `,
  );
  expect(await screen.findByText(MEMBER_RECORD.company.name)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Accept invitation' }));
  expect(await screen.findByText('Invitation accepted. Your company records are available.')).toBeTruthy();
  await view.rerender(dashboard);
  expect(await screen.findByLabelText('Your issued shares: 0')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Switch company' }));
  expect(screen.getByRole('button', { name: `${PAST_RECORD.company.name}, Member` })).toBeSelected();
  await fireEvent.press(screen.getByRole('button', { name: `${MEMBER_RECORD.company.name}, Member` }));
  expect(await screen.findByLabelText('Issued shares: 40')).toBeTruthy();
  expect(screen.queryByLabelText('Your companies')).toBeNull();
  expect(screen.getByLabelText('Your shares: 10')).toBeTruthy();
  expect(screen.getByLabelText('Current shareholders: 3')).toBeTruthy();
  expect(screen.getByText('100.00%')).toBeTruthy();
  expect(screen.getByText('You: 10')).toBeTruthy();
  await view.rerender(<InvitationScreen />);
  await fireEvent.changeText(screen.getByLabelText('Link or code from the email'), OTHER_CODE);
  const acceptOther = await screen.findByRole('button', { name: 'Accept invitation' });
  expect(screen.queryByText('Invitation accepted. Your company records are available.')).toBeNull();
  await fireEvent.press(acceptOther);
  await screen.findByRole('button', { name: 'Retry original member action' });
  await view.rerender(
    <CertificatesScreen route={{ key: 'past', name: 'Certificates', params: { record: PAST_RECORD.uuid } }} />,
  );
  expect(screen.getByText('Retry or finish your pending request before opening this company.')).toBeTruthy();
  expect(screen.queryByText('Certificate records')).toBeNull();
  await view.rerender(dashboard);
  await fireEvent.press(await screen.findByRole('button', { name: 'Retry original member action' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry original member action' })).toBeNull());
  const acceptances = api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_INVITATION_ACCEPT);
  expect(acceptances).toHaveLength(3);
  expect(acceptances[1][1]).toEqual(acceptances[2][1]);
  await fireEvent.press(
    await screen.findByRole('button', {
      name: 'Explore Ordinary (ORD), 40 issued shares, 100.00% of company issued shares, You: 10',
    }),
  );
  expect(screen.getByLabelText('Your share of this class: 25.00%')).toBeTruthy();
  const record = MEMBER_RECORD.uuid;
  const token = MEMBER_RECORD.classes[0].uuid;
  await fireEvent.press(screen.getByRole('button', { name: 'Certificates' }));
  expect(mockNavigate).toHaveBeenCalledWith('Certificates', { record, token });
  const certificatesPage = (
    <CertificatesScreen route={{ key: 'certificates', name: 'Certificates', params: { record, token } }} />
  );
  ownRecord = {
    ...OWNED_RECORD,
    awards: [
      {
        ...MEMBER_RECORD.awards[0],
        shares: '20',
        vestedShares: '6',
        issuedShares: '1',
        availableShares: '2',
        endedUnvestedShares: '4',
        endedVestedShares: '3',
        unvestedRemainingShares: '10',
        remainingUnissuedShares: '12',
        vestings: [{ ...MEMBER_RECORD.awards[0].vestings[0], shares: '8' }],
        ends: [
          {
            uuid: 'own-end',
            unvestedShares: '4',
            vestedShares: '3',
            companyEventOn: '2026-10-03',
            reason: 'Company selected reduction',
            createdAt: '2026-10-05T00:00:00Z',
          },
        ],
        vestingReversals: [
          {
            uuid: 'own-reversal',
            vesting: MEMBER_RECORD.awards[0].vestings[0].uuid,
            reversedShares: '2',
            companyEventOn: '2026-10-04',
            reason: 'Correct recorded quantity',
            createdAt: '2026-10-05T00:00:00Z',
          },
        ],
      },
    ],
  };
  await act(async () => screen.getByTestId('dashboard-scroll').props.refreshControl.props.onRefresh());
  await screen.findByLabelText('Vested rights ended: 3 shares');
  expect(screen.getByText('20 shares promised')).toBeTruthy();
  expect(screen.getByLabelText('Issued from award: 1 share')).toBeTruthy();
  expect(screen.getByLabelText('Vested, awaiting issue: 2 shares')).toBeTruthy();
  expect(screen.getByLabelText('Unvested: 10 shares')).toBeTruthy();
  expect(screen.getByLabelText('Unvested rights ended: 4 shares')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Show award details' }));
  expect(screen.getByText('2 October 2026 · 8 recorded vested')).toBeTruthy();
  expect(
    screen.getByText('3 October 2026 · 4 unvested and 3 vested unissued rights ended · Company selected reduction'),
  ).toBeTruthy();
  expect(
    screen.getByText('4 October 2026 · 2 vesting reversed · from 8 vested 2 October 2026 · Correct recorded quantity'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Download.*(entitlement|correction)/ })).toBeNull();
  ownRecord = MEMBER_RECORD;
  await view.rerender(certificatesPage);
  expect(await screen.findByText('Transfer · ORD · entry 2')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Filters|Request certificate|Withdraw request|Share PDF/ })).toBeNull();
  await view.rerender(
    <CertificatesScreen
      route={{ key: 'ended', name: 'Certificates', params: { record: 'ended-association', token } }}
    />,
  );
  expect(await screen.findByText('This company no longer records you as a member.')).toBeTruthy();
  expect(screen.queryByText('Certificate records')).toBeNull();
  await view.rerender(certificatesPage);
  await act(async () => screen.getByTestId('certificates-scroll').props.refreshControl.props.onRefresh());
  expect(await screen.findByText('Transfer · ORD · entry 2')).toBeTruthy();
  const registerReads = () =>
    api.get.mock.calls.filter(([url]) => url === URLS.REGISTER || url === URLS.OWNERSHIP || url.endsWith('-holders/'));
  expect(registerReads()).toHaveLength(0);
  administered = true;
  await act(async () => {
    await client.refetchQueries({
      queryKey: ownershipCompaniesKey({ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }),
    });
  });
  await view.rerender(dashboard);
  await fireEvent.press(await screen.findByRole('button', { name: 'Switch company' }));
  expect(screen.getByRole('button', { name: `${PAST_RECORD.company.name}, Member` })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: `${ADMINISTERED.name}, Company administrator` }));
  expect(await screen.findByLabelText('Issued shares: 30')).toBeTruthy();
  expect(screen.getByText('Company administrator')).toBeTruthy();
  expect(screen.getByLabelText('Current shareholders: 26')).toBeTruthy();
  expect(screen.queryByLabelText(/^Your shares/)).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Explore Founders (FND), 30 issued shares, 100.00% of company issued shares' }),
  );
  expect(
    await screen.findByRole('button', { name: 'Highlight Synthetic Holder 1’s holding, 5 shares, 16.67% of FND' }),
  ).toBeTruthy();
  expect(screen.getByText('1–25 of 26 shareholders')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Next (Class shareholders)' }));
  expect(await screen.findByText('26–26 of 26 shareholders')).toBeTruthy();
  expect(
    registerReads().every(
      ([url, config]) =>
        url === URLS.OWNERSHIP_HOLDERS(FOUNDERS.uuid) ||
        Object.values((config as { params: object }).params).includes(ADMINISTERED.uuid),
    ),
  ).toBe(true);
  await view.rerender(<TeamScreen />);
  expect(
    await screen.findByText(
      'Current personal Manage company information and team authority is required to read or change other appointments.',
    ),
  ).toBeTruthy();
  expect(api.get.mock.calls.filter(([url]) => url === `${APPOINTMENTS}team/`)).toHaveLength(0);
  appointed = true;
  await act(async () => screen.getByTestId('team-scroll').props.refreshControl.props.onRefresh());
  await fireEvent.press(await screen.findByRole('button', { name: /^Revoke appointment \(Synthetic Register Reader/ }));
  const revocations = () => api.post.mock.calls.filter(([url]) => url.endsWith('/revoke/'));
  expect(revocations()).toHaveLength(0);
  await fireEvent.press(screen.getByRole('button', { name: 'Permanently revoke appointment' }));
  expect(revocations()).toEqual([[`${APPOINTMENTS}${READER.uuid}/revoke/`, {}, expect.anything()]]);
  expect(
    await screen.findByRole('button', { name: /^Revoke appointment \(Synthetic Administered Company/ }),
  ).toBeTruthy();
  expect(await screen.findByText(/^Revoked /)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Revoke appointment \(Synthetic Register Reader/ })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: /^Revoke appointment \(Synthetic Administered Company/ }));
  expect(screen.getByText(/^Permanently remove your appointment for Synthetic Administered Company\?/)).toBeTruthy();
  expect(revocations()).toHaveLength(1);
  await view.rerender(certificatesPage);
  expect(await screen.findByText('Transfer · ORD · entry 2')).toBeTruthy();
  refused = true;
  await act(async () => {
    await client.refetchQueries({
      queryKey: ['member-records', 'profile-one', 'account-one', getSessionEpoch()],
      exact: true,
    });
  });
  await waitFor(() => expect(screen.queryByText('Certificate records')).toBeNull());
  expect(screen.queryByText('Transfer · ORD · entry 2')).toBeNull();
  expect(destinationOf({ type: 'publication', event: 'published', kind: 'meeting_notice' })).toBeUndefined();
  expect(destinationOf({ type: 'certificate', event: 'ready', company: MEMBER_RECORD.company.uuid })).toBeUndefined();
  const award = 'f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5';
  const vested = { type: 'award', event: 'vested', record: MEMBER_RECORD.uuid, award };
  expect(destinationOf(vested)).toEqual({
    screen: 'Dashboard',
    params: { record: MEMBER_RECORD.uuid, award },
    pop: true,
  });
  expect(destinationOf({ ...vested, award: undefined })).toBeUndefined();
});
