/** @jest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import type { ReactNode } from 'react';
import { ApiClientProvider } from '../../src/hooks/useApiClient';
import { AUTH_QUERY_KEY } from '../../src/hooks/useAuth';
import type { OrderSubmissionSession } from '../../src/hooks/useOrderSubmissions';
import { useSubmissionOwner } from '../../src/hooks/useSubmissionOwner';
import { USER_PREFERENCES_QUERY_KEY } from '../../src/hooks/useUserPreferences';

const clients: QueryClient[] = [];
const subscriptions: (() => void)[] = [];

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  clients.push(client);
  const preferences = { data: { userProfile: 'profile-a', userAccount: { uuid: 'account-a' } } };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, preferences);
  const api = axios.create();
  let epoch = 0;
  const sessionListeners = new Set<() => void>();
  const session: OrderSubmissionSession = {
    getEpoch: () => epoch,
    subscribe: (listener) => {
      sessionListeners.add(listener);
      return () => sessionListeners.delete(listener);
    },
    requestConfig: () => ({}),
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
  return {
    client,
    preferences,
    session,
    wrapper,
    changeEpoch: () => epoch++,
    notifyEpoch: () => sessionListeners.forEach((listener) => listener()),
  };
}

afterEach(() => {
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

it('does not notify a parent owner subscriber when a child creates, refreshes or removes unrelated team queries', () => {
  const f = setup();
  const { result } = renderHook(() => useSubmissionOwner(f.session), { wrapper: f.wrapper });
  const original = result.current.owner;
  const listener = jest.fn();
  subscriptions.push(result.current.boundary.subscribe(listener));
  act(() => {
    f.client.setQueryData(['company-team', 'profile-a', 'account-a', 'appointments'], []);
    f.client.setQueryData(['company-team', 'profile-a', 'account-a', 'invitations'], []);
    void f.client.invalidateQueries({ queryKey: ['company-team'] });
    f.client.removeQueries({ queryKey: ['company-team'] });
  });
  expect(listener).not.toHaveBeenCalled();
  expect(result.current.owner).toBe(original);
  expect(result.current.boundary.get()).toBe(original);
});

it('still notifies an account change when an earlier cache subscriber already read the new owner for a guard', () => {
  const f = setup();
  let readGuard = () => {};
  subscriptions.push(f.client.getQueryCache().subscribe(() => readGuard()));
  const { result } = renderHook(() => useSubmissionOwner(f.session), { wrapper: f.wrapper });
  const original = result.current.owner;
  const listener = jest.fn();
  subscriptions.push(result.current.boundary.subscribe(listener));
  let synchronousOwner = original;
  readGuard = () => {
    synchronousOwner = result.current.boundary.get();
  };
  act(() => {
    f.client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
      data: { userProfile: 'profile-b', userAccount: { uuid: 'account-b' } },
    });
  });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(synchronousOwner).not.toBe(original);
  expect(result.current.owner).toEqual({ userUuid: 'profile-b', ownerAccountUuid: 'account-b' });
  expect(result.current.owner).toBe(synchronousOwner);
});

it('invalidates the same account across an epoch change even when a synchronous guard read precedes notification', () => {
  const f = setup();
  const { result } = renderHook(() => useSubmissionOwner(f.session), { wrapper: f.wrapper });
  const original = result.current.owner;
  const listener = jest.fn();
  subscriptions.push(result.current.boundary.subscribe(listener));
  act(() => {
    f.changeEpoch();
    expect(result.current.boundary.get()).not.toBe(original);
    f.notifyEpoch();
  });
  expect(listener).toHaveBeenCalledTimes(1);
  expect(result.current.owner).toEqual(original);
  expect(result.current.owner).not.toBe(original);
  act(f.notifyEpoch);
  expect(listener).toHaveBeenCalledTimes(1);
});

it('immediately removes owner authority on signed-out data and ignores further changes without an authorised owner', () => {
  const f = setup();
  const { result } = renderHook(() => useSubmissionOwner(f.session), { wrapper: f.wrapper });
  const original = result.current.owner;
  const listener = jest.fn();
  subscriptions.push(result.current.boundary.subscribe(listener));
  act(() => f.client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } }));
  expect(result.current.owner).toBeNull();
  expect(result.current.boundary.get()).toBeNull();
  expect(result.current.owner).not.toBe(original);
  expect(listener).toHaveBeenCalledTimes(1);
  act(() => f.client.setQueryData(USER_PREFERENCES_QUERY_KEY, f.preferences));
  expect(listener).toHaveBeenCalledTimes(1);
});
