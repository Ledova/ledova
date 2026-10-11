// @vitest-environment jsdom

import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  USER_PREFERENCES_QUERY_KEY,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AxiosInstance } from 'axios';
import { webcrypto } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { afterEach, expect, it, vi } from 'vitest';
import { MEMBER_CODE, MEMBER_ENTRY, MEMBER_RECORD } from '../../../../packages/shared/tests/fixtures/member-access';
import {
  FULFILLED_CERTIFICATE,
  MEMBER_PDF,
  OUTPUT_APPOINTMENT,
  OUTPUT_PREVIEW,
} from '../../../../packages/shared/tests/fixtures/register-outputs';
import MemberRecordsPage from './index';
import { CompanyMemberAccess } from '../company/register/CompanyMemberAccess';

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
      <ApiClientProvider client={api as unknown as AxiosInstance}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  const company = render(
    <CompanyMemberAccess
      owner={{ userUuid: preferences.userProfile, ownerAccountUuid: preferences.userAccount.uuid }}
      company={MEMBER_RECORD.company.uuid}
    />,
    { wrapper },
  );
  fireEvent.change(await screen.findByLabelText('Member UUID'), { target: { value: MEMBER_RECORD.member } });
  fireEvent.change(screen.getByLabelText('Intended recipient email'), { target: { value: 'member@example.test' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create member invitation' }));
  await screen.findByLabelText('One-time member invitation code');
  expect(screen.getByText(/Private queued member name/)).toBeTruthy();
  expect(screen.getByText(/Private queued member address/)).toBeTruthy();
  expect(screen.getByText(/member@example.test/)).toBeTruthy();
  preferencesRefused = true;
  await act(async () => {
    await client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true });
  });
  await waitFor(() => expect(screen.queryByText(/Private queued member name/)).toBeNull());
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
  fireEvent.click(screen.getByRole('button', { name: `Preview recipient certificate ${FULFILLED_CERTIFICATE.uuid}` }));
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
  fireEvent.change(screen.getByLabelText('Member invitation code'), { target: { value: MEMBER_CODE } });
  fireEvent.click(screen.getByRole('checkbox', { name: /I accept access/ }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: 'Accept member invitation' }) as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Accept member invitation' }));
  await waitFor(() => expect(associated).toBe(true));
  fireEvent.click(await screen.findByRole('button', { name: `Open ${MEMBER_RECORD.company.name} member record` }));
  await screen.findByText(MEMBER_RECORD.name);
  expect(screen.getByText(/5 awarded · 2 vested · 0 issued/)).toBeTruthy();
  fireEvent.click(
    await screen.findByRole('button', { name: `Download own unsigned certificate ${FULFILLED_CERTIFICATE.uuid}` }),
  );
  await waitFor(() => expect(createObjectURL).toHaveBeenCalledWith(pdf));
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
  expect(screen.queryByText(/Certificate request.*requested/)).toBeNull();
  expect(api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_CERTIFICATE_REQUESTS)).toHaveLength(1);
});
