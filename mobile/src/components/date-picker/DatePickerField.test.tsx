import { cleanup, fireEvent, render } from '@testing-library/react-native';
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
