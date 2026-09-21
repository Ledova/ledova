import React from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { COMPANY_TOKEN_ENDPOINTS } from '@ledova/shared';
import { apiClient } from '../services/apiClient';
import { useCompanyShareholders } from './useCompanyTokens';

jest.mock('../services/apiClient', () => ({ apiClient: { get: jest.fn() } }));

const get = jest.mocked(apiClient.get);
const FIRST = `0x${'1'.repeat(40)}`;
const SECOND = `0x${'2'.repeat(40)}`;
const TOKENS = [
  { uuid: 'ordinary', name: 'Ordinary', symbol: 'ORD', status: 'deployed' },
  { uuid: 'preference', name: 'Preference', symbol: 'PRF', status: 'deployed' },
  { uuid: 'unopened', name: 'Unopened', symbol: 'UNO', status: 'deployed' },
];
let client: QueryClient;

function row(member: string, wallets: string[], balance: string, percentage: number) {
  return {
    member,
    wallets: wallets.map((address) => ({ address, whitelistStatus: 'active' })),
    name: member === 'member-1' ? 'Mia Member' : null,
    balance,
    percentage,
    source: 'stored',
    holderType: 'member',
    enteredOn: '2026-09-01',
    shareClass: 'ORD',
    identitySource: 'Live profile',
  };
}

const REGISTERS: Record<string, unknown> = {
  ordinary: { initialized: true, holders: [row('member-1', [FIRST], '60', 60), row('member-2', [], '40', 40)] },
  preference: { initialized: true, holders: [row('member-1', [FIRST, SECOND], '10', 100)] },
  unopened: { initialized: false, holders: [] },
};

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((url: string) => {
    if (url === COMPANY_TOKEN_ENDPOINTS.BASE) return Promise.resolve({ data: { results: TOKENS } });
    const token = TOKENS.find(({ uuid }) => url === COMPANY_TOKEN_ENDPOINTS.HOLDERS(uuid));
    return token ? Promise.resolve({ data: REGISTERS[token.uuid] }) : Promise.reject(new Error(`Unexpected ${url}`));
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});

afterEach(async () => {
  await cleanup();
  client.clear();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

it('adds up each member across share classes and names the classes whose register is not opened', async () => {
  const { result } = await renderHook(() => useCompanyShareholders(), { wrapper });
  await waitFor(() => expect(result.current.holders).toHaveLength(2));
  expect(result.current.holders).toEqual([
    {
      member: 'member-1',
      wallets: [FIRST, SECOND],
      name: 'Mia Member',
      totalBalance: 70,
      tokens: [
        { name: 'Ordinary', symbol: 'ORD', balance: 60, percentage: 60 },
        { name: 'Preference', symbol: 'PRF', balance: 10, percentage: 100 },
      ],
    },
    {
      member: 'member-2',
      wallets: [],
      name: null,
      totalBalance: 40,
      tokens: [{ name: 'Ordinary', symbol: 'ORD', balance: 40, percentage: 40 }],
    },
  ]);
  expect(result.current.unopenedTokens).toEqual(['UNO']);
});
