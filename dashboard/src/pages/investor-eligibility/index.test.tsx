// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { INVESTOR_CLASSIFICATION_ENDPOINTS, type InvestorClassification } from '@ledova/shared';
import { PageTitle } from '@components/PageTitle';
import InvestorEligibilityPage from './index';

const api = vi.hoisted(() => ({ get: vi.fn(), delete: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));

let client: QueryClient;
const eligibility = { account: 'account-one', isEligible: true, reasons: [], classification: null };

function claim(overrides: Partial<InvestorClassification> = {}): InvestorClassification {
  return {
    uuid: 'claim-one',
    category: 'professional_investor',
    categoryDisplay: 'Professional investor',
    createdAt: '2026-09-01T00:00:00Z',
    declarationText: 'I declare',
    evidenceFileSize: 10,
    evidenceMimeType: 'application/pdf',
    expiresAt: '2027-09-01T00:00:00Z',
    isExpired: false,
    isLive: true,
    rejectionReason: '',
    reviewedAt: '2026-09-02T00:00:00Z',
    reviewNotes: '',
    status: 'verified',
    statusDisplay: 'Verified',
    submittedAt: '2026-09-01T00:00:00Z',
    userAccount: 'account-one',
    ...overrides,
  };
}

function page(results: InvestorClassification[] = [], next: string | null = null) {
  return { data: { results, next, previous: null, count: results.length } };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <PageTitle.Provider value="Verification">
          <InvestorEligibilityPage />
        </PageTitle.Provider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.get.mockImplementation(async (url: string) =>
    url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY ? { data: eligibility } : page(),
  );
  api.delete.mockResolvedValue({});
  api.post.mockResolvedValue({ data: claim({ status: 'submitted', isLive: false }) });
});

afterEach(() => {
  cleanup();
  client.clear();
});

it('waits for eligibility and claims without showing a negative or empty result', async () => {
  let finish!: (value: ReturnType<typeof page>) => void;
  api.get.mockImplementation((url: string) =>
    url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY
      ? Promise.resolve({ data: eligibility })
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  renderPage();
  expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Verification');
  expect(screen.getByRole('status')).toBeTruthy();
  expect(screen.queryByText('Verification needed')).toBeNull();
  expect(screen.queryByText(/You have not submitted/)).toBeNull();
  await act(async () => finish(page()));
  expect(await screen.findByText('Verified to invest')).toBeTruthy();
});

it('reads every claim page so an older pending claim still prevents duplicate submission', async () => {
  api.get.mockImplementation(async (url: string, config?: { params: { page: number } }) => {
    if (url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY) return { data: eligibility };
    return config?.params.page === 1
      ? page([claim()], 'http://localhost/api/v1/investor-classifications/?page=2')
      : page([
          claim({ uuid: 'pending', categoryDisplay: 'Associated with the issuer', status: 'submitted', isLive: false }),
        ]);
  });
  renderPage();
  expect(await screen.findByText('Awaiting review')).toBeTruthy();
  expect(screen.getByText('Verified to invest')).toBeTruthy();
  expect(screen.getAllByRole('article')).toHaveLength(2);
  for (const button of screen.getAllByRole('button', { name: /Submit evidence|Update evidence/ })) {
    expect((button as HTMLButtonElement).disabled).toBe(true);
  }
  expect(api.get).toHaveBeenCalledWith(INVESTOR_CLASSIFICATION_ENDPOINTS.BASE, { params: { page: 2 } });
  expect(screen.getByRole('link', { name: 'View the directory' }).getAttribute('href')).toBe('/directory');
});

it.each(['eligibility', 'claims', 'later claims'])(
  'reports %s failure without treating missing data as ineligible or empty, then retries',
  async (source) => {
    let broken = true;
    api.get.mockImplementation(async (url: string, config?: { params: { page: number } }) => {
      const isEligibility = url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY;
      if (
        broken &&
        ((source === 'eligibility' && isEligibility) ||
          (source === 'claims' && !isEligibility) ||
          (source === 'later claims' && config?.params.page === 2))
      )
        throw new Error('Unavailable');
      if (isEligibility) return { data: eligibility };
      return source === 'later claims' && config?.params.page === 1
        ? page([claim()], 'http://localhost/api/v1/investor-classifications/?page=2')
        : page([claim()]);
    });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Your verification could not be loaded. Try again before continuing.Try again',
    );
    expect(screen.queryByText('Verification needed')).toBeNull();
    expect(screen.queryByText('Verified to invest')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Update evidence' })).toBeNull();
    broken = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Verified to invest')).toBeTruthy();
  },
);

it('refuses a nonadvancing pagination response instead of silently using incomplete claims', async () => {
  api.get.mockImplementation(async (url: string) =>
    url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY
      ? { data: eligibility }
      : page([claim()], 'http://localhost/api/v1/investor-classifications/?page=1'),
  );
  renderPage();
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByText('Verified to invest')).toBeNull();
  expect(api.get.mock.calls.filter(([url]) => url === INVESTOR_CLASSIFICATION_ENDPOINTS.BASE)).toHaveLength(1);
});

it('hides cached claims and actions when a refresh fails', async () => {
  renderPage();
  await screen.findByText('Verified to invest');
  api.get.mockRejectedValue(new Error('Unavailable'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['investor-eligibility'] });
  });
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Submit evidence' })).toBeNull();
  expect(screen.queryByText('Verified to invest')).toBeNull();
});

it.each(['eligibility', 'claims'])('retains an open claim through a failed %s refresh and retry', async (source) => {
  let broken = false;
  api.get.mockImplementation(async (url: string) => {
    const isEligibility = url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY;
    if (broken && (source === 'eligibility' ? isEligibility : !isEligibility)) throw new Error('Unavailable');
    return isEligibility ? { data: eligibility } : page();
  });
  renderPage();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Submit evidence' }))[1]);
  const dialog = await screen.findByRole('dialog');
  const file = new File(['retained evidence'], 'certificate.pdf', { type: 'application/pdf' });
  fireEvent.change(within(dialog).getByLabelText('Certificate date'), { target: { value: '2026-09-01' } });
  fireEvent.change(within(dialog).getByLabelText('Professional body'), { target: { value: 'cpa_australia' } });
  fireEvent.change(within(dialog).getByLabelText('Accountant name'), { target: { value: 'Alex Example' } });
  fireEvent.change(within(dialog).getByLabelText('Membership number'), { target: { value: 'TEST-123' } });
  fireEvent.change(within(dialog).getByLabelText('Basis for the claim'), { target: { value: 'Current certificate' } });
  fireEvent.change(within(dialog).getByLabelText('Evidence file'), { target: { files: [file] } });
  fireEvent.click(within(dialog).getByRole('checkbox'));
  expect((within(dialog).getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(false);
  broken = true;
  await act(async () => {
    await client.invalidateQueries({
      queryKey: [source === 'eligibility' ? 'investor-eligibility' : 'investor-classifications'],
    });
  });
  await waitFor(() =>
    expect(
      client.getQueryState(
        source === 'eligibility' ? ['investor-eligibility'] : ['investor-classifications', 'verification'],
      )?.status,
    ).toBe('error'),
  );
  expect(screen.getByRole('dialog')).toBe(dialog);
  expect(within(dialog).getByRole('alert').textContent).toContain('Your verification could not be loaded');
  expect(screen.queryByText('Verified to invest')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Submit evidence' })).toBeNull();
  expect((within(dialog).getByLabelText('Basis for the claim') as HTMLTextAreaElement).value).toBe(
    'Current certificate',
  );
  expect(within(dialog).getByText('certificate.pdf')).toBeTruthy();
  const submit = within(dialog).getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.click(submit);
  expect(api.post).not.toHaveBeenCalled();
  broken = false;
  fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(submit.disabled).toBe(false));
  expect(screen.getByRole('dialog')).toBe(dialog);
  fireEvent.click(submit);
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  const payload = api.post.mock.calls[0][1] as FormData;
  expect(payload.get('evidence_file')).toBe(file);
  expect(payload.get('declared_basis')).toBe('Current certificate');
  expect(payload.get('certificate_issued_at')).toBe('2026-09-01');
  expect(payload.get('certifier_name')).toBe('Alex Example');
  expect(payload.get('certifier_body')).toBe('cpa_australia');
  expect(payload.get('certifier_membership_number')).toBe('TEST-123');
});

it('retains evidence but blocks a claim when a refresh discovers another pending claim', async () => {
  renderPage();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Submit evidence' }))[0]);
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Basis for the claim'), { target: { value: 'My evidence' } });
  fireEvent.change(within(dialog).getByLabelText('Evidence file'), {
    target: { files: [new File(['test'], 'proof.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.click(within(dialog).getByRole('checkbox'));
  api.get.mockImplementation(async (url: string) =>
    url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY
      ? { data: eligibility }
      : page([claim({ status: 'submitted', isLive: false })]),
  );
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['investor-classifications'] });
  });
  expect(
    await within(dialog).findByText('Another claim is awaiting review. Withdraw it before submitting another.'),
  ).toBeTruthy();
  expect(within(dialog).getByText('proof.pdf')).toBeTruthy();
  const submit = within(dialog).getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement;
  expect(submit.disabled).toBe(true);
  fireEvent.click(submit);
  expect(api.post).not.toHaveBeenCalled();
});

it('shows expiry, review dates and refusal reasons without truncating the claim name', async () => {
  api.get.mockImplementation(async (url: string) =>
    url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY
      ? { data: { ...eligibility, isEligible: false, reasons: ['identity_not_verified'] } }
      : page([
          claim({
            categoryDisplay: 'An extended professional classification description',
            isLive: false,
            isExpired: true,
            rejectionReason: 'Please provide current evidence.',
          }),
        ]),
  );
  renderPage();
  expect(await screen.findByText('Expired')).toBeTruthy();
  expect(screen.getByText('Every holder on the account must finish identity verification.')).toBeTruthy();
  expect(screen.getByText('Please provide current evidence.')).toBeTruthy();
  expect(screen.getByText('Expires')).toBeTruthy();
  expect(screen.queryByRole('link', { name: 'View the directory' })).toBeNull();
});

it('surfaces a refused withdrawal and retries it, refreshing claims and eligibility after success', async () => {
  let withdrawn = false;
  api.get.mockImplementation(async (url: string) =>
    url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY
      ? { data: eligibility }
      : page([claim({ status: withdrawn ? 'withdrawn' : 'submitted', statusDisplay: 'Withdrawn', isLive: false })]),
  );
  api.delete.mockRejectedValueOnce(new Error('Refused')).mockImplementation(async () => {
    withdrawn = true;
    return {};
  });
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: 'Withdraw claim' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByText('Awaiting review')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Withdraw claim' }));
  expect(await screen.findByText('Withdrawn')).toBeTruthy();
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(api.delete).toHaveBeenCalledWith(INVESTOR_CLASSIFICATION_ENDPOINTS.DETAIL('claim-one'));
  expect((screen.getAllByRole('button', { name: 'Submit evidence' })[0] as HTMLButtonElement).disabled).toBe(false);
});

it('submits selected evidence and refreshes the claim list without sending the account identity', async () => {
  renderPage();
  const buttons = await screen.findAllByRole('button', { name: 'Submit evidence' });
  fireEvent.click(buttons[0]);
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Basis for the claim'), {
    target: { value: 'My eligible investment evidence' },
  });
  fireEvent.change(within(dialog).getByLabelText('Evidence file'), {
    target: { files: [new File(['synthetic'], 'evidence.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Submit for review' }));
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  const payload = api.post.mock.calls[0][1] as FormData;
  expect(payload.get('category')).toBe('product_value');
  expect(payload.get('declared_basis')).toBe('My eligible investment evidence');
  expect(payload.get('declaration_accepted')).toBe('true');
  expect(payload.has('user_account')).toBe(false);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(api.get.mock.calls.filter(([url]) => url === INVESTOR_CLASSIFICATION_ENDPOINTS.BASE).length).toBeGreaterThan(
    1,
  );
});

it('keeps submitted evidence in the form when the operator refuses the request', async () => {
  api.post.mockRejectedValue(new Error('Unavailable'));
  renderPage();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Submit evidence' }))[0]);
  const dialog = await screen.findByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Basis for the claim'), { target: { value: 'My evidence' } });
  fireEvent.change(within(dialog).getByLabelText('Evidence file'), {
    target: { files: [new File(['test'], 'proof.pdf', { type: 'application/pdf' })] },
  });
  fireEvent.click(within(dialog).getByRole('checkbox'));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Submit for review' }));
  expect(await within(dialog).findByRole('alert')).toBeTruthy();
  expect((within(dialog).getByLabelText('Basis for the claim') as HTMLTextAreaElement).value).toBe('My evidence');
  expect(within(dialog).getByText('proof.pdf')).toBeTruthy();
  expect((within(dialog).getByRole('button', { name: 'Submit for review' }) as HTMLButtonElement).disabled).toBe(false);
});

it('reports an issuer-list failure in an associated-person claim and retries instead of offering an empty selector', async () => {
  let broken = true;
  api.get.mockImplementation(async (url: string) => {
    if (url === INVESTOR_CLASSIFICATION_ENDPOINTS.ELIGIBILITY) return { data: eligibility };
    if (url === INVESTOR_CLASSIFICATION_ENDPOINTS.BASE) return page();
    if (broken) throw new Error('Unavailable');
    return { data: { results: [{ uuid: 'fictional-issuer', name: 'Harbour Example Pty Ltd' }] } };
  });
  renderPage();
  fireEvent.click((await screen.findAllByRole('button', { name: 'Submit evidence' }))[3]);
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByText('Issuers could not be loaded.')).toBeTruthy();
  expect((within(dialog).getByLabelText('Issuer') as HTMLSelectElement).disabled).toBe(true);
  broken = false;
  fireEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
  expect(await within(dialog).findByRole('option', { name: 'Harbour Example Pty Ltd' })).toBeTruthy();
  expect((within(dialog).getByLabelText('Issuer') as HTMLSelectElement).disabled).toBe(false);
});
