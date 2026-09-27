import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { InvestorEligibilityScreen } from './investor-eligibility';
import { ListingScreen } from './listing';
import { useInvestorEligibility } from './investor-eligibility/useInvestorEligibility';
import { useCompanyDocuments } from './listing/useCompanyDocuments';
import { apiClient } from '../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../services/sessionScope';
import { cache, files, pickedFile, resetFiles } from '../testSupport/documentFiles';

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 24, bottom: 24, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ navigate: jest.fn() }) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => jest.requireActual('../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(), shareAsync: jest.fn() }));
jest.mock('../services/tokenStorage', () => ({ getAccessToken: jest.fn(async () => 'synthetic-access') }));
jest.mock('../services/apiClient', () => ({ apiClient: { get: jest.fn(async () => ({ data: {} })) } }));
jest.mock('./investor-eligibility/useInvestorEligibility', () => ({ useInvestorEligibility: jest.fn() }));
jest.mock('./listing/useCompanyDocuments', () => ({ useCompanyDocuments: jest.fn() }));

const pick = jest.mocked(DocumentPicker.getDocumentAsync);
const submitClaim = jest.fn();
const upload = jest.fn();
let client: QueryClient;

beforeEach(() => {
  resetFiles();
  pick.mockReset();
  submitClaim.mockReset();
  upload.mockReset();
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  jest.mocked(useInvestorEligibility).mockReturnValue({
    eligibility: { account: 'account-a', isEligible: false, reasons: [] },
    classifications: [],
    isLoading: false,
    submitClaim,
    isSubmitting: false,
    deleteClaim: jest.fn(),
    isDeleting: false,
  } as unknown as ReturnType<typeof useInvestorEligibility>);
  jest.mocked(useCompanyDocuments).mockReturnValue({
    company: { uuid: 'company-a', status: 'draft', name: 'Synthetic company' },
    companyUuid: 'company-a',
    access: { allowed: true, isLoading: false, isError: false },
    error: null,
    isRefreshing: false,
    refetch: jest.fn(async () => {}),
    deletion: { isPending: false, isError: false, reset: jest.fn() },
    submission: { isPending: false },
    resubmission: { isPending: false },
    withdrawal: { isPending: false, isError: false, reset: jest.fn() },
    documents: [],
    uploadedTypes: new Set(),
    canEdit: true,
    isLoading: false,
    upload,
    isUploading: false,
    deleteDocument: jest.fn(),
    isDeleting: false,
    submitApplication: jest.fn(),
    isSubmitting: false,
    resubmitApplication: jest.fn(),
    isResubmitting: false,
    withdrawApplication: jest.fn(),
    isWithdrawing: false,
  } as unknown as ReturnType<typeof useCompanyDocuments>);
});

afterEach(() => {
  client.clear();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

async function claimForm() {
  const view = await render(<InvestorEligibilityScreen />, { wrapper });
  await fireEvent.press(view.getByLabelText('Attach evidence for Large investment'));
  await fireEvent.changeText(
    view.getByPlaceholderText('Describe why this category applies to you'),
    'Synthetic evidence',
  );
  await fireEvent.press(view.getByText('Attach evidence (PDF or image, max 10 MB)'));
  return view;
}

it('retains evidence after refusal and cleans it after the eligibility retry succeeds', async () => {
  const returned = pickedFile();
  pick.mockResolvedValue(returned);
  const view = await claimForm();
  expect(view.getByText('1.pdf')).toBeTruthy();
  submitClaim.mockRejectedValueOnce(new Error('Claim refused')).mockResolvedValueOnce({});
  await fireEvent.press(view.getByText('Submit for review'));
  const first = submitClaim.mock.calls[0][0];
  expect(files.has(first.file.uri)).toBe(true);
  expect(view.getByText('1.pdf')).toBeTruthy();
  await fireEvent.press(view.getByText('Submit for review'));
  expect(submitClaim.mock.calls[1][0].file).toEqual(first.file);
  expect(files.has(first.file.uri)).toBe(false);
  expect(files.has(returned.assets[0].uri)).toBe(false);
  expect(view.queryByText('1.pdf')).toBeNull();
}, 15_000);

it('keeps an edited eligibility draft when its earlier submission succeeds', async () => {
  pick.mockResolvedValue(pickedFile());
  const view = await claimForm();
  let finish!: () => void;
  submitClaim.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  let pressed!: Promise<void>;
  await act(async () => {
    pressed = fireEvent.press(view.getByText('Submit for review'));
  });
  const uri = submitClaim.mock.calls[0][0].file.uri;
  await fireEvent.changeText(view.getByPlaceholderText('Describe why this category applies to you'), 'Newer draft');
  await act(async () => {
    finish();
    await pressed;
  });
  expect(view.getByDisplayValue('Newer draft')).toBeTruthy();
  expect(files.has(uri)).toBe(false);
});

it.each(['success', 'refusal'])('retires a listing upload after %s and preserves it while pending', async (outcome) => {
  const returned = pickedFile();
  pick.mockResolvedValue(returned);
  let finish!: () => void;
  let refuse!: (error: Error) => void;
  upload.mockImplementation(
    () =>
      new Promise<void>((resolve, reject) => {
        finish = resolve;
        refuse = reject;
      }),
  );
  const view = await render(<ListingScreen />, { wrapper });
  let pressed!: Promise<void>;
  await fireEvent.press(view.getByRole('button', { name: 'Upload Certificate of Incorporation' }));
  await fireEvent.press(view.getByRole('button', { name: 'Choose document' }));
  await act(async () => {
    pressed = fireEvent.press(view.getByRole('button', { name: 'Upload document' }));
  });
  await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
  const input = upload.mock.calls[0][0];
  expect(input).toMatchObject({ companyUuid: 'company-a', documentType: 'cert_inc' });
  expect(files.has(input.file.uri)).toBe(true);
  await view.unmount();
  expect(files.has(input.file.uri)).toBe(true);
  await act(async () => {
    if (outcome === 'success') finish();
    else refuse(new Error('Refused'));
    await pressed;
  });
  await waitFor(() => expect(files.has(input.file.uri)).toBe(false));
  expect(files.has(returned.assets[0].uri)).toBe(false);
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('shares a viewed listing document from one private copy, and downloads nothing when sharing is unavailable', async () => {
  const earlier = `${cache}ledova-document-views-v1/earlier.pdf`;
  const copy = `${cache}ledova-document-views-v1/document-a.pdf`;
  files.set(earlier, { size: 5, content: 'leftover' });
  jest.mocked(useCompanyDocuments).mockReturnValue({
    ...useCompanyDocuments(),
    documents: [
      { uuid: 'document-a', documentType: 'cert_inc', name: 'a.pdf', fileUrl: '/documents/document-a/file/' },
    ],
    uploadedTypes: new Set(['cert_inc']),
  } as unknown as ReturnType<typeof useCompanyDocuments>);
  const bytes = Uint8Array.from('%PDF', (character) => character.charCodeAt(0));
  jest
    .mocked(apiClient.get)
    .mockImplementation(async (url: string) =>
      url === '/documents/document-a/file/'
        ? { data: bytes.buffer, headers: { 'content-type': 'application/pdf; charset=binary' } }
        : { data: {} },
    );
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  jest.mocked(Sharing.shareAsync).mockResolvedValueOnce(undefined);
  const view = await render(<ListingScreen />, { wrapper });

  await fireEvent.press(view.getByLabelText('View a.pdf'));
  await waitFor(() =>
    expect(Alert.alert).toHaveBeenCalledWith('Cannot open document', 'Sharing is not available on this device.'),
  );
  expect(apiClient.get).not.toHaveBeenCalledWith('/documents/document-a/file/', expect.anything());
  expect(files.has(copy)).toBe(false);

  await fireEvent.press(view.getByLabelText('View a.pdf'));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(copy, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' }),
  );
  expect(apiClient.get).toHaveBeenCalledWith('/documents/document-a/file/', {
    responseType: 'arraybuffer',
    ledovaSessionEpoch: getSessionEpoch(),
  });
  expect(files.get(copy)?.content).toBe('%PDF');
  expect(files.has(earlier)).toBe(false);
});

it('downloads nothing and stays silent when the session changes before a view starts', async () => {
  jest.mocked(useCompanyDocuments).mockReturnValue({
    ...useCompanyDocuments(),
    documents: [
      { uuid: 'document-a', documentType: 'cert_inc', name: 'a.pdf', fileUrl: '/documents/document-a/file/' },
    ],
    uploadedTypes: new Set(['cert_inc']),
  } as unknown as ReturnType<typeof useCompanyDocuments>);
  jest.mocked(Sharing.isAvailableAsync).mockImplementationOnce(async () => {
    invalidateSessionScope();
    return true;
  });
  const view = await render(<ListingScreen />, { wrapper });
  let pressed!: Promise<void>;
  await act(async () => {
    pressed = fireEvent.press(view.getByLabelText('View a.pdf'));
  });
  await act(async () => {
    await pressed;
  });
  expect(Sharing.isAvailableAsync).toHaveBeenCalledTimes(1);
  expect(apiClient.get).not.toHaveBeenCalledWith('/documents/document-a/file/', expect.anything());
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
});

it('keeps a selected company upload through refusal and failed company reads until retry succeeds', async () => {
  pick.mockResolvedValue(pickedFile());
  upload.mockRejectedValueOnce(new Error('Upload refused')).mockResolvedValueOnce({});
  const view = await render(<ListingScreen />, { wrapper });
  await fireEvent.press(view.getByRole('button', { name: 'Upload Certificate of Incorporation' }));
  await fireEvent.press(view.getByRole('button', { name: 'Choose document' }));
  await fireEvent.press(view.getByRole('button', { name: 'Upload document' }));
  await waitFor(() => expect(view.getByText('Upload refused')).toBeTruthy());
  const first = upload.mock.calls[0][0];
  expect(files.has(first.file.uri)).toBe(true);
  const ready = useCompanyDocuments();
  jest.mocked(useCompanyDocuments).mockReturnValue({ ...ready, error: new Error('Read refused') });
  await view.rerender(<ListingScreen />);
  expect(view.getByText('1.pdf')).toBeTruthy();
  expect(view.getByRole('button', { name: 'Upload document' })).toBeDisabled();
  expect(upload).toHaveBeenCalledTimes(1);
  jest.mocked(useCompanyDocuments).mockReturnValue(ready);
  await view.rerender(<ListingScreen />);
  await fireEvent.press(view.getByRole('button', { name: 'Upload document' }));
  await waitFor(() => expect(view.queryByText('1.pdf')).toBeNull());
  expect(upload.mock.calls[1][0].file).toEqual(first.file);
  expect(files.has(first.file.uri)).toBe(false);
});
