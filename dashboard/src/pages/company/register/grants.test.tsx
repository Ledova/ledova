// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_GRANT_COPY as COPY,
  REGISTER_GRANT_UNMET_COPY,
  type OwnCompanyAppointment,
  type RegisterGrant,
  type RegisterGrantPreparation,
  type RegisterGrantDecideRequest,
  type RegisterDecisionKind,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { GrantForm } from './grant/GrantForm';
import { GrantRecord } from './GrantRecord';
import { ClassGrants } from './ClassGrants';

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('@services/apiClient', () => ({ default: api }));
const APPOINTMENT: OwnCompanyAppointment = {
  uuid: 'appointment-a',
  company: 'company-a',
  companyName: 'Synthetic Company',
  capabilities: ['admin'],
  delegatableCapabilities: [],
  status: 'active',
  isEffective: true,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-10-07T00:00:00Z',
  source: 'invitation',
  declarationText: null,
  declarationVersion: null,
};
const HOLDER: TokenHoldersResponse['holders'][number] = {
  member: 'member-existing',
  name: 'Synthetic Existing Member',
  balance: '20',
  holderType: 'member',
  enteredOn: '2026-10-01',
  identitySource: 'particulars',
  percentage: 100,
  shareClass: 'ORD',
  source: 'register',
  wallets: [],
};
const FILE = new File(['%PDF synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
const ADDRESS = '1 Synthetic Street, Sydney NSW 2000';
const DIGEST = 'd'.repeat(64);
let client: QueryClient;
let prepare: ReturnType<typeof vi.fn<(body: RegisterGrantPreparation) => Promise<{ data: RegisterGrant }>>>;

function grantFrom(body: RegisterGrantPreparation): RegisterGrant {
  return {
    uuid: body.operationId,
    company: 'company-a',
    token: body.tokenId,
    member: body.member,
    newMember: body.newMember,
    name: body.name || HOLDER.name!,
    residentialAddress: body.residentialAddress || ADDRESS,
    shares: body.shares,
    termsOn: body.termsOn,
    approvingDirector: body.approvingDirector,
    effectiveOn: null,
    terms: body.terms,
    authorityReference: body.authorityReference,
    reason: body.reason,
    authorityEvidence: body.authorityEvidence,
    evidenceFingerprint: 'a'.repeat(64),
    evidenceSnapshot: {},
    termsEvidence: body.termsEvidence,
    termsFingerprint: 'b'.repeat(64),
    termsSnapshot: {},
    acceptanceRequired: body.acceptanceRequired,
    acceptanceEvidence: body.acceptanceEvidence ?? null,
    acceptanceFingerprint: body.acceptanceEvidence ? 'c'.repeat(64) : '',
    acceptanceSnapshot: body.acceptanceEvidence ? {} : null,
    preparingAppointment: body.appointment,
    preparedByName: 'Synthetic Preparer',
    providedBy: 'company',
    submittedBy: 1,
    status: 'submitted',
    stage: 'submitted',
    registerEntry: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: '2026-10-07T00:00:00Z',
  };
}

function openForm(blocked = false) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <GrantForm
                owner={{ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }}
                guard={() => {}}
                company="company-a"
                token="ordinary"
                members={[HOLDER]}
                appointment={APPOINTMENT}
                blocked={blocked}
                onRefused={vi.fn()}
              />
            }
          />
          <Route path="/company/register" element={<p>Register returned</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function fill(newMember = true, acceptance = false) {
  if (newMember) {
    fireEvent.change(screen.getByLabelText(COPY.NAME), { target: { value: ' Synthetic New Member ' } });
    fireEvent.change(screen.getByLabelText(COPY.RESIDENTIAL_ADDRESS), { target: { value: ` ${ADDRESS} ` } });
  } else fireEvent.change(screen.getByLabelText('Member'), { target: { value: HOLDER.member } });
  for (const [label, value] of [
    [COPY.SHARES, '10'],
    [COPY.TERMS_ON, '2020-01-01'],
    [COPY.DIRECTOR, ' Independent Director '],
    [COPY.TERMS, ' Non-paid employee grant '],
    [COPY.AUTHORITY_REFERENCE, ' Resolution 1 '],
    [COPY.REASON, ' Employee grant '],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  if (acceptance) fireEvent.click(screen.getByLabelText(COPY.ACCEPTANCE_REQUIRED));
  for (const label of [COPY.AUTHORITY_DOCUMENT, COPY.TERMS_DOCUMENT, ...(acceptance ? [COPY.ACCEPTANCE_DOCUMENT] : [])])
    fireEvent.change(screen.getByLabelText(label), { target: { files: [FILE] } });
}

const submissions = () =>
  api.post.mock.calls
    .filter(([url]) => url === URLS.REGISTER_GRANTS)
    .map(([, body]) => body as RegisterGrantPreparation);
const submit = () => fireEvent.click(screen.getByRole('button', { name: COPY.SUBMIT }));

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  prepare = vi.fn(async (body: RegisterGrantPreparation) => ({ data: grantFrom(body) }));
  api.get.mockReset();
  api.post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_EVIDENCE) {
      const form = body as FormData;
      return {
        data: {
          uuid: `evidence-${form.get('idempotency_key')}`,
          company: form.get('company_id'),
          appointment: form.get('appointment'),
          kind: form.get('kind'),
          idempotencyKey: form.get('idempotency_key'),
          originalFilename: FILE.name,
          fileSize: FILE.size,
          mimeType: FILE.type,
          sha256: 'a'.repeat(64),
          providedBy: 'company',
          createdAt: '2026-10-07T00:00:00Z',
        },
      };
    }
    if (url === URLS.REGISTER_GRANTS) return prepare(body);
    throw new Error(`Unexpected ${url}`);
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('retains new walletless particulars and the actual terms, authority and required acceptance', async () => {
  openForm();
  fill(true, true);
  submit();
  await screen.findByText('Register returned');
  expect(submissions()).toHaveLength(1);
  expect(submissions()[0]).toEqual(
    expect.objectContaining({
      tokenId: 'ordinary',
      newMember: true,
      member: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Synthetic New Member',
      residentialAddress: ADDRESS,
      shares: '10',
      terms: 'Non-paid employee grant',
      termsOn: '2020-01-01',
      approvingDirector: 'Independent Director',
      authorityReference: 'Resolution 1',
      acceptanceRequired: true,
      acceptanceEvidence: expect.any(String),
    }),
  );
  expect(Object.keys(submissions()[0]).sort()).toEqual(
    [
      'acceptanceEvidence',
      'acceptanceRequired',
      'appointment',
      'authorityEvidence',
      'authorityReference',
      'termsOn',
      'approvingDirector',
      'member',
      'name',
      'newMember',
      'operationId',
      'reason',
      'residentialAddress',
      'shares',
      'terms',
      'termsEvidence',
      'tokenId',
    ].sort(),
  );
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(3);
});

it('requires the company-provided approving director without adding an account requirement', () => {
  openForm();
  fill();
  fireEvent.change(screen.getByLabelText(COPY.DIRECTOR), { target: { value: ' ' } });
  expect((screen.getByRole('button', { name: COPY.SUBMIT }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByLabelText('Effective on')).toBeNull();
  expect(submissions()).toHaveLength(0);
});

it('reuses an uncertain preparation and its uploaded evidence, while changed terms create a new command', async () => {
  prepare.mockRejectedValueOnce({ response: { status: 503 } }).mockRejectedValueOnce({ response: { status: 503 } });
  openForm();
  fill();
  submit();
  await screen.findByRole('alert');
  submit();
  await waitFor(() => expect(submissions()).toHaveLength(2));
  await waitFor(() =>
    expect((screen.getByRole('button', { name: COPY.SUBMIT }) as HTMLButtonElement).disabled).toBe(false),
  );
  expect(submissions()[1]).toEqual(submissions()[0]);
  fireEvent.change(screen.getByLabelText(COPY.TERMS), { target: { value: 'Revised non-paid grant terms' } });
  submit();
  await screen.findByText('Register returned');
  expect(submissions()[2].operationId).not.toBe(submissions()[0].operationId);
  expect(submissions()[2].member).toBe(submissions()[0].member);
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(2);
});

it('selects the existing stable member without reentering hidden particulars and refuses a mismatched receipt', async () => {
  prepare.mockImplementationOnce(async (body: RegisterGrantPreparation) => ({
    data: { ...grantFrom(body), member: 'another-member' },
  }));
  openForm();
  fill(false);
  submit();
  await screen.findByText(COPY.PREPARATION_RECEIPT_FAILED);
  expect(submissions()[0]).toEqual(
    expect.objectContaining({
      member: HOLDER.member,
      newMember: false,
      acceptanceRequired: false,
      acceptanceEvidence: null,
    }),
  );
  expect(submissions()[0]).not.toHaveProperty('name');
  expect(submissions()[0]).not.toHaveProperty('residentialAddress');
  expect(screen.queryByText('Register returned')).toBeNull();
});

const PREPARATION: RegisterGrantPreparation = {
  operationId: 'grant-a',
  appointment: APPOINTMENT.uuid,
  tokenId: 'ordinary',
  member: HOLDER.member,
  newMember: false,
  shares: '10',
  termsOn: '2020-01-01',
  approvingDirector: 'Independent Director',
  terms: 'Non-paid employee grant',
  authorityReference: 'Resolution 1',
  reason: 'Employee grant',
  authorityEvidence: 'authority-a',
  termsEvidence: 'terms-a',
  acceptanceRequired: false,
  acceptanceEvidence: null,
};
const GRANT = grantFrom(PREPARATION);

it('refreshes retained history after an interrupted application response', async () => {
  let recorded = GRANT;
  api.get.mockImplementation(async (url: string) => ({
    data: { results: url === URLS.REGISTER_GRANTS ? [recorded] : [APPOINTMENT], count: 1, next: null, previous: null },
  }));
  api.post.mockImplementation(async (url) => {
    if (url === URLS.REGISTER_GRANT_PREVIEW(GRANT.uuid))
      return {
        data: {
          ...GRANT,
          effectiveOn: '2026-10-07',
          previewDigest: DIGEST,
          canDecide: true,
          unmetRequirements: [],
          registerSequence: 1,
          issuedSupply: '20',
          authorisedSupply: '100',
          afterIssuedSupply: '30',
          currentShares: '20',
          afterShares: '30',
        },
      };
    recorded = {
      ...GRANT,
      status: 'applied',
      stage: 'applied',
      registerEntry: 'entry-recorded',
      effectiveOn: '2026-10-07',
    };
    throw { response: { status: 503 } };
  });
  const register: TokenHoldersResponse = {
    token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'draft', totalSupply: '100' },
    issuedSupply: '20',
    initialized: true,
    waitingEffects: 0,
    totalHolders: 1,
    holders: [HOLDER],
    formerMembers: [],
    formerMembersAsAt: null,
    formerMembersBlock: null,
    formerMembersStale: false,
  };
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ClassGrants
          owner={{ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }}
          guard={() => {}}
          company="company-a"
          register={register}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole('button', { name: /^Apply \(/ }));
  const confirm = await screen.findByRole('button', { name: 'Apply non-paid grant' });
  await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(confirm);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(screen.getByRole('button', { name: 'Refresh grants' }));
  await screen.findByText('entry-recorded');
  expect(screen.getByText('Applied')).toBeTruthy();
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_GRANT_DECIDE(GRANT.uuid))).toHaveLength(1);
});

it('shows the retained director conflict and refuses application until company authority is corrected', async () => {
  api.post.mockResolvedValue({
    data: {
      ...GRANT,
      effectiveOn: '2026-10-07',
      previewDigest: DIGEST,
      canDecide: false,
      unmetRequirements: ['approving_director_conflict'],
      registerSequence: 1,
      issuedSupply: '20',
      authorisedSupply: '100',
      afterIssuedSupply: '30',
      currentShares: '20',
      afterShares: '30',
    },
  });
  render(
    <QueryClientProvider client={client}>
      <ul>
        <GrantRecord grant={GRANT} steps={{ apply: APPOINTMENT }} guard={() => {}} onSettled={vi.fn()} />
      </ul>
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /^Apply/ }));
  await screen.findByText(REGISTER_GRANT_UNMET_COPY.approving_director_conflict);
  expect((screen.getByRole('button', { name: 'Apply non-paid grant' }) as HTMLButtonElement).disabled).toBe(true);
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_GRANT_DECIDE(GRANT.uuid))).toHaveLength(0);
});

it.each<RegisterDecisionKind>(['approve', 'apply', 'reject'])(
  'previews and confirms exact %s authority and ledger effect',
  async (kind) => {
    const settled = vi.fn();
    const decided = vi.fn(async (request: RegisterGrantDecideRequest) => {
      const decision = {
        uuid: 'decision-a',
        appointment: request.appointment,
        kind: request.kind,
        idempotencyKey: request.idempotencyKey,
        digest: request.previewDigest,
        reason: request.reason || '',
        decidedAt: '2026-10-07T01:00:00Z',
        decidedBy: 1,
        decidedByName: 'Synthetic Approver',
      };
      return {
        data: {
          ...GRANT,
          decisions: [decision],
          status: kind === 'approve' ? 'submitted' : kind === 'apply' ? 'applied' : 'rejected',
          stage: kind === 'approve' ? 'approved' : kind === 'apply' ? 'applied' : 'rejected',
          reviewedAt: kind === 'approve' ? null : decision.decidedAt,
          rejectionReason: decision.reason,
          registerEntry: kind === 'apply' ? 'entry-a' : null,
          effectiveOn: kind === 'apply' ? '2026-10-07' : null,
        },
      };
    });
    api.post.mockImplementation(async (url, body: RegisterGrantDecideRequest) => {
      if (url === URLS.REGISTER_GRANT_PREVIEW(GRANT.uuid))
        return {
          data: {
            ...GRANT,
            effectiveOn: '2026-10-07',
            previewDigest: DIGEST,
            canDecide: body.kind !== 'reject' || !!body.reason,
            unmetRequirements: body.kind === 'reject' && !body.reason ? ['reason_required'] : [],
            registerSequence: 1,
            issuedSupply: '20',
            authorisedSupply: '100',
            afterIssuedSupply: '30',
            currentShares: '20',
            afterShares: '30',
          },
        };
      if (url === URLS.REGISTER_GRANT_DECIDE(GRANT.uuid)) return decided(body);
      throw new Error(`Unexpected ${url}`);
    });
    render(
      <QueryClientProvider client={client}>
        <ul>
          <GrantRecord grant={GRANT} steps={{ [kind]: APPOINTMENT }} guard={() => {}} onSettled={settled} />
        </ul>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${COPY.DECISIONS[kind]}`) }));
    await screen.findByText('Member holding');
    expect(screen.getAllByText('2020-01-01')).toHaveLength(2);
    expect(screen.getByText('2026-10-07')).toBeTruthy();
    expect(screen.getAllByText('Independent Director')).toHaveLength(2);
    expect(screen.getAllByText(/20 shares → 30 shares/)).toHaveLength(2);
    if (kind === 'reject') {
      fireEvent.change(screen.getByLabelText(COPY.REJECTION_REASON), { target: { value: ' Terms need correction ' } });
      fireEvent.click(screen.getByRole('button', { name: 'Preview the rejection' }));
    }
    const confirm = await screen.findByRole('button', { name: `${COPY.DECISIONS[kind]} non-paid grant` });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
    expect(decided.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        appointment: APPOINTMENT.uuid,
        kind,
        previewDigest: DIGEST,
        confirmation: true,
        reason: kind === 'reject' ? 'Terms need correction' : '',
      }),
    );
  },
);
