/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import type { PropsWithChildren } from 'react';

import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { useSignupUserProfile } from '../../src/hooks/useSignupUserProfile';

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it('saves only web signup fields without erasing retained details and preserves native requirements', async () => {
  const api = axios.create();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  const profile = {
    uuid: 'profile-a',
    fullName: 'Example Director',
    dateOfBirth: '1990-01-01',
    residentialAddress: 'PO Box 123, Sydney NSW 2000',
    phoneCountryCode: '+61',
    phoneNumber: '0412345678',
  };
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { count: 1, results: [profile] } });
  const patch = jest.spyOn(api, 'patch').mockResolvedValue({ data: profile });
  const saved = jest.fn();
  const fields = ['fullName'] as const;
  const web = renderHook(() => useSignupUserProfile(fields), { wrapper });
  await waitFor(() => expect(web.result.current.isLoading).toBe(false));
  act(() => web.result.current.setFieldValue('fullName', '  Updated Director  '));
  await act(() => web.result.current.handleSubmit(saved));
  expect(patch).toHaveBeenLastCalledWith('/api/user-profiles/profile-a/', { fullName: 'Updated Director' });
  expect(saved).toHaveBeenCalledTimes(1);
  web.unmount();

  get.mockResolvedValue({ data: { count: 1, results: [{ uuid: profile.uuid, fullName: profile.fullName }] } });
  patch.mockClear();
  const native = renderHook(() => useSignupUserProfile(), { wrapper });
  await waitFor(() => expect(native.result.current.isLoading).toBe(false));
  await act(() => native.result.current.handleSubmit(saved));
  expect(native.result.current.errors).toEqual({
    dateOfBirth: ['Date of birth is required'],
    residentialAddress: ['Residential address is required'],
    phoneNumber: ['Phone number is required'],
  });
  expect(patch).not.toHaveBeenCalled();
  native.unmount();

  const minimal = renderHook(() => useSignupUserProfile(fields), { wrapper });
  await waitFor(() => expect(minimal.result.current.isLoading).toBe(false));
  expect(minimal.result.current.formValidation.isFormValid).toBe(true);
  act(() => minimal.result.current.setFieldValue('fullName', ''));
  await act(() => minimal.result.current.handleSubmit(saved));
  expect(patch).not.toHaveBeenCalled();
  expect(minimal.result.current.errors.fullName).toEqual(['Full name is required']);
  act(() => minimal.result.current.setFieldValue('fullName', profile.fullName));
  await act(() => minimal.result.current.handleSubmit(saved));
  expect(patch).toHaveBeenLastCalledWith('/api/user-profiles/profile-a/', { fullName: profile.fullName });
  expect(saved).toHaveBeenCalledTimes(2);
  minimal.unmount();
  client.clear();
});
