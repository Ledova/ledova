import React from 'react';
import { cleanup, render } from '@testing-library/react-native';
import { BottomTabNavigator } from './BottomTabNavigator';

const mockScreens: { name: string; options?: unknown }[] = [];
const mockStacks: Record<string, unknown> = {};
jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => children,
    Screen: (props: { name: string; options?: unknown; children?: () => React.ReactNode }) => {
      mockScreens.push(props);
      return typeof props.children === 'function' ? props.children() : null;
    },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../hooks/useRole', () => ({ useRole: () => ({ isCompany: true, isInvestor: true, isLoading: false }) }));
jest.mock('../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ isEnabled: () => true }) }));
jest.mock('./headers', () => ({ MainHeader: () => ({}), getMainHeaderStyle: () => ({}) }));
jest.mock('./HomeStackNavigator', () => ({
  HomeStackNavigator: (props: object) => {
    mockStacks.Home = props;
    return null;
  },
}));
jest.mock('./CompanyStackNavigator', () => ({
  CompanyStackNavigator: (props: object) => {
    mockStacks.Company = props;
    return null;
  },
}));
jest.mock('./WalletsStackNavigator', () => ({
  WalletsStackNavigator: (props: object) => {
    mockStacks.Wallets = props;
    return null;
  },
}));
jest.mock('./TradingStackNavigator', () => ({
  TradingStackNavigator: (props: object) => {
    mockStacks.Trading = props;
    return null;
  },
}));
jest.mock('./DirectoryStackNavigator', () => ({
  DirectoryStackNavigator: (props: object) => {
    mockStacks.Directory = props;
    return null;
  },
}));
jest.mock('./ApplicationsStackNavigator', () => ({
  ApplicationsStackNavigator: (props: object) => {
    mockStacks.Applications = props;
    return null;
  },
}));
jest.mock('../screens/transactions', () => ({ TransactionsScreen: () => null }));
jest.mock('../screens/user-profile', () => ({ UserProfileScreen: () => null }));
jest.mock('../screens/listing', () => ({ ListingScreen: () => null }));
jest.mock('../screens/investor-eligibility', () => ({ InvestorEligibilityScreen: () => null }));
jest.mock('../screens/publications', () => ({ PublicationsScreen: () => null }));

afterEach(async () => {
  mockScreens.length = 0;
  for (const name of Object.keys(mockStacks)) delete mockStacks[name];
  await cleanup();
});

it('leaves the tab header untitled above every screen whose page carries its title', async () => {
  await render(<BottomTabNavigator onNotifications={jest.fn()} unreadCount={0} />);
  const titles = Object.fromEntries(
    mockScreens
      .filter((screen) =>
        ['Transactions', 'Publications', 'Profile', 'Listing', 'InvestorEligibility'].includes(screen.name),
      )
      .map((screen) => [screen.name, (screen.options as { title?: string }).title]),
  );
  expect(titles).toEqual({ Transactions: '', Publications: '', Profile: '', Listing: '', InvestorEligibility: '' });
});

it("hands the frame's bell to every tab's stack, so each header opens the notifications with the unread count", async () => {
  const open = jest.fn();
  await render(<BottomTabNavigator onNotifications={open} unreadCount={4} />);
  const bell = { onNotifications: open, unreadCount: 4 };
  expect(mockStacks).toEqual({
    Home: bell,
    Company: bell,
    Wallets: bell,
    Trading: bell,
    Directory: bell,
    Applications: bell,
  });
});
