import { cleanup, render } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CameraAccessContext, createCameraAccess } from '../../../contexts/cameraAccess';

jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  getUserVerificationStatus: () => ({ type: 'unverified' }),
  useCurrency: () => ({ formatDisplayCurrency: String }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQuery: () => ({ data: { data: { results: [{}] } }, isLoading: false }),
}));
jest.mock('../../../services/apiClient', () => ({ apiClient: {} }));

import { BuyCryptoModal } from './BuyCryptoModal';

afterEach(async () => {
  await cleanup();
});

it('keeps the identity warning at its earlier 12pt size', async () => {
  const view = await render(
    <CameraAccessContext.Provider value={createCameraAccess()}>
      <QueryClientProvider client={new QueryClient()}>
        <BuyCryptoModal
          visible
          userAccountUuid="synthetic-account"
          onClose={jest.fn()}
          onNavigateToProfile={jest.fn()}
          onNavigateToWebView={jest.fn()}
        />
      </QueryClientProvider>
    </CameraAccessContext.Provider>,
  );
  expect(view.getByText(/^You must verify your identity before purchasing assets/)).toHaveStyle({ fontSize: 12 });
});
