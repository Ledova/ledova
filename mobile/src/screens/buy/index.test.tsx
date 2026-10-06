import React from 'react';
import { act, cleanup, render } from '@testing-library/react-native';

const mockNavigate = jest.fn();
let mockAccount: { uuid: string; role: 'investor' | 'company' | 'both' } | null;
let mockProps: {
  visible: boolean;
  onNavigateToWebView: (url: string, sessionEpoch: number, userAccountUuid: string) => void;
};

jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({ userAccount: mockAccount }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ navigate: mockNavigate, canGoBack: () => false }),
  useRoute: () => ({ params: { asset: 'ETH' } }),
  useFocusEffect: (callback: () => void) =>
    jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]),
}));
jest.mock('../../components/GradientBackground', () => ({
  GradientBackground: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('./components/BuyCryptoModal', () => ({
  BuyCryptoModal: (props: typeof mockProps) => {
    mockProps = props;
    return null;
  },
}));

import { BuyScreen } from './index';

beforeEach(() => {
  mockAccount = { uuid: 'owner', role: 'investor' };
});
afterEach(async () => {
  await cleanup();
  jest.clearAllMocks();
});

it.each(['company', 'missing'] as const)('refuses the directly opened Buy route for a %s account', async (kind) => {
  mockAccount = kind === 'company' ? { uuid: 'owner', role: 'company' } : null;
  await render(<BuyScreen />);
  expect(mockProps.visible).toBe(false);
  await act(() => mockProps.onNavigateToWebView('https://provider.example.test', 1, 'owner'));
  expect(mockNavigate).not.toHaveBeenCalled();
});

it.each(['investor', 'both'] as const)('binds a %s provider route to its requesting personal account', async (role) => {
  mockAccount = { uuid: 'owner', role };
  await render(<BuyScreen />);
  expect(mockProps.visible).toBe(true);
  await act(() => mockProps.onNavigateToWebView('https://provider.example.test', 1, 'owner'));
  expect(mockNavigate).toHaveBeenCalledWith('OnRampWebView', {
    url: 'https://provider.example.test',
    sessionEpoch: 1,
    userAccountUuid: 'owner',
  });
});

it('refuses a provider opening for a different account', async () => {
  await render(<BuyScreen />);
  await act(() => mockProps.onNavigateToWebView('https://provider.example.test', 1, 'old-owner'));
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('hides the Buy route after investor authority is lost', async () => {
  const view = await render(<BuyScreen />);
  expect(mockProps.visible).toBe(true);
  mockAccount = { uuid: 'owner', role: 'company' };
  await view.rerender(<BuyScreen />);
  expect(mockProps.visible).toBe(false);
  await act(() => mockProps.onNavigateToWebView('https://provider.example.test', 1, 'owner'));
  expect(mockNavigate).not.toHaveBeenCalled();
});
