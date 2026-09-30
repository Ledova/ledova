import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { CompanyStackNavigator } from './CompanyStackNavigator';
import { TradingStackNavigator } from './TradingStackNavigator';
import { WalletsStackNavigator } from './WalletsStackNavigator';

type Options = { headerRight?: () => React.ReactNode };
const mockOptions: (Options | (() => Options))[] = [];
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({
      screenOptions,
      children,
    }: {
      screenOptions: Options | (() => Options);
      children: React.ReactNode;
    }) => {
      mockOptions.push(screenOptions);
      return children;
    },
    Screen: ({ children }: { children?: () => React.ReactNode }) =>
      typeof children === 'function' ? children() : null,
  }),
}));
jest.mock('../screens/company-register/CompanyRegisterScreen', () => ({ CompanyRegisterScreen: () => null }));
jest.mock('../screens/company-offerings/OfferingsScreen', () => ({ OfferingsScreen: () => null }));
jest.mock('../screens/company', () => ({ CompanyScreen: () => null }));
jest.mock('../screens/company-publications/CompanyPublicationsScreen', () => ({
  CompanyPublicationsScreen: () => null,
}));
jest.mock('../screens/company-tokens/TokenDetailScreen', () => ({ TokenDetailScreen: () => null }));
jest.mock('../screens/trading', () => ({ TradingScreen: () => null }));
jest.mock('../screens/wallets', () => ({ WalletsScreen: () => null }));
jest.mock('../screens/wallets/components/WalletActionScreen', () => ({ WalletActionScreen: () => null }));
jest.mock('../screens/wallets/components/WalletVerificationScreen', () => ({ WalletVerificationScreen: () => null }));
jest.mock('../screens/wallets/components/SeedPhraseBackupScreen', () => ({ SeedPhraseBackupScreen: () => null }));
jest.mock('../screens/transfers/components/BitcoinSendScreen', () => ({ BitcoinSendScreen: () => null }));
jest.mock('../screens/wallets/components/OnRampWebViewScreen', () => ({ OnRampWebViewScreen: () => null }));
jest.mock('../screens/buy', () => ({ BuyScreen: () => null }));
jest.mock('../screens/send', () => ({ SendScreen: () => null }));

afterEach(async () => {
  mockOptions.length = 0;
  await cleanup();
});

it.each([
  ['Company', CompanyStackNavigator, 1],
  ['Wallets, Buy crypto and Send', WalletsStackNavigator, 3],
  ['Market', TradingStackNavigator, 1],
])(
  'rings the frame bell from the %s headers: it opens the notifications and shows the unread count',
  async (_, Stack, stacks) => {
    const open = jest.fn();
    await render(<Stack onNotifications={open} unreadCount={3} />);
    const bells = mockOptions.map((options) => (typeof options === 'function' ? options() : options).headerRight!);
    expect(bells).toHaveLength(stacks);
    const view = await render(
      <>
        {bells.map((bell, index) => (
          <React.Fragment key={index}>{bell()}</React.Fragment>
        ))}
      </>,
    );
    expect(view.getAllByText('3')).toHaveLength(stacks);
    for (const button of view.getAllByRole('button', { name: 'Notifications' })) await fireEvent.press(button);
    expect(open).toHaveBeenCalledTimes(stacks);
  },
);
