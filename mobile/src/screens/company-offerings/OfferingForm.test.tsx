import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import type { Offering, OperatorSettlementAsset } from '@ledova/shared';
import { OfferingForm } from './OfferingForm';

jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual('react-native');
  return { __esModule: true, default: View };
});
const submit = jest.fn();
const close = jest.fn();
const editing = {
  tokenUuid: 'class-a',
  exemption: 's708_11_professional',
  pricePerShare: '9999999999999999.99',
  minimumShares: 1,
  targetShares: 100,
  capShares: 1000,
  opensAt: '2026-10-01T10:00:00.000Z',
  closesAt: null,
  summary: 'Example',
  useOfProceeds: 'Fictional',
  acceptsBankTransfer: true,
  settlementAssets: [],
  status: 'draft',
} as unknown as Offering;
const props = {
  tokens: [{ uuid: 'class-a', name: 'Ordinary shares', symbol: 'EXA' }],
  busy: false,
  blocked: false,
  settlementAssets: [] as OperatorSettlementAsset[],
  operatorName: 'Example Operator',
  editing,
  onSubmit: submit,
  onClose: close,
};
beforeEach(() => {
  submit.mockReset();
  close.mockReset();
});
afterEach(async () => {
  await cleanup();
});

it.each(['1.5', '1e3', '0', '-1', '2147483648', '9007199254740993'])(
  'rejects invalid request quantity %s and accepts the exact request boundary',
  async (value) => {
    const view = await render(<OfferingForm {...props} />);
    expect(view.getByRole('button', { name: 'Save changes' })).toBeEnabled();
    await fireEvent.changeText(view.getByLabelText('Cap shares'), value);
    expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    expect(submit).not.toHaveBeenCalled();
    await fireEvent.changeText(view.getByLabelText('Cap shares'), '2147483647');
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
    expect(submit).toHaveBeenCalledWith(
      expect.objectContaining({ capShares: 2147483647, pricePerShare: '9999999999999999.99' }),
    );
  },
);

it.each(['0', '0.00', '-1', '1e3', '1.234', '10000000000000000.00'])(
  'rejects invalid price %s without rounding a valid maximum',
  async (value) => {
    const view = await render(<OfferingForm {...props} />);
    await fireEvent.changeText(view.getByLabelText('Price per share (AUD)'), value);
    expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await fireEvent.changeText(view.getByLabelText('Price per share (AUD)'), '9999999999999999.99');
    await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ pricePerShare: '9999999999999999.99' }));
  },
);

it('keeps selected rails until explicitly removed and blocks missing or retired payment choices', async () => {
  const asset = { uuid: 'asset-a', symbol: 'EXAMPLE' } as OperatorSettlementAsset;
  const view = await render(<OfferingForm {...props} settlementAssets={[asset]} />);
  await fireEvent(view.getByLabelText('Accept EXAMPLE'), 'valueChange', true);
  await fireEvent(view.getByLabelText('Accept bank transfer'), 'valueChange', false);
  expect(view.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  await view.rerender(<OfferingForm {...props} settlementAssets={[]} />);
  expect(
    view.getByText('A previously selected settlement asset is no longer available. Remove it before saving.'),
  ).toBeTruthy();
  expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Remove unavailable settlement assets' }));
  expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await fireEvent(view.getByLabelText('Accept bank transfer'), 'valueChange', true);
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ acceptsBankTransfer: true, settlementAssets: [] }));
});

it('preserves draft inputs across changed read readiness and prevents all pending field changes', async () => {
  const view = await render(<OfferingForm {...props} />);
  await fireEvent.changeText(view.getByLabelText('Summary'), 'Retained while blocked');
  await view.rerender(<OfferingForm {...props} blocked />);
  expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  expect(view.getByLabelText('Summary').props.value).toBe('Retained while blocked');
  await view.rerender(<OfferingForm {...props} busy />);
  expect(view.getByLabelText('Summary').props.editable).toBe(false);
  expect(view.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  expect(view.getByRole('button', { name: 'Opens at: choose date' })).toBeDisabled();
  expect(view.getByLabelText('Accept bank transfer').props.disabled).toBe(true);
  expect(submit).not.toHaveBeenCalled();
});

it('uses native date/time selections and rejects closing before opening while supporting no close date', async () => {
  const view = await render(<OfferingForm {...props} />);
  await fireEvent.press(view.getByRole('button', { name: 'Closes at: choose date' }));
  await fireEvent(
    view.getByTestId('offering-date-Closes at'),
    'change',
    { type: 'set' },
    new Date('2026-09-30T10:00:00Z'),
  );
  expect(view.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  await fireEvent.press(view.getByRole('button', { name: 'Closes at: choose date' }));
  await fireEvent(
    view.getByTestId('offering-date-Closes at'),
    'change',
    { type: 'set' },
    new Date('2026-10-03T10:00:00Z'),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Closes at: choose time' }));
  await fireEvent(
    view.getByTestId('offering-date-Closes at'),
    'change',
    { type: 'set' },
    new Date('2026-10-03T11:45:00Z'),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ closesAt: '2026-10-03T11:45:00.000Z' }));
  await fireEvent.press(view.getByRole('button', { name: 'Remove closing date' }));
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ closesAt: null }));
});
