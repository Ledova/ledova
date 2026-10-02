import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, OFFER_DOCUMENT_COPY } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { OfferingsScreen } from './OfferingsScreen';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';

let mockRole = 'company';
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({ userAccount: { role: mockRole }, isLoading: false, isError: false }),
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual('react-native');
  return { __esModule: true, default: View };
});
jest.mock('../../services/apiClient', () => ({
  apiClient: { get: jest.fn(), patch: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
const get = jest.mocked(apiClient.get);
const patch = jest.mocked(apiClient.patch);
const post = jest.mocked(apiClient.post);
const remove = jest.mocked(apiClient.delete);
const COMPANY = '/api/v1/companies/company-a/';
const OFFERINGS = '/api/v1/offerings/';
const OFFERING = '/api/v1/offerings/offering-a/';
const SUBSCRIPTIONS = '/api/v1/offerings/offering-a/subscriptions/';
const OPERATOR = '/api/operator/';
const TOKENS = '/api/v1/tokens/';
const company = {
  uuid: 'company-a',
  name: 'Example Company',
  status: 'active',
  statusDisplay: 'Active',
  canIssueTokens: true,
  isOpenToInvestors: false,
};
const draft = {
  uuid: 'offering-a',
  tokenUuid: 'token-a',
  tokenName: 'Ordinary shares',
  tokenSymbol: 'EXA',
  status: 'draft',
  statusDisplay: 'Draft',
  canBeEdited: true,
  canBeDeleted: true,
  isOpen: false,
  pricePerShare: '9999999999999999.99',
  priceCurrency: 'AUD',
  minimumShares: 1,
  targetShares: 100,
  capShares: 1000,
  maximumShares: null,
  opensAt: '2026-10-01T10:00:00Z',
  closesAt: null,
  exemption: 's708_11_professional',
  exemptionDisplay: 'Professional investors',
  summary: 'An example offering',
  useOfProceeds: 'Fictional works',
  acceptsBankTransfer: true,
  settlementAssets: [],
  createdAt: '2026-09-27T10:00:00Z',
};
let current = { ...company };
let detail = { ...draft };
let listed = { ...draft };
let client: QueryClient;
let failure: string | null;
let badPage: string | null;
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
function page(results: unknown[], number: number) {
  return { data: { results, count: 2, next: number === 1 ? 'https://example.test/?page=2' : null, previous: null } };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  mockRole = 'company';
  failure = null;
  badPage = null;
  current = { ...company };
  detail = { ...draft };
  listed = { ...draft };
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
  });
  get.mockReset();
  patch.mockReset();
  post.mockReset();
  remove.mockReset();
  patch.mockResolvedValue({ data: {} });
  post.mockResolvedValue({ data: {} });
  remove.mockResolvedValue({ data: {} });
  get.mockImplementation(async (url, config) => {
    if (url === failure) throw new Error('Synthetic read refusal');
    const number = (config?.params as { page?: number } | undefined)?.page ?? 1;
    if (url === badPage && number === 2) throw new Error('Second page refused');
    if (url === '/api/v1/companies/') return { data: { results: [{ uuid: current.uuid, name: 'Incomplete' }] } };
    if (url === COMPANY) return { data: { ...current } };
    if (url === OPERATOR) return { data: { name: 'Example Operator', supportedSettlementAssets: [] } };
    if (url === TOKENS)
      return page(
        number === 1
          ? [
              {
                uuid: 'foreign',
                companyUuid: 'foreign-company',
                name: 'Foreign class',
                symbol: 'BAD',
                status: 'deployed',
              },
            ]
          : [
              {
                uuid: 'token-a',
                companyUuid: company.uuid,
                name: 'Ordinary shares',
                symbol: 'EXA',
                status: 'deployed',
              },
            ],
        number,
      );
    if (url === OFFERINGS)
      return page(
        number === 1
          ? [{ ...draft, uuid: 'foreign-offering', tokenUuid: 'foreign', tokenName: 'Foreign offering' }]
          : [{ ...listed }],
        number,
      );
    if (url === OFFERING) return { data: { ...detail } };
    if (url === SUBSCRIPTIONS)
      return page(
        [
          {
            uuid: `subscription-${number}`,
            investorName: `Example investor ${number}`,
            quantity: number === 1 ? 1 : 7,
            allottedQuantity: null,
            amountDue: '17.50',
            amountReceived: number === 1 ? null : '0.00',
            status: 'pending',
            statusDisplay: 'Pending',
            settlementRailDisplay: 'Bank transfer',
            reference: `EXAMPLE-${number}`,
            allotmentState: 'not_started',
          },
        ],
        number,
      );
    throw new Error(`Unexpected GET ${url}`);
  });
});
afterEach(async () => {
  await cleanup();
  client.clear();
});
async function start() {
  const view = await render(<OfferingsScreen />, { wrapper });
  await view.findByText('Your offerings (1)');
  await waitFor(() => expect(view.getByRole('button', { name: 'New offering' })).toBeEnabled());
  return view;
}
async function edit() {
  const view = await start();
  await fireEvent.press(view.getByRole('button', { name: 'Edit Ordinary shares offering' }));
  await view.findByLabelText('Summary');
  await waitFor(() => expect(view.getByRole('button', { name: 'Save changes' })).toBeEnabled());
  return view;
}

it('reads all owned offering, class and application pages and retains precise money and zero versus missing amounts', async () => {
  const view = await start();
  expect(view.queryByText('Foreign offering (EXA)')).toBeNull();
  expect(await view.findByText('Example investor 2')).toBeTruthy();
  expect(view.getByRole('header', { name: 'Applications' })).toBeTruthy();
  expect(
    view.getByText(
      'Read-only. Payment confirmation and allotment are done by Example Operator; this is where you watch them happen.',
    ),
  ).toBeTruthy();
  expect(view.getByText('2 applications')).toBeTruthy();
  expect(view.getByText(/AUD\s9,999,999,999,999,999\.99/)).toBeTruthy();
  expect(view.getByText(/AUD\s0\.00/)).toBeTruthy();
  expect(view.getByText('EXAMPLE-2')).toBeTruthy();
  for (const url of [TOKENS, OFFERINGS, SUBSCRIPTIONS]) expect(get).toHaveBeenCalledWith(url, { params: { page: 2 } });
});

it('puts Your offerings first, then its applications, the directory switch and what happens next', async () => {
  const view = await start();
  expect(view.getAllByRole('header').map((header) => header.props.children)).toEqual([
    'Offerings',
    'Your offerings (1)',
    'Applications',
    'Investor Directory',
    'What happens next',
  ]);
});

it('makes no company or offering read for a member account', async () => {
  mockRole = 'member';
  const view = await render(<OfferingsScreen />, { wrapper });
  expect(view.getByText('Verify your company access before opening Offerings.')).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
});

it('does not present incomplete applications as complete and retries every page', async () => {
  badPage = SUBSCRIPTIONS;
  const view = await start();
  expect(await view.findByText('Applications could not be loaded. Try again before continuing.')).toBeTruthy();
  expect(view.queryByText('Example investor 1')).toBeNull();
  badPage = null;
  await fireEvent.press(view.getByRole('button', { name: 'Retry applications' }));
  expect(await view.findByText('Example investor 2')).toBeTruthy();
});

it('suppresses stale list actions after failed reads while preserving an edit draft through recovery', async () => {
  const view = await edit();
  await fireEvent.changeText(view.getByLabelText('Summary'), 'Retained draft');
  failure = OFFERINGS;
  await act(() => client.invalidateQueries({ queryKey: ['offerings'] }));
  expect(view.getByLabelText('Summary').props.value).toBe('Retained draft');
  await waitFor(() => expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled());
  expect(view.queryByText('Your offerings (1)')).toBeNull();
  expect(patch).not.toHaveBeenCalled();
  failure = null;
  await act(() => client.invalidateQueries({ queryKey: ['offerings'] }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Save changes' })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  await waitFor(() =>
    expect(patch).toHaveBeenCalledWith(OFFERING, expect.objectContaining({ summary: 'Retained draft' }), {
      ledovaSessionEpoch: getSessionEpoch(),
    }),
  );
});

it('requires a fresh detail before editing and blocks an already open draft when current authority changes', async () => {
  failure = OFFERING;
  const view = await start();
  await fireEvent.press(view.getByRole('button', { name: 'Edit Ordinary shares offering' }));
  expect(await view.findByText('Current offering could not be loaded. Try again before continuing.')).toBeTruthy();
  expect(view.queryByLabelText('Summary')).toBeNull();
  failure = null;
  await fireEvent.press(view.getByRole('button', { name: 'Retry current offering' }));
  await view.findByLabelText('Summary');
  await fireEvent.changeText(view.getByLabelText('Summary'), 'Keep current draft');
  detail = { ...detail, canBeEdited: false, status: 'submitted' };
  await act(() => client.invalidateQueries({ queryKey: ['offering'] }));
  expect(await view.findByText('This offering can no longer be edited.')).toBeTruthy();
  expect(view.getByLabelText('Summary').props.value).toBe('Keep current draft');
  await waitFor(() => expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled());
  expect(patch).not.toHaveBeenCalled();
});

it('blocks a held current detail refetch and preserves pending and refused edits', async () => {
  const view = await edit();
  const held = deferred<{ data: typeof draft }>();
  const existing = get.getMockImplementation()!;
  get.mockImplementation((url, config) => (url === OFFERING ? held.promise : existing(url, config)));
  let refreshing!: Promise<void>;
  await act(() => {
    refreshing = client.invalidateQueries({ queryKey: ['offering'] });
  });
  await waitFor(() => expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled());
  await act(() => {
    held.resolve({ data: { ...detail } });
    return refreshing;
  });
  const saving = deferred<{ data: object }>();
  patch.mockReturnValueOnce(saving.promise);
  await fireEvent.changeText(view.getByLabelText('Summary'), 'Refused draft');
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Cancel' })).toBeDisabled());
  expect(view.getByLabelText('Summary').props.editable).toBe(false);
  await act(() => saving.reject(new Error('Refused')));
  expect(await view.findByText('The offering could not be saved. Try again.')).toBeTruthy();
  expect(view.getByLabelText('Summary').props.value).toBe('Refused draft');
  expect(patch).toHaveBeenCalledTimes(1);
});

it('blocks Directory visibility when company refresh fails and reports a refused current toggle', async () => {
  const view = await start();
  failure = COMPANY;
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  await waitFor(() => expect(view.queryByLabelText('Show this company to eligible investors')).toBeNull());
  expect(patch).not.toHaveBeenCalled();
  failure = null;
  await fireEvent.press(view.getByRole('button', { name: 'Retry company information' }));
  await waitFor(() =>
    expect(view.getByLabelText('Show this company to eligible investors').props.disabled).toBe(false),
  );
  patch.mockRejectedValueOnce(new Error('Refused'));
  await fireEvent(view.getByLabelText('Show this company to eligible investors'), 'valueChange', true);
  expect(await view.findByText('Directory visibility could not be changed. Try again.')).toBeTruthy();
  expect(view.getByRole('alert', { name: 'Directory visibility could not be changed. Try again.' })).toBeTruthy();
  expect(view.getByLabelText('Show this company to eligible investors').props.value).toBe(false);
  expect(patch).toHaveBeenLastCalledWith(
    COMPANY,
    { isOpenToInvestors: true },
    { ledovaSessionEpoch: getSessionEpoch() },
  );
});

it('holds the directory switch while its change is saving', async () => {
  const view = await start();
  const saving = deferred<{ data: object }>();
  patch.mockReturnValueOnce(saving.promise);
  try {
    await fireEvent(view.getByLabelText('Show this company to eligible investors'), 'valueChange', true);
    await waitFor(() =>
      expect(view.getByLabelText('Show this company to eligible investors').props.disabled).toBe(true),
    );
    expect(view.getByLabelText('Show this company to eligible investors').props.value).toBe(false);
  } finally {
    current = { ...current, isOpenToInvestors: true };
    await act(() => saving.resolve({ data: {} }));
  }
  await waitFor(() => {
    expect(view.getByLabelText('Show this company to eligible investors').props.disabled).toBe(false);
    expect(view.getByLabelText('Show this company to eligible investors').props.value).toBe(true);
  });
  expect(patch).toHaveBeenCalledTimes(1);
});

it('keeps the directory switch disabled for a company that cannot issue shares yet', async () => {
  current = { ...company, canIssueTokens: false, status: 'approved', statusDisplay: 'Approved' };
  const view = await start();
  expect(view.getByLabelText('Show this company to eligible investors').props.disabled).toBe(true);
  expect(view.getByText(/It is currently Approved/)).toBeTruthy();
  await fireEvent(view.getByLabelText('Show this company to eligible investors'), 'valueChange', true);
  expect(patch).not.toHaveBeenCalled();
});

it('exposes an operator failure, retries it and does not guess settlement rails', async () => {
  failure = OPERATOR;
  const view = await render(<OfferingsScreen />, { wrapper });
  expect(await view.findByText('Offering information could not be loaded. Try again before continuing.')).toBeTruthy();
  expect(view.getByRole('button', { name: 'New offering' })).toBeDisabled();
  expect(view.queryByText('Your offerings (1)')).toBeNull();
  failure = null;
  await fireEvent.press(view.getByRole('button', { name: 'Retry offering information' }));
  expect(await view.findByText('Your offerings (1)')).toBeTruthy();
});

it('uses issuer action contracts, refuses duplicate pending actions and retains refusal feedback', async () => {
  const view = await start();
  const pending = deferred<{ data: object }>();
  post.mockReturnValueOnce(pending.promise);
  await fireEvent.press(view.getByRole('button', { name: 'Submit for review Ordinary shares' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Submit for review Ordinary shares' })).toBeDisabled());
  expect(post).toHaveBeenCalledWith(
    '/api/v1/offerings/offering-a/submit/',
    {},
    { ledovaSessionEpoch: getSessionEpoch() },
  );
  expect(post).toHaveBeenCalledTimes(1);
  await act(() => pending.reject(new Error('Refused')));
  expect(await view.findByText('The request could not be completed. Try again.')).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Delete Ordinary shares offering' }));
  await waitFor(() => expect(remove).toHaveBeenCalledWith(OFFERING, { ledovaSessionEpoch: getSessionEpoch() }));
});

it('creates a bounded draft through the existing API and retains all inputs on refusal', async () => {
  const view = await start();
  await fireEvent.press(view.getByRole('button', { name: 'New offering' }));
  for (const [label, value] of [
    ['Price per share (AUD)', '2.50'],
    ['Minimum shares', '1'],
    ['Target shares', '100'],
    ['Cap shares', '1000'],
    ['Summary', 'New example'],
  ])
    await fireEvent.changeText(view.getByLabelText(label), value);
  expect(view.getByRole('button', { name: 'Create draft offering' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Opens at: choose date' }));
  await fireEvent(
    view.getByTestId('offering-date-Opens at'),
    'change',
    { type: 'set' },
    new Date('2026-10-01T10:00:00Z'),
  );
  post.mockRejectedValueOnce({ response: { data: { detail: 'Example offering refused' } } });
  await fireEvent.press(view.getByRole('button', { name: 'Create draft offering' }));
  expect(await view.findByText('Example offering refused')).toBeTruthy();
  expect(view.getByLabelText('Summary').props.value).toBe('New example');
  expect(post).toHaveBeenCalledWith(
    OFFERINGS,
    expect.objectContaining({
      token: 'token-a',
      pricePerShare: '2.50',
      minimumShares: 1,
      targetShares: 100,
      capShares: 1000,
      opensAt: '2026-10-01T10:00:00.000Z',
      closesAt: null,
      acceptsBankTransfer: true,
      settlementAssets: [],
    }),
    { ledovaSessionEpoch: getSessionEpoch() },
  );
});

it.each(['success', 'refusal'])(
  'keeps an old editor draft and suppresses callbacks after session retirement on %s',
  async (outcome) => {
    const view = await edit();
    await fireEvent.changeText(view.getByLabelText('Summary'), 'Retained old draft');
    const pending = deferred<{ data: object }>();
    patch.mockReturnValueOnce(pending.promise);
    const epoch = getSessionEpoch();
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith(OFFERING, expect.any(Object), { ledovaSessionEpoch: epoch }),
    );
    const refresh = jest.spyOn(client, 'invalidateQueries');
    await act(() => {
      invalidateSessionScope();
    });
    await act(() => (outcome === 'success' ? pending.resolve({ data: {} }) : pending.reject(new Error('Old refusal'))));
    await waitFor(() => expect(view.getByRole('button', { name: 'Save changes' })).toBeEnabled());
    expect(view.getByLabelText('Summary').props.value).toBe('Retained old draft');
    expect(view.queryByRole('alert')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  },
);

it.each([
  ['submit', 'Submit for review Ordinary shares', 'success'],
  ['submit', 'Submit for review Ordinary shares', 'refusal'],
  ['withdraw', 'Withdraw Ordinary shares offering', 'success'],
  ['withdraw', 'Withdraw Ordinary shares offering', 'refusal'],
  ['delete', 'Delete Ordinary shares offering', 'success'],
  ['delete', 'Delete Ordinary shares offering', 'refusal'],
  ['directory', 'Show this company to eligible investors', 'success'],
  ['directory', 'Show this company to eligible investors', 'refusal'],
])('suppresses old %s %s callbacks after session retirement (%s)', async (action, label, outcome) => {
  const view = await start();
  const pending = deferred<{ data: object }>();
  const method = action === 'delete' ? remove : action === 'directory' ? patch : post;
  method.mockReturnValueOnce(pending.promise);
  const epoch = getSessionEpoch();
  if (action === 'directory') await fireEvent(view.getByLabelText(label), 'valueChange', true);
  else await fireEvent.press(view.getByRole('button', { name: label }));
  await waitFor(() => expect(method).toHaveBeenCalledTimes(1));
  expect(method.mock.calls[0].at(-1)).toEqual({ ledovaSessionEpoch: epoch });
  const refresh = jest.spyOn(client, 'invalidateQueries');
  await act(() => {
    invalidateSessionScope();
  });
  await act(() => (outcome === 'success' ? pending.resolve({ data: {} }) : pending.reject(new Error('Old refusal'))));
  await waitFor(() => expect(view.getByRole('button', { name: 'New offering' })).toBeEnabled());
  expect(view.queryByRole('alert')).toBeNull();
  expect(refresh).not.toHaveBeenCalled();
});

const DOCUMENTS = `${OFFERING}documents/`;
function companyDocument(uuid: string, documentType: string, documentTypeDisplay: string) {
  return { uuid, name: `${uuid}.pdf`, documentType, documentTypeDisplay };
}
function publish(status: 'approved' | 'closed') {
  listed = { ...draft, status, statusDisplay: status, canBeEdited: false, canBeDeleted: false };
  detail = { ...listed, documents: ['memorandum'] } as typeof detail;
  current = {
    ...company,
    documents: [
      companyDocument('memorandum', 'prospectus', 'Prospectus or Information Memorandum'),
      companyDocument('supplement', 'risk_disclosure', 'Risk Disclosure Statement'),
      companyDocument('register', 'share_register', 'Current Share Register'),
    ],
  } as typeof current;
}
async function openDocuments() {
  const view = await start();
  await fireEvent.press(view.getByRole('button', { name: 'Add documents to the Ordinary shares offering' }));
  await waitFor(() => expect(view.getByLabelText('Attach supplement.pdf').props.disabled).toBe(false));
  return view;
}

it.each(['approved', 'closed'] as const)(
  'adds documents to a %s offering and never offers to remove one',
  async (status) => {
    publish(status);
    const view = await openDocuments();
    expect(view.getByLabelText('Attach memorandum.pdf').props).toEqual(
      expect.objectContaining({ value: true, disabled: true }),
    );
    expect(view.getByText('Prospectus or Information Memorandum · Attached')).toBeTruthy();
    expect(view.queryByLabelText('Attach register.pdf')).toBeNull();
    expect(view.getByRole('button', { name: 'Add documents' })).toBeDisabled();
    await fireEvent(view.getByLabelText('Attach supplement.pdf'), 'valueChange', true);
    await fireEvent.press(view.getByRole('button', { name: 'Add documents' }));
    await waitFor(() => expect(view.queryByLabelText('Attach supplement.pdf')).toBeNull());
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      DOCUMENTS,
      { documents: ['supplement'] },
      { ledovaSessionEpoch: getSessionEpoch() },
    );
  },
);

it.each(['draft', 'submitted', 'under_review', 'rejected', 'withdrawn'])(
  'offers no way to add documents to a %s offering',
  async (status) => {
    listed = { ...draft, status };
    const view = await start();
    expect(view.queryByRole('button', { name: 'Add documents to the Ordinary shares offering' })).toBeNull();
  },
);

it('keeps the dialog open with the refusal when the documents cannot be added', async () => {
  publish('approved');
  post.mockRejectedValueOnce({ response: { data: { detail: 'Documents can be added to a draft offering.' } } });
  const view = await openDocuments();
  await fireEvent(view.getByLabelText('Attach supplement.pdf'), 'valueChange', true);
  await fireEvent.press(view.getByRole('button', { name: 'Add documents' }));
  expect(await view.findByRole('alert', { name: 'Documents can be added to a draft offering.' })).toBeTruthy();
  expect(view.getByLabelText('Attach supplement.pdf').props.value).toBe(true);
  expect(view.getByRole('button', { name: 'Add documents' })).toBeEnabled();
});

it.each(['success', 'refusal'])(
  'suppresses an old documents addition after session retirement (%s)',
  async (outcome) => {
    publish('approved');
    const view = await openDocuments();
    const pending = deferred<{ data: object }>();
    post.mockReturnValueOnce(pending.promise);
    const epoch = getSessionEpoch();
    await fireEvent(view.getByLabelText('Attach supplement.pdf'), 'valueChange', true);
    await fireEvent.press(view.getByRole('button', { name: 'Add documents' }));
    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(DOCUMENTS, { documents: ['supplement'] }, { ledovaSessionEpoch: epoch }),
    );
    const refresh = jest.spyOn(client, 'invalidateQueries');
    await act(() => {
      invalidateSessionScope();
    });
    await act(() => (outcome === 'success' ? pending.resolve({ data: {} }) : pending.reject(new Error('Old refusal'))));
    await waitFor(() => expect(view.getByRole('button', { name: 'Cancel' })).toBeEnabled());
    expect(view.getByLabelText('Attach supplement.pdf')).toBeTruthy();
    expect(view.queryByRole('alert')).toBeNull();
    expect(refresh).not.toHaveBeenCalled();
  },
);

it('says so and adds nothing when the offering is no longer approved or closed', async () => {
  publish('approved');
  const view = await start();
  detail = { ...detail, status: 'withdrawn', statusDisplay: 'Withdrawn' };
  await fireEvent.press(view.getByRole('button', { name: 'Add documents to the Ordinary shares offering' }));
  expect(await view.findByRole('alert', { name: OFFER_DOCUMENT_COPY.ADD_UNAVAILABLE })).toBeTruthy();
  expect(view.queryByLabelText('Attach supplement.pdf')).toBeNull();
  expect(view.getByRole('button', { name: 'Add documents' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Add documents' }));
  expect(post).not.toHaveBeenCalled();
});

it('sends nothing once the offering leaves approved or closed with a document already switched on', async () => {
  publish('approved');
  const view = await openDocuments();
  await fireEvent(view.getByLabelText('Attach supplement.pdf'), 'valueChange', true);
  detail = { ...detail, status: 'withdrawn', statusDisplay: 'Withdrawn' };
  await act(() => client.invalidateQueries({ queryKey: ['offering'] }));
  expect(await view.findByRole('alert', { name: OFFER_DOCUMENT_COPY.ADD_UNAVAILABLE })).toBeTruthy();
  expect(view.queryByLabelText('Attach supplement.pdf')).toBeNull();
  expect(view.getByRole('button', { name: 'Add documents' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Add documents' }));
  expect(post).not.toHaveBeenCalled();
});
