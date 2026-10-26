import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  PUBLICATION_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
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
import { DocumentsScreen } from '../documents/DocumentsScreen';
import { AwardScreen } from './AwardScreen';
import { ClassScreen } from './ClassScreen';
import { CompanyScreen } from './CompanyScreen';
import { DetailsScreen } from './DetailsScreen';
import { HoldingsScreen } from './HoldingsScreen';
import { MemberRecordsProvider } from './MemberRecordsProvider';

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
        jest.requireActual<{ sha256: (value: Uint8Array) => Uint8Array }>('@noble/hashes/sha256').sha256(bytes),
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
const SECOND_ENTRY = {
  ...MEMBER_ENTRY,
  uuid: '19191919-1919-4919-8919-191919191919',
  sequence: 2,
  kind: 'TRANSFER',
  delta: '5',
};

it('associates a member by invitation code, opens their company, award, details and share history from Holdings, keeps one exact request recoverable across screens and refuses cached records and a late action after current read loss', async () => {
  let keys = 0;
  jest
    .mocked(Crypto.randomUUID)
    .mockImplementation(() => `00000000-0000-4000-8000-${String(++keys).padStart(12, '0')}`);
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'investor' } };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  let ownRecord = MEMBER_RECORD;
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
  const company = <CompanyScreen route={{ key: 'company', name: 'Company', params: { record: MEMBER_RECORD.uuid } }} />;
  const view = await render(<HoldingsScreen />, { wrapper });
  await fireEvent.changeText(await screen.findByLabelText('Member invitation code'), MEMBER_CODE);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Accept access using my signed-in account' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Accept member invitation' }));
  const card = await screen.findByRole('button', {
    name: `${MEMBER_RECORD.company.name}: Ordinary 10, Award 2 of 5 vested`,
  });
  expect(screen.getByRole('button', { name: 'Past holdings (1)' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: new RegExp(`^${PAST_RECORD.company.name}`) })).toBeNull();
  await fireEvent.press(card);
  expect(mockNavigate).toHaveBeenCalledWith('Company', { record: MEMBER_RECORD.uuid });
  expect(screen.getByText('1 company · 1 share class · 1 award')).toBeTruthy();
  expect(screen.getByText('2 of 5 vested')).toBeTruthy();
  const record = MEMBER_RECORD.uuid;
  const award = MEMBER_RECORD.awards[0].uuid;
  const token = MEMBER_RECORD.classes[0].uuid;
  const awardPage = <AwardScreen route={{ key: 'award', name: 'Award', params: { record, award } }} />;
  const classPage = <ClassScreen route={{ key: 'class', name: 'Class', params: { record, token } }} />;
  const details = <DetailsScreen route={{ key: 'details', name: 'Details', params: { record } }} />;
  await view.rerender(company);
  await screen.findByRole('header', { name: MEMBER_RECORD.company.name });
  await fireEvent.press(screen.getByRole('button', { name: 'Employee award, 2 of 5 vested' }));
  expect(mockNavigate).toHaveBeenCalledWith('Award', { record, award });
  await fireEvent.press(screen.getByRole('button', { name: 'Ordinary shares, 10' }));
  expect(mockNavigate).toHaveBeenCalledWith('Class', { record, token });
  await fireEvent.press(screen.getByRole('button', { name: `Your details: ${MEMBER_RECORD.name}` }));
  expect(mockNavigate).toHaveBeenCalledWith('Details', { record });
  ownRecord = {
    ...MEMBER_RECORD,
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
  await view.rerender(awardPage);
  await act(async () => screen.getByTestId('award-scroll').props.refreshControl.props.onRefresh());
  await screen.findByLabelText('Rights ended: 7');
  expect(screen.getByLabelText('6 of 20 vested')).toBeTruthy();
  expect(screen.getByLabelText('Issued to you: 1')).toBeTruthy();
  expect(screen.getByLabelText('Vested, not yet issued: 2')).toBeTruthy();
  expect(screen.getByLabelText('Still to vest: 10')).toBeTruthy();
  expect(
    screen.getAllByLabelText(/^(Vested|Rights ended|Vesting reversed), \d/).map((row) => row.props.accessibilityLabel),
  ).toEqual([
    'Vesting reversed, 4 October 2026, 2, Corrects the vesting of 2 October 2026, Correct recorded quantity',
    'Rights ended, 3 October 2026, 7, 4 unvested and 3 vested not yet issued, Company selected reduction',
    'Vested, 2 October 2026, 8',
  ]);
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
  await view.rerender(<HoldingsScreen />);
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
});
