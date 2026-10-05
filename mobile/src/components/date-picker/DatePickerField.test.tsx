import { act, cleanup, fireEvent, render } from '@testing-library/react-native';
import { DatePickerField } from './DatePickerField';

jest.mock('@react-native-community/datetimepicker', () => {
  const { View } = jest.requireActual('react-native');
  return { __esModule: true, default: View };
});

afterEach(async () => {
  await cleanup();
});

it('opens the date sheet on the card, titled by its field, with Cancel before Done', async () => {
  const change = jest.fn();
  const view = await render(<DatePickerField label="From date" onChange={change} />);
  await fireEvent.press(view.getByText('DD/MM/YYYY'));
  const title = view.getByRole('header', { name: 'From date' });
  const sheet = title.parent!;
  expect(sheet).toHaveStyle({ borderWidth: 1, borderTopLeftRadius: 12, borderTopRightRadius: 12, padding: 16 });
  const cancel = view.getByRole('button', { name: 'Cancel' });
  const row = cancel.parent!;
  expect(row.children).toEqual([cancel, view.getByRole('button', { name: 'Done' })]);
  expect(row).toHaveStyle({ flexDirection: 'row', justifyContent: 'flex-end' });
  expect(sheet.children.at(-1)).toBe(row);
  await fireEvent.press(view.getByRole('button', { name: 'Done' }));
  expect(view.queryByRole('header', { name: 'From date' })).toBeNull();
  await fireEvent.press(view.getByText('DD/MM/YYYY'));
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  expect(view.queryByRole('header', { name: 'From date' })).toBeNull();
  expect(change).not.toHaveBeenCalled();
});

it('opens the named date control through native accessibility activation without inventing a date change', async () => {
  const change = jest.fn();
  const view = await render(<DatePickerField label="Date of Birth" value={new Date(1990, 0, 2)} onChange={change} />);
  const opener = view.getByRole('button', { name: 'Date of Birth', expanded: false });
  expect(opener.props.accessibilityValue).toEqual({ text: '02/01/1990' });
  await fireEvent(opener, 'accessibilityTap');
  expect(view.getByRole('button', { name: 'Date of Birth', expanded: true })).toBeTruthy();
  expect(view.getByRole('header', { name: 'Date of Birth' })).toBeTruthy();
  await fireEvent(view.getByRole('button', { name: 'Done' }), 'accessibilityTap');
  expect(view.queryByRole('header', { name: 'Date of Birth' })).toBeNull();
  expect(change).not.toHaveBeenCalled();
});

it('refuses touch and direct native activation while the date field is disabled', async () => {
  const view = await render(<DatePickerField label="Date of Birth" onChange={jest.fn()} disabled />);
  const opener = view.getByRole('button', { name: 'Date of Birth', disabled: true });
  await fireEvent.press(opener);
  await act(() => opener.props.onAccessibilityTap());
  expect(view.queryByRole('header', { name: 'Date of Birth' })).toBeNull();
});
