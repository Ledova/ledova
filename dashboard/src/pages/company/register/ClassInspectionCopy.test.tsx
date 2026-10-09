// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  AUTH_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS,
  USER_PREFERENCES_QUERY_KEY,
  type RegisterInspectionPreview,
  type TokenHoldersResponse,
} from '@ledova/shared';
import CompanyRegisterPage from '.';
import { companyPreferences, prepareCompanyClient, renderCompanyPage } from '../testSupport';
import { ClassInspectionCopy } from './ClassInspectionCopy';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const endpoint = COMPANY_TOKEN_ENDPOINTS.REGISTER_INSPECTION_COPY;
const appointment = '00000000-0000-4000-8000-000000000001';
const digest = 'a'.repeat(64);
const copied = new Blob(['Synthetic register'], { type: 'text/csv' });

function register(overrides: Partial<TokenHoldersResponse> = {}): TokenHoldersResponse {
  return {
    token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'deployed', totalSupply: '5' },
    initialized: true,
    issuedSupply: '5',
    waitingEffects: 0,
    holders: [],
    totalHolders: 0,
    formerMembers: [],
    formerMembersAsAt: null,
    formerMembersBlock: null,
    formerMembersStale: false,
    ...overrides,
  };
}

function preview(overrides: Partial<RegisterInspectionPreview> = {}): RegisterInspectionPreview {
  return { token: 'ordinary', appointment, sourceDigest: digest, registerSequence: 12, ...overrides };
}

function request() {
  fireEvent.change(screen.getByLabelText('Written instruction reference'), { target: { value: '  Resolution 12  ' } });
  fireEvent.change(screen.getByLabelText('Recipient'), { target: { value: '  Example recipient  ' } });
  fireEvent.change(screen.getByLabelText('Date of request (Sydney)'), { target: { value: '2026-09-01' } });
}

async function prepare() {
  request();
  fireEvent.click(screen.getByRole('button', { name: 'Preview inspection copy' }));
  return screen.findByRole('button', { name: 'Confirm and download inspection copy' });
}

function downloads() {
  const create = vi.fn(() => 'blob:synthetic');
  const revoke = vi.fn();
  const names: string[] = [];
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = create;
      static revokeObjectURL = revoke;
    },
  );
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  return { create, revoke, names };
}

beforeEach(() => {
  api.get.mockReset().mockResolvedValue({ data: preview() });
  api.post.mockReset().mockResolvedValue({ data: copied });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('confirms the captured instruction, recipient, date and actual appointment before saving the class CSV', async () => {
  const saved = downloads();
  const guard = vi.fn();
  render(<ClassInspectionCopy register={register()} guard={guard} sourceReady />);
  expect(api.get).not.toHaveBeenCalled();
  const confirm = await prepare();
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.getByText('Resolution 12')).toBeTruthy();
  expect(screen.getByText('Example recipient')).toBeTruthy();
  expect(screen.getByLabelText('Recipient').matches(':disabled')).toBe(true);
  expect(api.get).toHaveBeenCalledWith(
    endpoint('ordinary'),
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  fireEvent.click(confirm);
  await screen.findByText('The inspection copy was downloaded.');
  expect(api.post).toHaveBeenCalledWith(
    endpoint('ordinary'),
    {
      appointment,
      sourceDigest: digest,
      instruction: 'Resolution 12',
      recipient: 'Example recipient',
      requestedOn: '2026-09-01',
    },
    expect.objectContaining({
      responseType: 'blob',
      signal: expect.any(AbortSignal),
      ledovaSubmissionGuard: expect.any(Function),
    }),
  );
  expect(saved.create).toHaveBeenCalledWith(copied);
  expect(saved.names).toEqual(['register-ORD-inspection-copy.csv']);
  expect(saved.revoke).toHaveBeenCalledWith('blob:synthetic');
  expect(guard).toHaveBeenCalled();
});

it.each([
  ['instruction', 'Written instruction reference', ' '.repeat(10)],
  ['long instruction', 'Written instruction reference', 'a'.repeat(256)],
  ['recipient', 'Recipient', ''],
  ['long recipient', 'Recipient', 'a'.repeat(256)],
  ['future date', 'Date of request (Sydney)', '2099-01-01'],
])('refuses preview for an invalid %s', (_name, field, value) => {
  render(<ClassInspectionCopy register={register()} guard={() => {}} sourceReady />);
  request();
  fireEvent.change(screen.getByLabelText(field), { target: { value } });
  const button = screen.getByRole('button', { name: 'Preview inspection copy' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(api.get).not.toHaveBeenCalled();
  expect(api.post).not.toHaveBeenCalled();
});

it.each(['unopened', 'refreshing'])('offers no command for an %s source', (state) => {
  render(
    <ClassInspectionCopy
      register={register({ initialized: state !== 'unopened' })}
      guard={() => {}}
      sourceReady={state !== 'refreshing'}
    />,
  );
  request();
  expect((screen.getByRole('button', { name: 'Preview inspection copy' }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.get).not.toHaveBeenCalled();
});

it.each([
  ['foreign class', { token: 'preference' }],
  ['array appointment', { appointment: [appointment] }],
  ['array digest', { sourceDigest: [digest] }],
  ['unsafe sequence', { registerSequence: Number.MAX_SAFE_INTEGER + 1 }],
  ['zero sequence', { registerSequence: 0 }],
  ['negative sequence', { registerSequence: -1 }],
  ['fractional sequence', { registerSequence: 1.5 }],
  ['string sequence', { registerSequence: '1' }],
])('does not confirm a preview with %s', async (_name, invalid) => {
  api.get.mockResolvedValue({ data: { ...preview(), ...invalid } });
  render(<ClassInspectionCopy register={register()} guard={() => {}} sourceReady />);
  request();
  fireEvent.click(screen.getByRole('button', { name: 'Preview inspection copy' }));
  expect((await screen.findByRole('alert')).textContent).toContain('could not be confirmed');
  expect(screen.queryByRole('button', { name: 'Confirm and download inspection copy' })).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

it('retires the old confirmation when a refreshed preview is refused', async () => {
  render(<ClassInspectionCopy register={register()} guard={() => {}} sourceReady />);
  await prepare();
  api.get.mockRejectedValueOnce(new Error('Appointment expired'));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh inspection preview' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Confirm and download inspection copy' })).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

it('starts a new request when the displayed register source changes', async () => {
  const view = render(<ClassInspectionCopy register={register()} guard={() => {}} sourceReady />);
  await prepare();
  view.rerender(<ClassInspectionCopy register={register({ issuedSupply: '6' })} guard={() => {}} sourceReady />);
  expect(screen.queryByRole('button', { name: 'Confirm and download inspection copy' })).toBeNull();
  expect((screen.getByLabelText('Recipient') as HTMLInputElement).value).toBe('');
  expect(api.post).not.toHaveBeenCalled();
});

it('requires a new preview after a download refusal and never retries the old body automatically', async () => {
  const saved = downloads();
  api.post.mockRejectedValueOnce(new Error('Register changed'));
  render(<ClassInspectionCopy register={register()} guard={() => {}} sourceReady />);
  fireEvent.click(await prepare());
  expect((await screen.findByRole('alert')).textContent).toContain('Refresh the preview');
  expect(screen.queryByRole('button', { name: 'Confirm and download inspection copy' })).toBeNull();
  expect(api.post).toHaveBeenCalledTimes(1);
  expect(saved.create).not.toHaveBeenCalled();
});

it('saves no late file after the register begins refreshing even when the response ignores cancellation', async () => {
  const saved = downloads();
  let finish!: (value: { data: Blob }) => void;
  api.post.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const value = register();
  const view = render(<ClassInspectionCopy register={value} guard={() => {}} sourceReady />);
  fireEvent.click(await prepare());
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  const config = api.post.mock.calls[0][2];
  view.rerender(<ClassInspectionCopy register={value} guard={() => {}} sourceReady={false} />);
  view.rerender(<ClassInspectionCopy register={value} guard={() => {}} sourceReady />);
  await act(async () => finish({ data: copied }));
  expect(config.signal.aborted).toBe(true);
  expect(saved.create).not.toHaveBeenCalled();
  expect(saved.names).toEqual([]);
  expect(screen.queryByRole('button', { name: 'Confirm and download inspection copy' })).toBeNull();
});

it('saves no response after the class component is closed', async () => {
  const saved = downloads();
  let finish!: (value: { data: Blob }) => void;
  api.post.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<ClassInspectionCopy register={register()} guard={() => {}} sourceReady />);
  fireEvent.click(await prepare());
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  view.unmount();
  await act(async () => finish({ data: copied }));
  expect(saved.create).not.toHaveBeenCalled();
  expect(saved.names).toEqual([]);
});

it.each(['class', 'register'])('saves no late file after the %s source changes', async (change) => {
  const saved = downloads();
  let finish!: (value: { data: Blob }) => void;
  api.post.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const value = register();
  const view = render(<ClassInspectionCopy register={value} guard={() => {}} sourceReady />);
  fireEvent.click(await prepare());
  await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
  const changed =
    change === 'class'
      ? register({ token: { ...value.token, uuid: 'preference', name: 'Preference shares' } })
      : register({ issuedSupply: '6' });
  view.rerender(<ClassInspectionCopy register={changed} guard={() => {}} sourceReady />);
  await act(async () => finish({ data: copied }));
  expect(saved.create).not.toHaveBeenCalled();
  expect(saved.names).toEqual([]);
  expect(screen.queryByRole('button', { name: 'Confirm and download inspection copy' })).toBeNull();
});

it('discards a preview arriving after the account boundary is retired', async () => {
  let finish!: (value: { data: RegisterInspectionPreview }) => void;
  api.get.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  let current = true;
  render(
    <ClassInspectionCopy
      register={register()}
      guard={() => {
        if (!current) throw new Error('Account changed');
      }}
      sourceReady
    />,
  );
  request();
  fireEvent.click(screen.getByRole('button', { name: 'Preview inspection copy' }));
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(1));
  current = false;
  await act(async () => finish({ data: preview() }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('button', { name: 'Confirm and download inspection copy' })).toBeNull();
  expect(api.post).not.toHaveBeenCalled();
});

it('rejects a changed account before POST and retains no downloadable confirmation', async () => {
  let current = true;
  const guard = () => {
    if (!current) throw new Error('Account changed');
  };
  render(<ClassInspectionCopy register={register()} guard={guard} sourceReady />);
  const confirm = await prepare();
  current = false;
  fireEvent.click(confirm);
  await screen.findByRole('alert');
  expect(api.post).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name: 'Confirm and download inspection copy' })).toBeNull();
});

it('does not save an unexpected response body', async () => {
  const saved = downloads();
  api.post.mockResolvedValue({ data: new Blob(['Unexpected error page'], { type: 'text/html' }) });
  render(<ClassInspectionCopy register={register()} guard={() => {}} sourceReady />);
  fireEvent.click(await prepare());
  await screen.findByRole('alert');
  expect(saved.create).not.toHaveBeenCalled();
});

it.each(['account', 'session'])(
  'uses the Register account boundary to reject a file arriving after an actual %s change',
  async (change) => {
    const saved = downloads();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    prepareCompanyClient(client, 'investor');
    client.setQueryData(['userAccount'], { data: { role: 'investor' } });
    api.get.mockImplementation(async (url: string) => {
      if (url === COMPANY_TOKEN_ENDPOINTS.REGISTER)
        return {
          data: {
            results: [{ uuid: 'ordinary', companyUuid: 'harbour', companyName: 'Harbour Example Pty Ltd' }],
            count: 1,
            next: null,
            previous: null,
          },
        };
      if (url === COMPANY_TOKEN_ENDPOINTS.HOLDERS('ordinary')) return { data: register() };
      if (url === endpoint('ordinary')) return { data: preview() };
      return { data: { results: [], count: 0, next: null, previous: null } };
    });
    let finish!: (value: { data: Blob }) => void;
    api.post.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    renderCompanyPage(client, <CompanyRegisterPage />, 'Register');
    fireEvent.click(await screen.findByRole('button', { name: /Ordinary shares/ }));
    fireEvent.click(await prepare());
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(1));
    act(() => {
      if (change === 'session') client.setQueryData(AUTH_QUERY_KEY, { data: { valid: false } });
      else {
        const other = companyPreferences('investor');
        client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
          data: { ...other, userProfile: 'profile-two', userAccount: { ...other.userAccount!, uuid: 'account-two' } },
        });
      }
    });
    await act(async () => finish({ data: copied }));
    expect(saved.create).not.toHaveBeenCalled();
    expect(saved.names).toEqual([]);
    cleanup();
    client.clear();
  },
);
