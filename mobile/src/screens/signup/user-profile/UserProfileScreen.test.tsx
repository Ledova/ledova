import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ApiClientProvider, USER_PROFILE_FIELDS } from '@ledova/shared';
import { apiClient } from '../../../services/apiClient';
import { UserProfileScreen } from './UserProfileScreen';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: jest.fn() }),
}));
jest.mock('../../../hooks/useRole', () => ({ useRole: () => ({ isCompany: false }) }));
jest.mock('../../../services/apiClient', () => ({ apiClient: { get: jest.fn(), patch: jest.fn() } }));
const api = jest.mocked(apiClient);

const A_MESSAGE: Record<string, string> = {
  fullName: 'Enter your full legal name.',
  dateOfBirth: 'Enter a date in the past.',
  residentialAddress: 'Enter a street address.',
  phoneNumber: 'Enter a valid phone number.',
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  api.get.mockResolvedValue({
    data: {
      count: 1,
      results: [
        {
          uuid: 'profile-1',
          fullName: 'Synthetic Person',
          dateOfBirth: '1990-01-01',
          residentialAddress: '1 Synthetic Street, Sydney',
          phoneCountryCode: '+61',
          phoneNumber: '491570156',
        },
      ],
    },
  });
});

afterEach(async () => {
  await cleanup();
});

describe('every field USER_PROFILE_FIELDS names is one this screen actually renders', () => {
  it.each(USER_PROFILE_FIELDS)('shows the refusal the server gave for %s under its field', async (field) => {
    api.patch.mockRejectedValue({ response: { status: 400, data: { [field]: [A_MESSAGE[field]] } } });
    const view = await render(
      <ApiClientProvider client={apiClient}>
        <UserProfileScreen />
      </ApiClientProvider>,
    );
    await waitFor(() => expect(view.getByDisplayValue('Synthetic Person')).toBeTruthy());

    await fireEvent.press(view.getByText('Continue'));

    await waitFor(() => expect(view.getByText(A_MESSAGE[field])).toBeTruthy());
  });
});

it('saves edits from named profile fields once through accessible Continue and locks the form while saving', async () => {
  let finishSave!: (result: { data: object }) => void;
  api.patch.mockImplementation(
    () =>
      new Promise((resolve) => {
        finishSave = resolve;
      }),
  );
  const view = await render(
    <ApiClientProvider client={apiClient}>
      <UserProfileScreen />
    </ApiClientProvider>,
  );
  await waitFor(() => expect(view.getByLabelText('Full Name')).toHaveDisplayValue('Synthetic Person'));
  await fireEvent.changeText(view.getByLabelText('Full Name'), 'Synthetic Representative');
  await fireEvent.changeText(view.getByLabelText('Residential Address'), '2 Test Street, Sydney NSW 2000');
  await fireEvent.changeText(view.getByLabelText('Phone Number'), '416234567');
  await fireEvent(view.getByRole('button', { name: 'Continue' }), 'accessibilityTap');

  expect(api.patch).toHaveBeenCalledTimes(1);
  expect(api.patch).toHaveBeenCalledWith('/api/user-profiles/profile-1/', {
    fullName: 'Synthetic Representative',
    dateOfBirth: '1990-01-01',
    residentialAddress: '2 Test Street, Sydney NSW 2000',
    phoneCountryCode: '+61',
    phoneNumber: '416234567',
  });
  for (const label of ['Full Name', 'Residential Address', 'Phone Number']) {
    expect(view.getByLabelText(label)).toBeDisabled();
  }
  expect(view.getByRole('button', { name: 'Date of Birth' })).toBeDisabled();
  const saving = view.getByRole('button', { name: 'Continue', busy: true, disabled: true });
  await fireEvent.press(saving);
  await act(() => saving.props.onAccessibilityTap());
  expect(api.patch).toHaveBeenCalledTimes(1);
  await act(() => finishSave({ data: {} }));
  expect(view.getByRole('button', { name: 'Continue' })).toBeEnabled();
});
