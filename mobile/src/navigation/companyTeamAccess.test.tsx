import React from 'react';
import { cleanup, render } from '@testing-library/react-native';
import { CompanyRegisterScreen } from '../screens/company-register/CompanyRegisterScreen';
import { PrepareRegisterCorrectionScreen } from '../screens/company-register/PrepareRegisterCorrectionScreen';
import { PrepareRegisterImportScreen } from '../screens/company-register/PrepareRegisterImportScreen';
import { PrepareRegisterOpeningScreen } from '../screens/company-register/PrepareRegisterOpeningScreen';
import { PrepareRegisterParticularsScreen } from '../screens/company-register/PrepareRegisterParticularsScreen';
import { HomeStackNavigator, type HomeStackParamList } from './HomeStackNavigator';
import { CompanyStackNavigator, type CompanyStackParamList } from './CompanyStackNavigator';

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
jest.mock('../screens/company-register/PrepareRegisterImportScreen', () => ({
  PrepareRegisterImportScreen: () => null,
}));
jest.mock('../screens/company-register/PrepareRegisterCorrectionScreen', () => ({
  PrepareRegisterCorrectionScreen: () => null,
}));
jest.mock('../screens/company-register/PrepareRegisterOpeningScreen', () => ({
  PrepareRegisterOpeningScreen: () => null,
}));
jest.mock('../screens/company-register/PrepareRegisterParticularsScreen', () => ({
  PrepareRegisterParticularsScreen: () => null,
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

it.each([
  ['import', 'PrepareRegisterImport', PrepareRegisterImportScreen, HomeStackNavigator],
  ['import', 'PrepareRegisterImport', PrepareRegisterImportScreen, CompanyStackNavigator],
  ['correction', 'PrepareRegisterCorrection', PrepareRegisterCorrectionScreen, HomeStackNavigator],
  ['correction', 'PrepareRegisterCorrection', PrepareRegisterCorrectionScreen, CompanyStackNavigator],
  ['opening', 'PrepareRegisterOpening', PrepareRegisterOpeningScreen, HomeStackNavigator],
  ['opening', 'PrepareRegisterOpening', PrepareRegisterOpeningScreen, CompanyStackNavigator],
  ['particulars', 'PrepareRegisterParticulars', PrepareRegisterParticularsScreen, HomeStackNavigator],
  ['particulars', 'PrepareRegisterParticulars', PrepareRegisterParticularsScreen, CompanyStackNavigator],
])('registers %s preparation beside the register with a back action', async (_, name, component, Navigator) => {
  await render(<Navigator onNotifications={jest.fn()} unreadCount={0} />);
  expect(mockScreens.find((screen) => screen.name === name)).toEqual(
    expect.objectContaining({
      component,
      options: expect.objectContaining({ title: '', headerBackVisible: true }),
    }),
  );
});

it('registers participant requests in the always reachable Home stack', async () => {
  await render(<HomeStackNavigator onNotifications={jest.fn()} unreadCount={0} />);
  expect(mockScreens.find((screen) => screen.name === 'ParticipantEligibility')).toEqual(
    expect.objectContaining({
      component: expect.any(Function),
      options: expect.objectContaining({ headerBackVisible: true }),
    }),
  );
});

it('types the import preparation params alike in both register stacks', () => {
  const home: HomeStackParamList['PrepareRegisterImport'] = { tokenUuid: 'ordinary', companyUuid: 'paper' };
  const company: CompanyStackParamList['PrepareRegisterImport'] = home;
  const back: HomeStackParamList['PrepareRegisterImport'] = company;
  expect(back).toEqual({ tokenUuid: 'ordinary', companyUuid: 'paper' });
});

it('types the correction preparation params alike in both register stacks', () => {
  const home: HomeStackParamList['PrepareRegisterCorrection'] = {
    tokenUuid: 'ordinary',
    companyUuid: 'paper',
    entryUuid: 'entry-1',
  };
  const company: CompanyStackParamList['PrepareRegisterCorrection'] = home;
  const back: HomeStackParamList['PrepareRegisterCorrection'] = company;
  expect(back).toEqual({ tokenUuid: 'ordinary', companyUuid: 'paper', entryUuid: 'entry-1' });
});

it('types the opening preparation params alike in both register stacks', () => {
  const home: HomeStackParamList['PrepareRegisterOpening'] = { tokenUuid: 'ordinary', companyUuid: 'paper' };
  const company: CompanyStackParamList['PrepareRegisterOpening'] = home;
  const back: HomeStackParamList['PrepareRegisterOpening'] = company;
  expect(back).toEqual({ tokenUuid: 'ordinary', companyUuid: 'paper' });
});

it('types the particulars preparation params alike in both register stacks', () => {
  const home: HomeStackParamList['PrepareRegisterParticulars'] = {
    tokenUuid: 'ordinary',
    companyUuid: 'paper',
    memberUuid: 'member-1',
  };
  const company: CompanyStackParamList['PrepareRegisterParticulars'] = home;
  const back: HomeStackParamList['PrepareRegisterParticulars'] = company;
  expect(back).toEqual({ tokenUuid: 'ordinary', companyUuid: 'paper', memberUuid: 'member-1' });
});

it('registers the register in Home with a back action and keeps it as the Company tab landing', async () => {
  await render(<HomeStackNavigator onNotifications={jest.fn()} unreadCount={0} />);
  expect(mockScreens.find((screen) => screen.name === 'CompanyRegister')).toEqual(
    expect.objectContaining({
      component: CompanyRegisterScreen,
      options: expect.objectContaining({ headerBackVisible: true }),
    }),
  );
  mockScreens.length = 0;
  await render(<CompanyStackNavigator onNotifications={jest.fn()} unreadCount={0} />);
  expect(mockScreens.find((screen) => screen.name === 'CompanyMain')?.component).toBe(CompanyRegisterScreen);
});
