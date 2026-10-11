import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_AWARD_COPY as COPY,
  USER_PREFERENCES_QUERY_KEY,
} from '@ledova/shared';
import type {
  OwnCompanyAppointment,
  RegisterAward,
  RegisterAwardPreparation,
  RegisterAwardVesting,
  RegisterAwardVestingPreparation,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import React from 'react';
import {
  APPOINTMENT,
  AWARD_REQUEST,
  REGISTER,
  awardFrom,
  vestingFrom,
} from '../../../../packages/shared/tests/fixtures/employee-awards';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { pickedFile, resetFiles } from '../../testSupport/documentFiles';
import { ClassAwards } from './ClassAwards';

jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../services/tokenStorage', () => ({ getAccessToken: jest.fn(async () => 'synthetic-access') }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);

const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
let client: QueryClient;
let appointments: OwnCompanyAppointment[];
let awards: RegisterAward[];
let events: RegisterAwardVesting[];
let failedRead: 'award' | 'vesting' | null;
let append: jest.SpyInstance<ReturnType<FormData['append']>, Parameters<FormData['append']>>;
const submissions = (url: string) => post.mock.calls.filter(([endpoint]) => endpoint === url).map(([, body]) => body);

function field(form: unknown, key: string) {
  return append.mock.calls
    .filter((_, index) => append.mock.contexts[index] === form)
    .find(([name]) => name === key)?.[1];
}

function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

beforeEach(() => {
  resetFiles();
  let keys = 0;
  let picks = 0;
  jest
    .mocked(Crypto.randomUUID)
    .mockImplementation(
      () => `00000000-0000-4000-8000-${String(++keys).padStart(12, '0')}` as ReturnType<typeof Crypto.randomUUID>,
    );
  jest
    .mocked(DocumentPicker.getDocumentAsync)
    .mockReset()
    .mockImplementation(async () => pickedFile(++picks));
  append = jest.spyOn(FormData.prototype, 'append');
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } },
  });
  appointments = [APPOINTMENT];
  awards = [];
  events = [];
  failedRead = null;
  get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/v1/company-authority/appointments/') return { data: { results: appointments, next: null } };
    if (url === URLS.REGISTER_AWARDS) {
      if (failedRead === 'award') throw new Error('Recorded awards could not be refreshed');
      return { data: { results: awards, next: null } };
    }
    if (url === URLS.REGISTER_AWARD_VESTINGS) {
      if (failedRead === 'vesting') throw new Error('Recorded vesting could not be refreshed');
      return { data: { results: events, next: null } };
    }
    if (url === URLS.REGISTER_MEMBERS(REGISTER.token.uuid)) return { data: { members: [] } };
    throw new Error(`Unexpected request: ${url}`);
  });
  post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_EVIDENCE)
      return {
        data: {
          uuid: `evidence-${field(body, 'idempotency_key')}`,
          company: field(body, 'company_id'),
          appointment: field(body, 'appointment'),
          kind: field(body, 'kind'),
          idempotencyKey: field(body, 'idempotency_key'),
          originalFilename: (field(body, 'file') as unknown as { name: string }).name,
          fileSize: 5,
          mimeType: 'application/pdf',
          sha256: 'a'.repeat(64),
          providedBy: 'company',
          createdAt: '2026-10-07T00:00:00Z',
        },
      };
    if (url === URLS.REGISTER_AWARDS) {
      const award = awardFrom(body as RegisterAwardPreparation);
      awards = [award];
      failedRead = 'award';
      return { data: award };
    }
    if (url === URLS.REGISTER_AWARD_VESTINGS) {
      const event = vestingFrom(body as RegisterAwardVestingPreparation);
      events = [event];
      awards = [{ ...awards[0], vestedShares: event.shares, availableShares: event.shares }];
      failedRead = 'vesting';
      return { data: event };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

it('keeps confirmed award and vesting commands through parent refresh failures without submitting or uploading twice', async () => {
  const navigate = jest.fn();
  const view = await render(
    <ClassAwards
      company={APPOINTMENT.company}
      register={REGISTER}
      epoch={getSessionEpoch()}
      sourceReady
      onPrepareGrant={navigate}
    />,
    { wrapper },
  );
  for (const kind of ['award', 'vesting'] as const) {
    const open = await view.findByRole('button', { name: kind === 'award' ? COPY.PREPARE : COPY.VEST });
    await waitFor(() => expect(open).not.toBeDisabled());
    await fireEvent.press(open);
    if (kind === 'award') {
      for (const [label, value] of [
        ['Recipient name', AWARD_REQUEST.name!],
        ['Residential address', AWARD_REQUEST.residentialAddress!],
        [COPY.SHARES, AWARD_REQUEST.shares],
        [COPY.TERMS_ON, AWARD_REQUEST.termsOn],
        [COPY.TERMS, AWARD_REQUEST.terms],
        [COPY.SCHEDULE, AWARD_REQUEST.schedule],
      ])
        await fireEvent.changeText(await view.findByLabelText(label), value);
    } else await fireEvent.changeText(await view.findByLabelText(COPY.VESTING_SHARES), '100');
    const noun = kind === 'award' ? 'agreement document' : 'vesting evidence';
    await fireEvent.press(view.getByRole('button', { name: `Choose the ${noun}` }));
    await view.findByRole('button', { name: `Replace the ${noun}` });
    const action = kind === 'award' ? COPY.SUBMIT : COPY.VEST;
    const close = kind === 'award' ? 'Close award form' : 'Close vesting form';
    const url = kind === 'award' ? URLS.REGISTER_AWARDS : URLS.REGISTER_AWARD_VESTINGS;
    const retry = kind === 'award' ? 'Retry awards' : 'Retry vesting events';
    await fireEvent.press(view.getByRole('button', { name: action }));
    await view.findByText(
      kind === 'award' ? /Employee awards could not be read/ : /vesting events could not be loaded/,
    );
    const retained = submissions(url)[0];
    expect(view.getByRole('button', { name: close })).toBeDisabled();
    expect(view.getByRole('button', { name: action })).toBeDisabled();
    await fireEvent.press(view.getByRole('button', { name: retry }));
    await waitFor(() => expect(view.getByRole('button', { name: retry })).not.toBeDisabled());
    expect(submissions(url)).toEqual([retained]);
    failedRead = null;
    await fireEvent.press(view.getByRole('button', { name: retry }));
    await waitFor(() => expect(view.getByRole('button', { name: action })).not.toBeDisabled());
    expect(view.getByRole('button', { name: close })).toBeTruthy();
    await fireEvent.press(view.getByRole('button', { name: action }));
    await waitFor(() => expect(view.queryByRole('button', { name: close })).toBeNull());
    expect(submissions(url)).toEqual([retained]);
    expect(submissions(URLS.REGISTER_EVIDENCE)).toHaveLength(kind === 'award' ? 1 : 2);
  }
  expect(awards[0]).toEqual(
    expect.objectContaining({ vestedShares: '100', issuedShares: '0', availableShares: '100' }),
  );
  await fireEvent.press(view.getByRole('button', { name: new RegExp(`^${COPY.PREPARE_GRANT}`) }));
  expect(navigate).toHaveBeenCalledWith(awards[0].uuid);
  expect(submissions(URLS.REGISTER_GRANTS)).toHaveLength(0);
});

it('hides cached private award rows and document actions when current company authority is lost', async () => {
  awards = [awardFrom(AWARD_REQUEST)];
  const view = await render(
    <ClassAwards
      company={APPOINTMENT.company}
      register={REGISTER}
      epoch={getSessionEpoch()}
      sourceReady
      onPrepareGrant={jest.fn()}
    />,
    { wrapper },
  );
  await view.findByText(`${AWARD_REQUEST.name} · ${AWARD_REQUEST.member}`);
  appointments = [{ ...APPOINTMENT, capabilities: ['finance'] }];
  await fireEvent.press(view.getByRole('button', { name: 'Refresh awards' }));
  await waitFor(() => expect(view.queryByText(`${AWARD_REQUEST.name} · ${AWARD_REQUEST.member}`)).toBeNull());
  expect(view.queryByRole('button', { name: /^Download agreement/ })).toBeNull();
  expect(view.queryByRole('button', { name: COPY.PREPARE })).toBeNull();
});
