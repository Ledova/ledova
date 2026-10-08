// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { ApiClientProvider, COMPANY_TOKEN_ENDPOINTS, REGISTER_COPY } from '@ledova/shared';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const providedApi = Object.assign(axios.create(), api);

import { MemoryRouter } from 'react-router-dom';
import { PageTitle } from '@components/PageTitle';
import { ShareClass } from './classes';
import { prepareCompanyClient } from './testSupport';

const TOKEN = {
  uuid: 'token-1',
  company: 'company-one',
  isOwner: true,
  companyUuid: 'company-one',
  companyName: 'Fictional Company',
  name: 'Ordinary Shares',
  symbol: 'QAT',
  status: 'deployed',
  statusDisplay: 'Deployed',
  tokenType: 'ordinary',
  totalSupply: '1000000',
  contractAddress: `0x${'c'.repeat(40)}`,
  chain: 'base',
};

const REQUEST = {
  uuid: 'request-1',
  token: 'token-1',
  tokenSymbol: 'QAT',
  tokenName: 'Ordinary Shares',
  recipientAddress: `0x${'b'.repeat(40)}`,
  amount: 10000,
  issuanceType: 'additional',
  issuanceTypeDisplay: 'Additional',
  reason: 'Founder allocation',
  status: 'submitted',
  statusDisplay: 'Submitted',
  dilutionPercentage: null,
  submittedBy: 'user-1',
  submittedByEmail: 'issuer@example.test',
  submittedAt: '2026-09-07T00:00:00Z',
  createdAt: '2026-09-07T00:00:00Z',
};

const OPENED_EMPTY = {
  token: TOKEN,
  holders: [],
  totalHolders: 0,
  initialized: true,
  issuedSupply: '0',
  waitingEffects: 0,
};

const MEMBERS = {
  ...OPENED_EMPTY,
  holders: [
    {
      member: 'member-1',
      wallets: [
        { address: `0x${'1'.repeat(40)}`, whitelistStatus: 'active' },
        { address: `0x${'2'.repeat(40)}`, whitelistStatus: '' },
      ],
      name: 'Mia Member',
      balance: '60',
      percentage: 60,
      source: 'stored',
      holderType: 'member',
      enteredOn: '2026-09-01',
      shareClass: 'QAT',
      identitySource: 'Live profile',
    },
    {
      member: 'member-2',
      wallets: [],
      name: null,
      balance: '40',
      percentage: 40,
      source: 'stored',
      holderType: 'unidentified',
      enteredOn: '2026-09-02',
      shareClass: 'QAT',
      identitySource: 'None',
    },
  ],
  totalHolders: 2,
  issuedSupply: '100',
};

let requests: Array<typeof REQUEST & { executionNotes?: string }>;
let register: Record<string, unknown>;
let tokenStatus: string;
let refuseRequests: boolean;
let queryClient: QueryClient;

function showHistory() {
  render(
    <QueryClientProvider client={queryClient}>
      <ApiClientProvider client={providedApi}>
        <MemoryRouter>
          <PageTitle.Provider value="Share class">
            <ShareClass uuid="token-1" />
          </PageTitle.Provider>
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  requests = [];
  register = OPENED_EMPTY;
  tokenStatus = 'deployed';
  refuseRequests = false;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  prepareCompanyClient(queryClient);
  api.get.mockReset();
  api.post.mockReset();
  api.get.mockImplementation(async (url: string, config?: { params?: { page?: number } }) => {
    if (url === '/api/v1/company-authority/appointments/' || url === COMPANY_TOKEN_ENDPOINTS.REGISTER_DEPLOYMENTS)
      return { data: { results: [], count: 0, next: null, previous: null } };
    if (url === COMPANY_TOKEN_ENDPOINTS.DETAIL('token-1')) return { data: { ...TOKEN, status: tokenStatus } };
    if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('token-1')) return { data: register };
    if (url === COMPANY_TOKEN_ENDPOINTS.ISSUANCES('token-1') || url === COMPANY_TOKEN_ENDPOINTS.CAPITAL_INCREASES) {
      return { data: { results: [], count: 0, next: null, previous: null } };
    }
    if (url === COMPANY_TOKEN_ENDPOINTS.ISSUANCE_REQUESTS) {
      if (refuseRequests) throw new Error('Network unavailable');
      const page = config?.params?.page ?? 1;
      return {
        data: {
          results: requests.slice((page - 1) * 25, page * 25),
          count: requests.length,
          previous: null,
          next:
            requests.length > page * 25
              ? `https://example.test/api/v1/tokens/issuance-requests/?page=${page + 1}`
              : null,
        },
      };
    }
    throw new Error(`Unexpected GET ${url}`);
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('the issuer request history through real query and service hooks', () => {
  it('allows a register export after the last current holder has left', async () => {
    showHistory();
    await screen.findByText('No issuance requests yet.');
    const download = screen.getByRole('button', { name: 'Download CSV' }) as HTMLButtonElement;
    expect(download.disabled).toBe(false);
  });

  it('refuses the export and says why while the register is not opened', async () => {
    register = {
      token: TOKEN,
      holders: [],
      totalHolders: 0,
      initialized: false,
      issuedSupply: null,
      waitingEffects: null,
    };
    showHistory();
    await screen.findByText(REGISTER_COPY.NOT_OPENED_NOTE);
    expect((screen.getByRole('button', { name: 'Download CSV' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText(REGISTER_COPY.WAITING_UNKNOWN_NOTE)).toBeNull();
  });

  it('lists each member once with every linked wallet and the effects still waiting', async () => {
    register = { ...MEMBERS, waitingEffects: 2 };
    showHistory();
    await screen.findByText('Mia Member');
    expect(screen.getByText('0x1111111111111111111111111111111111111111 · active')).toBeDefined();
    expect(screen.getByText('0x2222222222222222222222222222222222222222 ·')).toBeDefined();
    expect(screen.getByText(REGISTER_COPY.NO_WALLET)).toBeDefined();
    expect(screen.getByText('Current members · 2')).toBeDefined();
    expect(screen.getByText(REGISTER_COPY.WAITING_NOTE(2))).toBeDefined();
    expect((screen.getByRole('button', { name: 'Download CSV' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('says so when it could not check for effects still waiting', async () => {
    register = { ...MEMBERS, waitingEffects: null };
    showHistory();
    await screen.findByText(REGISTER_COPY.WAITING_UNKNOWN_NOTE);
    expect(screen.queryByText(REGISTER_COPY.NOT_OPENED_NOTE)).toBeNull();
  });

  it('reads every page before displaying the full history', async () => {
    requests = Array.from({ length: 26 }, (_, index) => ({
      ...REQUEST,
      uuid: `request-${index}`,
      reason: `Allocation ${index}`,
    }));
    showHistory();
    await screen.findByText('Allocation 25');
    expect(screen.getByText('Allocation 0')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Load more issuance requests' })).toBeNull();
    expect(api.get).toHaveBeenCalledWith(COMPANY_TOKEN_ENDPOINTS.ISSUANCE_REQUESTS, {
      params: { token: 'token-1', page: 2 },
      ledovaSubmissionGuard: expect.any(Function),
    });
  });

  it('reports a failed history load and retries without claiming it is empty', async () => {
    refuseRequests = true;
    showHistory();
    await screen.findByText("We couldn't load issuance requests.");
    expect(screen.queryByText('No issuance requests yet.')).toBeNull();
    refuseRequests = false;
    requests = [REQUEST];
    fireEvent.click(screen.getByRole('button', { name: 'Retry issuance requests' }));
    await screen.findByText('Submitted');
    await waitFor(() => expect(screen.queryByText("We couldn't load issuance requests.")).toBeNull());
  });

  it('shows safe execution history and distinguishes approved and rejected requests', async () => {
    requests = [
      {
        ...REQUEST,
        status: 'approved',
        statusDisplay: 'Approved',
        executionNotes: 'Execution failed. Operations review is required.',
      },
      { ...REQUEST, uuid: 'request-2', status: 'rejected', statusDisplay: 'Rejected' },
    ];
    showHistory();
    await screen.findByText('Approved');
    expect(screen.getByText('Approved').previousElementSibling?.className).not.toEqual(
      screen.getByText('Rejected').previousElementSibling?.className,
    );
    expect(screen.getByText('Execution history')).toBeDefined();
    expect(screen.getByText('Execution failed. Operations review is required.')).toBeDefined();
  });

  it('keeps draft history readable and refreshes existing requests', async () => {
    tokenStatus = 'draft';
    showHistory();
    await screen.findByText('No issuance requests yet.');
    expect(screen.getByText('No issuance requests yet.')).toBeDefined();
    requests = [REQUEST];
    await queryClient.invalidateQueries({
      queryKey: ['token', 'token-1', 'profile-one', 'account-one', 'issuance-requests'],
    });
    await screen.findByText('Submitted');
    expect(screen.getByText('Issuance requests')).toBeDefined();
  });
});
