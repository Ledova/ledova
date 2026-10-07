// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_TRANSFER_COPY as COPY,
  type OwnCompanyAppointment,
  type RegisterTransfer,
  type RegisterTransferMember,
  type RegisterTransferPreparation,
  type RegisterTransferDecideRequest,
  type RegisterDecisionKind,
} from '@ledova/shared';
import { TransferForm } from './transfer/TransferForm';
import { TransferRecord } from './TransferRecord';

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
const SENDER: RegisterTransferMember = {
  member: '10000000-0000-4000-8000-00000000000a',
  name: 'Synthetic Transferor',
  residentialAddress: '1 Synthetic Street',
  currentShares: '20',
  enteredOn: '2026-10-01',
  lastCeasedOn: null,
  walletless: true,
  particularsRetained: true,
};
const FORMER: RegisterTransferMember = {
  ...SENDER,
  member: '10000000-0000-4000-8000-00000000000b',
  name: 'Synthetic Former Member',
  residentialAddress: '2 Synthetic Street',
  currentShares: '0',
  enteredOn: null,
  lastCeasedOn: '2026-09-15',
};
const PURGED: RegisterTransferMember = {
  ...FORMER,
  member: '10000000-0000-4000-8000-00000000000c',
  name: null,
  residentialAddress: null,
  particularsRetained: false,
};
const FILE = new File(['%PDF synthetic'], 'synthetic.pdf', { type: 'application/pdf' });
const DIGEST = 'd'.repeat(64);
let client: QueryClient;
let prepare: ReturnType<typeof vi.fn<(body: RegisterTransferPreparation) => Promise<{ data: RegisterTransfer }>>>;

function transferFrom(body: RegisterTransferPreparation): RegisterTransfer {
  return {
    uuid: body.operationId,
    company: 'company-a',
    token: body.tokenId,
    fromMember: body.fromMember,
    toMember: body.toMember,
    newMember: body.newMember,
    newParticulars: body.newMember || !!body.name,
    fromName: SENDER.name!,
    fromResidentialAddress: SENDER.residentialAddress!,
    fromParticulars: {},
    name: body.name || FORMER.name!,
    residentialAddress: body.residentialAddress || FORMER.residentialAddress!,
    toParticulars: {},
    shares: body.shares,
    signedOn: body.signedOn,
    lodgedOn: body.lodgedOn,
    effectiveOn: null,
    terms: body.terms,
    authority: 'director_resolution',
    approvingDirector: body.approvingDirector,
    authorityReference: body.authorityReference,
    reason: body.reason,
    authorityEvidence: body.authorityEvidence,
    evidenceFingerprint: 'a'.repeat(64),
    evidenceSnapshot: {},
    instrumentEvidence: body.instrumentEvidence,
    instrumentFingerprint: 'b'.repeat(64),
    instrumentSnapshot: {},
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
function form(members: RegisterTransferMember[] = [SENDER, FORMER, PURGED]) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route
            path="/"
            element={
              <TransferForm
                owner={{ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }}
                guard={() => {}}
                company="company-a"
                token="ordinary"
                members={members}
                appointment={APPOINTMENT}
                blocked={false}
                onRefused={vi.fn()}
              />
            }
          />
          <Route path="/company/register" element={<p>Register returned</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}
function openForm() {
  return render(form());
}
function fill(recipient = 'new') {
  fireEvent.change(screen.getByLabelText(COPY.FROM), { target: { value: SENDER.member } });
  fireEvent.change(screen.getByLabelText(COPY.TO), { target: { value: recipient } });
  if (recipient === 'new' || recipient === PURGED.member) {
    fireEvent.change(screen.getByLabelText(COPY.NAME), { target: { value: ' Synthetic Recipient ' } });
    fireEvent.change(screen.getByLabelText(COPY.ADDRESS), { target: { value: ' 3 Synthetic Street ' } });
  }
  for (const [label, value] of [
    [COPY.SHARES, '20'],
    [COPY.SIGNED_ON, '2026-10-05'],
    [COPY.LODGED_ON, '2026-10-06'],
    [COPY.TERMS, ' Non-paid family transfer '],
    [COPY.DIRECTOR, ' Independent Director '],
    [COPY.AUTHORITY_REFERENCE, ' Resolution 2 '],
    [COPY.REASON, ' Family gift '],
  ])
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  for (const label of [COPY.AUTHORITY_DOCUMENT, COPY.INSTRUMENT_DOCUMENT])
    fireEvent.change(screen.getByLabelText(label), { target: { files: [FILE] } });
}
const submissions = () =>
  api.post.mock.calls
    .filter(([url]) => url === URLS.REGISTER_TRANSFERS)
    .map(([, body]) => body as RegisterTransferPreparation);
const submit = () => fireEvent.click(screen.getByRole('button', { name: COPY.SUBMIT }));
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { gcTime: 0 } } });
  prepare = vi.fn(async (body: RegisterTransferPreparation) => ({ data: transferFrom(body) }));
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
    if (url === URLS.REGISTER_TRANSFERS) return prepare(body);
    throw new Error(`Unexpected ${url}`);
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.restoreAllMocks();
});

it('prepares a genuine new walletless recipient with signing/lodgement and no invented entry or payment', async () => {
  openForm();
  fill();
  submit();
  await screen.findByText('Register returned');
  const body = submissions()[0];
  expect(body).toEqual(
    expect.objectContaining({
      fromMember: SENDER.member,
      toMember: expect.stringMatching(/^[0-9a-f-]{36}$/),
      newMember: true,
      name: 'Synthetic Recipient',
      shares: '20',
      signedOn: '2026-10-05',
      lodgedOn: '2026-10-06',
      terms: 'Non-paid family transfer',
      approvingDirector: 'Independent Director',
      authorityEvidence: expect.any(String),
      instrumentEvidence: expect.any(String),
    }),
  );
  expect(body).not.toHaveProperty('effectiveOn');
  expect(body).not.toHaveProperty('payment');
  expect(body).not.toHaveProperty('wallet');
});

it.each([FORMER, PURGED])('returns the existing stable member $member using its retained state', async (member) => {
  openForm();
  fill(member.member);
  submit();
  await screen.findByText('Register returned');
  expect(submissions()[0]).toEqual(expect.objectContaining({ toMember: member.member, newMember: false }));
  if (member.particularsRetained) expect(submissions()[0]).not.toHaveProperty('name');
  else expect(submissions()[0]).toHaveProperty('name', 'Synthetic Recipient');
});

it('replays an uncertain preparation using the same operation and retained documents', async () => {
  prepare.mockRejectedValueOnce({ response: { status: 503 } });
  openForm();
  fill(FORMER.member);
  submit();
  await screen.findByRole('alert');
  submit();
  await screen.findByText('Register returned');
  expect(submissions()[1]).toEqual(submissions()[0]);
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(2);
});

it.each(['recipient particulars', 'source balance'])(
  'replays the original uncertain request after refreshed %s changed',
  async (change) => {
    prepare.mockRejectedValueOnce({ response: { status: 503 } });
    const view = openForm();
    fill(PURGED.member);
    submit();
    await screen.findByRole('alert');
    expect(submissions()).toHaveLength(1);
    view.rerender(
      form([
        change === 'source balance' ? { ...SENDER, currentShares: '0', enteredOn: null } : SENDER,
        FORMER,
        change === 'recipient particulars'
          ? {
              ...PURGED,
              name: 'Synthetic Recipient',
              residentialAddress: '3 Synthetic Street',
              particularsRetained: true,
              currentShares: '20',
              enteredOn: '2026-10-07',
            }
          : PURGED,
      ]),
    );
    expect(screen.getByLabelText(COPY.NAME)).toBeTruthy();
    const retry = screen.getByRole('button', { name: COPY.SUBMIT });
    await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false));
    prepare.mockImplementationOnce(async (body: RegisterTransferPreparation) => ({
      data: {
        ...transferFrom(body),
        status: 'applied',
        stage: 'applied',
        registerEntry: 'entry-recorded',
        effectiveOn: '2026-10-07',
      },
    }));
    fireEvent.click(retry);
    await screen.findByText('Register returned');
    expect(submissions()).toHaveLength(2);
    expect(submissions()[1]).toEqual(submissions()[0]);
    expect(submissions()[1]).toEqual(
      expect.objectContaining({
        toMember: PURGED.member,
        newMember: false,
        name: 'Synthetic Recipient',
        residentialAddress: '3 Synthetic Street',
      }),
    );
    expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(2);
  },
);

it('a deliberate draft edit starts a fresh preparation after an ambiguous response', async () => {
  prepare.mockRejectedValueOnce({ response: { status: 503 } });
  openForm();
  fill(FORMER.member);
  submit();
  await screen.findByRole('alert');
  fireEvent.change(screen.getByLabelText(COPY.REASON), { target: { value: 'Updated reason' } });
  submit();
  await screen.findByText('Register returned');
  expect(submissions()).toHaveLength(2);
  expect(submissions()[1].operationId).not.toBe(submissions()[0].operationId);
  expect(submissions()[1].reason).toBe('Updated reason');
});

it('blocks overspending and refuses a receipt identifying another transferor', async () => {
  openForm();
  fill();
  fireEvent.change(screen.getByLabelText(COPY.SHARES), { target: { value: '21' } });
  submit();
  expect(api.post).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(COPY.SHARES), { target: { value: '20' } });
  prepare.mockImplementationOnce(async (body) => ({ data: { ...transferFrom(body), fromMember: 'another-member' } }));
  submit();
  await screen.findByText(COPY.PREPARATION_RECEIPT_FAILED);
  expect(screen.queryByText('Register returned')).toBeNull();
});

const PREPARATION: RegisterTransferPreparation = {
  operationId: 'transfer-a',
  appointment: APPOINTMENT.uuid,
  tokenId: 'ordinary',
  fromMember: SENDER.member,
  toMember: FORMER.member,
  newMember: false,
  shares: '20',
  signedOn: '2026-10-05',
  lodgedOn: '2026-10-06',
  terms: 'Non-paid family transfer',
  approvingDirector: 'Independent Director',
  authorityReference: 'Resolution 2',
  reason: 'Family gift',
  authorityEvidence: 'authority-a',
  instrumentEvidence: 'instrument-a',
};
const TRANSFER = transferFrom(PREPARATION);
it.each<RegisterDecisionKind>(['approve', 'apply', 'reject'])(
  'confirms exact %s with both member effects and conserved supply',
  async (kind) => {
    const settled = vi.fn();
    api.post.mockImplementation(async (url, body: RegisterTransferDecideRequest) => {
      if (url === URLS.REGISTER_TRANSFER_PREVIEW(TRANSFER.uuid))
        return {
          data: {
            ...TRANSFER,
            effectiveOn: '2026-10-07',
            previewDigest: DIGEST,
            canDecide: kind !== 'reject' || !!body.reason,
            unmetRequirements: kind === 'reject' && !body.reason ? ['reason_required'] : [],
            registerSequence: 2,
            issuedSupply: '20',
            authorisedSupply: '100',
            afterIssuedSupply: '20',
            fromCurrentShares: '20',
            fromAfterShares: '0',
            toCurrentShares: '0',
            toAfterShares: '20',
          },
        };
      const decision = {
        uuid: 'decision-a',
        appointment: body.appointment,
        kind,
        idempotencyKey: body.idempotencyKey,
        digest: body.previewDigest,
        reason: body.reason || '',
        decidedAt: '2026-10-07T01:00:00Z',
        decidedBy: 1,
        decidedByName: 'Synthetic Approver',
      };
      return {
        data: {
          ...TRANSFER,
          decisions: [decision],
          status: kind === 'approve' ? 'submitted' : kind === 'apply' ? 'applied' : 'rejected',
          reviewedAt: kind === 'approve' ? null : decision.decidedAt,
          rejectionReason: decision.reason,
          registerEntry: kind === 'apply' ? 'entry-a' : null,
          effectiveOn: kind === 'apply' ? '2026-10-07' : null,
        },
      };
    });
    render(
      <QueryClientProvider client={client}>
        <ul>
          <TransferRecord transfer={TRANSFER} steps={{ [kind]: APPOINTMENT }} guard={() => {}} onSettled={settled} />
        </ul>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${COPY.DECISIONS[kind]}`) }));
    await screen.findByText('Transferor holding');
    expect(screen.getByText('20 shares → 20 shares')).toBeTruthy();
    expect(screen.getByText('20 shares → 0 shares')).toBeTruthy();
    if (kind === 'reject') {
      fireEvent.change(screen.getByLabelText(COPY.REJECTION_REASON), {
        target: { value: ' Instrument needs correction ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Preview the rejection' }));
    }
    const confirm = await screen.findByRole('button', { name: `${COPY.DECISIONS[kind]} non-paid transfer` });
    await waitFor(() => expect((confirm as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirm);
    await waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
    expect(api.post.mock.calls.find(([url]) => url === URLS.REGISTER_TRANSFER_DECIDE(TRANSFER.uuid))?.[1]).toEqual(
      expect.objectContaining({
        appointment: APPOINTMENT.uuid,
        kind,
        previewDigest: DIGEST,
        confirmation: true,
        reason: kind === 'reject' ? 'Instrument needs correction' : '',
      }),
    );
  },
);
