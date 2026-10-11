import { cleanup, render } from '@testing-library/react-native';
import { loadAsync } from 'expo-font';
import App from '../App';

jest.mock('react-native-webview', () => jest.requireActual('react-native').View);
jest.mock('react-native-gesture-handler', () => ({ GestureHandlerRootView: jest.requireActual('react-native').View }));
jest.mock('./navigation/DrawerNavigator', () => ({ DrawerNavigator: () => null }));
jest.mock('expo-font', () => ({ loadAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('./services/notificationsService', () => ({
  notificationsService: { configure: jest.fn(), registerToken: jest.fn().mockResolvedValue(true) },
}));
jest.mock('./services/apiClient', () => ({
  apiClient: { get: jest.fn().mockResolvedValue({ data: { valid: false } }) },
}));
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn().mockResolvedValue(null),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));

beforeEach(() => jest.useFakeTimers());

afterEach(async () => {
  await cleanup();
  jest.clearAllTimers();
  jest.useRealTimers();
});

it('starts the real app at its signed-out sign-in screen after loading the bundled fonts', async () => {
  const view = await render(<App />);
  expect(await view.findByLabelText('Email')).toBeTruthy();
  expect(view.getByLabelText('Password')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Sign In' })).toBeTruthy();
  expect(loadAsync).toHaveBeenCalledTimes(1);
});
