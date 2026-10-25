// @vitest-environment jsdom

import { registerKey } from '@hooks/useRegisterAccess';
import { MemberRecordsProvider } from '@components/member-records/MemberRecordsProvider';
import { CompanyRecordedDetails } from '@pages/settings/CompanyRecordedDetails';

import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  USER_PREFERENCES_QUERY_KEY,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { MEMBER_CODE, MEMBER_ENTRY, MEMBER_RECORD, choose } from '../../testSupport/company';
import { AWARD_REQUEST, REGISTER, awardFrom } from '../../testSupport/company';
import { FULFILLED_CERTIFICATE, MEMBER_PDF, OUTPUT_APPOINTMENT, OUTPUT_PREVIEW } from '../../testSupport/company';
import MemberRecordsPage from './index';
import MemberInvitationPage from '../member-invitation';
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
  sessionStorage.clear();
  window.history.replaceState({}, '', '/');
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
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = createObjectURL;
      static revokeObjectURL = vi.fn();
    },
  );
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
  let mailAttempts = 0;
  let holdPreview = true;
  let signupCompleted = false;
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
  const otherCertificate = {
    ...FULFILLED_CERTIFICATE,
    uuid: '56565656-5656-4565-8565-565656565656',
    token: '78787878-7878-4787-8787-787878787878',
  };
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/user-preferences/') {
      if (preferencesRefused)
        throw Object.assign(new Error('Current preferences refused'), { response: { status: 404 } });
      return { data: preferences };
    }
    if (url === '/api/user-profiles/') {
      const current = client.getQueryData<{ data: typeof preferences }>(USER_PREFERENCES_QUERY_KEY)?.data;
      return page([{ uuid: current?.userProfile, isSignupCompleted: signupCompleted }]);
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
    if ([FULFILLED_CERTIFICATE.uuid, otherCertificate.uuid].some((uuid) => url === URLS.MEMBER_CERTIFICATE_FILE(uuid)))
      return { data: pdf };
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
    if (url === URLS.MEMBER_INVITATION_SEND_EMAIL) {
      invitation = {
        ...body,
        uuid: body.operationId,
        status: 'pending',
        emailDelivery: 'accepted',
        acceptanceDeadline: '2026-10-18T00:00:00Z',
      };
      if (++mailAttempts === 1) throw new Error('Synthetic interrupted invitation delivery');
      return { data: invitation };
    }
    if (url === URLS.MEMBER_INVITATION_PREVIEW) {
      expect(body).toEqual({ code: MEMBER_CODE });
      if (
        client.getQueryData<{ data: typeof preferences }>(USER_PREFERENCES_QUERY_KEY)?.data.userAccount.uuid !==
        preferences.userAccount.uuid
      )
        throw Object.assign(new Error('This invitation is for another recipient.'), {
          response: { status: 403, data: { detail: 'This invitation is for another recipient.' } },
        });
      const response = {
        data: {
          company: MEMBER_RECORD.company,
          member: { uuid: MEMBER_RECORD.member, name: MEMBER_RECORD.name },
          intendedEmail: 'member@example.test',
          acceptanceDeadline: '2026-10-28T00:00:00Z',
          status: 'pending',
        },
      };
      if (holdPreview) {
        holdPreview = false;
        return new Promise((resolve) => {
          release = () => resolve(response);
        });
      }
      return response;
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
        <MemoryRouter initialEntries={['/home']}>{children}</MemoryRouter>
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
  fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Retry original company member action' }));
  await screen.findByText(/The invitation email was accepted for sending/);
  const mailCommands = api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_INVITATION_SEND_EMAIL);
  expect(mailCommands).toHaveLength(2);
  expect(mailCommands[0][1]).toEqual(mailCommands[1][1]);
  expect(screen.queryByLabelText('One-time member invitation code')).toBeNull();
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
  expect(screen.queryByRole('button', { name: 'Send invitation' })).toBeNull();
  preferencesRefused = false;
  particulars = [];
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(`^${MEMBER_RECORD.name}.*Requested$`) }));
  const prepareCertificate = screen.getByRole('button', { name: `Prepare certificate (${MEMBER_RECORD.name})` });
  expect(screen.queryByRole('textbox', { name: 'Company instruction' })).toBeNull();
  fireEvent.click(prepareCertificate);
  await screen.findByRole('heading', { name: 'Prepare certificate' });
  expect(screen.queryByRole('heading', { name: 'Invitations' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Current member access' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Invite a member' })).toBeNull();
  fireEvent.change(screen.getByRole('textbox', { name: 'Company instruction' }), {
    target: { value: 'Synthetic recipient instruction' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(document.activeElement).toBe(prepareCertificate));
  expect(
    api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_CERTIFICATE_FULFIL(FULFILLED_CERTIFICATE.uuid)),
  ).toHaveLength(0);
  fireEvent.click(prepareCertificate);
  fireEvent.click(screen.getByRole('button', { name: 'Preview' }));
  await screen.findByRole('heading', { name: 'Review certificate' });
  expect(screen.getByText(`${memberRegister.token.name} · ${memberRegister.token.symbol}`)).toBeTruthy();
  expect(screen.getByText('Unsigned certificate · 1 page')).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'Company instruction' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Invite a member' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Record details' }));
  expect(screen.getByText('Synthetic recipient instruction')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Create certificate' }));
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
  window.history.replaceState({}, '', `/member-invitation#${MEMBER_CODE}`);
  const recipient = render(<MemberInvitationPage />, { wrapper });
  await screen.findByRole('link', { name: 'Continue setup' });
  expect(api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_INVITATION_PREVIEW)).toHaveLength(0);
  signupCompleted = true;
  await act(async () => client.refetchQueries({ queryKey: ['userProfiles'] }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  await act(async () => {
    client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'other-profile', userAccount: { uuid: 'other-account', role: 'investor' } },
    });
    release!();
  });
  expect(screen.queryByText(MEMBER_RECORD.name)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull();
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ),
  ).not.toContain(MEMBER_CODE);
  await act(async () => client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences }));
  await screen.findByText(MEMBER_RECORD.name);
  expect(window.location.hash).toBe('');
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(associated).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
  await waitFor(() => expect(associated).toBe(true));
  await screen.findByText(/Invitation accepted/);
  expect(sessionStorage).toHaveLength(0);
  recipient.unmount();
  particulars = [
    {
      uuid: '13131313-1313-4313-8313-131313131313',
      association: MEMBER_RECORD.uuid,
      company: MEMBER_RECORD.company.uuid,
      member: MEMBER_RECORD.member,
      name: MEMBER_RECORD.name,
      residentialAddress: MEMBER_RECORD.residentialAddress,
      status: 'applied',
      change: '14141414-1414-4414-8414-141414141414',
    },
  ];
  certificates.push(
    {
      ...FULFILLED_CERTIFICATE,
      uuid: '67676767-6767-4676-8676-676767676767',
      createdAt: '2026-10-03T00:00:00Z',
      status: 'requested',
      fulfilment: null,
    },
    {
      ...FULFILLED_CERTIFICATE,
      uuid: '89898989-8989-4898-8898-898989898989',
      createdAt: '2026-10-02T00:00:00Z',
      status: 'withdrawn',
      fulfilment: null,
    },
    otherCertificate,
  );
  render(
    <MemberRecordsProvider>
      <nav>
        <Link to="/home">Dashboard</Link>
        <Link to="/home#documents">Documents</Link>
        <Link to="/settings#company-recorded-details">Settings</Link>
      </nav>
      <Routes>
        <Route path="/home" element={<MemberRecordsPage />} />
        <Route path="/settings" element={<CompanyRecordedDetails />} />
      </Routes>
    </MemberRecordsProvider>,
    { wrapper },
  );
  await screen.findByText('10 issued shares');
  expect(screen.queryByRole('button', { name: 'Refresh member records' })).toBeNull();
  expect(screen.getByRole('img', { name: /Your issued shares by class/ })).toBeTruthy();
  expect(screen.queryByText(MEMBER_RECORD.name)).toBeNull();
  expect(screen.queryByText(MEMBER_RECORD.residentialAddress)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request a particulars update' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Read own entries for Ordinary' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Particulars requests' })).toBeNull();
  expect(screen.queryByText('Recent changes · Ordinary')).toBeNull();
  expect(screen.getByRole('img', { name: /3 unvested, 2 vested, awaiting issue, 0 issued from award/ })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Request certificate (Ordinary, entry 1)' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Withdraw certificate request/ })).toBeNull();
  expect(screen.queryByRole('button', { name: /Download unsigned certificate/ })).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
  const detailsCard = (await screen.findByRole('heading', { name: 'Your details' })).closest('section')!;
  expect(
    within(detailsCard)
      .getAllByRole('definition')
      .map((item) => item.textContent),
  ).toEqual([MEMBER_RECORD.name, MEMBER_RECORD.residentialAddress]);
  const previousParticulars = await screen.findByRole('button', { name: 'Previous particulars requests' });
  expect(previousParticulars.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(previousParticulars);
  expect(screen.getByText('Particulars update · Applied')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Documents' }));
  const certificatesCard = (await screen.findByRole('heading', { name: 'Certificates' })).closest('section')!;
  expect(within(certificatesCard).getByRole('heading', { name: '+10 ORD shares' })).toBeTruthy();
  expect(within(certificatesCard).getByText('Requested', { exact: true, selector: 'p.font-medium' })).toBeTruthy();
  expect(within(certificatesCard).getByText('Not recorded')).toBeTruthy();
  expect(within(certificatesCard).getByRole('button', { name: /Withdraw certificate request/ })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Share history' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Your request status' })).toBeNull();
  expect(screen.queryByRole('heading', { name: 'Particulars requests' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request a particulars update' })).toBeNull();
  expect(screen.queryByRole('button', { name: /Download unsigned certificate/ })).toBeNull();
  fireEvent.click(within(certificatesCard).getByRole('button', { name: 'Record details' }));
  expect(within(certificatesCard).getByRole('heading', { name: 'Previous requests' })).toBeTruthy();
  expect(within(certificatesCard).getByText('Ordinary · Withdrawn')).toBeTruthy();
  expect(within(certificatesCard).getByText('Ordinary · Fulfilled')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: /Download unsigned certificate/ }));
  await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(pdf));
  expect(api.get).toHaveBeenCalledWith(URLS.MEMBER_CERTIFICATE_FILE(FULFILLED_CERTIFICATE.uuid), expect.anything());
  fireEvent.click(within(certificatesCard).getByRole('button', { name: 'Record details' }));
  fireEvent.click(within(certificatesCard).getByRole('button', { name: 'Other certificate requests' }));
  expect(within(certificatesCard).getByText('Share certificate · Fulfilled')).toBeTruthy();
  fireEvent.click(within(certificatesCard).getByRole('button', { name: /Download unsigned certificate/ }));
  await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
  expect(api.get).toHaveBeenCalledWith(URLS.MEMBER_CERTIFICATE_FILE(otherCertificate.uuid), expect.anything());
  fireEvent.click(screen.getByRole('link', { name: 'Settings' }));
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
  expect(commands[0][1]).toEqual({
    operationId: expect.any(String),
    association: MEMBER_RECORD.uuid,
    name: 'Requested Member Name',
    residentialAddress: 'Requested synthetic address',
    confirmation: true,
  });
  expect(screen.getByText(MEMBER_RECORD.name)).toBeTruthy();
  expect(screen.getByText(MEMBER_RECORD.residentialAddress)).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Particulars requests' })).toBeTruthy();
  expect(screen.getByText('Particulars update · Submitted')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: 'Documents' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Request certificate (Ordinary, entry 1)' }));
  await waitFor(() => expect(release).toBeTypeOf('function'));
  refused = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: ['member-records', 'profile-one', 'account-one', 0], exact: true });
  });
  await waitFor(() => expect(screen.queryByText(MEMBER_RECORD.name)).toBeNull());
  expect(screen.queryByRole('img', { name: /Your issued shares by class/ })).toBeNull();
  expect(screen.queryByText(MEMBER_RECORD.residentialAddress)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Request certificate (Ordinary, entry 1)' })).toBeNull();
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
    expect(url).toBe(URLS.MEMBER_INVITATION_SEND_EMAIL);
    invitation = {
      ...body,
      uuid: body.operationId,
      status: 'pending',
      emailDelivery: 'accepted',
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
  fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
  await screen.findByText(/The invitation email was accepted for sending/);
  expect(screen.queryByLabelText('One-time member invitation code')).toBeNull();
  expect(api.post).toHaveBeenCalledWith(
    URLS.MEMBER_INVITATION_SEND_EMAIL,
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
  fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
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
  expect(screen.getByRole('button', { name: 'Send invitation' }).matches(':disabled')).toBe(true);
  expect(api.post).toHaveBeenCalledTimes(1);
  view.rerender(companyView(otherCompany, [], false));
  await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Member or award recipient' })).toBeNull());
});
