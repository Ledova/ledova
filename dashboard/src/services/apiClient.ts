import axios, { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import {
  AUTH_ENDPOINTS,
  AUTH_QUERY_KEY,
  USER_PREFERENCES_QUERY_KEY,
  createUserFriendlyError,
  describeFailure,
  hasServiceErrorDetail,
} from '@ledova/shared';
import { queryClient } from './queryClient';

export type { UserFriendlyError } from '@ledova/shared';

type RetriableRequestConfig = InternalAxiosRequestConfig & { csrfRetried?: boolean };

const apiClient = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,

  xsrfCookieName: 'csrftoken',
  xsrfHeaderName: 'X-CSRFToken',
  withXSRFToken: true,
});

const isCsrfFailure = (error: AxiosError) => {
  const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
  return error.response?.status === 403 && typeof detail === 'string' && detail.startsWith('CSRF Failed');
};

const SESSION_CALLS: string[] = [
  AUTH_ENDPOINTS.SIGNIN,
  AUTH_ENDPOINTS.SIGNOUT,
  AUTH_ENDPOINTS.SIGNUP,
  AUTH_ENDPOINTS.EMAIL_VERIFICATION,
  AUTH_ENDPOINTS.RESEND_VERIFICATION,
  AUTH_ENDPOINTS.TOKEN_REFRESH,
];

const sessionSettled = () => {
  if (!queryClient.getQueryData<{ data: { valid: boolean } }>(AUTH_QUERY_KEY)?.data.valid) return true;
  return [AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY].every((queryKey) => {
    const state = queryClient.getQueryState(queryKey);
    return state?.status === 'success' && state.fetchStatus === 'idle' && !state.isInvalidated;
  });
};

apiClient.interceptors.request.use((config) => {
  if (config.method !== 'get' && !SESSION_CALLS.includes(config.url ?? '') && !sessionSettled())
    throw createUserFriendlyError('Your session is being checked. Try again in a moment.');
  config.ledovaSubmissionGuard?.();
  return config;
});

apiClient.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (axios.isCancel(error)) return Promise.reject(error);
    const config = error.config as RetriableRequestConfig | undefined;
    config?.ledovaSubmissionGuard?.();
    if (config && !config.csrfRetried && isCsrfFailure(error)) {
      config.csrfRetried = true;
      return apiClient
        .get(AUTH_ENDPOINTS.VERIFY, { ledovaSubmissionGuard: config.ledovaSubmissionGuard })
        .then(() => apiClient.request(config));
    }

    console.error(`API request failed: ${describeFailure(error)}`);

    if (!error.response) {
      if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
        return Promise.reject(
          createUserFriendlyError('Request timed out. Please check your connection and try again.', error),
        );
      }

      if (
        error.code === 'ERR_NETWORK' ||
        error.message?.includes('Network Error') ||
        error.message?.includes('ECONNREFUSED') ||
        error.message?.includes('ENOTFOUND')
      ) {
        return Promise.reject(
          createUserFriendlyError(
            'Unable to connect to our servers. Please check your internet connection and try again.',
            error,
          ),
        );
      }
    }

    if (error.response?.status && error.response.status >= 500) {
      if (error.response.status === 503 && hasServiceErrorDetail(error)) {
        return Promise.reject(error);
      }

      return Promise.reject(
        createUserFriendlyError('Our servers are temporarily unavailable. Please try again in a few moments.', error),
      );
    }

    return Promise.reject(error);
  },
);

export default apiClient;
