import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import { InvestorEligibilityScreen } from './index';
import { apiClient } from '../../services/apiClient';
import { files, pickedFile, resetFiles } from '../../testSupport/documentFiles';

jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('../../services/tokenStorage', () => ({ getAccessToken: jest.fn(async () => 'synthetic-access') }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));

const eligibilityUrl = '/api/investor-classifications/eligibility/';
const claimsUrl = '/api/investor-classifications/';
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const remove = jest.mocked(apiClient.delete);
const pick = jest.mocked(DocumentPicker.getDocumentAsync);
let client: QueryClient;
let readFailure: string | null;
let claimPages: Record<number, object>;
let eligibility: object;
let companies: object[];

function claim(uuid: string, status = 'rejected') {
  return {
    uuid,
    category: 'product_value',
    categoryDisplay: `Evidence ${uuid}`,
    status,
    statusDisplay: status === 'rejected' ? 'Rejected' : 'Submitted',
    isLive: false,
    isExpired: false,
    createdAt: '2026-09-01T12:00:00Z',
    rejectionReason: status === 'rejected' ? 'Please supply current evidence.' : '',
  };
}

beforeEach(() => {
  resetFiles();
  pick.mockReset();
  post.mockReset();
  jest.spyOn(FormData.prototype, 'append');
  remove.mockReset();
  readFailure = null;
  eligibility = { account: 'account-a', isEligible: false, reasons: ['no_live_classification'] };
  claimPages = { 1: { results: [], next: null } };
  companies = [{ uuid: 'issuer-a', name: 'Fictional Harbour Pty Ltd' }];
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
  });
  get.mockReset().mockImplementation(async (url, config) => {
    const page = (config?.params as { page?: number } | undefined)?.page ?? 1;
    if (readFailure === url || readFailure === `${url}${page}`) throw new Error('Synthetic read unavailable');
    if (url === eligibilityUrl) return { data: eligibility };
    if (url === claimsUrl) return { data: claimPages[page] };
    if (url === '/api/v1/companies/') return { data: { results: companies, next: null } };
    throw new Error(`Unexpected request ${url}`);
  });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function page() {
  return render(<InvestorEligibilityScreen />, { wrapper });
}

async function draft(category = 'Large investment') {
  const view = await page();
  await waitFor(() => expect(view.getByLabelText(`Attach evidence for ${category}`)).toBeEnabled());
  await fireEvent.press(view.getByLabelText(`Attach evidence for ${category}`));
  await fireEvent.changeText(view.getByLabelText('Basis for the claim'), 'My retained synthetic evidence');
  pick.mockResolvedValueOnce(pickedFile());
  await fireEvent.press(view.getByText('Attach evidence (PDF or image, max 10 MB)'));
  expect(view.getByText('1.pdf')).toBeTruthy();
  return view;
}

async function refresh() {
  await act(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ['investor-eligibility'] }),
      client.invalidateQueries({ queryKey: ['investor-classifications'] }),
    ]);
  });
}

it('reads later claim pages and blocks a duplicate claim without changing the documents cache', async () => {
  claimPages = {
    1: { results: [claim('old')], next: `https://example.test${claimsUrl}?page=2` },
    2: { results: [claim('pending', 'submitted')], next: null },
  };
  const documentsCache = { data: { results: [claim('documents-only')], next: null } };
  client.setQueryData(['investor-classifications'], documentsCache);
  const view = await page();
  expect(await view.findByText('Evidence pending')).toBeTruthy();
  expect(view.getByText('Awaiting review')).toBeTruthy();
  expect(view.getByLabelText('Attach evidence for Large investment')).toBeDisabled();
  expect(get).toHaveBeenCalledWith(claimsUrl, { params: { page: 2 } });
  expect(client.getQueryData(['investor-classifications'])).toEqual(documentsCache);
});

it.each([eligibilityUrl, claimsUrl, `${claimsUrl}2`])(
  'shows an explicit read failure for %s without false status or partial claims',
  async (url) => {
    claimPages = {
      1: { results: [claim('partial')], next: `https://example.test${claimsUrl}?page=2` },
      2: { results: [], next: null },
    };
    readFailure = url;
    const view = await page();
    expect(await view.findByText(/Verification information could not be loaded/)).toBeTruthy();
    expect(view.queryByText('You cannot subscribe to offerings yet')).toBeNull();
    expect(view.queryByText('Evidence partial')).toBeNull();
    expect(view.queryByText('You have not made a claim yet.')).toBeNull();
    readFailure = null;
    await fireEvent.press(view.getByText('Try again'));
    expect(await view.findByText('Evidence partial')).toBeTruthy();
  },
);

it.each([`https://example.test${claimsUrl}?page=1`, `https://example.test${claimsUrl}?cursor=next`])(
  'rejects a non-advancing advertised next page %s',
  async (next) => {
    claimPages = { 1: { results: [claim('partial')], next } };
    const view = await page();
    expect(await view.findByText(/Verification information could not be loaded/)).toBeTruthy();
    expect(view.queryByText('Evidence partial')).toBeNull();
    expect(get.mock.calls.filter(([url]) => url === claimsUrl)).toHaveLength(1);
  },
);

it.each([eligibilityUrl, claimsUrl])(
  'retains the draft and private evidence through failed background %s and retries the same bytes',
  async (url) => {
    const view = await draft();
    const copy = [...files.keys()].find((uri) => uri.includes('/ledova-upload-copies-v1/'))!;
    expect(files.get(copy)?.content).toBe('document-1');
    readFailure = url;
    await refresh();
    expect(view.getByDisplayValue('My retained synthetic evidence')).toBeTruthy();
    expect(view.getByText('1.pdf')).toBeTruthy();
    await waitFor(() => expect(view.getByRole('button', { name: 'Submit for review' })).toBeDisabled());
    await fireEvent.press(view.getByText('Submit for review'));
    expect(post).not.toHaveBeenCalled();
    expect(files.get(copy)?.content).toBe('document-1');
    readFailure = null;
    await fireEvent.press(view.getAllByText('Try again').at(-1)!);
    await waitFor(() => expect(view.getByText('Submit for review')).toBeEnabled());
    post.mockImplementationOnce(async () => {
      expect(FormData.prototype.append).toHaveBeenCalledWith(
        'evidence_file',
        expect.objectContaining({ uri: copy, name: '1.pdf' }),
      );
      expect(files.get(copy)?.content).toBe('document-1');
      claimPages = { 1: { results: [claim('new', 'submitted')], next: null } };
      return { data: claim('new', 'submitted') };
    });
    await fireEvent.press(view.getByText('Submit for review'));
    expect(await view.findByText('Evidence new')).toBeTruthy();
    expect(post).toHaveBeenCalledTimes(1);
    expect(files.has(copy)).toBe(false);
  },
);

it('blocks submission while either prerequisite is still refreshing and when a pending claim then appears', async () => {
  const view = await draft();
  let finish!: (value: object) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  let refreshing!: Promise<void>;
  await act(async () => {
    refreshing = client.invalidateQueries({ queryKey: ['investor-eligibility'] });
  });
  await waitFor(() => expect(view.getByText('Submit for review')).toBeDisabled());
  await fireEvent.press(view.getByText('Submit for review'));
  expect(post).not.toHaveBeenCalled();
  await act(async () => {
    finish({ data: eligibility });
    await refreshing;
  });
  await waitFor(() => expect(view.getByText('Submit for review')).toBeEnabled());
  claimPages = { 1: { results: [claim('elsewhere', 'submitted')], next: null } };
  await refresh();
  await waitFor(() => expect(view.getByRole('button', { name: 'Submit for review' })).toBeDisabled());
  expect(view.getByText(/A claim is now awaiting review/)).toBeTruthy();
  expect(view.getByDisplayValue('My retained synthetic evidence')).toBeTruthy();
});

it('keeps a refused claim withdrawal visible and refreshes the ledger after retry', async () => {
  claimPages = { 1: { results: [claim('pending', 'submitted')], next: null } };
  remove.mockRejectedValueOnce(new Error('Withdrawal refused')).mockImplementationOnce(async () => {
    claimPages = { 1: { results: [], next: null } };
    return {};
  });
  const view = await page();
  await fireEvent.press(await view.findByLabelText('Withdraw Evidence pending claim'));
  expect(await view.findByText('Withdrawal refused')).toBeTruthy();
  expect(view.getByText('Evidence pending')).toBeTruthy();
  await fireEvent.press(view.getByLabelText('Withdraw Evidence pending claim'));
  expect(await view.findByText('You have not made a claim yet.')).toBeTruthy();
  expect(view.queryByText('Withdrawal refused')).toBeNull();
  expect(remove).toHaveBeenNthCalledWith(2, `${claimsUrl}pending/`);
});

it('keeps the modal and file through refusal and prevents closing or duplicate submission while pending', async () => {
  const view = await draft();
  let refuse!: (error: Error) => void;
  post.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        refuse = reject;
      }),
  );
  let pressed!: Promise<void>;
  await act(async () => {
    pressed = fireEvent.press(view.getByText('Submit for review'));
  });
  await waitFor(() => expect(view.getByText('Submitting…')).toBeDisabled());
  await fireEvent.press(view.getByText('Cancel'));
  await fireEvent.press(view.getByLabelText('Close claim'));
  await fireEvent(view.getByText('Claim: Large investment'), 'requestClose');
  expect(view.getByText('1.pdf')).toBeTruthy();
  expect(view.getByDisplayValue('My retained synthetic evidence')).toBeTruthy();
  await fireEvent.press(view.getByText('Submitting…'));
  expect(post).toHaveBeenCalledTimes(1);
  await act(async () => {
    refuse(new Error('Operator refused this evidence'));
    await pressed;
  });
  expect(await view.findByText('Operator refused this evidence')).toBeTruthy();
  expect(view.getByText('1.pdf')).toBeTruthy();
  await waitFor(() => expect(view.getByRole('button', { name: 'Submit for review' })).toBeEnabled());
});

it('requires a currently readable selected issuer for an associated-person claim', async () => {
  readFailure = '/api/v1/companies/';
  const view = await draft('Associated with the issuer');
  expect(await view.findByText('Issuers could not be loaded.')).toBeTruthy();
  await waitFor(() => expect(view.getByRole('button', { name: 'Submit for review' })).toBeDisabled());
  readFailure = null;
  await fireEvent.press(view.getByText('Try issuers again'));
  await fireEvent.press(await view.findByText('Fictional Harbour Pty Ltd'));
  await waitFor(() => expect(view.getByRole('button', { name: 'Submit for review' })).toBeEnabled());
  companies = [];
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['companies'] });
  });
  expect(await view.findByText('No issuer is available for this account.')).toBeTruthy();
  await waitFor(() => expect(view.getByRole('button', { name: 'Submit for review' })).toBeDisabled());
});

it('keeps the loading state explicit and shows verified, expired and rejected evidence truthfully', async () => {
  let finish!: (value: object) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  claimPages = {
    1: {
      results: [
        { ...claim('live', 'verified'), isLive: true, expiresAt: '2027-09-01' },
        { ...claim('expired', 'verified'), isExpired: true },
        claim('refused'),
      ],
      next: null,
    },
  };
  const view = await page();
  expect(view.getByText('Loading verification…')).toBeTruthy();
  expect(view.queryByLabelText('Attach evidence for Large investment')).toBeNull();
  await act(async () => {
    finish({ data: { ...eligibility, isEligible: true, reasons: [] } });
  });
  expect(await view.findByText('You can see and subscribe to offerings')).toBeTruthy();
  expect(view.getByText(/Verified until/)).toBeTruthy();
  expect(view.getByText('Expired')).toBeTruthy();
  expect(view.getByText('Rejected')).toBeTruthy();
  expect(view.getByText('Please supply current evidence.')).toBeTruthy();
});

it('requires the complete accountant certificate and sends its fields with the evidence', async () => {
  const view = await draft("Qualified accountant's certificate");
  expect(view.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
  await fireEvent.changeText(view.getByLabelText('Certificate date'), '2026-09-01');
  await fireEvent.changeText(view.getByLabelText('Accountant name'), 'Fictional Accountant');
  await fireEvent.changeText(view.getByLabelText('Membership number'), 'EXAMPLE-123');
  await fireEvent.press(view.getByText('CPA Australia'));
  expect(view.getByRole('button', { name: 'Submit for review' })).toBeEnabled();
  post.mockResolvedValueOnce({ data: claim('new', 'submitted') });
  await fireEvent.press(view.getByText('Submit for review'));
  expect(post).toHaveBeenCalledTimes(1);
  for (const [name, value] of [
    ['category', 'accountant_certificate'],
    ['certificate_issued_at', '2026-09-01'],
    ['certifier_name', 'Fictional Accountant'],
    ['certifier_body', 'cpa_australia'],
    ['certifier_membership_number', 'EXAMPLE-123'],
    ['declaration_accepted', 'true'],
  ])
    expect(FormData.prototype.append).toHaveBeenCalledWith(name, value);
});
