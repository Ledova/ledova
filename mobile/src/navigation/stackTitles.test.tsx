import React from 'react';
import { cleanup, render } from '@testing-library/react-native';
import { WalletsStackNavigator } from './WalletsStackNavigator';
import { SendStackNavigator } from './SendStackNavigator';

const mockScreens: { name: string; options?: unknown }[] = [];
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => children,
    Screen: (props: { name: string; options?: unknown }) => {
      mockScreens.push(props);
      return null;
    },
  }),
}));
jest.mock('./headers', () => ({ MainHeader: () => ({}), getMainHeaderStyle: () => ({}) }));
jest.mock('./headers/MainHeader', () => ({ MainHeader: () => ({}), getMainHeaderStyle: () => ({}) }));
jest.mock('./BuyStackNavigator', () => ({ BuyStackNavigator: () => null }));
jest.mock('../screens/wallets', () => ({ WalletsScreen: () => null }));
jest.mock('../screens/wallets/components/WalletActionScreen', () => ({ WalletActionScreen: () => null }));
jest.mock('../screens/wallets/components/WalletVerificationScreen', () => ({ WalletVerificationScreen: () => null }));
jest.mock('../screens/wallets/components/SeedPhraseBackupScreen', () => ({ SeedPhraseBackupScreen: () => null }));
jest.mock('../screens/transfers/components/TransferFormScreen', () => ({ TransferFormScreen: () => null }));
jest.mock('../screens/wallets/components/OnRampWebViewScreen', () => ({ OnRampWebViewScreen: () => null }));
jest.mock('../screens/send', () => ({ SendScreen: () => null }));

function titleOf(name: string) {
  const screen = mockScreens.find((each) => each.name === name)!;
  const options = typeof screen.options === 'function' ? screen.options() : screen.options;
  return (options as { title?: string }).title;
}

afterEach(async () => {
  mockScreens.length = 0;
  await cleanup();
});

it('leaves the stack header untitled above the flow screens whose card carries the title', async () => {
  await render(<WalletsStackNavigator onNotifications={jest.fn()} unreadCount={0} />);
  expect(titleOf('TransferDetails')).toBe('');
  expect(titleOf('WalletVerification')).toBe('');
  expect(titleOf('SeedPhraseBackup')).toBe('');
  await render(<SendStackNavigator onNotifications={jest.fn()} unreadCount={0} />);
  expect(titleOf('SendMain')).toBe('');
});
