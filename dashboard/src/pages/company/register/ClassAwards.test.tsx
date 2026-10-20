// @vitest-environment jsdom

import { registerKey } from '@hooks/useRegisterAccess';
import { ownAppointmentsKey } from '@hooks/useOwnAppointments';

import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_AWARD_COPY as COPY,
  REGISTER_GRANT_COPY as GRANT,
  ApiClientProvider,
  USER_PREFERENCES_QUERY_KEY,
} from '@ledova/shared';
import type {
  OwnCompanyAppointment,
  RegisterAward,
  RegisterAwardVesting,
  RegisterAwardEnd,
  RegisterAwardVestingReversal,
  RegisterGrant,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  APPOINTMENT,
  AWARD_REQUEST,
  REGISTER,
  awardFrom,
  vestingFrom,
  endFrom,
  vestingReversalFrom,
} from '../../../testSupport/company';
import { ClassAwards } from './ClassAwards';
import { GrantForm } from './GrantForm';

import apiClient from '@services/apiClient';
import CompanyRegisterPage from '.';
import { companyPreferences, prepareCompanyClient } from '../../../testSupport/company';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), save: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
vi.mock('@utils/saveFile', async (original) => ({ ...(await original<object>()), saveFile: api.save }));
const OWNER = { userUuid: 'profile-one', ownerAccountUuid: 'account-one' };
const FILE = new File(['%PDF synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
let client: QueryClient;
let appointments: OwnCompanyAppointment[];
let awards: RegisterAward[];
let events: RegisterAwardVesting[];
let ends: RegisterAwardEnd[];
let reversals: RegisterAwardVestingReversal[];
let mismatchedEndReceipt: boolean;
let failedRead: 'award' | 'vesting' | 'change' | null;
const submissions = (url: string) =>
  api.post.mock.calls.filter(([endpoint]) => endpoint === url).map(([, body]) => body);

function show(onHeldChange?: (token: string, held: boolean) => void) {
  return render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <MemoryRouter>
          <ClassAwards
            owner={OWNER}
            company={APPOINTMENT.company}
            register={REGISTER}
            guard={() => {}}
            onHeldChange={onHeldChange}
          />
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  appointments = [APPOINTMENT];
  awards = [];
  events = [];
  ends = [];
  reversals = [];
  mismatchedEndReceipt = false;
  failedRead = null;
  api.save.mockReset();
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
    if (url === URLS.REGISTER_AWARD_ENDS || url === URLS.REGISTER_AWARD_VESTING_REVERSALS) {
      if (failedRead === 'change') throw new Error('Award changes could not be refreshed');
      return { data: { results: url === URLS.REGISTER_AWARD_ENDS ? ends : reversals, next: null } };
    }
    if (ends.some((event) => url === URLS.REGISTER_AWARD_END(event.uuid)))
      return {
        data: {
          ...ends.find((event) => url === URLS.REGISTER_AWARD_END(event.uuid))!,
          ...(mismatchedEndReceipt ? { evidenceFingerprint: 'b'.repeat(64) } : {}),
        },
      };
    if (reversals.some((event) => url === URLS.REGISTER_AWARD_VESTING_REVERSAL(event.uuid)))
      return { data: reversals.find((event) => url === URLS.REGISTER_AWARD_VESTING_REVERSAL(event.uuid)) };
    if (events.some((event) => url === URLS.REGISTER_AWARD_VESTING(event.uuid)))
      return { data: events.find((event) => url === URLS.REGISTER_AWARD_VESTING(event.uuid)) };
    if (url === URLS.REGISTER_MEMBERS(REGISTER.token.uuid)) return { data: { members: [], awardRecipients: [] } };
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
      awards = [
        {
          ...awards[0],
          vestedShares: event.shares,
          availableShares: event.shares,
          unvestedRemainingShares: (BigInt(awards[0].shares) - BigInt(event.shares)).toString(),
        },
      ];
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

it('retains original award, vesting and linked issue preparations through interrupted responses without duplicating their effects', async () => {
  const view = show();
  for (const kind of ['award', 'vesting'] as const) {
    const open = await screen.findByRole('button', { name: kind === 'award' ? COPY.PREPARE : 'Record vesting' });
    await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(open);
    if (kind === 'award') {
      for (const [label, value] of [
        ['Name', AWARD_REQUEST.name!],
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
    expect(screen.queryByRole('button', { name: action })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: retry }));
    await waitFor(() =>
      expect((screen.getByRole('button', { name: retry }) as HTMLButtonElement).disabled).toBe(false),
    );
    expect(submissions(url)).toEqual([retained]);
    appointments = [{ ...APPOINTMENT, capabilities: ['read_register'] }];
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
    appointments = [APPOINTMENT];
    await client.refetchQueries({ queryKey: ownAppointmentsKey(OWNER) });
  }
  expect(awards[0]).toEqual(
    expect.objectContaining({ vestedShares: '100', issuedShares: '0', availableShares: '100' }),
  );
  expect((await screen.findByRole('link', { name: 'Issue vested shares' })).getAttribute('href')).toBe(
    '/company/register',
  );
  expect(submissions(URLS.REGISTER_GRANTS)).toHaveLength(0);
  expect(screen.getByText('100 shares promised · 100 company-recorded vested')).toBeTruthy();
  for (const [label, quantity] of [
    ['Unvested', '0'],
    ['Issued from award', '0'],
    ['Vested, awaiting issue', '100'],
  ])
    expect(within(screen.getByText(label).parentElement!).getByText(`${quantity} shares`)).toBeTruthy();
  view.unmount();
  const post = api.post.getMockImplementation()!;
  let retainedGrant: RegisterGrant | null = null;
  let preferencesFailed = false;
  let listed = true;
  let effectCount = 0;
  const get = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url, config) => {
    if (url === '/api/user-preferences/') {
      if (preferencesFailed) throw new Error('Preferences unavailable');
      return { data: companyPreferences() };
    }
    if (url === URLS.REGISTER)
      return {
        data: {
          results: listed
            ? [
                { uuid: REGISTER.token.uuid, companyUuid: APPOINTMENT.company, companyName: APPOINTMENT.companyName },
                { uuid: 'other-class', companyUuid: 'other-company', companyName: 'Other Company' },
              ]
            : [{ uuid: 'other-class', companyUuid: 'other-company', companyName: 'Other Company' }],
          next: null,
        },
      };
    if (url === URLS.HOLDERS(REGISTER.token.uuid))
      return {
        data: {
          ...REGISTER,
          issuedSupply: retainedGrant?.registerEntry ? '10' : '0',
          totalHolders: retainedGrant?.registerEntry ? 1 : 0,
        },
      };
    if (url === URLS.REGISTER_LINK_WAITING_WALLETS) return { data: { wallets: [] } };
    if (url === URLS.REGISTER_GRANTS) return { data: { results: retainedGrant ? [retainedGrant] : [], next: null } };
    if (awards.some((award) => url === URLS.REGISTER_AWARD(award.uuid)))
      return { data: awards.find((award) => url === URLS.REGISTER_AWARD(award.uuid)) };
    if (
      url === URLS.REGISTER_AWARDS ||
      url === URLS.REGISTER_AWARD_VESTINGS ||
      url === '/api/v1/company-authority/appointments/' ||
      url === URLS.REGISTER_MEMBERS(REGISTER.token.uuid)
    )
      return get(url, config);
    if (url.startsWith(URLS.REGISTER_AWARD_ENDS) || url.startsWith(URLS.REGISTER_AWARD_VESTING_REVERSALS))
      return get(url, config);
    if (url.startsWith('/api/v1/tokens/')) return { data: { results: [], next: null } };
    return get(url, config);
  });
  api.post.mockImplementation(async (url, body) => {
    if (retainedGrant && url === URLS.REGISTER_GRANT_PREVIEW(retainedGrant.uuid))
      return {
        data: {
          ...retainedGrant,
          effectiveOn: retainedGrant.companyEventOn,
          previewDigest: 'b'.repeat(64),
          canDecide: true,
          unmetRequirements: [],
          registerSequence: 1,
          currentShares: '0',
          afterShares: body.kind === 'apply' ? '10' : '0',
          issuedSupply: '0',
          afterIssuedSupply: body.kind === 'apply' ? '10' : '0',
          authorisedSupply: '1000',
          awardPromisedShares: '100',
          awardVestedShares: '100',
          awardIssuedShares: '0',
          awardAvailableShares: '100',
        },
      };
    if (retainedGrant && url === URLS.REGISTER_GRANT_DECIDE(retainedGrant.uuid)) {
      const repeated = retainedGrant.decisions.some((row) => row.idempotencyKey === body.idempotencyKey);
      if (!repeated) {
        retainedGrant = {
          ...retainedGrant,
          decisions: [
            ...retainedGrant.decisions,
            {
              uuid: body.idempotencyKey,
              appointment: body.appointment,
              kind: body.kind,
              digest: body.previewDigest,
              idempotencyKey: body.idempotencyKey,
              reason: body.reason || '',
              decidedAt: '2026-10-11T00:00:00Z',
              decidedBy: 1,
              decidedByName: 'Synthetic Appointee',
            },
          ],
          stage: body.kind === 'apply' ? 'applied' : 'approved',
          ...(body.kind === 'apply'
            ? {
                status: 'applied',
                registerEntry: 'entry-award',
                effectiveOn: retainedGrant.companyEventOn,
                reviewedAt: '2026-10-11T00:00:00Z',
                reviewedBy: 1,
              }
            : {}),
        };
        if (body.kind === 'apply') {
          effectCount++;
          awards = [{ ...awards[0], issuedShares: '10', availableShares: '90', remainingUnissuedShares: '90' }];
          throw new Error('Issue committed but response interrupted');
        }
      }
      return { data: retainedGrant };
    }
    if (url !== URLS.REGISTER_GRANTS) return post(url, body);
    retainedGrant = {
      ...body,
      uuid: body.operationId,
      company: APPOINTMENT.company,
      token: body.tokenId,
      preparingAppointment: body.appointment,
      providedBy: 'company',
      status: 'submitted',
      stage: 'submitted',
      acceptanceEvidence: null,
      acceptanceFingerprint: '',
      acceptanceSnapshot: {},
      evidenceFingerprint: 'a'.repeat(64),
      evidenceSnapshot: {},
      termsFingerprint: 'a'.repeat(64),
      termsSnapshot: {},
      preparedByName: 'Synthetic Preparer',
      submittedBy: 1,
      registerEntry: null,
      effectiveOn: null,
      reviewedBy: null,
      reviewedAt: null,
      rejectionReason: '',
      decisions: [],
      createdAt: '2026-10-07T00:00:00Z',
    };
    return { data: { ...retainedGrant, termsFingerprint: 'c'.repeat(64) } };
  });
  prepareCompanyClient(client);
  let canPrepare = true;
  const preparation = () => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <GrantForm
          owner={OWNER}
          guard={() => {}}
          company={APPOINTMENT.company}
          token={REGISTER.token.uuid}
          people={[]}
          appointment={APPOINTMENT}
          blocked={false}
          canPrepare={canPrepare}
          onRefused={() => {}}
          onRecorded={() => {}}
          award={awards[0]}
        />
      </ApiClientProvider>
    </QueryClientProvider>
  );
  const preparedView = render(
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>
        <MemoryRouter
          initialEntries={[
            { pathname: '/company/register', hash: '#awards', state: { registerCompany: APPOINTMENT.company } },
          ]}
        >
          <CompanyRegisterPage />
        </MemoryRouter>
      </ApiClientProvider>
    </QueryClientProvider>,
  );
  const issueVested = await screen.findByRole('link', { name: 'Issue vested shares' });
  await waitFor(() => expect(screen.queryByText('Loading employee awards…')).toBeNull());
  fireEvent.click(issueVested);
  const issues = within((await screen.findByRole('group', { name: 'What kind of issue?' })).parentElement!);
  expect((issues.getByRole('radio', { name: 'Non-paid issue' }) as HTMLInputElement).checked).toBe(true);
  expect(await issues.findByText(AWARD_REQUEST.name!)).toBeTruthy();
  expect(issues.queryByRole('combobox', { name: 'Issue to' })).toBeNull();
  const fillGrant = () => {
    for (const [label, value] of [
      [GRANT.SHARES, '10'],
      [GRANT.COMPANY_EVENT_ON, '2026-10-06'],
      [GRANT.DIRECTOR, 'Synthetic Director'],
      [GRANT.AUTHORITY_REFERENCE, 'Synthetic resolution'],
      [GRANT.REASON, 'Issue recorded vested shares'],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.change(screen.getByLabelText(GRANT.AUTHORITY_DOCUMENT), { target: { files: [FILE] } });
  };
  expect(screen.queryByLabelText(GRANT.TERMS_DOCUMENT)).toBeNull();
  expect(screen.getByText('The retained award agreement will be used for this issue.')).toBeTruthy();
  expect((screen.getByLabelText(GRANT.COMPANY_EVENT_ON) as HTMLInputElement).value).toBe('');
  fillGrant();
  fireEvent.change(screen.getByLabelText(GRANT.COMPANY_EVENT_ON), { target: { value: '' } });
  expect((screen.getByRole('button', { name: 'Prepare vested share issue' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(GRANT.COMPANY_EVENT_ON), { target: { value: '2026-10-06' } });
  fireEvent.click(screen.getByRole('button', { name: 'Prepare vested share issue' }));
  const recover = await screen.findByRole('button', { name: 'Recover original grant preparation' });
  await waitFor(() => expect((recover as HTMLButtonElement).disabled).toBe(false));
  const original = submissions(URLS.REGISTER_GRANTS)[0];
  expect(original).toEqual(
    expect.objectContaining({
      award: awards[0].uuid,
      member: awards[0].member,
      shares: '10',
      termsEvidence: awards[0].agreementEvidence,
      companyEventOn: '2026-10-06',
      newMember: true,
    }),
  );
  expect((screen.getByLabelText(GRANT.SHARES).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  const retainedAward = awards[0];
  const retainedReceipt = retainedGrant!;
  awards = [{ ...retainedAward, agreementEvidence: 'changed-agreement', agreementFingerprint: 'd'.repeat(64) }];
  retainedGrant = { ...retainedReceipt, termsFingerprint: 'c'.repeat(64) };
  appointments = [{ ...APPOINTMENT, capabilities: ['read_register'] }];
  await act(async () => client.refetchQueries({ queryKey: ownAppointmentsKey(OWNER) }));
  await waitFor(() => expect((recover as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(recover);
  await issues.findByRole('alert');
  expect(submissions(URLS.REGISTER_GRANTS)).toEqual([original]);
  retainedGrant = retainedReceipt;
  fireEvent.click(recover);
  await issues.findByText('Next: review and approve the exact share issue.');
  expect(issues.queryByRole('button', { name: 'Recover original grant preparation' })).toBeNull();
  expect(submissions(URLS.REGISTER_GRANTS)).toEqual([original]);
  expect(submissions(URLS.REGISTER_EVIDENCE)).toHaveLength(3);
  awards = [retainedAward];
  appointments = [APPOINTMENT];
  await act(async () => client.refetchQueries({ queryKey: ownAppointmentsKey(OWNER) }));
  expect(awards[0].issuedShares).toBe('0');
  expect((screen.getByRole('combobox', { name: 'Company' }) as HTMLInputElement).value).toBe(APPOINTMENT.companyName);
  expect(screen.getByText('Non-paid issues from this award · 1')).toBeTruthy();
  fireEvent.click(screen.getByRole('link', { name: /^10 shares, prepared/, hidden: true }));
  await waitFor(() =>
    expect(document.activeElement?.textContent).toContain('Next: review and approve the exact share issue.'),
  );
  expect(screen.queryByRole('button', { name: /^Record issue [(]grant/ })).toBeNull();
  for (const label of ['Approve', 'Record issue']) {
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${label} [(]grant`) }));
    const confirm = await screen.findByRole('button', { name: `${label} non-paid grant` });
    expect(within(screen.getByRole('dialog')).getByText('2026-10-06')).toBeTruthy();
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    if (label === 'Approve') {
      await screen.findByText('Next: record the approved issue. Approval has not changed ownership.');
      expect(effectCount).toBe(0);
      expect(awards[0].issuedShares).toBe('0');
    }
  }
  await screen.findByRole('button', { name: /^Recover record issue receipt/, hidden: true });
  const originalIssue = submissions(URLS.REGISTER_GRANT_DECIDE(retainedGrant!.uuid)).filter(
    (row) => row.kind === 'apply',
  )[0];
  expect((screen.getByRole('combobox', { name: 'Company', hidden: true }) as HTMLInputElement).disabled).toBe(true);
  preferencesFailed = true;
  await act(async () => client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true }));
  expect(client.getQueryState(USER_PREFERENCES_QUERY_KEY)?.status).toBe('error');
  await waitFor(() => {
    expect(screen.getByText("We couldn't load the complete register.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Recover record issue receipt/ })).toBeNull();
    expect(document.body.textContent).not.toContain(AWARD_REQUEST.name);
  });
  listed = false;
  await act(async () =>
    client.refetchQueries({
      queryKey: [...registerKey(OWNER), 'classes'],
      exact: true,
    }),
  );
  expect(screen.queryByRole('dialog')).toBeNull();
  appointments = [{ ...APPOINTMENT, capabilities: ['read_register'] }];
  preferencesFailed = false;
  listed = true;
  await act(async () => client.refetchQueries({ queryKey: USER_PREFERENCES_QUERY_KEY, exact: true }));
  await act(async () =>
    client.refetchQueries({
      queryKey: [...registerKey(OWNER), 'classes'],
      exact: true,
    }),
  );
  fireEvent.click(await screen.findByRole('button', { name: 'Refresh grants' }));
  const issueRecovery = await screen.findByRole('button', { name: /^Recover record issue receipt/ });
  await waitFor(() => expect((issueRecovery as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(issueRecovery);
  await issues.findByText('Shares issued');
  await waitFor(() => expect(screen.queryByRole('button', { name: /^Recover record issue receipt/ })).toBeNull());
  expect(submissions(URLS.REGISTER_GRANT_DECIDE(retainedGrant!.uuid)).filter((row) => row.kind === 'apply')).toEqual([
    originalIssue,
    originalIssue,
  ]);
  expect(effectCount).toBe(1);
  expect(awards[0].issuedShares).toBe('10');
  expect(awards[0].availableShares).toBe('90');
  await waitFor(() =>
    expect(within(screen.getByText('Issued from award').parentElement!).getByText('10 shares')).toBeTruthy(),
  );
  expect(within(screen.getByText('Vested, awaiting issue').parentElement!).getByText('90 shares')).toBeTruthy();
  retainedGrant = { ...retainedGrant!, companyEventOn: null };
  fireEvent.click(screen.getByRole('button', { name: 'Refresh grants' }));
  await waitFor(() =>
    expect(within(screen.getByText(GRANT.COMPANY_EVENT_ON).parentElement!).getByText('Not recorded')).toBeTruthy(),
  );
  expect(within(screen.getByText('Ledger date').parentElement!).getByText('2026-10-06')).toBeTruthy();
  preparedView.unmount();
  api.post.mockClear();
  retainedGrant = null;
  canPrepare = true;
  api.post.mockImplementation(async (url, body) => {
    if (url !== URLS.REGISTER_GRANTS) return post(url, body);
    if (submissions(url).length === 1) throw new Error('Preparation response interrupted');
    throw { response: { status: 403 } };
  });
  const refusedView = render(preparation());
  fillGrant();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare vested share issue' }));
  const absentRecover = await screen.findByRole('button', { name: 'Recover original grant preparation' });
  await waitFor(() => expect((absentRecover as HTMLButtonElement).disabled).toBe(false));
  const absentOriginal = submissions(URLS.REGISTER_GRANTS)[0];
  canPrepare = false;
  refusedView.rerender(preparation());
  const beforeLookup = api.get.mock.calls.filter(([url]) => url === URLS.REGISTER_GRANTS).length;
  fireEvent.click(absentRecover);
  await screen.findByText(/The original grant was not recorded and the request was refused/);
  expect(screen.queryByRole('button', { name: 'Recover original grant preparation' })).toBeNull();
  expect(submissions(URLS.REGISTER_GRANTS)).toEqual([absentOriginal, absentOriginal]);
  expect(api.get.mock.calls.filter(([url]) => url === URLS.REGISTER_GRANTS)).toHaveLength(beforeLookup + 2);
  expect(submissions(URLS.REGISTER_EVIDENCE)).toHaveLength(1);
  expect(awards[0].issuedShares).toBe('10');
  refusedView.unmount();
  appointments = [APPOINTMENT];
  api.post.mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_AWARD_ENDS) {
      const event = endFrom(body);
      ends = [...ends, event];
      awards = [{ ...awards[0], endedVestedShares: '20', availableShares: '70', remainingUnissuedShares: '70' }];
      throw new Error('Ending response interrupted');
    }
    if (url === URLS.REGISTER_AWARD_VESTING_REVERSALS) {
      const event = vestingReversalFrom(body, awards[0].uuid);
      reversals = [event];
      awards = [{ ...awards[0], vestedShares: '90', availableShares: '60', unvestedRemainingShares: '10' }];
      return { data: { ...event, reversedShares: '11' } };
    }
    return post(url, body);
  });
  const changes = show();
  await act(async () => client.refetchQueries({ queryKey: ownAppointmentsKey(OWNER) }));
  const ending = await screen.findByRole('button', { name: COPY.END });
  await waitFor(() => expect((ending as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(ending);
  expect((screen.getByLabelText(COPY.COMPANY_EVENT_ON) as HTMLInputElement).value).toBe('');
  fireEvent.change(screen.getByLabelText(COPY.END_VESTED), { target: { value: '91' } });
  fireEvent.change(screen.getByLabelText(COPY.COMPANY_EVENT_ON), { target: { value: '2026-10-12' } });
  fireEvent.change(screen.getByLabelText(COPY.REASON), {
    target: { value: 'Company ends part of unissued vested rights' },
  });
  fireEvent.change(screen.getByLabelText(COPY.ADJUSTMENT_DOCUMENT), { target: { files: [FILE] } });
  expect((screen.getByRole('button', { name: COPY.END }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText(COPY.END_VESTED), { target: { value: '20' } });
  fireEvent.click(screen.getByRole('button', { name: COPY.END }));
  await screen.findByRole('alert');
  const endRequest = submissions(URLS.REGISTER_AWARD_ENDS)[0];
  expect(endRequest).toEqual(
    expect.objectContaining({
      award: awards[0].uuid,
      unvestedShares: '0',
      vestedShares: '20',
      companyEventOn: '2026-10-12',
    }),
  );
  appointments = [{ ...APPOINTMENT, capabilities: ['read_register'] }];
  await act(async () => client.refetchQueries({ queryKey: ownAppointmentsKey(OWNER) }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: COPY.END }) as HTMLButtonElement).disabled).toBe(false),
  );
  expect((screen.getByLabelText(COPY.END_VESTED).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  mismatchedEndReceipt = true;
  fireEvent.click(screen.getByRole('button', { name: COPY.END }));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: COPY.END }) as HTMLButtonElement).disabled).toBe(false),
  );
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(submissions(URLS.REGISTER_AWARD_ENDS)).toEqual([endRequest]);
  expect(screen.getByLabelText(COPY.END_VESTED)).toBeTruthy();
  mismatchedEndReceipt = false;
  fireEvent.click(screen.getByRole('button', { name: COPY.END }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Close change form' })).toBeNull());
  expect(submissions(URLS.REGISTER_AWARD_ENDS)).toEqual([endRequest]);
  appointments = [APPOINTMENT];
  await act(async () => client.refetchQueries({ queryKey: ownAppointmentsKey(OWNER) }));
  fireEvent.click(screen.getByText(/Recorded vesting history/));
  const correct = await screen.findByRole('button', { name: new RegExp(`^${COPY.REVERSE}`) });
  await waitFor(() => expect((correct as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(correct);
  fireEvent.change(screen.getByLabelText(COPY.REVERSED_SHARES), { target: { value: '10' } });
  fireEvent.change(screen.getByLabelText(COPY.COMPANY_EVENT_ON), { target: { value: '2026-10-13' } });
  fireEvent.change(screen.getByLabelText(COPY.REASON), { target: { value: 'Correct the original vesting quantity' } });
  fireEvent.change(screen.getByLabelText(COPY.ADJUSTMENT_DOCUMENT), { target: { files: [FILE] } });
  fireEvent.click(screen.getByRole('button', { name: COPY.REVERSE }));
  await screen.findByRole('alert');
  const reversalRequest = submissions(URLS.REGISTER_AWARD_VESTING_REVERSALS)[0];
  expect(reversalRequest).toEqual(
    expect.objectContaining({ vesting: events[0].uuid, reversedShares: '10', companyEventOn: '2026-10-13' }),
  );
  fireEvent.click(screen.getByRole('button', { name: COPY.REVERSE }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Close change form' })).toBeNull());
  expect(submissions(URLS.REGISTER_AWARD_VESTING_REVERSALS)).toEqual([reversalRequest]);
  expect(awards[0]).toEqual(
    expect.objectContaining({
      shares: '100',
      vestedShares: '90',
      issuedShares: '10',
      availableShares: '60',
      endedVestedShares: '20',
      remainingUnissuedShares: '70',
    }),
  );
  expect(events[0].shares).toBe('100');
  expect(screen.getByRole('img', { name: /20 vested rights ended/ })).toBeTruthy();
  changes.unmount();
});

it('hides cached private award rows and document actions when current company authority is lost', async () => {
  awards = [awardFrom(AWARD_REQUEST)];
  const held = vi.fn();
  show(held);
  await screen.findByRole('heading', { name: AWARD_REQUEST.name! });
  const open = await screen.findByRole('button', { name: 'Record vesting' });
  await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(open);
  fireEvent.change(screen.getByLabelText(COPY.VESTING_SHARES), { target: { value: '50' } });
  fireEvent.change(screen.getByLabelText(COPY.VESTING_DOCUMENT), { target: { files: [FILE] } });
  const post = api.post.getMockImplementation()!;
  api.post.mockImplementation(async (url, body) => {
    const response = await post(url, body);
    if (url === URLS.REGISTER_AWARD_VESTINGS) {
      failedRead = null;
      throw new Error('Vesting response interrupted');
    }
    return response;
  });
  fireEvent.click(screen.getByRole('button', { name: COPY.VEST }));
  await screen.findByRole('alert');
  const original = submissions(URLS.REGISTER_AWARD_VESTINGS)[0];
  expect(held).toHaveBeenLastCalledWith(REGISTER.token.uuid, true);
  let receiveFile: (value: { data: Blob }) => void = () => {};
  const download = new Promise<{ data: Blob }>((resolve) => {
    receiveFile = resolve;
  });
  const get = api.get.getMockImplementation()!;
  api.get.mockImplementation(async (url, config) =>
    url === URLS.REGISTER_AWARD_FILE(awards[0].uuid) ? download : get(url, config),
  );
  fireEvent.click(screen.getByText('Agreement and vesting schedule'));
  fireEvent.click(screen.getByRole('button', { name: /^Download agreement/ }));
  await waitFor(() =>
    expect(api.get.mock.calls.some(([url]) => url === URLS.REGISTER_AWARD_FILE(awards[0].uuid))).toBe(true),
  );
  failedRead = 'award';
  fireEvent.click(screen.getByRole('button', { name: 'Refresh awards' }));
  await screen.findByText(/Employee awards could not be read/);
  expect(screen.queryByRole('heading', { name: AWARD_REQUEST.name! })).toBeNull();
  await act(async () => receiveFile({ data: new Blob(['private agreement'], { type: 'application/pdf' }) }));
  expect(api.save).not.toHaveBeenCalled();
  failedRead = null;
  fireEvent.click(screen.getByRole('button', { name: 'Retry awards' }));
  await screen.findByRole('heading', { name: AWARD_REQUEST.name! });
  appointments = [{ ...APPOINTMENT, capabilities: ['finance'] }];
  fireEvent.click(screen.getByRole('button', { name: 'Refresh awards' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: AWARD_REQUEST.name! })).toBeNull());
  expect(screen.queryByText(AWARD_REQUEST.residentialAddress!)).toBeNull();
  expect(screen.queryByLabelText(COPY.VESTING_SHARES)).toBeNull();
  expect(screen.queryByRole('button', { name: /^Download agreement/ })).toBeNull();
  expect(screen.queryByRole('button', { name: COPY.PREPARE })).toBeNull();
  expect(held).toHaveBeenLastCalledWith(REGISTER.token.uuid, true);
  appointments = [{ ...APPOINTMENT, capabilities: ['read_register'] }];
  await client.refetchQueries({ queryKey: ownAppointmentsKey(OWNER) });
  await screen.findByRole('heading', { name: AWARD_REQUEST.name! });
  const recover = await screen.findByRole('button', { name: COPY.VEST });
  await waitFor(() => expect((recover as HTMLButtonElement).disabled).toBe(false));
  expect((screen.getByLabelText(COPY.VESTING_SHARES).closest('fieldset') as HTMLFieldSetElement).disabled).toBe(true);
  fireEvent.click(recover);
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Close vesting form' })).toBeNull());
  expect(submissions(URLS.REGISTER_AWARD_VESTINGS)).toEqual([original]);
  expect(submissions(URLS.REGISTER_EVIDENCE)).toHaveLength(1);
  expect(held).toHaveBeenLastCalledWith(REGISTER.token.uuid, false);
  expect(api.get.mock.calls.some(([url]) => url === URLS.REGISTER_AWARD_VESTING(original.operationId))).toBe(true);
});
