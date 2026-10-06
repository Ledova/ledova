import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { EligibilityLinks } from './EligibilityLinks';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
afterEach(async () => {
  await cleanup();
  mockNavigate.mockReset();
});

it.each([
  ['participant', 'Eligibility requests', 'ParticipantEligibility'],
  ['company', 'Company eligibility', 'CompanyEligibility'],
] as const)('opens the %s workflow through the visible Home stack', async (kind, label, screen) => {
  const view = await render(<EligibilityLinks participant={kind === 'participant'} company={kind === 'company'} />);
  await fireEvent.press(view.getByRole('button', { name: label }));
  expect(mockNavigate).toHaveBeenCalledWith('MainApp', {
    screen: 'Main',
    params: { screen: 'Home', params: { screen } },
  });
});
