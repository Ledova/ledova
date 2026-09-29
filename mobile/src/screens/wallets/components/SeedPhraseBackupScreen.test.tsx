import { cleanup, fireEvent, render } from '@testing-library/react-native';
import { getSeedPhrase } from '../../../services/secureKeyStorage';
import { SeedPhraseBackupScreen } from './SeedPhraseBackupScreen';

const mockGoBack = jest.fn();
const mockNavigation = { goBack: mockGoBack };
const mockRoute = { params: { seedIdentifier: 'synthetic-seed' } };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => mockNavigation,
  useRoute: () => mockRoute,
}));
jest.mock('../../../services/secureKeyStorage', () => ({ getSeedPhrase: jest.fn() }));

afterEach(async () => {
  await cleanup();
  mockGoBack.mockReset();
});

it('titles the recovery phrase once, on its card, and ends it with Done', async () => {
  jest.mocked(getSeedPhrase).mockResolvedValue(Array(12).fill('fictional').join(' '));
  const view = await render(<SeedPhraseBackupScreen />);
  await view.findByText('Auto-hiding in 60s');
  expect(view.getAllByText('Recovery Phrase')).toHaveLength(1);
  const title = view.getByRole('header', { name: 'Recovery Phrase' });
  const done = view.getByRole('button', { name: 'Done' });
  expect(title.parent!.children.at(-1)).toBe(done.parent);
  await fireEvent.press(done);
  expect(mockGoBack).toHaveBeenCalledTimes(1);
});
