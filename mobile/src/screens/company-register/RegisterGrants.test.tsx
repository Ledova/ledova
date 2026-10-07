import React from 'react';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_GRANT_COPY as COPY,
  REGISTER_GRANT_UNMET_COPY,
  type RegisterGrantPreparation,
  type RegisterGrant,
  type OwnCompanyAppointment,
  type RegisterGrantDecideRequest,
  type RegisterDecisionKind,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { pickedFile, resetFiles } from '../../testSupport/documentFiles';
import { PrepareRegisterGrantScreen } from './PrepareRegisterGrantScreen';
import { GrantRecord } from './GrantRecord';
import { ClassGrants } from './ClassGrants';
import { getSessionEpoch } from '../../services/sessionScope';

const mockGoBack = jest.fn();
const mockParams = { tokenUuid: 'ordinary', companyUuid: 'paper' };
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: mockGoBack }),
  useRoute: () => ({ params: mockParams }),
}));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock('../../services/tokenStorage', () => ({ getAccessToken: jest.fn(async () => 'synthetic-access') }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));

const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const MEMBER = '10000000-0000-4000-8000-0000000000aa';
const ADDRESS = '1 Synthetic Street, Sydney NSW 2000';
const DIGEST = 'd'.repeat(64);
const KEY = (index: number) => `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
const get = jest.mocked(apiClient.get);
const post = jest.mocked(apiClient.post);
const appointment: OwnCompanyAppointment = {
  uuid: 'appointment-a',
  company: 'paper',
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
const holder = {
  member: MEMBER,
  name: 'Synthetic Existing Member',
  balance: '20',
  holderType: 'member',
  enteredOn: '2026-10-01',
  wallets: [],
};
const register = {
  token: { uuid: 'ordinary', name: 'Ordinary shares', symbol: 'ORD', status: 'draft', totalSupply: '100' },
  issuedSupply: '20',
  initialized: true,
  waitingEffects: 0,
  totalHolders: 1,
  holders: [holder],
};
let client: QueryClient;
let prepare: jest.Mock;
let appointments: unknown[];
let append: jest.SpyInstance<ReturnType<FormData['append']>, Parameters<FormData['append']>>;

function field(form: unknown, key: string) {
  return append.mock.calls
    .filter((_, index) => append.mock.contexts[index] === form)
    .find(([name]) => name === key)?.[1];
}
function grantFrom(body: RegisterGrantPreparation): RegisterGrant {
  return {
    uuid: body.operationId,
    company: 'paper',
    token: body.tokenId,
    member: body.member,
    newMember: body.newMember,
    name: body.name || holder.name,
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
    status: 'submitted' as const,
    stage: 'submitted',
    registerEntry: null,
    reviewedBy: null,
    reviewedAt: null,
    rejectionReason: '',
    decisions: [],
    createdAt: '2026-10-07T00:00:00Z',
  };
}
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
async function open() {
  const view = await render(<PrepareRegisterGrantScreen />, { wrapper });
  await view.findByTestId('prepare-grant-screen');
  return view;
}
async function fill(view: Awaited<ReturnType<typeof open>>, newMember = true, acceptance = false) {
  if (newMember) {
    await fireEvent.changeText(view.getByLabelText(COPY.NAME), ' Synthetic New Member ');
    await fireEvent.changeText(view.getByLabelText(COPY.RESIDENTIAL_ADDRESS), ` ${ADDRESS} `);
  } else await fireEvent.press(view.getByRole('button', { name: `Use existing member ${holder.name} ${MEMBER}` }));
  for (const [label, value] of [
    [COPY.SHARES, '10'],
    [COPY.TERMS_ON, '2020-01-01'],
    [COPY.DIRECTOR, ' Independent Director '],
    [COPY.TERMS, ' Non-paid employee grant '],
    [COPY.AUTHORITY_REFERENCE, ' Resolution 1 '],
    [COPY.REASON, ' Employee grant '],
  ])
    await fireEvent.changeText(view.getByLabelText(label), value);
  if (acceptance) await fireEvent.press(view.getByRole('button', { name: COPY.ACCEPTANCE_REQUIRED }));
  for (const noun of ['authority', 'terms', ...(acceptance ? ['acceptance'] : [])]) {
    await fireEvent.press(view.getByRole('button', { name: `Choose the ${noun} document` }));
    await view.findByRole('button', { name: `Replace the ${noun} document` });
  }
}
const submissions = () =>
  post.mock.calls.filter(([url]) => url === URLS.REGISTER_GRANTS).map(([, body]) => body as RegisterGrantPreparation);

beforeEach(() => {
  resetFiles();
  mockGoBack.mockReset();
  jest.mocked(Sharing.shareAsync).mockClear();
  let keys = 0;
  jest.mocked(Crypto.randomUUID).mockImplementation(() => KEY(++keys) as ReturnType<typeof Crypto.randomUUID>);
  let picks = 0;
  jest
    .mocked(DocumentPicker.getDocumentAsync)
    .mockReset()
    .mockImplementation(async () => pickedFile(++picks));
  append = jest.spyOn(FormData.prototype, 'append');
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: 0 } },
  });
  appointments = [appointment];
  get.mockReset().mockImplementation(async (url) => {
    if (url === URLS.REGISTER)
      return {
        data: { results: [{ uuid: 'ordinary', companyUuid: 'paper', companyName: 'Synthetic Company' }], next: null },
      };
    if (url === URLS.HOLDERS('ordinary')) return { data: register };
    if (url === APPOINTMENTS) return { data: { results: appointments, next: null } };
    throw new Error(`Unexpected ${url}`);
  });
  prepare = jest.fn(async (body: RegisterGrantPreparation) => ({ data: grantFrom(body) }));
  post.mockReset().mockImplementation(async (url, body) => {
    if (url === URLS.REGISTER_EVIDENCE)
      return {
        data: {
          uuid: `evidence-${field(body, 'idempotency_key')}`,
          company: field(body, 'company_id'),
          appointment: field(body, 'appointment'),
          kind: field(body, 'kind'),
          idempotencyKey: field(body, 'idempotency_key'),
          originalFilename: (field(body, 'file') as unknown as { name: string }).name,
          fileSize: 5,
          mimeType: 'application/pdf',
          sha256: 'a'.repeat(64),
          providedBy: 'company',
          createdAt: '2026-10-07T00:00:00Z',
        },
      };
    if (url === URLS.REGISTER_GRANTS) return prepare(body);
    throw new Error(`Unexpected ${url}`);
  });
});
afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

it('prepares a new walletless member with retained terms and required recipient acceptance', async () => {
  const view = await open();
  await fill(view, true, true);
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(submissions()[0]).toEqual(
    expect.objectContaining({
      member: KEY(1),
      newMember: true,
      name: 'Synthetic New Member',
      residentialAddress: ADDRESS,
      terms: 'Non-paid employee grant',
      termsOn: '2020-01-01',
      approvingDirector: 'Independent Director',
      shares: '10',
      acceptanceRequired: true,
      acceptanceEvidence: expect.any(String),
    }),
  );
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(3);
  expect(submissions()[0]).not.toHaveProperty('effectiveOn');
  expect(submissions()[0]).not.toHaveProperty('wallet');
  expect(submissions()[0]).not.toHaveProperty('payment');
});

it('requires a company-provided approving director and shows no user-chosen register entry date', async () => {
  const view = await open();
  await fill(view);
  await fireEvent.changeText(view.getByLabelText(COPY.DIRECTOR), ' ');
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  expect(view.queryByLabelText('Effective on')).toBeNull();
  expect(submissions()).toHaveLength(0);
});

it('replays the same uncertain grant and evidence for an existing member without retyping their particulars', async () => {
  prepare.mockRejectedValueOnce({ response: { status: 503 } });
  const view = await open();
  await fill(view, false);
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await view.findByRole('alert');
  await waitFor(() => expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(submissions()).toHaveLength(2);
  expect(submissions()[1]).toEqual(submissions()[0]);
  expect(submissions()[0]).toEqual(
    expect.objectContaining({ member: MEMBER, newMember: false, acceptanceRequired: false, acceptanceEvidence: null }),
  );
  expect(submissions()[0]).not.toHaveProperty('name');
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(2);
});

it('does not report preparation success for a different retained member', async () => {
  prepare.mockImplementationOnce(async (body: RegisterGrantPreparation) => ({
    data: { ...grantFrom(body), member: 'another-member' },
  }));
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await view.findByText(COPY.PREPARATION_RECEIPT_FAILED);
  expect(mockGoBack).not.toHaveBeenCalled();
});

it('hides preparation for a current appointment without the prepare capability', async () => {
  appointments = [{ ...appointment, capabilities: ['approve'] }];
  const view = await render(<PrepareRegisterGrantScreen />, { wrapper });
  await view.findByText(COPY.READ_ONLY_NOTE);
  expect(view.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

const PREPARATION: RegisterGrantPreparation = {
  operationId: 'grant-a',
  appointment: appointment.uuid,
  tokenId: 'ordinary',
  member: MEMBER,
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

it('opens retained authority, terms and acceptance copies through their exact private routes', async () => {
  get.mockResolvedValue({ data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/pdf' } });
  const epoch = getSessionEpoch();
  const view = await render(
    <GrantRecord
      grant={{ ...GRANT, acceptanceRequired: true, acceptanceEvidence: 'acceptance-a' }}
      epoch={epoch}
      last
      onSettled={jest.fn()}
    />,
    { wrapper },
  );
  for (const [index, kind] of (['authority', 'terms', 'acceptance'] as const).entries()) {
    await fireEvent.press(view.getByRole('button', { name: new RegExp(`^Download ${kind} document`) }));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(index + 1));
  }
  expect(get.mock.calls).toEqual([
    [URLS.REGISTER_GRANT_FILE(GRANT.uuid), { responseType: 'arraybuffer', ledovaSessionEpoch: epoch }],
    [URLS.REGISTER_GRANT_TERMS_FILE(GRANT.uuid), { responseType: 'arraybuffer', ledovaSessionEpoch: epoch }],
    [URLS.REGISTER_GRANT_ACCEPTANCE_FILE(GRANT.uuid), { responseType: 'arraybuffer', ledovaSessionEpoch: epoch }],
  ]);
});

it('reads the genuine register outcome after an interrupted application response', async () => {
  let recorded = GRANT;
  get.mockImplementation(async (url) => ({
    data: { results: url === URLS.REGISTER_GRANTS ? [recorded] : [], count: 1, next: null },
  }));
  post.mockImplementation(async (url) => {
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
  const refresh = jest.fn(async () => {});
  const step = {
    ...appointment,
    capabilities: ['admin'] as 'admin'[],
    status: 'active' as const,
    source: 'invitation' as const,
  };
  const view = await render(
    <ClassGrants
      epoch={getSessionEpoch()}
      company="paper"
      register={{
        ...register,
        token: register.token,
        holders: [],
        formerMembers: [],
        formerMembersAsAt: null,
        formerMembersBlock: null,
        formerMembersStale: false,
      }}
      steps={{ prepare: undefined, approve: undefined, apply: step, reject: undefined }}
      refreshHolders={refresh}
      refreshAppointments={refresh}
      onPrepare={jest.fn()}
    />,
    { wrapper },
  );
  await fireEvent.press(await view.findByRole('button', { name: /^Apply the non-paid grant/ }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await view.findByRole('alert');
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  await fireEvent.press(view.getByRole('button', { name: 'Refresh grants' }));
  await view.findByText('entry-recorded');
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_GRANT_DECIDE(GRANT.uuid))).toHaveLength(1);
});

it('shows the named director conflict and withholds application confirmation', async () => {
  post.mockResolvedValue({
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
  const view = await render(
    <GrantRecord
      grant={GRANT}
      epoch={getSessionEpoch()}
      steps={{ prepare: undefined, approve: undefined, reject: undefined, apply: appointment }}
      last
      onSettled={jest.fn()}
    />,
    { wrapper },
  );
  await fireEvent.press(view.getByRole('button', { name: /^Apply the non-paid grant/ }));
  await view.findByText(REGISTER_GRANT_UNMET_COPY.approving_director_conflict);
  expect(view.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_GRANT_DECIDE(GRANT.uuid))).toHaveLength(0);
});

it.each<RegisterDecisionKind>(['approve', 'apply', 'reject'])(
  'previews and confirms the company’s exact %s grant decision',
  async (kind) => {
    const settled = jest.fn();
    post.mockImplementation(async (url, raw) => {
      const request = raw as RegisterGrantDecideRequest;
      if (url === URLS.REGISTER_GRANT_PREVIEW(GRANT.uuid))
        return {
          data: {
            ...GRANT,
            effectiveOn: '2026-10-07',
            previewDigest: DIGEST,
            canDecide: kind !== 'reject' || !!request.reason,
            unmetRequirements: kind === 'reject' && !request.reason ? ['reason_required'] : [],
            registerSequence: 1,
            issuedSupply: '20',
            authorisedSupply: '100',
            afterIssuedSupply: '30',
            currentShares: '20',
            afterShares: '30',
          },
        };
      if (url === URLS.REGISTER_GRANT_DECIDE(GRANT.uuid)) {
        const decision = {
          uuid: 'decision-a',
          appointment: request.appointment,
          kind,
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
            reviewedAt: kind === 'approve' ? null : decision.decidedAt,
            rejectionReason: decision.reason,
            registerEntry: kind === 'apply' ? 'entry-a' : null,
            effectiveOn: kind === 'apply' ? '2026-10-07' : null,
          },
        };
      }
      throw new Error(`Unexpected ${url}`);
    });
    const view = await render(
      <GrantRecord
        grant={GRANT}
        epoch={0}
        steps={{
          prepare: undefined,
          approve:
            kind === 'approve'
              ? { ...appointment, capabilities: ['admin'], status: 'active', source: 'invitation' }
              : undefined,
          apply:
            kind === 'apply'
              ? { ...appointment, capabilities: ['admin'], status: 'active', source: 'invitation' }
              : undefined,
          reject:
            kind === 'reject'
              ? { ...appointment, capabilities: ['admin'], status: 'active', source: 'invitation' }
              : undefined,
        }}
        last
        onSettled={settled}
      />,
      { wrapper },
    );
    await fireEvent.press(
      view.getByRole('button', { name: new RegExp(`^${COPY.DECISIONS[kind]} the non-paid grant`) }),
    );
    await view.findByText('Member holding');
    expect(view.getAllByText('2020-01-01')).toHaveLength(2);
    expect(view.getByText('2026-10-07')).toBeTruthy();
    expect(view.getAllByText('Independent Director')).toHaveLength(2);
    expect(view.getAllByText('20 → 30')).toHaveLength(2);
    if (kind === 'reject') {
      await fireEvent.changeText(view.getByLabelText(COPY.REJECTION_REASON), ' Terms need correction ');
      await fireEvent.press(view.getByRole('button', { name: 'Preview rejection' }));
    }
    await waitFor(() => expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled());
    await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
    expect(post.mock.calls.find(([url]) => url === URLS.REGISTER_GRANT_DECIDE(GRANT.uuid))?.[1]).toEqual(
      expect.objectContaining({
        appointment: appointment.uuid,
        kind,
        previewDigest: DIGEST,
        confirmation: true,
        reason: kind === 'reject' ? 'Terms need correction' : '',
      }),
    );
  },
);
