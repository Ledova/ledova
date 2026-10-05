import React from 'react';
import { cleanup, render } from '@testing-library/react-native';
import { HomeStackNavigator } from './HomeStackNavigator';
import { CompanyStackNavigator } from './CompanyStackNavigator';

const mockScreens: { name: string; component?: unknown; options?: unknown }[] = [];
jest.mock('@react-navigation/native-stack', () => ({
  createNativeStackNavigator: () => ({
    Navigator: ({ children }: { children: React.ReactNode }) => children,
    Screen: (props: { name: string; component?: unknown; options?: unknown }) => {
      mockScreens.push(props);
      return null;
    },
  }),
}));
jest.mock('./headers', () => ({ MainHeader: () => ({}), getMainHeaderStyle: () => ({}) }));
jest.mock('./headers/MainHeader', () => ({ getMainHeaderStyle: () => ({}) }));
jest.mock('../screens/home', () => ({ HomeScreen: () => null }));
jest.mock('../screens/company', () => ({ CompanyScreen: () => null }));
jest.mock('../screens/company-register/CompanyRegisterScreen', () => ({ CompanyRegisterScreen: () => null }));
jest.mock('../screens/company-offerings/OfferingsScreen', () => ({ OfferingsScreen: () => null }));
jest.mock('../screens/company-publications/CompanyPublicationsScreen', () => ({
  CompanyPublicationsScreen: () => null,
}));
jest.mock('../screens/company-tokens/TokenDetailScreen', () => ({ TokenDetailScreen: () => null }));
jest.mock('../screens/company-authority/CompanyAuthorityScreen', () => ({ CompanyAuthorityScreen: () => null }));
jest.mock('../screens/company-team/CompanyTeamScreen', () => ({ CompanyTeamScreen: () => null }));
jest.mock('../screens/eligibility-records/CompanyEligibilityScreen', () => ({ CompanyEligibilityScreen: () => null }));
jest.mock('../screens/eligibility-records/ParticipantEligibilityScreen', () => ({
  ParticipantEligibilityScreen: () => null,
}));

afterEach(async () => {
  await cleanup();
  mockScreens.length = 0;
});

it.each([HomeStackNavigator, CompanyStackNavigator])(
  'registers the reachable team screen with a back action',
  async (Navigator) => {
    await render(<Navigator onNotifications={jest.fn()} unreadCount={0} />);
    expect(mockScreens.find((screen) => screen.name === 'CompanyTeam')).toEqual(
      expect.objectContaining({
        component: expect.any(Function),
        options: expect.objectContaining({ headerBackVisible: true }),
      }),
    );
  },
);

it.each([HomeStackNavigator, CompanyStackNavigator])(
  'registers the company eligibility queue independently of the visible company tab',
  async (Navigator) => {
    await render(<Navigator onNotifications={jest.fn()} unreadCount={0} />);
    expect(mockScreens.find((screen) => screen.name === 'CompanyEligibility')).toEqual(
      expect.objectContaining({
        component: expect.any(Function),
        options: expect.objectContaining({ headerBackVisible: true }),
      }),
    );
  },
);

it('registers participant requests in the always reachable Home stack', async () => {
  await render(<HomeStackNavigator onNotifications={jest.fn()} unreadCount={0} />);
  expect(mockScreens.find((screen) => screen.name === 'ParticipantEligibility')).toEqual(
    expect.objectContaining({
      component: expect.any(Function),
      options: expect.objectContaining({ headerBackVisible: true }),
    }),
  );
});
