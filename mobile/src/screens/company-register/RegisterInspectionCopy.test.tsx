import React from 'react';
import { ApiClientProvider, AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Sharing from 'expo-sharing';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { cache, files, resetFiles } from '../../testSupport/documentFiles';
import { RegisterInspectionCopy } from './RegisterInspectionCopy';

jest.mock('@ledova/shared', () => ({ ...jest.requireActual('@ledova/shared'), useUserPreferences: () => ({}) }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));

const URL = '/api/v1/tokens/ordinary/register/inspection-copy/';
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const preview = {
  token: 'ordinary',
  appointment: 'personal-appointment',
  registerSequence: 3,
  sourceDigest: 'a'.repeat(64),
};
const response = () => ({
  data: Uint8Array.from('member,shares\nSynthetic Member,15', (value) => value.charCodeAt(0)).buffer,
  headers: { 'content-type': 'text/csv; charset=utf-8' },
});
let client: QueryClient;
const props = () => ({ uuid: 'ordinary', name: 'Ordinary shares', epoch: getSessionEpoch(), disabled: false });
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function draft(view: ReturnType<typeof render> extends Promise<infer V> ? V : never, requestedOn = '2026-10-01') {
  await fireEvent.press(view.getByRole('button', { name: 'Prepare inspection copy for Ordinary shares' }));
  await fireEvent.changeText(view.getByLabelText('Written instruction'), 'Company instruction');
  await fireEvent.changeText(view.getByLabelText('Recipient'), 'Synthetic recipient');
  await fireEvent.changeText(view.getByLabelText('Requested on (YYYY-MM-DD)'), requestedOn);
}
async function prepare(view: Parameters<typeof draft>[0]) {
  await draft(view);
  await fireEvent.press(view.getByRole('button', { name: 'Preview inspection copy' }));
  return view.findByRole('button', { name: 'Confirm and share inspection copy for Ordinary shares' });
}

beforeEach(() => {
  resetFiles();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } },
  });
  get.mockReset();
  post.mockReset();
  get.mockResolvedValue({ data: { ...preview } } as never);
  post.mockResolvedValue(response() as never);
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(true);
  jest.mocked(Sharing.shareAsync).mockClear();
});
afterEach(async () => {
  await cleanup();
  client.clear();
});

it('shares the actual inspection bytes for an investor account through the exact appointment, source and written request', async () => {
  const view = await render(<RegisterInspectionCopy {...props()} />, { wrapper });
  const button = await prepare(view);
  const epoch = getSessionEpoch();
  expect(get).toHaveBeenCalledWith(URL, { ledovaSessionEpoch: epoch, ledovaSubmissionGuard: expect.any(Function) });
  expect(view.getByText('Company instruction')).toBeTruthy();
  expect(view.getByText('3')).toBeTruthy();
  expect(post).not.toHaveBeenCalled();
  await fireEvent.press(button);
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(`${cache}ledova-document-views-v1/inspection-ordinary.csv`, {
      mimeType: 'text/csv',
      UTI: 'public.comma-separated-values-text',
    }),
  );
  expect(post).toHaveBeenCalledTimes(1);
  expect(post).toHaveBeenCalledWith(
    URL,
    {
      appointment: preview.appointment,
      sourceDigest: preview.sourceDigest,
      instruction: 'Company instruction',
      recipient: 'Synthetic recipient',
      requestedOn: '2026-10-01',
    },
    { responseType: 'arraybuffer', ledovaSessionEpoch: epoch, ledovaSubmissionGuard: expect.any(Function) },
  );
  expect(files.get(`${cache}ledova-document-views-v1/inspection-ordinary.csv`)?.content).toBe(
    'member,shares\nSynthetic Member,15',
  );
});

it('requires the written request fields and keeps the preview body immutable when its response object is later changed', async () => {
  const data = { ...preview };
  get.mockResolvedValue({ data } as never);
  const view = await render(<RegisterInspectionCopy {...props()} />, { wrapper });
  await fireEvent.press(view.getByRole('button', { name: 'Prepare inspection copy for Ordinary shares' }));
  expect(view.getByRole('button', { name: 'Preview inspection copy' })).toBeDisabled();
  expect(view.getByLabelText('Written instruction').props.maxLength).toBe(255);
  expect(view.getByLabelText('Recipient').props.maxLength).toBe(255);
  await fireEvent.changeText(view.getByLabelText('Written instruction'), 'Company instruction');
  await fireEvent.changeText(view.getByLabelText('Recipient'), 'Synthetic recipient');
  await fireEvent.changeText(view.getByLabelText('Requested on (YYYY-MM-DD)'), '2026-10-01');
  await fireEvent.press(view.getByRole('button', { name: 'Preview inspection copy' }));
  const button = await view.findByRole('button', { name: 'Confirm and share inspection copy for Ordinary shares' });
  data.appointment = 'foreign';
  data.sourceDigest = 'b'.repeat(64);
  await fireEvent.press(button);
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
  expect(post.mock.calls[0][1]).toMatchObject({ appointment: preview.appointment, sourceDigest: preview.sourceDigest });
});

it.each([
  { token: 'foreign' },
  { appointment: [] },
  { registerSequence: '3' },
  { registerSequence: 0 },
  { sourceDigest: [preview.sourceDigest] },
])('refuses a foreign or malformed preview %j before creating or caching a copy', async (changed) => {
  get.mockResolvedValue({ data: { ...preview, ...changed } } as never);
  const view = await render(<RegisterInspectionCopy {...props()} />, { wrapper });
  await draft(view);
  await fireEvent.press(view.getByRole('button', { name: 'Preview inspection copy' }));
  await view.findByRole('alert');
  expect(view.queryByRole('button', { name: 'Confirm and share inspection copy for Ordinary shares' })).toBeNull();
  expect(post).not.toHaveBeenCalled();
  expect(files.size).toBe(0);
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

it.each(['preview', 'copy', 'future-date'])(
  'keeps a refused %s request from writing private bytes or sharing',
  async (kind) => {
    if (kind === 'preview') get.mockRejectedValue(new Error('The appointment cannot inspect this register.'));
    else post.mockRejectedValue(new Error('The request or register is no longer current.'));
    const view = await render(<RegisterInspectionCopy {...props()} />, { wrapper });
    await draft(view, kind === 'future-date' ? '2099-10-01' : '2026-10-01');
    await fireEvent.press(view.getByRole('button', { name: 'Preview inspection copy' }));
    if (kind !== 'preview')
      await fireEvent.press(
        await view.findByRole('button', { name: 'Confirm and share inspection copy for Ordinary shares' }),
      );
    await view.findByRole('alert');
    expect(files.size).toBe(0);
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  },
);

it.each(['owner', 'session', 'class', 'unmount'])('discards a late preview when the %s changes', async (kind) => {
  const pending = deferred<{ data: typeof preview }>();
  get.mockReturnValue(pending.promise as never);
  const view = await render(<RegisterInspectionCopy {...props()} />, { wrapper });
  await draft(view);
  await fireEvent.press(view.getByRole('button', { name: 'Preview inspection copy' }));
  if (kind === 'owner')
    await act(() => {
      client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
        data: { userProfile: 'other-user', userAccount: { uuid: 'other-account', role: 'company' } },
      });
    });
  if (kind === 'session') {
    await act(() => invalidateSessionScope());
    await view.rerender(<RegisterInspectionCopy {...props()} />);
  }
  if (kind === 'class') await view.rerender(<RegisterInspectionCopy {...props()} uuid="foreign" />);
  if (kind === 'unmount') await view.unmount();
  await act(() => pending.resolve({ data: { ...preview } }));
  expect(post).not.toHaveBeenCalled();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(files.size).toBe(0);
  if (kind !== 'unmount')
    expect(view.queryByRole('button', { name: 'Confirm and share inspection copy for Ordinary shares' })).toBeNull();
});

it.each(['owner', 'session', 'class', 'unmount', 'edit', 'refresh'])(
  'discards late copy bytes when the %s changes',
  async (kind) => {
    const pending = deferred<ReturnType<typeof response>>();
    post.mockReturnValue(pending.promise as never);
    const view = await render(<RegisterInspectionCopy {...props()} />, { wrapper });
    await fireEvent.press(await prepare(view));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    if (kind === 'owner')
      await act(() => {
        client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
      });
    if (kind === 'session') {
      await act(() => invalidateSessionScope());
      await view.rerender(<RegisterInspectionCopy {...props()} />);
    }
    if (kind === 'class') await view.rerender(<RegisterInspectionCopy {...props()} uuid="foreign" />);
    if (kind === 'unmount') await view.unmount();
    if (kind === 'edit') await fireEvent.press(view.getByRole('button', { name: 'Edit inspection request' }));
    if (kind === 'refresh') {
      get.mockResolvedValue({ data: { ...preview, registerSequence: 4, sourceDigest: 'b'.repeat(64) } } as never);
      await fireEvent.press(view.getByRole('button', { name: 'Refresh inspection preview' }));
      await view.findByText('4');
    }
    await act(() => pending.resolve(response()));
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
    expect(files.size).toBe(0);
    expect(post).toHaveBeenCalledTimes(1);
  },
);

it('blocks confirmation while the register refreshes and requires a new preview afterwards', async () => {
  const view = await render(<RegisterInspectionCopy {...props()} />, { wrapper });
  await prepare(view);
  await view.rerender(<RegisterInspectionCopy {...props()} disabled />);
  expect(view.queryByRole('button', { name: 'Confirm and share inspection copy for Ordinary shares' })).toBeNull();
  await view.rerender(<RegisterInspectionCopy {...props()} />);
  expect(post).not.toHaveBeenCalled();
});

it('does not create an output when native sharing is unavailable', async () => {
  jest.mocked(Sharing.isAvailableAsync).mockResolvedValue(false);
  const view = await render(<RegisterInspectionCopy {...props()} />, { wrapper });
  await fireEvent.press(await prepare(view));
  await view.findByRole('alert');
  expect(post).not.toHaveBeenCalled();
  expect(files.size).toBe(0);
});

it('refuses successful non-CSV responses before caching or sharing an inspection copy', async () => {
  post.mockResolvedValue({ ...response(), headers: { 'content-type': 'application/json' } } as never);
  const view = await render(<RegisterInspectionCopy {...props()} />, { wrapper });
  await fireEvent.press(await prepare(view));
  await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
  expect(files.size).toBe(0);
  await view.findByRole('alert');
});
