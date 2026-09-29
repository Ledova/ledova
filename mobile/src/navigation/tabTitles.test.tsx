import React from 'react';
import { cleanup, render } from '@testing-library/react-native';
import { BottomTabNavigator } from './BottomTabNavigator';

const mockScreens: { name: string; options?: unknown }[] = [];
jest.mock('@react-navigation/bottom-tabs', () => ({
  createBottomTabNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => children,
    Screen: (props: { name: string; options?: unknown }) => {
      mockScreens.push(props);
      return null;
    },
  }),
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('../hooks/useRole', () => ({ useRole: () => ({ isCompany: true, isInvestor: true, isLoading: false }) }));
jest.mock('../hooks/useFeatureFlags', () => ({ useFeatureFlags: () => ({ isEnabled: () => true }) }));
jest.mock('./headers', () => ({ MainHeader: () => ({}), getMainHeaderStyle: () => ({}) }));
jest.mock('./HomeStackNavigator', () => ({ HomeStackNavigator: () => null }));
jest.mock('./CompanyStackNavigator', () => ({ CompanyStackNavigator: () => null }));
jest.mock('./WalletsStackNavigator', () => ({ WalletsStackNavigator: () => null }));
jest.mock('./TradingStackNavigator', () => ({ TradingStackNavigator: () => null }));
jest.mock('./DirectoryStackNavigator', () => ({ DirectoryStackNavigator: () => null }));
jest.mock('./ApplicationsStackNavigator', () => ({ ApplicationsStackNavigator: () => null }));
jest.mock('../screens/transactions', () => ({ TransactionsScreen: () => null }));
jest.mock('../screens/user-profile', () => ({ UserProfileScreen: () => null }));
jest.mock('../screens/listing', () => ({ ListingScreen: () => null }));
jest.mock('../screens/investor-eligibility', () => ({ InvestorEligibilityScreen: () => null }));
jest.mock('../screens/publications', () => ({ PublicationsScreen: () => null }));

afterEach(async () => {
  mockScreens.length = 0;
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
