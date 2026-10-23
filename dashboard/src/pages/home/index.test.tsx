// @vitest-environment jsdom

import { registerKey } from '@hooks/useRegisterAccess';

import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  USER_PREFERENCES_QUERY_KEY,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { MemoryRouter } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { MEMBER_CODE, MEMBER_ENTRY, MEMBER_RECORD, choose } from '../../testSupport/company';
import { AWARD_REQUEST, REGISTER, awardFrom } from '../../testSupport/company';
import { FULFILLED_CERTIFICATE, MEMBER_PDF, OUTPUT_APPOINTMENT, OUTPUT_PREVIEW } from '../../testSupport/company';
import MemberRecordsPage from './index';
import { CompanyMemberAccess } from '../company/ledger/CompanyMemberAccess';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
let release: (() => void) | undefined;
afterEach(async () => {
  await act(async () => release?.());
  release = undefined;
  cleanup();
  client.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const page = (results: unknown[]) => ({ data: { results, next: null, count: results.length } });
const memberRegister: TokenHoldersResponse = {
  ...REGISTER,
  token: { ...REGISTER.token, uuid: MEMBER_RECORD.classes[0].uuid },
  issuedSupply: '10',
  totalHolders: 1,
  holders: [
    {
      member: MEMBER_RECORD.member,
      name: MEMBER_RECORD.name,
      holderType: 'member',
      balance: '10',
      shareClass: 'Ordinary',
      source: 'register',
      identitySource: 'company_recorded',
      enteredOn: '2026-10-01',
      percentage: 100,
      wallets: [],
    },
  ],
};

it('invites and associates a walletless member, recovers one exact request and refuses cached records and a late action after current read loss', async () => {
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'investor' } };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  let associated = false;
  let refused = false;
  let preferencesRefused = false;
  const createObjectURL = vi.fn(() => 'blob:synthetic');
  vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
  vi.stubGlobal('crypto', {
    randomUUID: () => webcrypto.randomUUID(),
    subtle: {
      digest: (_algorithm: string, bytes: ArrayBuffer) =>
        webcrypto.subtle.digest('SHA-256', Buffer.from(new Uint8Array(bytes))),
    },
  });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const pdf = Object.assign(new Blob(['%PDF synthetic recipient'], { type: 'application/pdf' }), {
    arrayBuffer: async () => MEMBER_PDF.buffer,
  });
  let invitation: unknown;
  let particulars: Record<string, unknown>[] = [
    {
      uuid: '12121212-1212-4212-8212-121212121212',
      association: MEMBER_RECORD.uuid,
      company: MEMBER_RECORD.company.uuid,
      member: MEMBER_RECORD.member,
      name: 'Private queued member name',
      residentialAddress: 'Private queued member address',
      status: 'submitted',
      change: null,
    },
  ];
  let certificates: Record<string, unknown>[] = [{ ...FULFILLED_CERTIFICATE, status: 'requested', fulfilment: null }];
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/user-preferences/') {
      if (preferencesRefused)
        throw Object.assign(new Error('Current preferences refused'), { response: { status: 404 } });
      return { data: preferences };
    }
    if (url === '/api/v1/company-authority/appointments/')
      return page([{ ...OUTPUT_APPOINTMENT, capabilities: ['admin', 'prepare'] }]);
    if (url === URLS.MEMBER_INVITATIONS) return page(invitation ? [invitation] : []);
    if (url === URLS.REGISTER_AWARDS) return page([]);
    if (url === URLS.MEMBER_ASSOCIATIONS) return page([]);
    if (url === URLS.MEMBER_RECORDS) {
      if (refused) throw Object.assign(new Error('Current member access refused'), { response: { status: 404 } });
      return page(associated ? [MEMBER_RECORD] : []);
    }
    if (url === URLS.MEMBER_RECORD(MEMBER_RECORD.uuid)) return { data: MEMBER_RECORD };
    if (url === URLS.MEMBER_ENTRIES(MEMBER_RECORD.uuid)) return { data: { entries: [MEMBER_ENTRY] } };
    if (url === URLS.MEMBER_PARTICULARS_REQUESTS) return page(particulars);
    if (url === URLS.MEMBER_CERTIFICATE_REQUESTS) return page(certificates);
    if (url === URLS.MEMBER_CERTIFICATE_FILE(FULFILLED_CERTIFICATE.uuid)) return { data: pdf };
    if (url === URLS.MEMBER_CERTIFICATE_PREVIEW(FULFILLED_CERTIFICATE.uuid))
      return {
        data: {
          ...OUTPUT_PREVIEW,
          company: MEMBER_RECORD.company.uuid,
          member: MEMBER_RECORD.member,
          memberRequest: FULFILLED_CERTIFICATE.uuid,
        },
      };
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.MEMBER_CERTIFICATE_FULFIL(FULFILLED_CERTIFICATE.uuid)) {
      const request = {
        ...FULFILLED_CERTIFICATE,
        fulfilment: {
          ...FULFILLED_CERTIFICATE.fulfilment,
          uuid: body.operationId,
          appointment: body.appointment,
          instruction: body.instruction,
          sourceDigest: body.sourceDigest,
        },
      };
      certificates = [request];
      return { data: request };
    }
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
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <MemoryRouter>{children}</MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>
  );
  const company = render(
    <CompanyMemberAccess
      owner={{ userUuid: preferences.userProfile, ownerAccountUuid: preferences.userAccount.uuid }}
      company={MEMBER_RECORD.company.uuid}
      guard={() => {}}
      registers={[memberRegister]}
    />,
    { wrapper },
  );
  expect(screen.queryByRole('button', { name: 'Refresh member access' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Invite a member' }));
  await choose('Member or award recipient', 'Company Recorded Member', 'recorded member');
  fireEvent.change(screen.getByLabelText('Intended recipient email'), { target: { value: 'member@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create member invitation' }));
  await screen.findByLabelText('One-time member invitation code');
  fireEvent.click(screen.getByRole('button', { name: /^Private queued member name/ }));
  expect(screen.getByText('Private queued member address')).toBeTruthy();
  expect(screen.getByText(/member@example.test/)).toBeTruthy();
  preferencesRefused = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true });
  });
  await waitFor(() => expect(screen.queryAllByText(/Private queued member name/)).toHaveLength(0));
  expect(screen.queryByText(/Private queued member address/)).toBeNull();
  expect(screen.queryByText(/member@example.test/)).toBeNull();
  expect(screen.queryByLabelText('One-time member invitation code')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Create member invitation' })).toBeNull();
  preferencesRefused = false;
  particulars = [];
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  fireEvent.change(await screen.findByLabelText('Certificate instruction reference'), {
    target: { value: 'Synthetic recipient instruction' },
  });
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${MEMBER_RECORD.name}.*Requested$`) }));
  fireEvent.click(screen.getByRole('button', { name: `Preview certificate for ${MEMBER_RECORD.name}` }));
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm recipient certificate fulfilment' }));
  await screen.findByText(/The unsigned recipient certificate is recorded/);
  expect(api.post).toHaveBeenCalledWith(
    URLS.MEMBER_CERTIFICATE_FULFIL(FULFILLED_CERTIFICATE.uuid),
    expect.objectContaining({
      appointment: OUTPUT_APPOINTMENT.uuid,
      instruction: 'Synthetic recipient instruction',
      sourceDigest: OUTPUT_PREVIEW.sourceDigest,
    }),
    expect.objectContaining({ ledovaSubmissionGuard: expect.any(Function) }),
  );
  company.unmount();
  render(<MemberRecordsPage />, { wrapper });
  fireEvent.change(await screen.findByLabelText('Member invitation code'), { target: { value: MEMBER_CODE } });
  fireEvent.click(screen.getByRole('checkbox', { name: /I accept access/ }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Accept member invitation' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Accept member invitation' }));
  await waitFor(() => expect(associated).toBe(true));
  await screen.findByRole('button', { name: 'Read own entries for Ordinary' });
  await screen.findByText(MEMBER_RECORD.name);
  expect(await screen.findByText('Company date Not recorded')).toBeTruthy();
  expect(screen.getByText(/Ledger .*Issue.*Own change \+10/)).toBeTruthy();
  expect(screen.getByRole('img', { name: /3 unvested, 2 vested, awaiting issue, 0 issued from award/ })).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: /Download unsigned certificate/ }));
  await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(pdf));
  fireEvent.click(screen.getByText('Request a particulars update'));
  fireEvent.change(screen.getByLabelText('Requested name'), { target: { value: 'Requested Member Name' } });
  fireEvent.change(screen.getByLabelText('Requested residential address'), {
    target: { value: 'Requested synthetic address' },
  });
  fireEvent.click(screen.getByRole('checkbox', { name: /Share these requested particulars/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Send particulars request' }));
  await screen.findByRole('button', { name: 'Retry original member action' });
  expect(screen.getByLabelText('Requested name').matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Retry original member action' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry original member action' })).toBeNull());
  const commands = api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_PARTICULARS_REQUESTS);
  expect(commands).toHaveLength(2);
  expect(commands[0][1]).toEqual(commands[1][1]);
  expect(screen.getByText(MEMBER_RECORD.name)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Read own entries for Ordinary' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Request certificate for entry 1' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  refused = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: ['member-records', 'profile-one', 'account-one', 0], exact: true });
  });
  await waitFor(() => expect(screen.queryByText(MEMBER_RECORD.name)).toBeNull());
  expect(screen.queryByText(MEMBER_RECORD.residentialAddress)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request certificate for entry 1' })).toBeNull();
  await act(async () => release!());
  expect(screen.queryAllByText(/Certificate requested/)).toHaveLength(0);
  expect(api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_CERTIFICATE_REQUESTS)).toHaveLength(1);
});

it('invites an exact award-only recipient, deduplicates members and clears unavailable and foreign company selections', async () => {
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'company' } };
  const owner = { userUuid: preferences.userProfile, ownerAccountUuid: preferences.userAccount.uuid };
  const company = MEMBER_RECORD.company.uuid;
  const otherCompany = '99999999-9999-4999-8999-999999999999';
  const awardMember = '88888888-8888-4888-8888-888888888888';
  const otherClass = '77777777-7777-4777-8777-777777777777';
  const award = {
    ...awardFrom(AWARD_REQUEST),
    company,
    token: memberRegister.token.uuid,
    member: awardMember,
    name: 'Award Only Recipient',
    recipientName: 'Award Only Recipient',
  };
  let awards = [award];
  let invitation: unknown;
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  vi.stubGlobal('crypto', { randomUUID: () => webcrypto.randomUUID() });
  api.get.mockReset().mockImplementation(async (url, config) => {
    if (url === '/api/user-preferences/') return { data: preferences };
    if (url === '/api/v1/company-authority/appointments/')
      return page([
        { ...OUTPUT_APPOINTMENT, company, capabilities: ['admin'] },
        { ...OUTPUT_APPOINTMENT, company: otherCompany, capabilities: ['admin'] },
      ]);
    if (url === URLS.REGISTER_AWARDS) {
      expect([company, otherCompany]).toContain(config.params.company);
      return page(awards);
    }
    if (url === URLS.MEMBER_INVITATIONS) return page(invitation ? [invitation] : []);
    if ([URLS.MEMBER_ASSOCIATIONS, URLS.MEMBER_PARTICULARS_REQUESTS, URLS.MEMBER_CERTIFICATE_REQUESTS].includes(url))
      return page([]);
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockReset().mockImplementation(async (url, body) => {
    expect(url).toBe(URLS.MEMBER_INVITATIONS);
    invitation = {
      ...body,
      uuid: body.operationId,
      status: 'pending',
      code: MEMBER_CODE,
      acceptanceDeadline: '2026-10-18T00:00:00Z',
    };
    return { data: invitation };
  });
  const guard = () => {};
  const onHeldChange = vi.fn();
  const companyView = (uuid: string, registers: TokenHoldersResponse[], sourceReady = true) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <CompanyMemberAccess
          owner={owner}
          company={uuid}
          registers={registers}
          guard={guard}
          sourceReady={sourceReady}
          onHeldChange={onHeldChange}
        />
      </ApiClientProvider>
    </QueryClientProvider>
  );
  const registers = [
    memberRegister,
    { ...memberRegister, token: { ...memberRegister.token, uuid: otherClass, symbol: 'PREF' } },
  ];
  const view = render(companyView(company, registers));
  expect(screen.queryByRole('combobox', { name: 'Member or award recipient' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Company action reason' })).toBeNull();
  expect(screen.queryByRole('textbox', { name: 'Certificate instruction reference' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Refresh member access' })).toBeNull();
  fireEvent.click(await screen.findByRole('button', { name: 'Invite a member' }));
  const recipient = await screen.findByRole('combobox', { name: 'Member or award recipient' });
  await waitFor(() => expect((recipient as HTMLInputElement).disabled).toBe(false));
  fireEvent.change(recipient, { target: { value: ' ' } });
  const awardOnly = await screen.findByRole('option', {
    name: 'Award Only Recipient · Award recipient without shares · ORD',
  });
  expect(screen.getAllByRole('option', { name: /Company Recorded Member/ })).toHaveLength(1);
  expect(screen.queryByLabelText('Member UUID')).toBeNull();
  fireEvent.change(recipient, { target: { value: 'award only' } });
  expect(screen.queryByRole('option', { name: /Company Recorded Member/ })).toBeNull();
  fireEvent.mouseDown(awardOnly);
  fireEvent.change(screen.getByLabelText('Intended recipient email'), { target: { value: 'employee@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create member invitation' }));
  await screen.findByLabelText('One-time member invitation code');
  expect(api.post).toHaveBeenCalledWith(
    URLS.MEMBER_INVITATIONS,
    expect.objectContaining({ company, member: awardMember, intendedEmail: 'employee@example.test' }),
    expect.any(Object),
  );
  expect(onHeldChange).toHaveBeenCalledWith(true);
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('combobox', { name: 'Member or award recipient' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Invite a member' }));

  awards = [];
  await act(async () =>
    client.refetchQueries({
      queryKey: [...registerKey(owner), 'invitation-awards', company],
      exact: true,
    }),
  );
  await waitFor(() =>
    expect((screen.getByRole('combobox', { name: 'Member or award recipient' }) as HTMLInputElement).value).toBe(''),
  );
  expect((screen.getByLabelText('Intended recipient email') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Create member invitation' }));
  expect(document.activeElement).toBe(screen.getByText('Before continuing:').parentElement);
  expect(screen.getByRole('combobox', { name: 'Member or award recipient' }).getAttribute('aria-invalid')).toBe('true');
  expect(api.post).toHaveBeenCalledTimes(1);

  await choose('Member or award recipient', 'Company Recorded Member', 'recorded member');
  fireEvent.change(screen.getByLabelText('Intended recipient email'), { target: { value: 'member@example.test' } });
  awards = [{ ...award, name: 'Foreign Private Award Recipient' }];
  invitation = undefined;
  view.rerender(companyView(otherCompany, [{ ...REGISTER, token: { ...REGISTER.token, uuid: otherClass } }]));
  fireEvent.click(await screen.findByRole('button', { name: 'Invite a member' }));
  await screen.findByText('The award recipients belong to another company.');
  expect((screen.getByRole('combobox', { name: 'Member or award recipient' }) as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('combobox', { name: 'Member or award recipient' }) as HTMLInputElement).disabled).toBe(true);
  expect((screen.getByLabelText('Intended recipient email') as HTMLInputElement).value).toBe('');
  expect(screen.getByRole('button', { name: 'Create member invitation' }).matches(':disabled')).toBe(true);
  expect(api.post).toHaveBeenCalledTimes(1);
  view.rerender(companyView(otherCompany, [], false));
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Member or award recipient' })).toBeNull());
});
