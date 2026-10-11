// @vitest-environment jsdom

import { COMPANY_TOKEN_ENDPOINTS as URLS, REGISTER_AWARD_COPY as COPY } from '@ledova/shared';
import type { OwnCompanyAppointment, RegisterAward, RegisterAwardVesting } from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  APPOINTMENT,
  AWARD_REQUEST,
  REGISTER,
  awardFrom,
  vestingFrom,
} from '../../../../../packages/shared/tests/fixtures/employee-awards';
import { ClassAwards } from './ClassAwards';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const OWNER = { userUuid: 'profile-one', ownerAccountUuid: 'account-one' };
const FILE = new File(['%PDF synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
let client: QueryClient;
let appointments: OwnCompanyAppointment[];
let awards: RegisterAward[];
let events: RegisterAwardVesting[];
let failedRead: 'award' | 'vesting' | null;
const submissions = (url: string) =>
  api.post.mock.calls.filter(([endpoint]) => endpoint === url).map(([, body]) => body);

function show() {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ClassAwards owner={OWNER} company={APPOINTMENT.company} register={REGISTER} guard={() => {}} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  appointments = [APPOINTMENT];
  awards = [];
  events = [];
  failedRead = null;
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/v1/company-authority/appointments/') return { data: { results: appointments, next: null } };
    if (url === URLS.REGISTER_AWARDS) {
      if (failedRead === 'award') throw new Error('Recorded awards could not be refreshed');
      return { data: { results: awards, next: null } };
    }
    if (url === URLS.REGISTER_AWARD_VESTINGS) {
      if (failedRead === 'vesting') throw new Error('Recorded vesting could not be refreshed');
      return { data: { results: events, next: null } };
    }
    if (url === URLS.REGISTER_MEMBERS(REGISTER.token.uuid)) return { data: { members: [] } };
    throw new Error(`Unexpected request: ${url}`);
  });
  api.post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_EVIDENCE) {
      const form = body as FormData;
      const file = form.get('file') as File;
      return {
        data: {
          uuid: `evidence-${form.get('idempotency_key')}`,
          company: form.get('company_id'),
          appointment: form.get('appointment'),
          kind: form.get('kind'),
          idempotencyKey: form.get('idempotency_key'),
          originalFilename: file.name,
          fileSize: file.size,
          mimeType: file.type,
          sha256: 'a'.repeat(64),
          providedBy: 'company',
          createdAt: '2026-10-07T00:00:00Z',
        },
      };
    }
    if (url === URLS.REGISTER_AWARDS) {
      const award = awardFrom(body);
      awards = [award];
      failedRead = 'award';
      return { data: award };
    }
    if (url === URLS.REGISTER_AWARD_VESTINGS) {
      const event = vestingFrom(body);
      events = [event];
      awards = [{ ...awards[0], vestedShares: event.shares, availableShares: event.shares }];
      failedRead = 'vesting';
      return { data: event };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
});

afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('keeps confirmed award and vesting commands through parent refresh failures without submitting or uploading twice', async () => {
  show();
  for (const kind of ['award', 'vesting'] as const) {
    const open = await screen.findByRole('button', { name: kind === 'award' ? COPY.PREPARE : COPY.VEST });
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(open);
    if (kind === 'award') {
      for (const [label, value] of [
        ['Recipient name', AWARD_REQUEST.name!],
        ['Residential address', AWARD_REQUEST.residentialAddress!],
        [COPY.SHARES, AWARD_REQUEST.shares],
        [COPY.TERMS_ON, AWARD_REQUEST.termsOn],
        [COPY.TERMS, AWARD_REQUEST.terms],
        [COPY.SCHEDULE, AWARD_REQUEST.schedule],
      ])
        fireEvent.change(await screen.findByLabelText(label), { target: { value } });
    } else fireEvent.change(await screen.findByLabelText(COPY.VESTING_SHARES), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(kind === 'award' ? COPY.AGREEMENT_DOCUMENT : COPY.VESTING_DOCUMENT), {
      target: { files: [FILE] },
    });
    const action = kind === 'award' ? COPY.SUBMIT : COPY.VEST;
    const close = kind === 'award' ? 'Close award form' : 'Close vesting form';
    const url = kind === 'award' ? URLS.REGISTER_AWARDS : URLS.REGISTER_AWARD_VESTINGS;
    const retry = kind === 'award' ? 'Retry awards' : 'Retry vesting events';
    fireEvent.click(screen.getByRole('button', { name: action }));
    await screen.findByText(
      kind === 'award' ? /Employee awards could not be read/ : /vesting events could not be loaded/,
    );
    const retained = submissions(url)[0];
    expect((screen.getByRole('button', { name: close }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: action }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: retry }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: retry }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(submissions(url)).toEqual([retained]);
    failedRead = null;
    fireEvent.click(screen.getByRole('button', { name: retry }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: action }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(screen.getByRole('button', { name: close })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(screen.queryByRole('button', { name: close })).toBeNull());
    expect(submissions(url)).toEqual([retained]);
    expect(submissions(URLS.REGISTER_EVIDENCE)).toHaveLength(kind === 'award' ? 1 : 2);
  }
  expect(awards[0]).toEqual(
    expect.objectContaining({ vestedShares: '100', issuedShares: '0', availableShares: '100' }),
  );
  expect(screen.getByRole('link', { name: COPY.PREPARE_GRANT }).getAttribute('href')).toContain(
    `award=${encodeURIComponent(awards[0].uuid)}`,
  );
  expect(submissions(URLS.REGISTER_GRANTS)).toHaveLength(0);
});

it('hides cached private award rows and document actions when current company authority is lost', async () => {
  awards = [awardFrom(AWARD_REQUEST)];
  show();
  await screen.findByText(`${AWARD_REQUEST.name} · ${AWARD_REQUEST.member}`);
  appointments = [{ ...APPOINTMENT, capabilities: ['finance'] }];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh awards' }));
  await waitFor(() => expect(screen.queryByText(`${AWARD_REQUEST.name} · ${AWARD_REQUEST.member}`)).toBeNull());
  expect(screen.queryByRole('button', { name: /^Download agreement/ })).toBeNull();
  expect(screen.queryByRole('button', { name: COPY.PREPARE })).toBeNull();
});
