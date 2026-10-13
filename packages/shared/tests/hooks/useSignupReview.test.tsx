/** @jest-environment jsdom */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import axios from 'axios';
import type { PropsWithChildren } from 'react';

import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { useSignupCompanyRegistration } from '../../src/hooks/useSignupCompanyRegistration';
import { useSignupReview } from '../../src/hooks/useSignupReview';
import {
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_SIGNUP_DECLARATION,
} from '../../src/constants/business/company-authority';

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

it('accepts current company terms only on explicit completion, resumes setup without uploads and refuses completion after authority is lost', async () => {
  const api = axios.create();
  const query = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={query}>
      <ApiClientProvider client={api}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  const company = { uuid: 'company-a', name: 'Example Company', acn: '123456789', companyType: 'pty', status: 'draft' };
  const profile = { uuid: 'profile-a', fullName: 'Example Director', isSignupCompleted: false };
  let companySaved = false;
  let preferencesMode: 'ready' | 'missing' | 'failed' = 'ready';
  let request: Record<string, unknown> | null = null;
  let effective = false;
  let declarationVersion = '2026-10-14';
  let source = 'initial';
  let delegation = ['admin', 'prepare', 'approve', 'apply', 'finance', 'read_register'];
  let expiresAt: string | null = null;
  let appointmentCompany = company.uuid;
  let appointmentStatus = 'active';
  let retainedTerms: Record<string, unknown> | null = null;
  const termsReceipt = () => ({
    company: company.uuid,
    appointment: 'appointment-a',
    acceptedBy: 1,
    acceptedProfile: profile.uuid,
    declarationVersion: '2026-10-14',
    declarationText: COMPANY_SIGNUP_DECLARATION,
    acceptedAt: '2026-10-14T00:00:00Z',
  });
  let failProfileCompletion = true;
  let refuseReads = false;
  const appointment = () => ({
    uuid: 'appointment-a',
    company: appointmentCompany,
    status: appointmentStatus,
    capabilities: ['admin'],
    isEffective: effective,
    declarationVersion,
    declarationText: declarationVersion === '2026-10-14' ? COMPANY_SIGNUP_DECLARATION : COMPANY_AUTHORITY_DECLARATION,
    delegatableCapabilities: delegation,
    expiresAt,
    source,
    createdAt: '2026-10-14T00:00:00Z',
    signupTerms: declarationVersion === '2026-10-14' && source === 'initial' ? termsReceipt() : retainedTerms,
  });
  jest.spyOn(api, 'get').mockImplementation(async (url) => {
    if (url === '/api/auth/verify/') return { data: { valid: true } };
    if (url === '/api/user-preferences/') {
      if (preferencesMode === 'failed') throw new Error('Preferences refused');
      if (preferencesMode === 'missing') return { data: { userProfile: null, userAccount: null } };
      return { data: { userProfile: profile.uuid, userAccount: { uuid: 'account-a', role: 'company' } } };
    }
    if (url === '/api/user-profiles/') return { data: { results: [profile] } };
    if (url === '/api/financial-profiles/') return { data: { results: [] } };
    if (url === '/api/v1/companies/') return { data: { results: companySaved ? [company] : [] } };
    if (url === '/api/v1/companies/company-a/') return { data: company };
    if (url === '/api/v1/company-authority/requests/') {
      if (refuseReads) throw new Error('Source refused');
      return { data: { results: request ? [request] : [] } };
    }
    if (url === '/api/v1/company-authority/appointments/')
      return { data: { results: request?.status === 'admitted' ? [appointment()] : [] } };
    throw new Error('Unexpected read');
  });
  const post = jest.spyOn(api, 'post').mockImplementation(async (url, body) => {
    if (url === '/api/v1/companies/') {
      expect(body).toMatchObject({
        name: company.name,
        acn: company.acn,
        primaryContact: { firstName: 'Example', lastName: 'Director' },
      });
      companySaved = true;
      throw new Error('Company response interrupted after saving');
    }
    if (url === '/api/v1/company-authority/requests/') {
      expect(body).toEqual({
        company: company.uuid,
        idempotencyKey: '11111111-1111-4111-8111-111111111111',
        requestedCapabilities: ['admin'],
        delegatableCapabilities: ['admin', 'prepare', 'approve', 'apply', 'finance', 'read_register'],
      });
      request = {
        ...(body as Record<string, unknown>),
        uuid: 'request-a',
        status: 'pending',
        originalFilename: '',
        fileUrl: null,
      };
      throw new Error('Response interrupted after saving');
    }
    if (url === '/api/v1/company-authority/requests/request-a/admit/') {
      expect(body).toEqual({ declarationVersion: '2026-10-14', acceptDeclaration: true });
      effective = true;
      request = { ...request, status: 'admitted', appointment: appointment() };
      return { data: request };
    }
    if (url === '/api/v1/company-authority/appointments/appointment-a/signup-terms/') {
      expect(body).toEqual({ declarationVersion: '2026-10-14', acceptDeclaration: true });
      retainedTerms ??= termsReceipt();
      return { data: appointment() };
    }
    throw new Error('Unexpected mutation');
  });
  const complete = jest.spyOn(api, 'patch').mockImplementation(async (url, body) => {
    if (url === '/api/v1/companies/company-a/') {
      expect(body).toMatchObject({ name: company.name, acn: company.acn });
      return { data: company };
    }
    if (url === '/api/user-profiles/profile-a/') {
      if (failProfileCompletion) throw new Error('Profile completion interrupted');
      return { data: { ...profile, isSignupCompleted: true } };
    }
    throw new Error('Unexpected update');
  });
  const completedProfiles = () => complete.mock.calls.filter(([url]) => url === '/api/user-profiles/profile-a/');
  const continued = jest.fn();
  let registration = renderHook(() => useSignupCompanyRegistration(), { wrapper });
  await waitFor(() => expect(registration.result.current.canSubmit).toBe(true));
  act(() => {
    registration.result.current.setFieldValue('name', company.name);
    registration.result.current.setFieldValue('acn', company.acn);
  });
  await act(async () => registration.result.current.handleSubmit(continued));
  await waitFor(() => expect(registration.result.current.form.name).toBe(company.name));
  await waitFor(() => expect(registration.result.current.canSubmit).toBe(true));
  expect(continued).not.toHaveBeenCalled();
  expect(post.mock.calls.filter(([url]) => url === '/api/v1/companies/')).toHaveLength(1);
  await act(async () => registration.result.current.handleSubmit(continued));
  expect(continued).toHaveBeenCalledTimes(1);
  expect(post.mock.calls.filter(([url]) => url === '/api/v1/companies/')).toHaveLength(1);
  expect(complete.mock.calls.filter(([url]) => url === '/api/v1/companies/company-a/')).toHaveLength(1);
  expect(completedProfiles()).toHaveLength(0);
  preferencesMode = 'failed';
  await act(async () => registration.result.current.retryLoad());
  await waitFor(() => expect(registration.result.current.loadError).toBeTruthy());
  expect(registration.result.current.isLoading).toBe(false);
  expect(registration.result.current.canSubmit).toBe(false);
  await act(async () => registration.result.current.handleSubmit(continued));
  expect(continued).toHaveBeenCalledTimes(1);
  expect(complete.mock.calls.filter(([url]) => url === '/api/v1/companies/company-a/')).toHaveLength(1);
  preferencesMode = 'ready';
  await act(async () => registration.result.current.retryLoad());
  await waitFor(() => expect(registration.result.current.canSubmit).toBe(true));
  registration.unmount();
  const finished = jest.fn();
  const newKey = jest.fn(() => '11111111-1111-4111-8111-111111111111');
  let mounted = renderHook(() => useSignupReview('company', finished, undefined, newKey), { wrapper });
  await waitFor(() => expect(mounted.result.current.isLoading).toBe(false));
  await waitFor(() => expect(mounted.result.current.canCompleteSignup).toBe(true));
  expect(post.mock.calls.filter(([url]) => url === '/api/v1/company-authority/requests/')).toHaveLength(0);
  expect(completedProfiles()).toHaveLength(0);
  await act(async () => {
    await expect(mounted.result.current.completeSignup()).rejects.toThrow('Response interrupted');
  });
  expect(completedProfiles()).toHaveLength(0);
  await waitFor(() => expect(mounted.result.current.authorityRequest?.uuid).toBe('request-a'));
  request = { ...(request ?? {}), requestedExpiresAt: '2020-10-14T00:00:00Z' };
  await act(async () => mounted.result.current.refreshAuthority());
  await waitFor(() => expect(mounted.result.current.authorityError).toMatch(/saved setup has expired/));
  expect(mounted.result.current.authorityRequest?.status).toBe('pending');
  expect(mounted.result.current.canCompleteSignup).toBe(false);
  await act(async () => mounted.result.current.completeSignup());
  expect(completedProfiles()).toHaveLength(0);
  expect(post.mock.calls.filter(([url]) => url === '/api/v1/company-authority/requests/request-a/admit/')).toHaveLength(
    0,
  );
  request = { ...request, requestedExpiresAt: null };
  await act(async () => mounted.result.current.refreshAuthority());
  mounted.unmount();
  mounted = renderHook(() => useSignupReview('company', finished, undefined, newKey), { wrapper });
  await waitFor(() => expect(mounted.result.current.authorityRequest?.uuid).toBe('request-a'));
  await waitFor(() => expect(mounted.result.current.canCompleteSignup).toBe(true));
  await act(async () => {
    await expect(mounted.result.current.completeSignup()).rejects.toThrow('Profile completion interrupted');
  });
  expect(finished).not.toHaveBeenCalled();
  expect(post.mock.calls.filter(([url]) => url === '/api/v1/company-authority/requests/request-a/admit/')).toHaveLength(
    1,
  );
  mounted.unmount();
  mounted = renderHook(() => useSignupReview('company', finished, undefined, newKey), { wrapper });
  await waitFor(() => expect(mounted.result.current.authorityReady).toBe(true));
  failProfileCompletion = false;
  await waitFor(() => expect(mounted.result.current.canCompleteSignup).toBe(true));
  await act(async () => mounted.result.current.completeSignup());
  expect(post.mock.calls.filter(([url]) => url === '/api/v1/company-authority/requests/request-a/admit/')).toHaveLength(
    1,
  );
  expect(post.mock.calls.filter(([url]) => url === '/api/v1/company-authority/requests/')).toHaveLength(1);
  expect(newKey).toHaveBeenCalledTimes(1);
  expect(completedProfiles()).toHaveLength(2);
  expect(finished).toHaveBeenCalledTimes(1);

  mounted.unmount();
  query.clear();
  declarationVersion = '2026-10-04';
  source = 'invitation';
  delegation = [];
  expiresAt = '2027-10-14T00:00:00Z';
  failProfileCompletion = true;
  const originalAppointment = appointment();
  mounted = renderHook(() => useSignupReview('company', finished, undefined, newKey), { wrapper });
  await waitFor(() => expect(mounted.result.current.authorityReady).toBe(true));
  await waitFor(() => expect(mounted.result.current.canCompleteSignup).toBe(true));
  const termSubmissions = () =>
    post.mock.calls.filter(([url]) => url === '/api/v1/company-authority/appointments/appointment-a/signup-terms/');
  expect(termSubmissions()).toHaveLength(0);
  expect(retainedTerms).toBeNull();
  await act(async () =>
    expect(mounted.result.current.completeSignup()).rejects.toThrow('Profile completion interrupted'),
  );
  expect(termSubmissions()).toHaveLength(1);
  expect(retainedTerms).toEqual(termsReceipt());
  expect({ ...appointment(), signupTerms: null }).toEqual(originalAppointment);
  expect(finished).toHaveBeenCalledTimes(1);
  mounted.unmount();
  mounted = renderHook(() => useSignupReview('company', finished, undefined, newKey), { wrapper });
  await waitFor(() => expect(mounted.result.current.canCompleteSignup).toBe(true));
  expect(termSubmissions()).toHaveLength(1);
  failProfileCompletion = false;
  await act(async () => mounted.result.current.completeSignup());
  expect(termSubmissions()).toHaveLength(1);
  expect({ ...appointment(), signupTerms: null }).toEqual(originalAppointment);
  expect(post.mock.calls.filter(([url]) => url === '/api/v1/company-authority/requests/request-a/admit/')).toHaveLength(
    1,
  );
  expect(post.mock.calls.filter(([url]) => url === '/api/v1/company-authority/requests/')).toHaveLength(1);
  expect(completedProfiles()).toHaveLength(4);
  expect(finished).toHaveBeenCalledTimes(2);

  appointmentStatus = 'revoked';
  effective = false;
  await act(async () => mounted.result.current.refreshAuthority());
  await waitFor(() => expect(mounted.result.current.canCompleteSignup).toBe(false));
  await waitFor(() => expect(mounted.result.current.authorityError).toMatch(/no longer current/));
  await act(async () => mounted.result.current.completeSignup());
  expect(completedProfiles()).toHaveLength(4);
  appointmentStatus = 'active';
  effective = true;
  expiresAt = '2020-10-14T00:00:00Z';
  await act(async () => mounted.result.current.refreshAuthority());
  await waitFor(() => expect(mounted.result.current.canCompleteSignup).toBe(false));
  await act(async () => mounted.result.current.completeSignup());
  expect(completedProfiles()).toHaveLength(4);
  expiresAt = '2027-10-14T00:00:00Z';
  appointmentCompany = 'company-b';
  await act(async () => mounted.result.current.refreshAuthority());
  await waitFor(() => expect(mounted.result.current.canCompleteSignup).toBe(false));
  await act(async () => mounted.result.current.completeSignup());
  expect(termSubmissions()).toHaveLength(1);
  expect(completedProfiles()).toHaveLength(4);
  appointmentCompany = company.uuid;
  refuseReads = true;
  await act(async () => expect(mounted.result.current.refreshAuthority()).rejects.toThrow('Source refused'));
  expect(mounted.result.current.canCompleteSignup).toBe(false);
  await waitFor(() => expect(mounted.result.current.authorityReady).toBe(false));
  expect(completedProfiles()).toHaveLength(4);
  mounted.unmount();
  query.clear();
  preferencesMode = 'missing';
  registration = renderHook(() => useSignupCompanyRegistration(), { wrapper });
  await waitFor(() =>
    expect(registration.result.current.loadError).toMatch(/signed-in account could not be confirmed/),
  );
  expect(registration.result.current.isLoading).toBe(false);
  expect(registration.result.current.canSubmit).toBe(false);
  preferencesMode = 'failed';
  await act(async () => registration.result.current.retryLoad());
  await waitFor(() => expect(registration.result.current.loadError).toBeTruthy());
  expect(registration.result.current.isLoading).toBe(false);
  expect(registration.result.current.canSubmit).toBe(false);
  preferencesMode = 'ready';
  await act(async () => registration.result.current.retryLoad());
  await waitFor(() => expect(registration.result.current.canSubmit).toBe(true));
  expect(registration.result.current.form.name).toBe(company.name);
  expect(post.mock.calls.filter(([url]) => url === '/api/v1/companies/')).toHaveLength(1);
  registration.unmount();
  query.clear();
});
