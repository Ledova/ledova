import React from 'react';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { REQUIRED_DOCUMENTS } from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { ListingScreen } from '.';

const mockNavigate = jest.fn();
let mockRole = 'company';
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: mockNavigate }) }));
jest.mock('@ledova/shared', () => ({
  ...jest.requireActual('@ledova/shared'),
  useUserPreferences: () => ({ userAccount: { role: mockRole }, isLoading: false, isError: false }),
}));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() } }));
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const remove = jest.mocked(apiClient.delete);
const LIST = '/api/v1/companies/';
const DETAIL = '/api/v1/companies/company-a/';
const base = {
  uuid: 'company-a',
  name: 'Fictional Company',
  status: 'draft',
  statusDisplay: 'Draft',
  documents: REQUIRED_DOCUMENTS.map(({ type }, index) => ({
    uuid: 'document-' + index,
    documentType: type,
    name: `document-${index}.pdf`,
    createdAt: '2026-09-01',
    isVerified: false,
    fileUrl: '/document.pdf',
  })),
  submittedAt: null as string | null,
  reviewStartedAt: null as string | null,
  infoRequestReason: '',
  additionalInfoResponse: '',
};
let company = { ...base };
let client: QueryClient;
let failure: string | null;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  mockRole = 'company';
  failure = null;
  company = { ...base };
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
  });
  get.mockReset();
  post.mockReset();
  remove.mockReset();
  mockNavigate.mockReset();
  get.mockImplementation(async (url) => {
    if (url === failure) throw new Error('Read refused');
    if (url === LIST) return { data: { results: [{ uuid: company.uuid }] } };
    if (url === DETAIL) return { data: { ...company } };
    if (url === '/api/operator/') return { data: { name: 'Fictional Operator' } };
    throw new Error(`Unexpected ${url}`);
  });
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

it('renders every supplied document, including duplicates and other records, without a truncated documents request', async () => {
  company.documents = [
    ...base.documents,
    ...Array.from({ length: 55 }, (_, i) => ({
      ...base.documents[0],
      uuid: 'extra-' + i,
      name: `Extra ${i}.pdf`,
      documentType: 'other' as const,
    })),
  ];
  const view = await render(<ListingScreen />, { wrapper });
  expect(await view.findByText('Extra 54.pdf')).toBeTruthy();
  expect(view.getByText('document-0.pdf')).toBeTruthy();
  expect(view.getAllByText('Not verified', { exact: false })).toHaveLength(64);
  expect(get.mock.calls.some(([url]) => url.endsWith('/documents/'))).toBe(false);
  expect(view.getByRole('button', { name: 'Submit application' })).toBeEnabled();
  await fireEvent.press(view.getByRole('button', { name: 'Back to Company' }));
  expect(mockNavigate).toHaveBeenCalledWith('Company', { screen: 'CompanyDetails' });
});

it.each(['submitted', 'review', 'approved', 'active', 'rejected', 'withdrawn'])(
  'keeps %s application records and documents visible with current actions only',
  async (status) => {
    company.status = status;
    company.statusDisplay = status;
    company.submittedAt = '2026-09-01';
    company.reviewStartedAt = status === 'submitted' ? null : '2026-09-02';
    const view = await render(<ListingScreen />, { wrapper });
    expect(await view.findByText('document-8.pdf')).toBeTruthy();
    expect(view.getByText('Submitted')).toBeTruthy();
    expect(!!view.queryByRole('button', { name: 'Withdraw application' })).toBe(status === 'submitted');
    expect(view.queryByRole('button', { name: 'Submit application' })).toBeNull();
    expect(view.queryByLabelText('Remove document-0.pdf')).toBeNull();
    expect(view.queryByRole('button', { name: 'Upload Certificate of Incorporation' })).toBeNull();
  },
);

it('requires all required documents and hides stale application content after a failed read', async () => {
  company.documents = [];
  const view = await render(<ListingScreen />, { wrapper });
  expect(await view.findByText('9 required documents still missing.')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Submit application' })).toBeDisabled();
  failure = DETAIL;
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  expect(await view.findByText('Company information could not be loaded. Try again before continuing.')).toBeTruthy();
  expect(view.queryByRole('button', { name: 'Submit application' })).toBeNull();
  expect(view.queryByText('No company found. Please register your company first.')).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

it('keeps a resubmission response after refusal and locks it while pending', async () => {
  company.status = 'info_required';
  company.infoRequestReason = 'Supply the missing certification.';
  company.additionalInfoResponse = 'Earlier response';
  let refuse!: (error: Error) => void;
  post.mockImplementation(
    () =>
      new Promise((_, reject) => {
        refuse = reject;
      }),
  );
  const view = await render(<ListingScreen />, { wrapper });
  expect(await view.findByText('Supply the missing certification.')).toBeTruthy();
  expect(view.getByText('Earlier response')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Resubmit application' })).toBeDisabled();
  await fireEvent.changeText(view.getByLabelText('Response to the operator'), 'New documents supplied');
  await fireEvent.press(view.getByRole('button', { name: 'Resubmit application' }));
  await waitFor(() => expect(view.getByLabelText('Response to the operator').props.editable).toBe(false));
  await act(() => refuse(new Error('Resubmission refused')));
  expect(await view.findByText('Resubmission refused')).toBeTruthy();
  expect(view.getByLabelText('Response to the operator').props.value).toBe('New documents supplied');
  expect(post).toHaveBeenCalledWith(DETAIL + 'resubmit/', { response: 'New documents supplied' });
  failure = DETAIL;
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  failure = null;
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  expect((await view.findByLabelText('Response to the operator')).props.value).toBe('New documents supplied');
});

it('keeps a withdrawal reason on refusal and refuses stale, reviewing and pending withdrawal', async () => {
  company.status = 'submitted';
  const view = await render(<ListingScreen />, { wrapper });
  await fireEvent.press(await view.findByRole('button', { name: 'Withdraw application' }));
  await fireEvent.changeText(view.getByLabelText('Reason (optional)'), 'Fictional withdrawal');
  failure = DETAIL;
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Confirm withdrawal' })).toBeDisabled());
  expect(view.getByLabelText('Reason (optional)').props.value).toBe('Fictional withdrawal');
  failure = null;
  company.status = 'review';
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  expect(await view.findByText('This application can no longer be withdrawn.')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Confirm withdrawal' })).toBeDisabled();
  company.status = 'submitted';
  await act(() => client.invalidateQueries({ queryKey: ['company'] }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Confirm withdrawal' })).toBeEnabled());
  let refuse!: (error: Error) => void;
  post.mockImplementation(
    () =>
      new Promise((_, reject) => {
        refuse = reject;
      }),
  );
  await fireEvent.press(view.getByRole('button', { name: 'Confirm withdrawal' }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Cancel' })).toBeDisabled());
  expect(view.getByLabelText('Reason (optional)').props.editable).toBe(false);
  await act(() => refuse(new Error('Withdrawal refused')));
  expect(await view.findByText('Withdrawal refused')).toBeTruthy();
  expect(view.getByLabelText('Reason (optional)').props.value).toBe('Fictional withdrawal');
  expect(post).toHaveBeenCalledWith(DETAIL + 'withdraw/', { reason: 'Fictional withdrawal' });
});

it('keeps a document removal confirmation after refusal instead of claiming it was removed', async () => {
  remove.mockRejectedValue(new Error('Removal refused'));
  const view = await render(<ListingScreen />, { wrapper });
  await fireEvent.press(await view.findByLabelText('Remove document-0.pdf'));
  await fireEvent.press(view.getByRole('button', { name: 'Confirm removal' }));
  expect(await view.findByText('Removal refused')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Confirm removal' })).toBeEnabled();
  expect(remove).toHaveBeenCalledWith(DETAIL + 'documents/document-0/');
});

it('makes no company, operator or application reads for member-only accounts', async () => {
  mockRole = 'member';
  const view = await render(<ListingScreen />, { wrapper });
  expect(view.getByText('Verify your company access before opening Application.')).toBeTruthy();
  expect(get).not.toHaveBeenCalled();
});

it('keeps operator read failures separate from the application and retries them', async () => {
  failure = '/api/operator/';
  const view = await render(<ListingScreen />, { wrapper });
  expect(await view.findByText('Operator details could not be loaded.')).toBeTruthy();
  expect(await view.findByText('document-8.pdf')).toBeTruthy();
  failure = null;
  await fireEvent.press(view.getByRole('button', { name: 'Retry operator details' }));
  await waitFor(() => expect(view.queryByText('Operator details could not be loaded.')).toBeNull());
  expect(
    view.getByText(
      'Fictional Operator reviews the application and may request more information. Approval and activation are separate decisions. Share classes can be deployed once the company is active.',
    ),
  ).toBeTruthy();
});
