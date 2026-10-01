import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { OFFER_DOCUMENT_COPY, type CompanyDocument, type Offering, type OperatorSettlementAsset } from '@ledova/shared';
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

it('offers the share class and exemption as choices with the edited ones selected', async () => {
  const view = await render(<OfferingForm {...props} />);
  expect(view.getByRole('button', { name: 'Ordinary shares (EXA)', selected: true })).toBeDisabled();
  expect(view.getByRole('button', { name: 'Professional investor (s708(11))', selected: true })).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Wholesale client (s761G)' }));
  expect(view.getByRole('button', { name: 'Wholesale client (s761G)', selected: true })).toBeTruthy();
  expect(view.getByRole('button', { name: 'Professional investor (s708(11))', selected: false })).toBeTruthy();
});

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

const document = (uuid: string, documentType: CompanyDocument['documentType'], documentTypeDisplay: string) =>
  ({ uuid, name: `${uuid}.pdf`, documentType, documentTypeDisplay }) as CompanyDocument;

it('attaches the chosen company documents and keeps those already attached', async () => {
  const documents = [
    document('memorandum', 'prospectus', 'Prospectus or Information Memorandum'),
    document('risks', 'risk_disclosure', 'Risk Disclosure Statement'),
  ];
  const view = await render(
    <OfferingForm {...props} editing={{ ...editing, documents: ['memorandum'] }} documents={documents} />,
  );
  expect(view.getByText(OFFER_DOCUMENT_COPY.ATTACH_HELP)).toBeTruthy();
  expect(view.getByLabelText('Attach memorandum.pdf').props.value).toBe(true);
  expect(view.getByLabelText('Attach risks.pdf').props.value).toBe(false);
  await fireEvent(view.getByLabelText('Attach risks.pdf'), 'valueChange', true);
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ documents: ['memorandum', 'risks'] }));
  await fireEvent(view.getByLabelText('Attach memorandum.pdf'), 'valueChange', false);
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ documents: ['risks'] }));
});

it('says where documents come from when the company has none', async () => {
  const view = await render(<OfferingForm {...props} />);
  expect(view.getByText(OFFER_DOCUMENT_COPY.ATTACH_NONE)).toBeTruthy();
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ documents: [] }));
});

it('lists offer documents, and any document already attached, but never personal records', async () => {
  const documents = [
    document('memorandum', 'prospectus', 'Prospectus or Information Memorandum'),
    document('register', 'share_register', 'Current Share Register'),
    document('authority', 'other', 'Other'),
  ];
  const view = await render(
    <OfferingForm {...props} editing={{ ...editing, documents: ['authority'] }} documents={documents} />,
  );
  expect(view.getByLabelText('Attach memorandum.pdf')).toBeTruthy();
  expect(view.getByLabelText('Attach authority.pdf').props.value).toBe(true);
  expect(view.queryByLabelText('Attach register.pdf')).toBeNull();
  await fireEvent(view.getByLabelText('Attach authority.pdf'), 'valueChange', false);
  await fireEvent.press(view.getByRole('button', { name: 'Save changes' }));
  expect(submit).toHaveBeenLastCalledWith(expect.objectContaining({ documents: [] }));
});
