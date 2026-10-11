import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  USER_PREFERENCES_QUERY_KEY,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Crypto from 'expo-crypto';
import type { AxiosInstance } from 'axios';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { MEMBER_CODE, MEMBER_ENTRY, MEMBER_RECORD } from '../../../../packages/shared/tests/fixtures/member-access';
import { APPOINTMENT } from '../../../../packages/shared/tests/fixtures/employee-awards';
import { MemberRecordsScreen } from './MemberRecordsScreen';
import { CompanyMemberAccess } from '../company-register/CompanyMemberAccess';

jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
const api = { get: jest.mocked(apiClient.get), post: jest.mocked(apiClient.post) };
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
let release: (() => void) | undefined;
afterEach(async () => {
  await act(async () => release?.());
  release = undefined;
  await cleanup();
  client.clear();
});
const page = (results: unknown[]) => ({ data: { results, next: null, count: results.length } });

it('invites and associates a walletless member, recovers one exact request and refuses cached records and a late action after current read loss', async () => {
  let keys = 0;
  jest
    .mocked(Crypto.randomUUID)
    .mockImplementation(() => `00000000-0000-4000-8000-${String(++keys).padStart(12, '0')}`);
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'investor' } };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  let associated = false;
  let refused = false;
  let invitation: unknown;
  let particulars: Record<string, unknown>[] = [];
  let certificates: Record<string, unknown>[] = [];
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/user-preferences/') return { data: preferences };
    if (url === '/api/v1/company-authority/appointments/')
      return page([
        { ...APPOINTMENT, company: MEMBER_RECORD.company.uuid, capabilities: ['admin', 'prepare'], isEffective: true },
      ]);
    if (url === URLS.MEMBER_INVITATIONS) return page(invitation ? [invitation] : []);
    if (url === URLS.MEMBER_ASSOCIATIONS) return page([]);
    if (url === URLS.MEMBER_RECORDS) {
      if (refused) throw Object.assign(new Error('Current member access refused'), { response: { status: 404 } });
      return page(associated ? [MEMBER_RECORD] : []);
    }
    if (url === URLS.MEMBER_RECORD(MEMBER_RECORD.uuid)) return { data: MEMBER_RECORD };
    if (url === URLS.MEMBER_ENTRIES(MEMBER_RECORD.uuid)) return { data: { entries: [MEMBER_ENTRY] } };
    if (url === URLS.MEMBER_PARTICULARS_REQUESTS) return page(particulars);
    if (url === URLS.MEMBER_CERTIFICATE_REQUESTS) return page(certificates);
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockReset().mockImplementation(async (url, value) => {
    const body = value as Record<string, string>;
    if (url === URLS.MEMBER_INVITATIONS) {
      invitation = {
        ...body,
        uuid: body.operationId,
        status: 'pending',
        code: MEMBER_CODE,
        acceptanceDeadline: '2026-10-18T00:00:00Z',
      };
      return { data: invitation };
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
      <ApiClientProvider client={api as unknown as AxiosInstance}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  const company = await render(<CompanyMemberAccess company={MEMBER_RECORD.company.uuid} />, { wrapper });
  await fireEvent.changeText(await screen.findByLabelText('Member UUID'), MEMBER_RECORD.member);
  await fireEvent.changeText(screen.getByLabelText('Intended recipient email'), 'member@example.test');
  await fireEvent.press(screen.getByRole('button', { name: 'Create member invitation' }));
  await screen.findByText(`One-time member invitation code: ${MEMBER_CODE}`);
  await company.unmount();
  await render(<MemberRecordsScreen />, { wrapper });
  await fireEvent.changeText(screen.getByLabelText('Member invitation code'), MEMBER_CODE);
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Accept access using my signed-in account' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Accept member invitation' }));
  await fireEvent.press(
    await screen.findByRole('button', { name: `Open ${MEMBER_RECORD.company.name} member record` }),
  );
  await screen.findByText(MEMBER_RECORD.name);
  expect(screen.getByText(/5 awarded · 2 vested · 0 issued/)).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Requested name'), 'Requested Member Name');
  await fireEvent.changeText(screen.getByLabelText('Requested residential address'), 'Requested synthetic address');
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Share these particulars with this company for review' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Send particulars request' }));
  await screen.findByRole('button', { name: 'Retry original member action' });
  expect(screen.getByLabelText('Requested name')).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Retry original member action' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry original member action' })).toBeNull());
  const commands = api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_PARTICULARS_REQUESTS);
  expect(commands).toHaveLength(2);
  expect(commands[0][1]).toEqual(commands[1][1]);
  expect(screen.getByText(MEMBER_RECORD.name)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Read own entries for Ordinary' }));
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
