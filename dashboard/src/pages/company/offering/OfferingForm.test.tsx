// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OFFER_DOCUMENT_COPY } from '@ledova/shared';
import type { CompanyShareToken, Offering, OfferingInput, OperatorSettlementAsset } from '@ledova/shared';
import { documentRecord } from '../testSupport';
import { OfferingForm } from './OfferingForm';

const TOKEN = { uuid: 'token-1', symbol: 'QAT', name: 'QA Token' } as unknown as CompanyShareToken;

const AUDY: OperatorSettlementAsset = {
  uuid: 'asset-audy',
  symbol: 'AUDY',
  name: 'Audy',
  chainDeployments: [{ chain: 'base', contractAddress: `0x${'9'.repeat(40)}`, decimals: 2, isActive: true }],
} as unknown as OperatorSettlementAsset;

const USDC: OperatorSettlementAsset = { ...AUDY, uuid: 'asset-usdc', symbol: 'USDC', name: 'USD Coin' };

function fillTheRequiredFields() {
  fireEvent.change(screen.getByLabelText('Price per share (AUD)'), { target: { value: '1.50' } });
  fireEvent.change(screen.getByLabelText('Minimum shares'), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText('Target shares'), { target: { value: '100' } });
  fireEvent.change(screen.getByLabelText('Cap shares'), { target: { value: '200' } });
  fireEvent.change(screen.getByLabelText('Opens at'), { target: { value: '2026-10-01T09:00' } });
}

function created(onCreate: ReturnType<typeof vi.fn>): OfferingInput {
  return onCreate.mock.calls[0][0] as OfferingInput;
}

describe('OfferingForm settlement assets', () => {
  afterEach(cleanup);

  it('offers the operator settlement assets the issuer may accept', () => {
    render(
      <OfferingForm
        tokens={[TOKEN]}
        busy={false}
        settlementAssets={[AUDY, USDC]}
        operatorName="Example Operator"
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('AUDY')).toBeDefined();
    expect(screen.getByLabelText('USDC')).toBeDefined();
  });

  it('carries the chosen settlement assets in the payload', () => {
    const onCreate = vi.fn();
    render(
      <OfferingForm
        tokens={[TOKEN]}
        busy={false}
        settlementAssets={[AUDY, USDC]}
        operatorName="Example Operator"
        onCreate={onCreate}
      />,
    );
    fillTheRequiredFields();

    fireEvent.click(screen.getByLabelText('USDC'));
    fireEvent.click(screen.getByText('Create draft offering'));

    expect(created(onCreate).settlementAssets).toEqual(['asset-usdc']);
  });

  it('sends no settlement assets when the issuer chooses none', () => {
    const onCreate = vi.fn();
    render(
      <OfferingForm
        tokens={[TOKEN]}
        busy={false}
        settlementAssets={[AUDY]}
        operatorName="Example Operator"
        onCreate={onCreate}
      />,
    );
    fillTheRequiredFields();

    fireEvent.click(screen.getByText('Create draft offering'));

    expect(created(onCreate).settlementAssets).toEqual([]);
  });

  it('says why there is nothing to choose when the operator supports no stablecoin', () => {
    render(
      <OfferingForm
        tokens={[TOKEN]}
        busy={false}
        settlementAssets={[]}
        operatorName="Example Operator"
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByText(/Example Operator has not configured a settlement asset/)).toBeDefined();
  });

  it('still offers bank transfer when there is no settlement asset', () => {
    render(
      <OfferingForm
        tokens={[TOKEN]}
        busy={false}
        settlementAssets={[]}
        operatorName="Example Operator"
        onCreate={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Accept bank transfer')).toBeDefined();
  });

  it('refuses an offering with no rail at all', () => {
    const onCreate = vi.fn();
    render(
      <OfferingForm
        tokens={[TOKEN]}
        busy={false}
        settlementAssets={[AUDY]}
        operatorName="Example Operator"
        onCreate={onCreate}
      />,
    );
    fillTheRequiredFields();

    fireEvent.click(screen.getByLabelText('Accept bank transfer'));
    fireEvent.click(screen.getByText('Create draft offering'));

    expect(onCreate).not.toHaveBeenCalled();
  });
});

afterEach(cleanup);

function form(onCreate = vi.fn()) {
  const props = {
    tokens: [TOKEN],
    busy: false,
    settlementAssets: [AUDY, USDC],
    operatorName: 'Example Operator',
    onCreate,
  };
  return { ...render(<OfferingForm {...props} />), props, onCreate };
}

it.each([
  ['Minimum shares', '1.5'],
  ['Minimum shares', '1e1'],
  ['Minimum shares', '0'],
  ['Target shares', '9'],
  ['Cap shares', '99'],
  ['Cap shares', '2147483648'],
  ['Cap shares', '9007199254740993'],
  ['Price per share (AUD)', '0'],
  ['Price per share (AUD)', '1e3'],
  ['Price per share (AUD)', '0.001'],
  ['Price per share (AUD)', '10000000000000000.00'],
])('refuses invalid %s value %s before creating', (label, value) => {
  const { onCreate } = form();
  fillTheRequiredFields();
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Create draft offering' }));
  expect(onCreate).not.toHaveBeenCalled();
});

it.each(['2147483646', '2147483647'])('sends an exact supported cap of %s without truncation', (value) => {
  const { onCreate } = form();
  fillTheRequiredFields();
  fireEvent.change(screen.getByLabelText('Cap shares'), { target: { value } });
  fireEvent.click(screen.getByRole('button', { name: 'Create draft offering' }));
  expect(created(onCreate).capShares).toBe(Number(value));
});

it('requires closing after opening and sends valid local times as ISO timestamps', () => {
  const { onCreate } = form();
  fillTheRequiredFields();
  fireEvent.change(screen.getByLabelText('Closes at (optional)'), { target: { value: '2026-10-01T08:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create draft offering' }));
  expect(onCreate).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Closes at (optional)'), { target: { value: '2026-10-02T08:00' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create draft offering' }));
  expect(created(onCreate).opensAt).toBe(new Date('2026-10-01T09:00').toISOString());
  expect(created(onCreate).closesAt).toBe(new Date('2026-10-02T08:00').toISOString());
});

it('keeps the initially selected class when background data changes order', () => {
  const { props, rerender, onCreate } = form();
  fillTheRequiredFields();
  rerender(<OfferingForm {...props} tokens={[{ ...TOKEN, uuid: 'token-two', name: 'Preference' }, TOKEN]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create draft offering' }));
  expect(created(onCreate).token).toBe(TOKEN.uuid);
});

it('preserves a draft while reads are blocked, and requires removing an unavailable settlement asset', () => {
  const { props, rerender, onCreate } = form();
  fillTheRequiredFields();
  fireEvent.click(screen.getByLabelText('USDC'));
  rerender(<OfferingForm {...props} blocked />);
  fireEvent.click(screen.getByRole('button', { name: 'Create draft offering' }));
  expect(onCreate).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('1.50')).toBeTruthy();
  rerender(<OfferingForm {...props} settlementAssets={[]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Create draft offering' }));
  expect(onCreate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Remove unavailable settlement assets' }));
  fireEvent.click(screen.getByRole('button', { name: 'Create draft offering' }));
  expect(created(onCreate).settlementAssets).toEqual([]);
});

describe('OfferingForm documents for investors', () => {
  afterEach(cleanup);

  const MEMORANDUM = documentRecord('prospectus', 'memorandum');
  const RISKS = documentRecord('risk_disclosure', 'risks');

  it('offers the company documents and carries only the chosen ones', () => {
    const onCreate = vi.fn();
    render(
      <OfferingForm
        tokens={[TOKEN]}
        busy={false}
        settlementAssets={[]}
        documents={[MEMORANDUM, RISKS]}
        operatorName="Example Operator"
        onCreate={onCreate}
      />,
    );
    fillTheRequiredFields();
    expect(screen.getByText(OFFER_DOCUMENT_COPY.ATTACH_HELP)).toBeDefined();
    fireEvent.click(screen.getByLabelText('Attach risks.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Create draft offering' }));

    expect(created(onCreate).documents).toEqual(['risks']);
  });

  it('keeps the documents of an edited offering unless the issuer removes one', () => {
    const onUpdate = vi.fn();
    const editing = {
      tokenUuid: TOKEN.uuid,
      exemption: 's708_11_professional',
      pricePerShare: '1.50',
      minimumShares: 10,
      targetShares: 100,
      capShares: 200,
      opensAt: '2026-10-01T09:00:00Z',
      closesAt: null,
      summary: '',
      useOfProceeds: '',
      acceptsBankTransfer: true,
      settlementAssets: [],
      documents: ['memorandum', 'risks'],
      status: 'draft',
    } as unknown as Offering;
    render(
      <OfferingForm
        tokens={[TOKEN]}
        busy={false}
        settlementAssets={[]}
        documents={[MEMORANDUM, RISKS]}
        operatorName="Example Operator"
        onCreate={vi.fn()}
        editing={editing}
        onUpdate={onUpdate}
      />,
    );
    expect((screen.getByLabelText('Attach memorandum.pdf') as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByLabelText('Attach memorandum.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect((onUpdate.mock.calls[0][0] as OfferingInput).documents).toEqual(['risks']);
  });

  it('lists offer documents, and any document already attached, but never personal records', () => {
    const onUpdate = vi.fn();
    const editing = {
      tokenUuid: TOKEN.uuid,
      exemption: 's708_11_professional',
      pricePerShare: '1.50',
      minimumShares: 10,
      targetShares: 100,
      capShares: 200,
      opensAt: '2026-10-01T09:00:00Z',
      closesAt: null,
      summary: '',
      useOfProceeds: '',
      acceptsBankTransfer: true,
      settlementAssets: [],
      documents: ['authority'],
      status: 'draft',
    } as unknown as Offering;
    render(
      <OfferingForm
        tokens={[TOKEN]}
        busy={false}
        settlementAssets={[]}
        documents={[MEMORANDUM, documentRecord('share_register', 'register'), documentRecord('other', 'authority')]}
        operatorName="Example Operator"
        onCreate={vi.fn()}
        editing={editing}
        onUpdate={onUpdate}
      />,
    );
    expect(screen.getByLabelText('Attach memorandum.pdf')).toBeDefined();
    expect((screen.getByLabelText('Attach authority.pdf') as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByLabelText('Attach register.pdf')).toBeNull();
    fireEvent.click(screen.getByLabelText('Attach authority.pdf'));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect((onUpdate.mock.calls[0][0] as OfferingInput).documents).toEqual([]);
  });

  it("drops an attachment the company does not hold, so another company's document never blocks a save", () => {
    const onUpdate = vi.fn();
    const editing = {
      tokenUuid: TOKEN.uuid,
      exemption: 's708_11_professional',
      pricePerShare: '1.50',
      minimumShares: 10,
      targetShares: 100,
      capShares: 200,
      opensAt: '2026-10-01T09:00:00Z',
      closesAt: null,
      summary: '',
      useOfProceeds: '',
      acceptsBankTransfer: true,
      settlementAssets: [],
      documents: ['memorandum', 'someone-elses'],
      status: 'draft',
    } as unknown as Offering;
    render(
      <OfferingForm
        tokens={[TOKEN]}
        busy={false}
        settlementAssets={[]}
        documents={[MEMORANDUM]}
        operatorName="Example Operator"
        onCreate={vi.fn()}
        editing={editing}
        onUpdate={onUpdate}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect((onUpdate.mock.calls[0][0] as OfferingInput).documents).toEqual(['memorandum']);
  });

  it('says where documents come from when the company has none', () => {
    const onCreate = vi.fn();
    render(
      <OfferingForm
        tokens={[TOKEN]}
        busy={false}
        settlementAssets={[]}
        operatorName="Example Operator"
        onCreate={onCreate}
      />,
    );
    fillTheRequiredFields();
    expect(screen.getByText(OFFER_DOCUMENT_COPY.ATTACH_NONE)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Create draft offering' }));

    expect(created(onCreate).documents).toEqual([]);
  });
});
