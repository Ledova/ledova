import { cleanup, render, renderHook } from '@testing-library/react-native';
import { useAppTheme } from '../../../contexts';
import { VerificationModal } from './VerificationModal';

const mockVerification = {
  status: null,
  isLoadingStatus: false,
  launchVerification: jest.fn(),
  isLaunching: false,
  sdkError: null,
  isPending: false,
  isOnHold: false,
  isRejected: false,
  needsRetry: false,
  hasSubmitted: false,
  justSubmitted: false,
  isVerified: false,
  resetState: jest.fn(),
  accessToken: null,
  formUrl: null,
  formSessionEpoch: 0,
  showVerificationForm: false,
  handleFormComplete: jest.fn(),
  closeFormModal: jest.fn(),
};

jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../../hooks/useIdentityVerification', () => ({ useIdentityVerification: () => mockVerification }));
jest.mock('../../signup/identity-verification/components/VerificationFormModal', () => ({
  VerificationFormModal: () => null,
}));

afterEach(async () => {
  await cleanup();
});

it('keeps what the check needs as secondary text under its heading', async () => {
  const theme = (await renderHook(() => useAppTheme())).result.current;
  const view = await render(<VerificationModal visible onClose={jest.fn()} onRefresh={jest.fn()} />);
  expect(view.getByRole('header', { name: "What You'll Need:" })).toBeTruthy();
  for (const need of ['A valid government-issued ID', 'Good lighting for clear photos', 'About 3-5 minutes']) {
    expect(view.getByText(`• ${need}`)).toHaveStyle({ fontSize: 14, color: theme.colors.text.secondary });
  }
});
