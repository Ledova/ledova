import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  PUBLICATION_ENDPOINTS,
  PUBLICATION_NOTICE,
  USER_PREFERENCES_QUERY_KEY,
  type OwnMemberRecord,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Crypto from 'expo-crypto';
import * as Sharing from 'expo-sharing';
import type { AxiosInstance } from 'axios';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { MEMBER_CODE, MEMBER_ENTRY, MEMBER_RECORD } from '../../../../packages/shared/tests/fixtures/member-access';
import { FULFILLED_CERTIFICATE, MEMBER_PDF } from '../../../../packages/shared/tests/fixtures/register-outputs';
import { cache, resetFiles } from '../../testSupport/documentFiles';
import { destinationOf } from '../../components/notifications/NotificationsModal';
import { DocumentsScreen } from '../documents/DocumentsScreen';
import { ClassScreen } from './ClassScreen';
import { DashboardScreen } from './DashboardScreen';
import { DetailsScreen } from './DetailsScreen';
import { InvitationScreen } from './InvitationScreen';
import { MemberRecordsProvider } from './MemberRecordsProvider';
import { YourDetailsScreen } from './YourDetailsScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, setOptions: jest.fn(), setParams: jest.fn() }),
  useIsFocused: () => true,
  useFocusEffect: (effect: () => void) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(),
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: jest.fn(
    async (_algorithm: string, bytes: Uint8Array) =>
      Uint8Array.from(
        jest
          .requireActual<{
            createHash: (name: string) => { update: (value: Uint8Array) => { digest: () => Uint8Array } };
          }>('crypto')
          .createHash('sha256')
          .update(bytes)
          .digest(),
      ).buffer,
  ),
}));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
const api = { get: jest.mocked(apiClient.get), post: jest.mocked(apiClient.post) };
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
});
let release: (() => void) | undefined;
afterEach(async () => {
  await act(async () => release?.());
  release = undefined;
  await cleanup();
  client.clear();
  resetFiles();
});
const page = (results: unknown[]) => ({ data: { results, next: null, count: results.length } });
const OTHER_CODE = 'B'.repeat(43);
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
const OPEN_REQUEST = {
  ...FULFILLED_CERTIFICATE,
  uuid: '17171717-1717-4717-8717-171717171717',
  status: 'requested',
  fulfilment: null,
  createdAt: '2026-10-02T00:00:00Z',
};
const WITHDRAWN_REQUEST = {
  ...OPEN_REQUEST,
  uuid: '18181818-1818-4818-8818-181818181818',
  status: 'withdrawn',
  createdAt: '2026-10-03T00:00:00Z',
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
const SECOND_ENTRY = {
  ...MEMBER_ENTRY,
  uuid: '19191919-1919-4919-8919-191919191919',
  sequence: 2,
  kind: 'TRANSFER',
  delta: '5',
};

it('associates a member by invitation code, switches to their company on Dashboard with its shared ownership, class and awards, opens details and share history, keeps one exact request recoverable across screens and refuses cached records and a late action after current read loss', async () => {
  let keys = 0;
  jest
    .mocked(Crypto.randomUUID)
    .mockImplementation(() => `00000000-0000-4000-8000-${String(++keys).padStart(12, '0')}`);
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'investor' } };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  let ownRecord: OwnMemberRecord = OWNED_RECORD;
  let associated = false;
  let refused = false;
  let particulars: Record<string, unknown>[] = [];
  let certificates: Record<string, unknown>[] = [FULFILLED_CERTIFICATE, OPEN_REQUEST, WITHDRAWN_REQUEST];
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/user-preferences/') return { data: preferences };
    if (url === URLS.MEMBER_ASSOCIATIONS) return page([]);
    if (url === URLS.MEMBER_RECORDS) {
      if (refused) throw Object.assign(new Error('Current member access refused'), { response: { status: 404 } });
      return page(associated ? [PAST_RECORD, ownRecord] : []);
    }
    if (url === URLS.MEMBER_RECORD(MEMBER_RECORD.uuid)) return { data: ownRecord };
    if (url === URLS.MEMBER_ENTRIES(MEMBER_RECORD.uuid))
      return { data: { entries: [{ ...MEMBER_ENTRY, companyEventOn: null }, SECOND_ENTRY] } };
    if (url === URLS.MEMBER_PARTICULARS_REQUESTS) return page(particulars);
    if (url === URLS.MEMBER_CERTIFICATE_REQUESTS) return page(certificates);
    if (url === URLS.MEMBER_CERTIFICATE_FILE(FULFILLED_CERTIFICATE.uuid))
      return { data: MEMBER_PDF.buffer, headers: { 'content-type': 'application/pdf' } };
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
    if (url === URLS.MEMBER_PARTICULARS_REQUESTS) {
      const request = {
        ...body,
        uuid: body.operationId,
        company: MEMBER_RECORD.company.uuid,
        member: MEMBER_RECORD.member,
        status: 'submitted',
        change: null,
      };
      particulars = [request];
      if (api.post.mock.calls.filter(([target]) => target === url).length === 1)
        throw new Error('Synthetic interrupted request receipt');
      return { data: request };
    }
    if (url === URLS.MEMBER_CERTIFICATE_REQUESTS) {
      const request = {
        ...body,
        uuid: body.operationId,
        company: MEMBER_RECORD.company.uuid,
        member: MEMBER_RECORD.member,
        token: MEMBER_RECORD.classes[0].uuid,
        status: 'requested',
      };
      certificates = [request];
      return new Promise((resolve) => {
        release = () => resolve({ data: request });
      });
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
  await fireEvent.press(await screen.findByRole('button', { name: 'Accept an invitation' }));
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
  expect(screen.getByLabelText('Your shares: 10')).toBeTruthy();
  expect(screen.getByLabelText('Current shareholders: 3')).toBeTruthy();
  expect(screen.getByText('100.00%')).toBeTruthy();
  expect(screen.getByText('You: 10')).toBeTruthy();
  await view.rerender(<InvitationScreen />);
  await fireEvent.changeText(screen.getByLabelText('Link or code from the email'), OTHER_CODE);
  expect(await screen.findByRole('button', { name: 'Accept invitation' })).toBeTruthy();
  expect(screen.queryByText('Invitation accepted. Your company records are available.')).toBeNull();
  await view.rerender(dashboard);
  await fireEvent.press(
    await screen.findByRole('button', {
      name: 'Explore Ordinary (ORD), 40 issued shares, 100.00% of company issued shares, You: 10',
    }),
  );
  expect(screen.getByLabelText('Your share of this class: 25.00%')).toBeTruthy();
  const record = MEMBER_RECORD.uuid;
  const token = MEMBER_RECORD.classes[0].uuid;
  await fireEvent.press(screen.getByRole('button', { name: 'Certificates and history' }));
  expect(mockNavigate).toHaveBeenCalledWith('Class', { record, token });
  const classPage = <ClassScreen route={{ key: 'class', name: 'Class', params: { record, token } }} />;
  const details = <DetailsScreen route={{ key: 'details', name: 'Details', params: { record } }} />;
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
  await view.rerender(classPage);
  await fireEvent.press(
    await screen.findByRole('button', { name: /^Entry 1: Issue \+10, Not recorded, certificate Requested$/ }),
  );
  await fireEvent.press(screen.getByRole('button', { name: `Share certificate PDF ${FULFILLED_CERTIFICATE.uuid}` }));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      `${cache}ledova-document-views-v1/member-certificate-${FULFILLED_CERTIFICATE.uuid}.pdf`,
      { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' },
    ),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Close dialog' }));
  await view.rerender(details);
  expect(await screen.findByText(MEMBER_RECORD.name)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Requested name'), 'Requested Member Name');
  await fireEvent.changeText(screen.getByLabelText('Requested residential address'), 'Requested synthetic address');
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Share these particulars with this company for review' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Send particulars request' }));
  await screen.findByRole('button', { name: 'Retry original member action' });
  expect(screen.getByLabelText('Requested name')).toBeDisabled();
  await view.rerender(dashboard);
  expect(await screen.findByRole('button', { name: 'Retry original member action' })).toBeEnabled();
  expect(screen.getByText(`Your request to ${MEMBER_RECORD.company.name} is waiting to be retried.`)).toBeTruthy();
  await view.rerender(<DetailsScreen route={{ key: 'past', name: 'Details', params: { record: PAST_RECORD.uuid } }} />);
  expect(screen.getByText('Retry or finish your pending request before opening this company.')).toBeTruthy();
  expect(screen.queryByText(MEMBER_RECORD.residentialAddress)).toBeNull();
  await view.rerender(details);
  expect(screen.getByLabelText('Requested name')).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry original member action' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry original member action' })).toBeNull());
  const commands = api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_PARTICULARS_REQUESTS);
  expect(commands).toHaveLength(2);
  expect(commands[0][1]).toEqual(commands[1][1]);
  expect((await screen.findByLabelText('Requested name')).props.value).toBe('Requested Member Name');
  await view.rerender(classPage);
  await act(async () => screen.getByTestId('class-scroll').props.refreshControl.props.onRefresh());
  await fireEvent.press(await screen.findByRole('button', { name: /^Entry 2:/ }));
  await fireEvent.press(screen.getByRole('button', { name: 'Request certificate' }));
  await waitFor(() => expect(typeof release).toBe('function'));
  refused = true;
  await act(async () => {
    await client.refetchQueries({
      queryKey: ['member-records', 'profile-one', 'account-one', getSessionEpoch()],
      exact: true,
    });
  });
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Entry 2:/ })).toBeNull());
  expect(screen.queryByRole('button', { name: 'Request certificate' })).toBeNull();
  expect(screen.queryByText('History')).toBeNull();
  await act(async () => release!());
  expect(screen.queryByRole('button', { name: /^Entry 2:/ })).toBeNull();
  expect(api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_CERTIFICATE_REQUESTS)).toHaveLength(1);
});

it('lists certificates from every member association in Documents, refuses a list holding another association and shares one through its own record', async () => {
  const SECOND = {
    ...MEMBER_RECORD,
    uuid: 'e1e1e1e1-e1e1-4e1e-8e1e-e1e1e1e1e1e1',
    member: 'e2e2e2e2-e2e2-4e2e-8e2e-e2e2e2e2e2e2',
    company: { uuid: 'e3e3e3e3-e3e3-4e3e-8e3e-e3e3e3e3e3e3', name: 'Second Holding Company Pty Ltd', acn: '111222333' },
    classes: [{ ...MEMBER_RECORD.classes[0], uuid: 'e4e4e4e4-e4e4-4e4e-8e4e-e4e4e4e4e4e4', name: 'Preference' }],
    awards: [],
  };
  const FOREIGN = {
    ...FULFILLED_CERTIFICATE,
    uuid: 'e5e5e5e5-e5e5-4e5e-8e5e-e5e5e5e5e5e5',
    association: 'e6e6e6e6-e6e6-4e6e-8e6e-e6e6e6e6e6e6',
    company: SECOND.company.uuid,
    member: SECOND.member,
    token: SECOND.classes[0].uuid,
  };
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'investor' } };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  jest.mocked(Sharing.shareAsync).mockClear();
  api.get.mockReset().mockImplementation(async (url, config) => {
    const association = (config as { params?: { association?: string } } | undefined)?.params?.association;
    if (url === '/api/user-preferences/') return { data: preferences };
    if (
      url === URLS.MEMBER_ASSOCIATIONS ||
      url === PUBLICATION_ENDPOINTS.BASE ||
      url === URLS.MEMBER_PARTICULARS_REQUESTS
    )
      return page([]);
    if (url === URLS.MEMBER_RECORDS) return page([MEMBER_RECORD, SECOND]);
    if (url === URLS.MEMBER_RECORD(MEMBER_RECORD.uuid)) return { data: MEMBER_RECORD };
    if (url === URLS.MEMBER_ENTRIES(MEMBER_RECORD.uuid))
      return { data: { entries: [{ ...MEMBER_ENTRY, companyEventOn: null }] } };
    if (url === URLS.MEMBER_CERTIFICATE_REQUESTS)
      return page(
        association === MEMBER_RECORD.uuid
          ? [FULFILLED_CERTIFICATE]
          : association === SECOND.uuid
            ? [FOREIGN]
            : [FULFILLED_CERTIFICATE, FOREIGN],
      );
    if (url === URLS.MEMBER_CERTIFICATE_FILE(FULFILLED_CERTIFICATE.uuid))
      return { data: MEMBER_PDF.buffer, headers: { 'content-type': 'application/pdf' } };
    throw new Error(`Unexpected GET ${url}`);
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <MemberRecordsProvider>{children}</MemberRecordsProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
  const view = await render(<DocumentsScreen route={{ key: 'documents', name: 'Documents', params: undefined }} />, {
    wrapper,
  });
  const own = `${MEMBER_RECORD.company.name}: Ordinary · 10, Issue · Not recorded, Ready`;
  expect(await screen.findByRole('button', { name: own })).toBeTruthy();
  expect(
    await screen.findByText('Some certificates could not be loaded. Refresh before relying on this list.'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: new RegExp(`^${SECOND.company.name}:`) })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: SECOND.company.name }));
  expect(screen.queryByRole('button', { name: own })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'All' }));
  await fireEvent.press(screen.getByRole('button', { name: own }));
  await fireEvent.press(
    await screen.findByRole('button', { name: `Share certificate PDF ${FULFILLED_CERTIFICATE.uuid}` }),
  );
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      `${cache}ledova-document-views-v1/member-certificate-${FULFILLED_CERTIFICATE.uuid}.pdf`,
      { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' },
    ),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
  await fireEvent.press(screen.getByRole('button', { name: SECOND.company.name }));
  await view.rerender(<DocumentsScreen route={{ key: 'documents', name: 'Documents', params: { show: 'notices' } }} />);
  expect(await screen.findByText('No notices yet.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'All', selected: true })).toBeTruthy();
  const notice = { type: PUBLICATION_NOTICE };
  expect(destinationOf(notice)).toEqual({ screen: 'Documents', params: { show: 'notices' } });
  expect(destinationOf(notice)).not.toBe(destinationOf(notice));
  const award = 'f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5';
  const vested = { type: 'award', event: 'vested', record: MEMBER_RECORD.uuid, award };
  expect(destinationOf(vested)).toEqual({
    screen: 'Dashboard',
    params: { record: MEMBER_RECORD.uuid, award },
    pop: true,
  });
  expect(destinationOf({ ...vested, award: undefined })).toBeUndefined();
});

it('sends one particulars change to every company from Your details, skipping a company where it already waits, keeping an interrupted request recoverable and stopping at a refusal', async () => {
  const SECOND = {
    ...MEMBER_RECORD,
    uuid: 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
    member: 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2',
    company: { uuid: 'f3f3f3f3-f3f3-4f3f-8f3f-f3f3f3f3f3f3', name: 'Zeta Holding Company Pty Ltd', acn: '444555666' },
    awards: [],
  };
  const THIRD = {
    ...MEMBER_RECORD,
    uuid: 'f6f6f6f6-f6f6-4f6f-8f6f-f6f6f6f6f6f6',
    member: 'f7f7f7f7-f7f7-4f7f-8f7f-f7f7f7f7f7f7',
    company: { uuid: 'f8f8f8f8-f8f8-4f8f-8f8f-f8f8f8f8f8f8', name: 'Zulu Ventures Pty Ltd', acn: '777888999' },
    awards: [],
  };
  const NAME = 'Requested Member Name';
  const ADDRESS = 'Requested synthetic address';
  const WAITING = {
    uuid: 'f4f4f4f4-f4f4-4f4f-8f4f-f4f4f4f4f4f4',
    association: MEMBER_RECORD.uuid,
    company: MEMBER_RECORD.company.uuid,
    member: MEMBER_RECORD.member,
    name: NAME,
    residentialAddress: ADDRESS,
    status: 'submitted',
    change: null,
    requestedBy: 1,
    createdAt: '2026-10-20T00:00:00Z',
  };
  let second: Record<string, unknown>[] = [];
  let firstReads = 0;
  let keys = 0;
  jest
    .mocked(Crypto.randomUUID)
    .mockImplementation(() => `00000000-0000-4000-8000-${String(++keys).padStart(12, '0')}`);
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'investor' } };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  api.get.mockReset().mockImplementation(async (url, config) => {
    const association = (config as { params?: { association?: string } } | undefined)?.params?.association;
    if (url === '/api/user-preferences/') return { data: preferences };
    if (url === URLS.MEMBER_RECORDS) return page([MEMBER_RECORD, SECOND, THIRD]);
    if (url === URLS.MEMBER_RECORD(MEMBER_RECORD.uuid)) return { data: MEMBER_RECORD };
    if (url === URLS.MEMBER_RECORD(SECOND.uuid)) return { data: SECOND };
    if (url === URLS.MEMBER_RECORD(THIRD.uuid)) return { data: THIRD };
    if (url === URLS.MEMBER_PARTICULARS_REQUESTS && association === MEMBER_RECORD.uuid) {
      if (++firstReads === 1) throw new Error('Synthetic interrupted particulars read');
      return page([WAITING]);
    }
    if (url === URLS.MEMBER_PARTICULARS_REQUESTS) return page(association === SECOND.uuid ? second : []);
    if (url === URLS.MEMBER_CERTIFICATE_REQUESTS) return page([]);
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockReset().mockImplementation(async (url, value) => {
    const body = value as Record<string, string>;
    if (url === URLS.MEMBER_PARTICULARS_REQUESTS && body.association === THIRD.uuid)
      throw Object.assign(new Error('Synthetic refusal'), { response: { status: 400 } });
    if (url === URLS.MEMBER_PARTICULARS_REQUESTS) {
      const request = {
        ...body,
        uuid: body.operationId,
        company: SECOND.company.uuid,
        member: SECOND.member,
        status: 'submitted',
        change: null,
        requestedBy: 1,
        createdAt: '2026-10-27T00:00:00Z',
      };
      second = [request];
      if (api.post.mock.calls.filter(([target]) => target === url).length === 1)
        throw new Error('Synthetic interrupted request receipt');
      return { data: request };
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
  await render(<YourDetailsScreen />, { wrapper });
  expect(
    await screen.findByText('Some change requests could not be loaded. Refresh before relying on this list.'),
  ).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Change at every company' }));
  await fireEvent.changeText(screen.getByLabelText('Requested name'), NAME);
  await fireEvent.changeText(screen.getByLabelText('Requested residential address'), ADDRESS);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Share these particulars with each company for review' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Send to 3 companies' }));
  expect(await screen.findByText(/^Stopped at Zeta Holding Company\./)).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Continue with the remaining companies' })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry original member action' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry original member action' })).toBeNull());
  await fireEvent.press(screen.getByRole('button', { name: 'Continue with the remaining companies' }));
  expect(await screen.findByText(/^Stopped at Zulu Ventures\. Continue with the others\./)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Continue with the remaining companies' }));
  expect(await screen.findByText('This change is now waiting or recorded at 2 of 3 companies.')).toBeTruthy();
  const posts = api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_PARTICULARS_REQUESTS);
  expect(posts.map(([, body]) => (body as { association: string }).association)).toEqual([
    SECOND.uuid,
    SECOND.uuid,
    THIRD.uuid,
  ]);
  expect(posts[0][1]).toEqual(posts[1][1]);
  expect(posts[0][1]).toMatchObject({ name: NAME, residentialAddress: ADDRESS });
  expect(
    screen.getByRole('button', { name: new RegExp(`^${MEMBER_RECORD.company.name}: .*, change waiting$`) }),
  ).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Done' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Change at every company' }));
  await fireEvent.changeText(screen.getByLabelText('Requested name'), NAME);
  await fireEvent.changeText(screen.getByLabelText('Requested residential address'), ADDRESS);
  expect(screen.getByRole('button', { name: 'Send to 1 company' })).toBeTruthy();
});
