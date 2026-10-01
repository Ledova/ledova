// @vitest-environment jsdom

import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Company, Offering } from '@ledova/shared';
import OfferingPage from '.';
import { companyRecord, documentRecord, renderCompanyPage } from '../testSupport';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const BASE = '/api/v1/offerings/';
const DETAIL = BASE + 'offering-one/';
const SUBSCRIPTIONS = DETAIL + 'subscriptions/';
const COMPANY = '/api/v1/companies/company-one/';
const TOKENS = '/api/v1/tokens/';
const OPERATOR = '/api/operator/';
const EMPTY = { results: [], count: 0, next: null, previous: null };
const token = {
  uuid: 'token-one',
  companyUuid: 'company-one',
  name: 'Ordinary shares',
  symbol: 'ORD',
  status: 'deployed',
};
let client: QueryClient;
let company: Company;
let offering: Offering;
let failed: string | null;
let offered: Offering[];

function record(overrides: Partial<Offering> = {}): Offering {
  return {
    uuid: 'offering-one',
    tokenUuid: 'token-one',
    tokenName: 'Ordinary shares',
    tokenSymbol: 'ORD',
    status: 'draft',
    statusDisplay: 'Draft',
    exemption: 's708_11_professional',
    exemptionDisplay: 'Professional investor',
    pricePerShare: '3.25',
    priceCurrency: 'AUD',
    minimumShares: 100,
    targetShares: 5000,
    capShares: 10000,
    maximumShares: null,
    opensAt: '2027-03-01T00:00:00Z',
    closesAt: null,
    isOpen: false,
    canBeEdited: true,
    canBeDeleted: true,
    rejectionReason: '',
    closeReason: '',
    createdAt: '2026-09-01T00:00:00Z',
    settlementAssets: [],
    acceptsBankTransfer: true,
    summary: 'The tranche as the operator saw it',
    useOfProceeds: 'Plant',
    documents: ['document-one'],
    submittedByEmail: null,
    submittedAt: null,
    reviewedByEmail: null,
    reviewedAt: null,
    reviewNotes: '',
    closedAt: null,
    updatedAt: '2026-09-01T00:00:00Z',
    ...overrides,
  };
}
function show() {
  return renderCompanyPage(client, <OfferingPage />, 'Offerings');
}
async function openEditor(edit = false) {
  await screen.findByRole('heading', { name: 'Your offerings (1)' });
  fireEvent.click(screen.getByRole('button', { name: edit ? 'Edit' : 'New offering' }));
  const dialog = await screen.findByRole('dialog');
  if (edit) await within(dialog).findByDisplayValue('3.25');
  return dialog;
}
function fill(dialog: HTMLElement) {
  const scope = within(dialog);
  for (const [label, value] of [
    ['Price per share (AUD)', '1.50'],
    ['Minimum shares', '10'],
    ['Target shares', '100'],
    ['Cap shares', '200'],
    ['Opens at', '2027-03-01T09:00'],
    ['Summary', 'A fictional tranche'],
  ]) {
    fireEvent.change(scope.getByLabelText(label), { target: { value } });
  }
}
const refusal = (message: string) => Object.assign(new Error('HTTP 400'), { response: { data: { detail: message } } });
beforeEach(() => {
  vi.resetAllMocks();
  failed = null;
  company = companyRecord({ status: 'active', statusDisplay: 'Active', canIssueTokens: true });
  offering = record();
  offered = [offering];
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api.get.mockImplementation(async (url: string) => {
    if (url === failed) throw new Error('Unavailable');
    if (url === '/api/v1/companies/') return { data: { ...EMPTY, results: [{ uuid: company.uuid }] } };
    if (url === COMPANY) return { data: { ...company } };
    if (url === TOKENS) return { data: { ...EMPTY, results: [token] } };
    if (url === OPERATOR) return { data: { name: 'Example Operator', supportedSettlementAssets: [] } };
    if (url === BASE) return { data: { ...EMPTY, results: offered } };
    if (url === DETAIL) return { data: { ...offering } };
    if (url.endsWith('/subscriptions/')) return { data: EMPTY };
    throw new Error(`Unexpected request: ${url}`);
  });
  api.post.mockResolvedValue({ data: {} });
  api.patch.mockResolvedValue({ data: {} });
  api.delete.mockResolvedValue({ data: {} });
});
afterEach(() => {
  cleanup();
  client.clear();
});

it('shows the ledger with recorded bounds, AUD amounts and read-only operator allotment controls', async () => {
  show();
  await screen.findByRole('heading', { name: 'Your offerings (1)' });
  expect(screen.getByText('AUD 3.25')).toBeTruthy();
  expect(screen.getByText('5,000')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Applications' })).toBeTruthy();
  expect(
    screen.getByText(
      'Read-only. Payment confirmation and allotment are done by Example Operator; this is where you watch them happen.',
    ),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Confirm payment|Allot/ })).toBeNull();
  expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy();
});

it('puts Your offerings first, then its applications, the directory switch and what happens next', async () => {
  show();
  await screen.findByRole('heading', { name: 'Applications' });
  expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
    'Your offerings (1)',
    'Applications',
    'Investor Directory',
    'What happens next',
  ]);
});

it('reads every offering and class page, filtering the selected company before presenting actions', async () => {
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string, config?: { params?: { page: number } }) => {
    if (url === TOKENS)
      return {
        data: {
          ...EMPTY,
          results:
            config?.params?.page === 2
              ? [
                  { ...token, uuid: 'token-two', name: 'Preference shares' },
                  { ...token, uuid: 'foreign-token', companyUuid: 'other-company' },
                ]
              : [token],
          next: config?.params?.page === 2 ? null : 'https://example.invalid/?page=2',
        },
      };
    if (url === BASE)
      return {
        data: {
          ...EMPTY,
          results:
            config?.params?.page === 2
              ? [
                  record({ uuid: 'offering-two', tokenUuid: 'token-two', tokenName: 'Preference shares' }),
                  record({ uuid: 'foreign', tokenUuid: 'foreign-token', tokenName: 'Foreign shares' }),
                ]
              : [offering],
          next: config?.params?.page === 2 ? null : 'https://example.invalid/?page=2',
        },
      };
    return original(url);
  });
  show();
  await screen.findByRole('heading', { name: 'Your offerings (2)' });
  expect(screen.getByRole('heading', { name: 'Preference shares (ORD)' })).toBeTruthy();
  expect(screen.queryByText('Foreign shares (ORD)')).toBeNull();
  expect(api.get).toHaveBeenCalledWith(BASE, { params: { page: 2 } });
  expect(api.get).toHaveBeenCalledWith(TOKENS, { params: { page: 1, company_uuid: company.uuid } });
  expect(api.get).toHaveBeenCalledWith(TOKENS, { params: { page: 2, company_uuid: company.uuid } });
});

it.each([BASE, TOKENS, OPERATOR])(
  'reports %s read failure instead of empty records, hides stale actions, and retries',
  async (endpoint) => {
    show();
    await screen.findByRole('button', { name: 'Edit' });
    failed = endpoint;
    await act(async () => {
      await client.invalidateQueries();
    });
    const retry = await screen.findByRole('button', { name: 'Retry offering information' });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByText(/You have no offerings/)).toBeNull();
    expect(screen.queryByText(/has not configured a settlement asset/)).toBeNull();
    expect((screen.getByRole('button', { name: 'New offering' }) as HTMLButtonElement).disabled).toBe(true);
    failed = null;
    fireEvent.click(retry);
    expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy();
  },
);

it.each(['/api/v1/companies/', COMPANY])('reports and retries %s without a false empty company', async (endpoint) => {
  failed = endpoint;
  show();
  const retry = await screen.findByRole('button', { name: 'Retry company information' });
  expect(screen.queryByText(/No company found/)).toBeNull();
  failed = null;
  fireEvent.click(retry);
  expect(await screen.findByRole('button', { name: 'Edit' })).toBeTruthy();
});

it('reads all applications and shows requested and zero allotted shares separately with exact money', async () => {
  let broken = true;
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url: string, config?: { params?: { page: number } }) => {
    if (url !== SUBSCRIPTIONS) return original(url);
    if (config?.params?.page === 2 && broken) throw new Error('Later subscription read failed');
    const last = config?.params?.page === 2;
    return {
      data: {
        ...EMPTY,
        next: last ? null : 'https://example.invalid/?page=2',
        results: [
          {
            uuid: last ? 'last' : 'first',
            investorName: last ? 'Last Member' : 'First Member',
            status: 'allotted',
            statusDisplay: 'Allotted',
            quantity: 100,
            allottedQuantity: 0,
            amountDue: '90071992547409.93',
            amountReceived: null,
            settlementRailDisplay: 'Bank transfer',
            allotmentState: 'Recorded',
            paymentDueAt: null,
            paymentConfirmedAt: null,
            reference: 'EXAMPLE',
          },
        ],
      },
    };
  });
  show();
  const retry = await screen.findByRole('button', { name: 'Retry applications' });
  expect(screen.queryByText('First Member')).toBeNull();
  expect(screen.queryByText('No one has applied to this offering yet.')).toBeNull();
  broken = false;
  fireEvent.click(retry);
  await screen.findByText('Last Member');
  expect(screen.getByText('First Member')).toBeTruthy();
  expect(screen.getByText('2 applications')).toBeTruthy();
  expect(screen.getAllByText('0')).toHaveLength(2);
  expect(screen.getAllByText('AUD 90,071,992,547,409.93')).toHaveLength(2);
});

it('refreshes directory visibility after the existing PATCH and retains the value on refusal', async () => {
  api.patch.mockRejectedValueOnce(refusal('Directory change refused.')).mockImplementationOnce(async (_url, body) => {
    company = { ...company, ...body };
    return { data: company };
  });
  show();
  const control = await screen.findByRole('switch', { name: 'Show this company to eligible investors' });
  expect(control.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(control);
  const directory = screen.getByRole('heading', { name: 'Investor Directory' }).closest('section')!;
  expect((await within(directory).findByRole('alert')).textContent).toBe('Directory change refused.');
  expect(control.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(control);
  await waitFor(() => expect(control.getAttribute('aria-checked')).toBe('true'));
  expect(api.patch).toHaveBeenLastCalledWith(COMPANY, { isOpenToInvestors: true });
});

it('holds the directory switch while its change is saving', async () => {
  let save!: () => void;
  api.patch.mockImplementationOnce(
    (_url, body) =>
      new Promise((resolve) => {
        save = () => {
          company = { ...company, ...body };
          resolve({ data: company });
        };
      }),
  );
  show();
  const control = (await screen.findByRole('switch', {
    name: 'Show this company to eligible investors',
  })) as HTMLButtonElement;
  fireEvent.click(control);
  await waitFor(() => expect(control.disabled).toBe(true));
  expect(control.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(control);
  expect(api.patch).toHaveBeenCalledOnce();
  await act(async () => save());
  await waitFor(() => {
    expect(control.disabled).toBe(false);
    expect(control.getAttribute('aria-checked')).toBe('true');
  });
});

it('keeps inactive company directory visibility disabled', async () => {
  company = { ...company, canIssueTokens: false, status: 'approved', statusDisplay: 'Approved' };
  show();
  await screen.findByRole('heading', { name: 'Your offerings (1)' });
  expect(
    (screen.getByRole('switch', { name: 'Show this company to eligible investors' }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/It is currently Approved/)).toBeTruthy();
});

it('creates a draft through the existing endpoint, keeps the exact decimal, and closes after refresh', async () => {
  show();
  const dialog = await openEditor();
  fill(dialog);
  fireEvent.change(within(dialog).getByLabelText('Price per share (AUD)'), { target: { value: '90071992547409.93' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Create draft offering' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.post).toHaveBeenCalledWith(
    BASE,
    expect.objectContaining({
      token: 'token-one',
      pricePerShare: '90071992547409.93',
      minimumShares: 10,
      targetShares: 100,
      capShares: 200,
      summary: 'A fictional tranche',
    }),
  );
});

it('edits the rejected record with its current values, retaining unchanged document and maximum fields', async () => {
  offering = record({
    status: 'rejected',
    statusDisplay: 'Rejected',
    canBeDeleted: false,
    rejectionReason: 'Explain the exemption.',
    maximumShares: 800,
  });
  offered = [offering];
  show();
  const dialog = await openEditor(true);
  expect(within(dialog).getByDisplayValue('The tranche as the operator saw it')).toBeTruthy();
  expect((within(dialog).getByLabelText('Share class') as HTMLSelectElement).disabled).toBe(true);
  fireEvent.change(within(dialog).getByLabelText('Summary'), { target: { value: 'Corrected after review' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const [url, payload] = api.patch.mock.calls[0];
  expect(url).toBe(DETAIL);
  expect(payload.summary).toBe('Corrected after review');
  expect(payload.pricePerShare).toBe('3.25');
  expect(payload).not.toHaveProperty('maximumShares');
  expect(payload.documents).toEqual(['document-one']);
});

it('attaches the company documents the issuer chooses, from the company record', async () => {
  company = companyRecord({
    status: 'active',
    statusDisplay: 'Active',
    canIssueTokens: true,
    documents: [documentRecord('prospectus', 'document-one'), documentRecord('risk_disclosure', 'document-two')],
  });
  show();
  const dialog = await openEditor(true);
  const kept = within(dialog).getByLabelText('Attach document-one.pdf') as HTMLInputElement;
  const added = within(dialog).getByLabelText('Attach document-two.pdf') as HTMLInputElement;
  expect([kept.checked, added.checked]).toEqual([true, false]);
  fireEvent.click(added);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.patch.mock.calls[0][1].documents).toEqual(['document-one', 'document-two']);
});

it('keeps a failed edit read distinct from a new offering and retries the same record', async () => {
  failed = DETAIL;
  show();
  await screen.findByRole('button', { name: 'Edit' });
  fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
  const dialog = await screen.findByRole('dialog');
  const retry = await within(dialog).findByRole('button', { name: 'Retry current offering' });
  expect(within(dialog).queryByRole('button', { name: 'Create draft offering' })).toBeNull();
  expect(within(dialog).queryByRole('button', { name: 'Save changes' })).toBeNull();
  failed = null;
  fireEvent.click(retry);
  expect(await within(dialog).findByDisplayValue('3.25')).toBeTruthy();
});

it.each([COMPANY, BASE, TOKENS, OPERATOR, DETAIL])(
  'retains an edited draft and blocks writes while %s refresh has failed',
  async (endpoint) => {
    show();
    const dialog = await openEditor(true);
    fireEvent.change(within(dialog).getByLabelText('Summary'), { target: { value: 'Keep this draft' } });
    failed = endpoint;
    await act(async () => {
      await client.invalidateQueries();
    });
    await waitFor(() =>
      expect((within(dialog).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true),
    );
    expect(within(dialog).getByDisplayValue('Keep this draft')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(api.patch).not.toHaveBeenCalled();
    failed = null;
    const label =
      endpoint === COMPANY
        ? 'Retry company information'
        : endpoint === DETAIL
          ? 'Retry current offering'
          : 'Retry offering information';
    fireEvent.click(within(dialog).getByRole('button', { name: label }));
    await waitFor(() =>
      expect((within(dialog).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(DETAIL, expect.objectContaining({ summary: 'Keep this draft' })),
    );
  },
);

it('waits for an in-flight current offering read and blocks an edit after it enters review', async () => {
  show();
  const dialog = await openEditor(true);
  fireEvent.change(within(dialog).getByLabelText('Summary'), { target: { value: 'Retain me' } });
  let finish!: (value: unknown) => void;
  const original = api.get.getMockImplementation()!;
  api.get.mockImplementation((url: string) =>
    url === DETAIL
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : original(url),
  );
  act(() => {
    void client.invalidateQueries({ queryKey: ['offering'] });
  });
  await within(dialog).findByText('Refreshing current offering…');
  expect((within(dialog).getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish({ data: record({ status: 'under_review', canBeEdited: false }) }));
  await within(dialog).findByText('This offering can no longer be edited.');
  expect(within(dialog).getByDisplayValue('Retain me')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(api.patch).not.toHaveBeenCalled();
});

it.each([false, true])(
  'keeps the %s edit flag form and values while saving, refuses duplicate posts and permits a retry',
  async (edit) => {
    let reject!: (reason: Error) => void;
    const request = edit ? api.patch : api.post;
    request.mockImplementationOnce(
      () =>
        new Promise((_resolve, rejectRequest) => {
          reject = rejectRequest;
        }),
    );
    show();
    const dialog = await openEditor(edit);
    if (!edit) fill(dialog);
    const submit = within(dialog).getByRole('button', { name: edit ? 'Save changes' : 'Create draft offering' });
    fireEvent.click(submit);
    await waitFor(() => expect((submit as HTMLButtonElement).disabled).toBe(true));
    fireEvent.keyDown(dialog, { key: 'Escape', code: 'Escape' });
    fireEvent.click(submit);
    expect(screen.getByRole('dialog')).toBe(dialog);
    expect(request).toHaveBeenCalledTimes(1);
    await act(async () => reject(refusal('Save refused.')));
    expect(await within(dialog).findByText('Save refused.')).toBeTruthy();
    expect(within(dialog).getByLabelText('Summary')).toHaveProperty(
      'value',
      edit ? 'The tranche as the operator saw it' : 'A fictional tranche',
    );
    fireEvent.click(submit);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(request).toHaveBeenCalledTimes(2);
  },
);

it('submits again without recreating the rejected offering, preserving rejection history until refresh', async () => {
  offering = record({
    status: 'rejected',
    statusDisplay: 'Rejected',
    canBeDeleted: false,
    rejectionReason: 'Explain the exemption.',
  });
  offered = [offering];
  api.post.mockImplementation(async () => {
    offered = [
      record({
        status: 'submitted',
        statusDisplay: 'Submitted',
        canBeEdited: false,
        canBeDeleted: false,
        rejectionReason: 'Explain the exemption.',
      }),
    ];
    return { data: {} };
  });
  show();
  await screen.findByText('Rejected: Explain the exemption.');
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Submit again' }));
  await screen.findByText('Submitted');
  expect(screen.queryByText('Rejected: Explain the exemption.')).toBeNull();
  expect(api.post).toHaveBeenCalledWith(DETAIL + 'submit/', {});
  expect(api.post).toHaveBeenCalledTimes(1);
});

it('withdraws an editable rejected record and retains its previous reason after refresh', async () => {
  offering = record({
    status: 'rejected',
    statusDisplay: 'Rejected',
    canBeDeleted: false,
    rejectionReason: 'Explain the exemption.',
  });
  offered = [offering];
  api.post.mockImplementation(async () => {
    offered = [
      record({
        status: 'withdrawn',
        statusDisplay: 'Withdrawn',
        canBeEdited: false,
        canBeDeleted: false,
        rejectionReason: 'Explain the exemption.',
        closeReason: 'Withdrawn by the issuer',
      }),
    ];
    return { data: {} };
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
  await screen.findByText('Previous rejection: Explain the exemption.');
  expect(screen.getByText('Closed: Withdrawn by the issuer')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Withdraw' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  expect(api.post).toHaveBeenCalledWith(DETAIL + 'withdraw/', { reason: 'Withdrawn by the issuer' });
});

it.each([
  ['a failing server’s bare body', { status: 502, data: 'Bad Gateway' }],
  ['no answer', undefined],
])('says an action could not be completed when %s gives no reason', async (_failure, response) => {
  api.post.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 502'), { response }));
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Submit for review' }));
  expect(await screen.findByText('The request could not be completed. Try again.')).toBeTruthy();
  expect(screen.queryByText(/Bad Gateway|status code|refused/)).toBeNull();
});

it('shows the latest action refusal and refreshes after deleting a draft', async () => {
  api.post.mockRejectedValueOnce(refusal('Submission refused.'));
  api.delete.mockRejectedValueOnce(refusal('Deletion refused.')).mockImplementationOnce(async () => {
    offered = [];
    return { data: {} };
  });
  show();
  fireEvent.click(await screen.findByRole('button', { name: 'Submit for review' }));
  await screen.findByText('Submission refused.');
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await screen.findByText('Deletion refused.');
  expect(screen.queryByText('Submission refused.')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await screen.findByRole('heading', { name: 'Your offerings (0)' });
  expect(api.delete).toHaveBeenLastCalledWith(DETAIL);
});

it('keeps approved offerings read-only except the existing withdrawal rule', async () => {
  offering = record({ status: 'approved', statusDisplay: 'Approved', canBeEdited: false, canBeDeleted: false });
  offered = [offering];
  show();
  await screen.findByRole('heading', { name: 'Your offerings (1)' });
  expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
});
