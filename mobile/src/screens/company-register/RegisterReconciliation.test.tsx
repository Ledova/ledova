import React from 'react';
import { ApiClientProvider, AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { act, cleanup, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import { COMPANY_TOKEN_ENDPOINTS as URLS, formatDateTime, REGISTER_RECONCILIATION_COPY as COPY } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { CompanyRegisterScreen } from './CompanyRegisterScreen';
import { reconciliationKey } from './useCompanyRegister';

const mockPreferences = { userAccount: { role: 'company' }, isLoading: false, isError: false, refetch: jest.fn() };
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => mockPreferences,
}));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));

type Row = Record<string, unknown>;
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const ACKNOWLEDGE = URLS.REGISTER_RECONCILIATION_ACKNOWLEDGE('reconciliation-latest');
const READ_FAILED = 'The reconciliation could not be loaded.';
const REASON = 'The directors accept the outside transfer';
const CHANGED = 'Your appointment for this step changed. Cancel and start this acknowledgement again.';
const KEY = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const acknowledge = (number: number) => `${COPY.ACKNOWLEDGE} discrepancy ${number} of Ordinary shares`;
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const shareClass = {
  uuid: 'ordinary',
  name: 'Ordinary shares',
  symbol: 'ORD',
  companyUuid: 'paper',
  companyName: 'Paper Company',
};
const register = {
  token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'deployed', totalSupply: '9000' },
  issuedSupply: '1000',
  initialized: true,
  waitingEffects: 0,
  totalHolders: 1,
  holders: [
    {
      member: 'member-1',
      name: 'Alex Member',
      holderType: 'member',
      balance: '1060',
      enteredOn: '2026-09-01',
      wallets: [],
    },
  ],
};
const COMPANY_ACKNOWLEDGEMENT = {
  reason: 'The directors accept the unlinked holding',
  appointment: 'appointment-approver',
  acknowledgedByName: 'Robin Approver' as string | null,
  acknowledgedAt: '2026-10-05T04:00:00Z',
  providedBy: 'company',
};
const STAFF_ACKNOWLEDGEMENT = {
  reason: 'Staff accepted the supply difference',
  appointment: null,
  acknowledgedByName: null,
  acknowledgedAt: '2026-10-01T04:00:00Z',
  providedBy: 'staff',
};
const TRANSACTION = `0x${'f'.repeat(64)}`;
const ADDRESS = `0x${'1'.repeat(40)}`;
const RECONCILIATION = {
  uuid: 'reconciliation-latest',
  token: 'ordinary',
  status: 'discrepant',
  blockNumber: 1234 as number | null,
  blockHash: `0x${'e'.repeat(64)}`,
  registerSequence: 7 as number | null,
  failure: '',
  createdAt: '2026-10-05T06:50:00Z',
  latest: true,
  discrepancies: [
    {
      kind: 'unrecognised_transfer',
      transaction: TRANSACTION,
      block: 1200,
      acknowledgeable: true,
      acknowledgement: null,
    },
    {
      kind: 'member',
      member: 'member-1',
      chain: '1070',
      expected: '1060',
      acknowledgeable: true,
      acknowledgement: null,
    },
    {
      kind: 'unlinked',
      address: ADDRESS,
      chain: '5',
      expected: '0',
      acknowledgeable: false,
      acknowledgement: COMPANY_ACKNOWLEDGEMENT,
    },
    { kind: 'supply', chain: '1005', expected: '1000', acknowledgeable: false, acknowledgement: STAFF_ACKNOWLEDGEMENT },
    {
      kind: 'missing_transfer',
      effect: 'issue',
      source: 'issuance-1',
      block: 1100,
      acknowledgeable: false,
      acknowledgement: null,
    },
    { kind: 'attribution', detail: 'The completion cannot be placed.', acknowledgeable: false, acknowledgement: null },
  ] as Row[],
};
let client: QueryClient;
let reconciliations: unknown[];
let appointments: unknown[];
let failing: Set<string>;

function appointment(uuid: string, capabilities: string[], changes: object = {}) {
  return {
    uuid,
    company: 'paper',
    companyName: 'Paper Company',
    capabilities,
    delegatableCapabilities: [],
    createdAt: '2026-10-01T00:00:00Z',
    declarationText: null,
    declarationVersion: null,
    expiresAt: null,
    isEffective: true,
    revokedAt: null,
    source: 'invitation',
    status: 'active',
    ...changes,
  };
}

function acknowledged(index: number, reason = REASON, appointmentUuid = 'appointment-approver') {
  return {
    ...RECONCILIATION,
    discrepancies: RECONCILIATION.discrepancies.map((row, position) =>
      position === index
        ? {
            ...row,
            acknowledgeable: false,
            acknowledgement: {
              reason,
              appointment: appointmentUuid,
              acknowledgedByName: 'Ari Approver',
              acknowledgedAt: '2026-10-05T07:00:00Z',
              providedBy: 'company',
            },
          }
        : row,
    ),
  };
}

const page = (results: unknown[]) => ({ data: { results, next: null, count: results.length } });
const reads = (url: string) => get.mock.calls.filter(([called]) => called === url).length;
const acknowledgements = () => post.mock.calls.filter(([url]) => url === ACKNOWLEDGE);
const keys = () => acknowledgements().map(([, body]) => (body as { idempotencyKey: string }).idempotencyKey);
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}

async function openClass() {
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  await view.findByText('Discrepancy 1');
  return view;
}

async function openAcknowledgement(view: Awaited<ReturnType<typeof render>>, number = 2) {
  await fireEvent.press(view.getByRole('button', { name: acknowledge(number) }));
  return view.getByLabelText(COPY.ACKNOWLEDGE_REASON);
}

beforeEach(() => {
  reconciliations = [RECONCILIATION];
  appointments = [appointment('appointment-approver', ['approve'])];
  failing = new Set();
  let count = 0;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => KEY(++count) as ReturnType<typeof Crypto.randomUUID>);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'company' } },
  });
  post.mockReset();
  get.mockReset().mockImplementation(async (url) => {
    if (failing.has(url)) throw new Error('Unavailable');
    if (url === URLS.REGISTER) return page([shareClass]);
    if (url === URLS.HOLDERS('ordinary')) return { data: register };
    if (
      (
        [
          URLS.REGISTER_OPENINGS,
          URLS.REGISTER_IMPORTS,
          URLS.REGISTER_ENTRIES('ordinary'),
          URLS.REGISTER_CORRECTIONS,
        ] as string[]
      ).includes(url)
    )
      return page([]);
    if (url === APPOINTMENTS) return page(appointments);
    if (url === URLS.REGISTER_RECONCILIATIONS) return page(reconciliations);
    throw new Error(`Unexpected ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

it('shows the latest reconciliation with each discrepancy in words and each acknowledgement read-only', async () => {
  appointments = [appointment('appointment-reader', ['read_register'])];
  const view = await openClass();
  const session = { ledovaSessionEpoch: getSessionEpoch(), signal: expect.objectContaining({ aborted: false }) };
  expect(get.mock.calls.filter(([url]) => url === URLS.REGISTER_RECONCILIATIONS).map(([, config]) => config)).toEqual([
    { ...session, params: { token: 'ordinary' } },
  ]);
  expect(within(view.getByText('Status').parent!).getByText(COPY.STATUSES.discrepant)).toBeTruthy();
  expect(within(view.getByText('Chain block').parent!).getByText('1234')).toBeTruthy();
  expect(within(view.getByText('Register sequence compared').parent!).getByText('7')).toBeTruthy();
  expect(view.getByText(formatDateTime(RECONCILIATION.createdAt))).toBeTruthy();
  for (const kind of ['unrecognised_transfer', 'member', 'unlinked', 'supply', 'missing_transfer', 'attribution'])
    expect(view.getByText(COPY.KINDS[kind])).toBeTruthy();
  const member = view.getByText('Discrepancy 2').parent!;
  expect(within(member).getByText('Alex Member')).toBeTruthy();
  expect(within(member).getByText('1,070')).toBeTruthy();
  expect(within(member).getByText('1,060')).toBeTruthy();
  expect(within(view.getByText('Discrepancy 1').parent!).getByText(TRANSACTION)).toBeTruthy();
  expect(within(view.getByText('Discrepancy 1').parent!).getByText('1200')).toBeTruthy();
  expect(within(view.getByText('Discrepancy 3').parent!).getByText(ADDRESS)).toBeTruthy();
  expect(within(view.getByText('Discrepancy 5').parent!).getByText('issuance-1')).toBeTruthy();
  expect(view.getByText('The completion cannot be placed.')).toBeTruthy();
  const company = view.getByText('Discrepancy 3').parent!;
  expect(within(company).getByText(COPY.PROVIDED_BY.company)).toBeTruthy();
  expect(within(company).getByText(COMPANY_ACKNOWLEDGEMENT.reason)).toBeTruthy();
  expect(within(company).getByText('Robin Approver')).toBeTruthy();
  expect(within(company).getByText(formatDateTime(COMPANY_ACKNOWLEDGEMENT.acknowledgedAt))).toBeTruthy();
  const staff = view.getByText('Discrepancy 4').parent!;
  expect(within(staff).getByText(COPY.PROVIDED_BY.staff)).toBeTruthy();
  expect(within(staff).getByText(STAFF_ACKNOWLEDGEMENT.reason)).toBeTruthy();
  expect(within(staff).queryByText('Acknowledged by')).toBeNull();
  expect(within(staff).getByText(formatDateTime(STAFF_ACKNOWLEDGEMENT.acknowledgedAt))).toBeTruthy();
  for (const number of [5, 6])
    expect(within(view.getByText(`Discrepancy ${number}`).parent!).getByText(COPY.ATTRIBUTION_NOTE)).toBeTruthy();
  for (const number of [1, 2])
    expect(within(view.getByText(`Discrepancy ${number}`).parent!).getByText(COPY.ACKNOWLEDGEABLE_NOTE)).toBeTruthy();
  expect(view.getAllByText(COPY.ATTRIBUTION_NOTE)).toHaveLength(2);
  expect(view.getAllByText(COPY.ACKNOWLEDGEABLE_NOTE)).toHaveLength(2);
  expect(view.getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(view.queryByRole('button', { name: /^Acknowledge discrepancy/ })).toBeNull();
});

it('names an acknowledgement without a recorded name neutrally', async () => {
  reconciliations = [
    {
      ...RECONCILIATION,
      discrepancies: [
        { ...RECONCILIATION.discrepancies[2], acknowledgement: { ...COMPANY_ACKNOWLEDGEMENT, acknowledgedByName: '' } },
      ],
    },
  ];
  const view = await openClass();
  expect(within(view.getByText('Discrepancy 1').parent!).getByText('Name not recorded')).toBeTruthy();
});

it.each([
  ['an approver', [appointment('appointment-step', ['approve'])], true],
  ['an administrator', [appointment('appointment-step', ['admin'])], true],
  ['a preparer', [appointment('appointment-step', ['prepare'])], false],
  ['an applier', [appointment('appointment-step', ['apply'])], false],
  [
    'a revoked approver',
    [appointment('appointment-step', ['approve'], { status: 'revoked', isEffective: false })],
    false,
  ],
  ['another company approver', [appointment('appointment-step', ['approve'], { company: 'garden' })], false],
])('offers %s acknowledgement of acknowledgeable rows only as its appointment allows', async (_, own, offered) => {
  appointments = own;
  const view = await openClass();
  for (const number of [1, 2]) expect(!!view.queryByRole('button', { name: acknowledge(number) })).toBe(offered);
  for (const number of [3, 4, 5, 6]) expect(view.queryByRole('button', { name: acknowledge(number) })).toBeNull();
  expect(!!view.queryByText(COPY.READ_ONLY_NOTE)).toBe(!offered);
});

it('says plainly that a class has no reconciliation yet', async () => {
  reconciliations = [];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(COPY.EMPTY)).toBeTruthy();
  expect(view.queryByText('Discrepancy 1')).toBeNull();
  expect(view.queryByText('Status')).toBeNull();
});

it('shows only the latest of the class reconciliations, which the API lists newest first', async () => {
  reconciliations = [
    RECONCILIATION,
    {
      ...RECONCILIATION,
      uuid: 'reconciliation-older',
      status: 'failed',
      failure: 'An older run could not read the chain.',
      createdAt: '2026-10-04T06:50:00Z',
      latest: false,
      discrepancies: [],
    },
  ];
  const view = await openClass();
  expect(view.getAllByText('Status')).toHaveLength(1);
  expect(within(view.getByText('Status').parent!).getByText(COPY.STATUSES.discrepant)).toBeTruthy();
  expect(view.queryByText('An older run could not read the chain.')).toBeNull();
});

it('follows the server on whether a row can be acknowledged, whatever its kind', async () => {
  reconciliations = [
    {
      ...RECONCILIATION,
      discrepancies: [
        { ...RECONCILIATION.discrepancies[1], acknowledgeable: false },
        { kind: 'future_kind', acknowledgeable: true, acknowledgement: null },
      ],
    },
  ];
  const view = await openClass();
  expect(within(view.getByText('Discrepancy 1').parent!).queryByText(COPY.ACKNOWLEDGEABLE_NOTE)).toBeNull();
  expect(view.queryByRole('button', { name: acknowledge(1) })).toBeNull();
  expect(view.getByText('future_kind')).toBeTruthy();
  expect(view.getByRole('button', { name: acknowledge(2) })).toBeTruthy();
});

it('shows a failed reconciliation with its failure text and nothing it could not compare', async () => {
  reconciliations = [
    {
      ...RECONCILIATION,
      status: 'failed',
      blockNumber: null,
      registerSequence: null,
      failure: 'The chain snapshot is below the opening boundary.',
      discrepancies: [],
    },
  ];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(COPY.FAILED_NOTE)).toBeTruthy();
  expect(view.getByText('The chain snapshot is below the opening boundary.')).toBeTruthy();
  expect(within(view.getByText('Status').parent!).getByText(COPY.STATUSES.failed)).toBeTruthy();
  expect(within(view.getByText('Chain block').parent!).getByText('Not recorded')).toBeTruthy();
  expect(within(view.getByText('Register sequence compared').parent!).getByText('Not recorded')).toBeTruthy();
  expect(view.queryByText('Discrepancy 1')).toBeNull();
});

it('does not call a matched reconciliation failed', async () => {
  reconciliations = [{ ...RECONCILIATION, status: 'matched', discrepancies: [] }];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(COPY.STATUSES.matched)).toBeTruthy();
  expect(view.queryByText(COPY.FAILED_NOTE)).toBeNull();
});

it('acknowledges one row with its trimmed reason, confirms the receipt and reads the reconciliation again', async () => {
  post.mockImplementationOnce(async () => {
    reconciliations = [acknowledged(1)];
    return { data: acknowledged(1) };
  });
  const view = await openClass();
  const epoch = getSessionEpoch();
  const before = reads(URLS.REGISTER_RECONCILIATIONS);
  const reason = await openAcknowledgement(view);
  expect(reason.props.maxLength).toBe(1000);
  expect(view.getAllByText(COPY.KINDS.member)).toHaveLength(2);
  expect(view.getByText(COPY.ACKNOWLEDGEMENT_NOTE)).toBeTruthy();
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await fireEvent.changeText(reason, '   ');
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await fireEvent.changeText(reason, `  ${REASON}  `);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  expect(post).toHaveBeenCalledWith(
    ACKNOWLEDGE,
    { appointment: 'appointment-approver', discrepancy: 1, reason: REASON, idempotencyKey: KEY(1) },
    { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: expect.any(Function) },
  );
  await waitFor(() => expect(reads(URLS.REGISTER_RECONCILIATIONS)).toBeGreaterThan(before));
  const row = view.getByText('Discrepancy 2').parent!;
  expect(await within(row).findByText(REASON)).toBeTruthy();
  expect(within(row).getByText('Ari Approver')).toBeTruthy();
  expect(view.queryByRole('button', { name: acknowledge(2) })).toBeNull();
  expect(view.getByRole('button', { name: acknowledge(1) })).toBeTruthy();
});

it.each([
  ['another reason', acknowledged(1, 'Something else')],
  ['another appointment', acknowledged(1, REASON, 'appointment-other')],
  ['another row', acknowledged(0)],
])('keeps the dialog open and reads nothing again for a receipt naming %s', async (_, receipt) => {
  post.mockResolvedValueOnce({ data: receipt });
  const view = await openClass();
  const before = [reads(URLS.REGISTER_RECONCILIATIONS), reads(APPOINTMENTS)];
  await fireEvent.changeText(await openAcknowledgement(view), REASON);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(await view.findByText(COPY.ACKNOWLEDGEMENT_RECEIPT_FAILED)).toBeTruthy();
  expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  expect([reads(URLS.REGISTER_RECONCILIATIONS), reads(APPOINTMENTS)]).toEqual(before);
  expect(client.getQueryData(reconciliationKey(getSessionEpoch(), 'ordinary'))).toEqual(RECONCILIATION);
});

it('words a refusal, reads the reconciliation and appointments again and takes a new key', async () => {
  post
    .mockRejectedValueOnce({ response: { status: 400, data: ['This discrepancy is already acknowledged.'] } })
    .mockResolvedValueOnce({ data: acknowledged(1) });
  const view = await openClass();
  const before = [reads(URLS.REGISTER_RECONCILIATIONS), reads(APPOINTMENTS)];
  await fireEvent.changeText(await openAcknowledgement(view), REASON);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(await view.findByText('This discrepancy is already acknowledged.')).toBeTruthy();
  await waitFor(() => expect(reads(URLS.REGISTER_RECONCILIATIONS)).toBeGreaterThan(before[0]));
  await waitFor(() => expect(reads(APPOINTMENTS)).toBeGreaterThan(before[1]));
  await waitFor(() => expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  expect(keys()).toEqual([KEY(1), KEY(2)]);
});

it('retries an unanswered acknowledgement under its key and takes a new key for a changed reason', async () => {
  post
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockRejectedValueOnce(new Error('Network Error'))
    .mockResolvedValueOnce({ data: acknowledged(1, 'Accepted after review') });
  const view = await openClass();
  const reason = await openAcknowledgement(view);
  await fireEvent.changeText(reason, REASON);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(await view.findByText('Network Error')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(acknowledgements()).toHaveLength(2));
  await waitFor(() => expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  await fireEvent.changeText(view.getByLabelText(COPY.ACKNOWLEDGE_REASON), 'Accepted after review');
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  expect(keys()).toEqual([KEY(1), KEY(1), KEY(2)]);
});

it('clears an earlier failure and reason when the acknowledgement opens again', async () => {
  post.mockRejectedValueOnce(new Error('Network Error'));
  const view = await openClass();
  await fireEvent.changeText(await openAcknowledgement(view), REASON);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(await view.findByText('Network Error')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  const reason = await openAcknowledgement(view);
  expect(reason.props.value).toBe('');
  expect(view.queryByText('Network Error')).toBeNull();
});

it('closes the dialog when a newer reconciliation replaces the record it opened on', async () => {
  const view = await openClass();
  await fireEvent.changeText(await openAcknowledgement(view), REASON);
  reconciliations = [{ ...RECONCILIATION, uuid: 'reconciliation-next', createdAt: '2026-10-05T12:50:00Z' }];
  await act(() => view.getByTestId('register-screen').props.refreshControl.props.onRefresh());
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  expect(view.getByRole('button', { name: acknowledge(2) })).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
});

it('holds an open acknowledgement once the step is held by another appointment', async () => {
  post.mockResolvedValueOnce({ data: acknowledged(1, REASON, 'appointment-aaa') });
  const view = await openClass();
  await fireEvent.changeText(await openAcknowledgement(view), REASON);
  expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled();
  expect(view.queryByText(CHANGED)).toBeNull();
  appointments = [appointment('appointment-approver', ['approve']), appointment('appointment-aaa', ['approve'])];
  await act(() => view.getByTestId('register-screen').props.refreshControl.props.onRefresh());
  expect(await view.findByText(CHANGED)).toBeTruthy();
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  expect(post).not.toHaveBeenCalled();
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  await fireEvent.changeText(await openAcknowledgement(view), REASON);
  expect(view.queryByText(CHANGED)).toBeNull();
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull());
  expect(post).toHaveBeenCalledWith(
    ACKNOWLEDGE,
    { appointment: 'appointment-aaa', discrepancy: 1, reason: REASON, idempotencyKey: KEY(1) },
    expect.anything(),
  );
});

it('withdraws acknowledgement once a pull to refresh reads the appointment as revoked', async () => {
  const view = await openClass();
  await openAcknowledgement(view);
  appointments = [appointment('appointment-approver', ['approve'], { status: 'revoked', isEffective: false })];
  await act(() => view.getByTestId('register-screen').props.refreshControl.props.onRefresh());
  await waitFor(() => expect(view.queryByRole('button', { name: acknowledge(1) })).toBeNull());
  expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull();
  expect(view.getByText(COPY.READ_ONLY_NOTE)).toBeTruthy();
});

it('drops an open acknowledgement when the session changes and ignores its late answer', async () => {
  const late = deferred();
  post.mockReturnValueOnce(late.promise as ReturnType<typeof post>);
  const view = await openClass();
  const epoch = getSessionEpoch();
  await fireEvent.changeText(await openAcknowledgement(view), REASON);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  const { ledovaSubmissionGuard } = post.mock.calls[0][2] as { ledovaSubmissionGuard: () => void };
  expect(ledovaSubmissionGuard).not.toThrow();
  await act(() => invalidateSessionScope());
  expect(ledovaSubmissionGuard).toThrow('The saved session changed.');
  expect(view.queryByRole('button', { name: 'Confirm' })).toBeNull();
  const retired = get.mock.calls.length;
  await act(async () => late.resolve({ data: acknowledged(1) }));
  expect(get.mock.calls.slice(retired).filter(([, config]) => config?.ledovaSessionEpoch === epoch)).toEqual([]);
  expect(client.getQueryState(reconciliationKey(epoch, 'ordinary'))?.errorUpdateCount).toBe(0);
  expect(view.queryByText(COPY.ACKNOWLEDGEMENT_RECEIPT_FAILED)).toBeNull();
  await view.findByRole('button', { name: 'Ordinary shares register' });
});

it('reads nothing for the old session when an acknowledgement is refused after the session changes', async () => {
  const late = deferred();
  post.mockReturnValueOnce(late.promise as ReturnType<typeof post>);
  const view = await openClass();
  const epoch = getSessionEpoch();
  await fireEvent.changeText(await openAcknowledgement(view), REASON);
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  await act(() => invalidateSessionScope());
  const retired = get.mock.calls.length;
  await act(async () =>
    late.reject({ response: { status: 400, data: ['This discrepancy is already acknowledged.'] } }),
  );
  expect(get.mock.calls.slice(retired).filter(([, config]) => config?.ledovaSessionEpoch === epoch)).toEqual([]);
  expect(view.queryByText('This discrepancy is already acknowledged.')).toBeNull();
  await view.findByRole('button', { name: 'Ordinary shares register' });
});

it('offers no acknowledgement and no read-only note while the appointments cannot be read', async () => {
  failing = new Set([APPOINTMENTS]);
  const view = await openClass();
  expect(await view.findByText('Your appointments could not be read, so register actions are hidden.')).toBeTruthy();
  expect(view.queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
  expect(view.queryByRole('button', { name: acknowledge(1) })).toBeNull();
  failing = new Set();
  await fireEvent.press(view.getByRole('button', { name: 'Retry appointments for Ordinary shares' }));
  expect(await view.findByRole('button', { name: acknowledge(1) })).toBeTruthy();
  expect(view.queryByText(COPY.READ_ONLY_NOTE)).toBeNull();
});

it('refuses a reconciliation of another class and offers a retry', async () => {
  reconciliations = [{ ...RECONCILIATION, token: 'preference' }];
  const view = await render(<CompanyRegisterScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Ordinary shares register' }));
  expect(await view.findByText(READ_FAILED)).toBeTruthy();
  expect(view.queryByText('Discrepancy 1')).toBeNull();
  reconciliations = [RECONCILIATION];
  await fireEvent.press(view.getByRole('button', { name: 'Retry the reconciliation for Ordinary shares' }));
  expect(await view.findByText('Discrepancy 1')).toBeTruthy();
});
