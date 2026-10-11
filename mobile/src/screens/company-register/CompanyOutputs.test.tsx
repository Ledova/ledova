import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_ENDPOINTS,
  COMPANY_TOKEN_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import type { ReactNode } from 'react';
import {
  OUTPUT_APPOINTMENT,
  OUTPUT_ENTRY,
  OUTPUT_PREVIEW,
  OUTPUT_REGISTER,
} from '../../../../packages/shared/tests/fixtures/register-outputs';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { cache, resetFiles } from '../../testSupport/documentFiles';
import { CompanyPack } from './CompanyPack';
import { RegisterCertificate } from './RegisterCertificate';

jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
});
let release: (() => void) | undefined;
afterEach(async () => {
  await act(async () => release?.());
  release = undefined;
  await cleanup();
  client.clear();
  resetFiles();
});

it('shares the exact unsigned entry certificate and company pack, refusing a late pack after current account preferences fail', async () => {
  const preferences = { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  const certificate = COMPANY_TOKEN_ENDPOINTS.REGISTER_CERTIFICATE(OUTPUT_REGISTER.token.uuid);
  const pack = COMPANY_ENDPOINTS.PACK(OUTPUT_APPOINTMENT.company);
  const bytes = Uint8Array.from('synthetic output', (value) => value.charCodeAt(0)).buffer;
  jest
    .mocked(apiClient.get)
    .mockImplementation(
      (url) =>
        Promise.resolve(
          url === '/api/user-preferences/'
            ? { data: preferences }
            : url === certificate
              ? { data: OUTPUT_PREVIEW }
              : { data: { results: [OUTPUT_APPOINTMENT], next: null } },
        ) as ReturnType<typeof apiClient.get>,
    );
  jest.mocked(apiClient.post).mockImplementation(
    (url) =>
      Promise.resolve({
        data: bytes,
        headers: { 'content-type': url === certificate ? 'application/pdf' : 'application/zip' },
      }) as ReturnType<typeof apiClient.post>,
  );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  await render(
    <>
      <RegisterCertificate
        epoch={getSessionEpoch()}
        register={OUTPUT_REGISTER}
        entry={OUTPUT_ENTRY}
        disabled={false}
        authorityGuard={() => {}}
      />
      <CompanyPack
        epoch={getSessionEpoch()}
        company={OUTPUT_APPOINTMENT.company}
        name="Synthetic Company"
        disabled={false}
      />
    </>,
    { wrapper },
  );
  await fireEvent.press(screen.getByRole('button', { name: /Prepare unsigned certificate/ }));
  await fireEvent.changeText(screen.getByLabelText('Written instruction'), 'Synthetic certificate instruction');
  await fireEvent.press(screen.getByRole('button', { name: 'Preview unsigned certificate' }));
  await fireEvent.press(await screen.findByRole('button', { name: /Confirm and share unsigned certificate/ }));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      `${cache}ledova-document-views-v1/certificate-${OUTPUT_REGISTER.token.uuid}-${OUTPUT_ENTRY.sequence}.pdf`,
      { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' },
    ),
  );
  expect(apiClient.post).toHaveBeenCalledWith(
    certificate,
    {
      sequence: OUTPUT_ENTRY.sequence,
      appointment: OUTPUT_APPOINTMENT.uuid,
      sourceDigest: OUTPUT_PREVIEW.sourceDigest,
      instruction: 'Synthetic certificate instruction',
    },
    expect.objectContaining({ responseType: 'arraybuffer', ledovaSubmissionGuard: expect.any(Function) }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  await fireEvent.press(await screen.findByRole('button', { name: /Prepare company pack for/ }));
  await fireEvent.changeText(screen.getByLabelText('Pack instruction reference'), 'Synthetic pack instruction');
  await fireEvent.changeText(screen.getByLabelText('Pack recipient'), 'Synthetic recipient');
  await fireEvent.press(screen.getByRole('button', { name: 'Prepare and share company pack' }));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(
      `${cache}ledova-document-views-v1/company-pack-${OUTPUT_APPOINTMENT.company}.zip`,
      { mimeType: 'application/zip', UTI: 'public.zip-archive' },
    ),
  );
  expect(apiClient.post).toHaveBeenCalledWith(
    pack,
    {
      appointment: OUTPUT_APPOINTMENT.uuid,
      instruction: 'Synthetic pack instruction',
      recipient: 'Synthetic recipient',
    },
    expect.objectContaining({ responseType: 'arraybuffer', ledovaSubmissionGuard: expect.any(Function) }),
  );
  jest.mocked(apiClient.post).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve({ data: bytes, headers: { 'content-type': 'application/zip' } } as Awaited<
            ReturnType<typeof apiClient.post>
          >);
      }),
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Prepare and share company pack' }));
  await waitFor(() => expect(release).toEqual(expect.any(Function)));
  await act(async () => {
    await client
      .fetchQuery({
        queryKey: USER_PREFERENCES_QUERY_KEY,
        queryFn: async () => {
          throw new Error('Current preferences refused');
        },
        retry: false,
      })
      .catch(() => {});
  });
  await act(async () => release!());
  await screen.findByRole('alert');
  expect(Sharing.shareAsync).toHaveBeenCalledTimes(2);
});
