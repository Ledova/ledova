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

it('saves only the full name, requires it and leaves retained details untouched', async () => {
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
    phoneNumber: '0491570156',
  };
  jest.spyOn(api, 'get').mockResolvedValue({ data: { count: 1, results: [profile] } });
  const patch = jest.spyOn(api, 'patch').mockResolvedValue({ data: profile });
  const saved = jest.fn();
  const signup = renderHook(() => useSignupUserProfile(), { wrapper });
  await waitFor(() => expect(signup.result.current.isLoading).toBe(false));
  expect(signup.result.current.form).toEqual({ fullName: profile.fullName });
  expect(signup.result.current.formValidation.isFormValid).toBe(true);

  act(() => signup.result.current.setFieldValue('fullName', ''));
  await act(() => signup.result.current.handleSubmit(saved));
  expect(patch).not.toHaveBeenCalled();
  expect(signup.result.current.errors).toEqual({ fullName: ['Full name is required'] });

  act(() => signup.result.current.setFieldValue('fullName', '  Updated Director  '));
  await act(() => signup.result.current.handleSubmit(saved));
  expect(patch).toHaveBeenCalledTimes(1);
  expect(patch).toHaveBeenLastCalledWith('/api/user-profiles/profile-a/', { fullName: 'Updated Director' });
  expect(saved).toHaveBeenCalledTimes(1);
  signup.unmount();
  client.clear();
});
