import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
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
import { CompanyScreen } from './CompanyScreen';
import { HoldingsScreen } from './HoldingsScreen';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate }),
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

it('associates a member by invitation code, opens their company from Holdings, recovers one exact request and refuses cached records and a late action after current read loss', async () => {
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
  let certificates: Record<string, unknown>[] = [FULFILLED_CERTIFICATE];
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/user-preferences/') return { data: preferences };
    if (url === URLS.MEMBER_ASSOCIATIONS) return page([]);
    if (url === URLS.MEMBER_RECORDS) {
      if (refused) throw Object.assign(new Error('Current member access refused'), { response: { status: 404 } });
      return page(associated ? [ownRecord] : []);
    }
    if (url === URLS.MEMBER_RECORD(MEMBER_RECORD.uuid)) return { data: ownRecord };
    if (url === URLS.MEMBER_ENTRIES(MEMBER_RECORD.uuid))
      return { data: { entries: [{ ...MEMBER_ENTRY, companyEventOn: null }] } };
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
      <ApiClientProvider client={api as unknown as AxiosInstance}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  const holdings = await render(<HoldingsScreen />, { wrapper });
  await fireEvent.changeText(await screen.findByLabelText('Member invitation code'), MEMBER_CODE);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Accept access using my signed-in account' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Accept member invitation' }));
  await fireEvent.press(await screen.findByRole('button', { name: `${MEMBER_RECORD.company.name}: Ordinary · Award` }));
  expect(mockNavigate).toHaveBeenCalledWith('Company', { record: MEMBER_RECORD.uuid });
  expect(screen.getByText('1 company · 1 share class · 1 award')).toBeTruthy();
  expect(screen.getByText('2 of 5 vested')).toBeTruthy();
  await holdings.unmount();
  await render(<CompanyScreen route={{ key: 'company', name: 'Company', params: { record: MEMBER_RECORD.uuid } }} />, {
    wrapper,
  });
  await screen.findByRole('header', { name: MEMBER_RECORD.company.name });
  await screen.findByText('Ordinary · 10 issued shares');
  expect(screen.getByText(/5 awarded · 2 vested · 0 issued/)).toBeTruthy();
  ownRecord = {
    ...MEMBER_RECORD,
    awards: [
      {
        ...MEMBER_RECORD.awards[0],
        vestedShares: '3',
        issuedShares: '1',
        availableShares: '1',
        endedUnvestedShares: '1',
        endedVestedShares: '1',
        unvestedRemainingShares: '1',
        remainingUnissuedShares: '2',
        vestings: [{ ...MEMBER_RECORD.awards[0].vestings[0], shares: '4' }],
        ends: [
          {
            uuid: 'own-end',
            unvestedShares: '1',
            vestedShares: '1',
            companyEventOn: '2026-10-03',
            reason: 'Company selected reduction',
            createdAt: '2026-10-05T00:00:00Z',
          },
        ],
        vestingReversals: [
          {
            uuid: 'own-reversal',
            vesting: MEMBER_RECORD.awards[0].vestings[0].uuid,
            reversedShares: '1',
            companyEventOn: '2026-10-04',
            reason: 'Correct recorded quantity',
            createdAt: '2026-10-05T00:00:00Z',
          },
        ],
      },
    ],
  };
  await act(async () => screen.getByTestId('company-scroll').props.refreshControl.props.onRefresh());
  await screen.findByText(/5 awarded · 3 vested · 1 issued · 1 available/);
  await fireEvent.press(
    screen.getByRole('button', { name: `Award terms and recorded vesting ${ownRecord.awards[0].uuid}` }),
  );
  expect(screen.getByText(/Company selected reduction/)).toBeTruthy();
  expect(screen.getByText(/Correct recorded quantity/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Download.*(entitlement|correction)/ })).toBeNull();
  ownRecord = MEMBER_RECORD;
  expect(screen.queryByLabelText('Requested name')).toBeNull();
  await fireEvent.press(
    await screen.findByRole('button', { name: `Share own unsigned certificate ${FULFILLED_CERTIFICATE.uuid}` }),
  );
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      `${cache}ledova-document-views-v1/member-certificate-${FULFILLED_CERTIFICATE.uuid}.pdf`,
      { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' },
    ),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Open member details' }));
  expect(screen.getByText(MEMBER_RECORD.name)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Requested name'), 'Requested Member Name');
  await fireEvent.changeText(screen.getByLabelText('Requested residential address'), 'Requested synthetic address');
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Share these particulars with this company for review' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Send particulars request' }));
  await screen.findByRole('button', { name: 'Retry original member action' });
  expect(screen.getByLabelText('Requested name')).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry original member action' }));
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: 'Retry original member action' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Read own entries for Ordinary' })).toBeEnabled();
  });
  const commands = api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_PARTICULARS_REQUESTS);
  expect(commands).toHaveLength(2);
  expect(commands[0][1]).toEqual(commands[1][1]);
  expect(screen.getByText(MEMBER_RECORD.name)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Read own entries for Ordinary' }));
  await screen.findByRole('button', { name: 'Request certificate for entry 1' });
  expect(screen.getByText('Company event date Not recorded')).toBeTruthy();
  expect(screen.getByText(`Ledger effective date ${MEMBER_ENTRY.effectiveOn}`)).toBeTruthy();
  await act(async () => screen.getByTestId('company-scroll').props.refreshControl.props.onRefresh());
  expect(await screen.findByRole('button', { name: 'Request certificate for entry 1' })).toBeEnabled();
  expect(screen.getByLabelText('Requested name').props.value).toBe('Requested Member Name');
  await fireEvent.press(await screen.findByRole('button', { name: 'Request certificate for entry 1' }));
  await waitFor(() => expect(typeof release).toBe('function'));
  refused = true;
  await act(async () => {
    await client.refetchQueries({
      queryKey: ['member-records', 'profile-one', 'account-one', getSessionEpoch()],
      exact: true,
    });
  });
  await waitFor(() => expect(screen.queryByText(MEMBER_RECORD.name)).toBeNull());
  expect(screen.queryByText(MEMBER_RECORD.residentialAddress)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request certificate for entry 1' })).toBeNull();
  await act(async () => release!());
  expect(screen.queryByText(/Certificate request.*requested/)).toBeNull();
  expect(api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_CERTIFICATE_REQUESTS)).toHaveLength(1);
});
