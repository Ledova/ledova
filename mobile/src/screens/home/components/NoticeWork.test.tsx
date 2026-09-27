import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiClientProvider, formatDateTime } from '@ledova/shared';
import type { AxiosInstance } from 'axios';
import { NoticeWork } from './NoticeWork';

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
const get = jest.fn();
const apiClient = { get } as unknown as AxiosInstance;
const nothing = { openResolutions: 0, nextClosesAt: null, publishedSince: 0, dividendsWithoutRecord: 0 };
let client: QueryClient;
let summary: Record<string, unknown>;
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  summary = {
    openResolutions: 2,
    nextClosesAt: new Date(Date.now() + 86400000).toISOString(),
    publishedSince: 1,
    dividendsWithoutRecord: 1,
  };
  get.mockImplementation(async () => ({ data: summary }));
});
afterEach(async () => {
  await cleanup();
  client.clear();
  jest.useRealTimers();
});

it('links personal votes and pending dividend records to Notices without submitting or paying', async () => {
  const view = await render(<NoticeWork />, { wrapper });
  expect(await view.findByText('2 resolutions await your vote')).toBeTruthy();
  expect(view.getByText(`First closes ${formatDateTime(String(summary.nextClosesAt))}`)).toBeTruthy();
  expect(view.getByText('1 dividend awaits a payment record from the company')).toBeTruthy();
  expect(view.getByText('1 notice addressed to you in the last 30 days.')).toBeTruthy();
  for (const label of ['View notices to vote', 'View dividend notices', 'View notices']) {
    await fireEvent.press(view.getByText(label));
    expect(mockNavigate).toHaveBeenLastCalledWith('MainApp', { screen: 'Main', params: { screen: 'Publications' } });
  }
  expect(get).toHaveBeenCalledWith('/api/v1/publications/summary/');
});

it('does not claim applications are clear when the available notice counts are zero', async () => {
  summary = nothing;
  const view = await render(<NoticeWork />, { wrapper });
  expect(await view.findByText('No votes need your attention.')).toBeTruthy();
  expect(view.getByText('No dividend records are in progress.')).toBeTruthy();
  expect(view.queryByText(/applications/i)).toBeNull();
  expect(view.queryByText('View notices')).toBeNull();
});

it('shows pending and failed reads without a reassuring empty claim, then retries', async () => {
  let fail!: (reason: Error) => void;
  get.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  const view = await render(<NoticeWork />, { wrapper });
  expect(view.getByText('Checking your notices…')).toBeTruthy();
  expect(view.queryByText('No votes need your attention.')).toBeNull();
  await act(async () => fail(new Error('synthetic unavailable summary')));
  expect(await view.findByText("We couldn't check your notices.")).toBeTruthy();
  expect(view.queryByText('No votes need your attention.')).toBeNull();
  await fireEvent.press(view.getByText('Try notices again'));
  expect(await view.findByText('2 resolutions await your vote')).toBeTruthy();
});

it('hides stale counts on refresh failure and restores fresh counts after retry', async () => {
  const view = await render(<NoticeWork />, { wrapper });
  expect(await view.findByText('2 resolutions await your vote')).toBeTruthy();
  get.mockRejectedValueOnce(new Error('synthetic refresh failure'));
  await act(async () => {
    await client.invalidateQueries({ queryKey: ['publications'] });
  });
  expect(await view.findByText("We couldn't check your notices.")).toBeTruthy();
  expect(view.queryByText('2 resolutions await your vote')).toBeNull();
  expect(view.queryByText('View notices to vote')).toBeNull();
  summary = nothing;
  await fireEvent.press(view.getByText('Try notices again'));
  expect(await view.findByText('No votes need your attention.')).toBeTruthy();
});

it('updates at the first closing time while Holdings remains open', async () => {
  jest.useFakeTimers({ advanceTimers: true });
  const closes = new Date(Date.now() + 60000).toISOString();
  const answers = [{ ...nothing, openResolutions: 1, nextClosesAt: closes }, nothing];
  get.mockImplementation(async () => ({ data: answers.shift() ?? nothing }));
  const view = await render(<NoticeWork />, { wrapper });
  expect(await view.findByText('1 resolution awaits your vote')).toBeTruthy();
  await act(async () => {
    await jest.advanceTimersByTimeAsync(Date.parse(closes) - Date.now() - 1000);
  });
  expect(get).toHaveBeenCalledTimes(1);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(1000);
  });
  await waitFor(() => expect(view.queryByText('1 resolution awaits your vote')).toBeNull());
  expect(view.getByText('No votes need your attention.')).toBeTruthy();
  expect(get).toHaveBeenCalledTimes(2);
});
