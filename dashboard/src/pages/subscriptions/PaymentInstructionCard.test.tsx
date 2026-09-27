// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PaymentInstruction } from '@ledova/shared';
import { PaymentInstructionCard } from './PaymentInstructionCard';

const writeText = vi.fn();
const instruction: PaymentInstruction = {
  rail: 'bank_transfer',
  railDisplay: 'Bank transfer',
  reference: 'EXAMPLE01ABCD',
  amountDue: '90071992547409.93',
  currency: 'AUD',
  payee: 'Example Registry',
  issuedAt: '2026-09-20T00:00:00Z',
  paymentDueAt: '2026-10-01T00:00:00Z',
  bankAccountName: 'Example Trust',
  bankBsb: '001-002',
  bankAccountNumber: '00012345',
};
beforeEach(() => {
  vi.resetAllMocks();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  writeText.mockResolvedValue(undefined);
});
afterEach(cleanup);

it('displays exact instruction money and copies the original reference and bank account including leading zeroes', async () => {
  render(<PaymentInstructionCard instruction={instruction} />);
  expect(screen.getByText(/AUD\s90,071,992,547,409.93/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copy reference' }));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Copied');
  expect(writeText).toHaveBeenLastCalledWith('EXAMPLE01ABCD');
  fireEvent.click(screen.getByRole('button', { name: 'Copy account number' }));
  expect(writeText).toHaveBeenLastCalledWith('00012345');
});

it('reports clipboard refusal without losing the selectable value and permits retry', async () => {
  writeText.mockRejectedValueOnce(Error('Denied'));
  render(<PaymentInstructionCard instruction={instruction} />);
  fireEvent.click(screen.getByRole('button', { name: 'Copy reference' }));
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    'Could not copy. Select and copy the value above.',
  );
  expect(screen.getByText('EXAMPLE01ABCD')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Copy reference' }));
  expect(await screen.findByRole('status')).toHaveProperty('textContent', 'Copied');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('does not provide a copy action for unavailable bank details', () => {
  render(<PaymentInstructionCard instruction={{ ...instruction, bankAccountNumber: undefined }} />);
  expect(screen.getByText('Unavailable')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Copy account number' })).toBeNull();
});

it('retains the supplied asset, network, contract, decimals and exact raw units without adding a send action', async () => {
  render(
    <PaymentInstructionCard
      instruction={{
        ...instruction,
        rail: 'stablecoin',
        railDisplay: 'Stablecoin',
        assetSymbol: 'AUDX',
        chain: 'base',
        contractAddress: `0x${'1'.repeat(40)}`,
        receivingWalletAddress: `0x${'2'.repeat(40)}`,
        decimals: 18,
        settlementAmount: '90071992547409930000000000000000',
      }}
    />,
  );
  expect(screen.getByText('AUDX')).toBeTruthy();
  expect(screen.getByText('base')).toBeTruthy();
  expect(screen.getByText('18')).toBeTruthy();
  expect(screen.getByText('90071992547409930000000000000000')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Send/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Copy raw units' }));
  expect(await screen.findByRole('status')).toBeTruthy();
  expect(writeText).toHaveBeenLastCalledWith('90071992547409930000000000000000');
});
