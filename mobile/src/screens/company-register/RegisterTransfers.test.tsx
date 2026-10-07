import React from 'react';
import { ApiClientProvider, AUTH_QUERY_KEY, USER_PREFERENCES_QUERY_KEY } from '@ledova/shared';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Crypto from 'expo-crypto';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import {
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_TRANSFER_COPY as COPY,
  type RegisterTransferPreparation,
  type RegisterTransfer,
  type OwnCompanyAppointment,
  type RegisterTransferDecideRequest,
  type RegisterDecisionKind,
} from '@ledova/shared';
import { apiClient } from '../../services/apiClient';
import { pickedFile, resetFiles } from '../../testSupport/documentFiles';
import { PrepareRegisterTransferScreen } from './PrepareRegisterTransferScreen';
import { TransferRecord } from './TransferRecord';
import { ClassTransfers } from './ClassTransfers';
import { getSessionEpoch } from '../../services/sessionScope';
import { transferMembersKey } from './useCompanyRegister';

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
const RECIPIENT = '10000000-0000-4000-8000-0000000000bb';
const PURGED = '10000000-0000-4000-8000-0000000000cc';
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
function transferFrom(body: RegisterTransferPreparation): RegisterTransfer {
  return {
    uuid: body.operationId,
    company: 'paper',
    token: body.tokenId,
    fromMember: body.fromMember,
    toMember: body.toMember,
    newMember: body.newMember,
    newParticulars: body.newMember || !!body.name,
    fromName: holder.name,
    fromResidentialAddress: ADDRESS,
    fromParticulars: {},
    toParticulars: {},
    name: body.name || 'Synthetic Former Member',
    residentialAddress: body.residentialAddress || ADDRESS,
    shares: body.shares,
    signedOn: body.signedOn,
    lodgedOn: body.lodgedOn,
    effectiveOn: null,
    authority: 'director_resolution',
    approvingDirector: body.approvingDirector,
    terms: body.terms,
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
  return (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={apiClient}>{children}</ApiClientProvider>
    </QueryClientProvider>
  );
}
async function open() {
  const view = await render(<PrepareRegisterTransferScreen />, { wrapper });
  await view.findByTestId('prepare-transfer-screen');
  return view;
}
async function fill(view: Awaited<ReturnType<typeof open>>, recipient = 'new') {
  await fireEvent.press(view.getByRole('button', { name: `Transferor ${holder.name} ${MEMBER}` }));
  if (recipient !== 'new')
    await fireEvent.press(
      view.getByRole('button', {
        name: `Recipient ${recipient === PURGED ? 'Recorded member' : 'Synthetic Former Member'} ${recipient}`,
      }),
    );
  if (recipient === 'new' || recipient === PURGED) {
    await fireEvent.changeText(view.getByLabelText(COPY.NAME), ' Synthetic New Member ');
    await fireEvent.changeText(view.getByLabelText(COPY.ADDRESS), ` ${ADDRESS} `);
  }
  for (const [label, value] of [
    [COPY.SHARES, '20'],
    [COPY.SIGNED_ON, '2026-10-05'],
    [COPY.LODGED_ON, '2026-10-06'],
    [COPY.TERMS, ' Non-paid family transfer '],
    [COPY.DIRECTOR, ' Independent Director '],
    [COPY.AUTHORITY_REFERENCE, ' Resolution 1 '],
    [COPY.REASON, ' Family gift '],
  ])
    await fireEvent.changeText(view.getByLabelText(label), value);
  for (const noun of ['authority document', 'signed transfer instrument']) {
    await fireEvent.press(view.getByRole('button', { name: `Choose the ${noun}` }));
    await view.findByRole('button', { name: `Replace the ${noun}` });
  }
}
const submissions = () =>
  post.mock.calls
    .filter(([url]) => url === URLS.REGISTER_TRANSFERS)
    .map(([, body]) => body as RegisterTransferPreparation);

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
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, {
    data: { userProfile: 'native-user', userAccount: { uuid: 'native-account', role: 'investor' } },
  });
  appointments = [appointment];
  get.mockReset().mockImplementation(async (url) => {
    if (url === URLS.REGISTER)
      return {
        data: { results: [{ uuid: 'ordinary', companyUuid: 'paper', companyName: 'Synthetic Company' }], next: null },
      };
    if (url === URLS.HOLDERS('ordinary')) return { data: register };
    if (url === URLS.REGISTER_MEMBERS('ordinary'))
      return {
        data: {
          members: [
            {
              member: MEMBER,
              name: holder.name,
              residentialAddress: ADDRESS,
              currentShares: '20',
              enteredOn: '2026-10-01',
              lastCeasedOn: null,
              walletless: true,
              particularsRetained: true,
            },
            {
              member: RECIPIENT,
              name: 'Synthetic Former Member',
              residentialAddress: ADDRESS,
              currentShares: '0',
              enteredOn: null,
              lastCeasedOn: '2026-09-15',
              walletless: true,
              particularsRetained: true,
            },
            {
              member: PURGED,
              name: null,
              residentialAddress: null,
              currentShares: '0',
              enteredOn: null,
              lastCeasedOn: '2018-09-15',
              walletless: true,
              particularsRetained: false,
            },
          ],
        },
      };
    if (url === APPOINTMENTS) return { data: { results: appointments, next: null } };
    throw new Error(`Unexpected ${url}`);
  });
  prepare = jest.fn(async (body: RegisterTransferPreparation) => ({ data: transferFrom(body) }));
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
    if (url === URLS.REGISTER_TRANSFERS) return prepare(body);
    throw new Error(`Unexpected ${url}`);
  });
});
afterEach(async () => {
  await cleanup();
  client.clear();
  jest.restoreAllMocks();
});

it('prepares a new walletless recipient from the genuine instrument without inventing entry or payment', async () => {
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(submissions()[0]).toEqual(
    expect.objectContaining({
      fromMember: MEMBER,
      toMember: KEY(1),
      newMember: true,
      name: 'Synthetic New Member',
      residentialAddress: ADDRESS,
      terms: 'Non-paid family transfer',
      shares: '20',
      signedOn: '2026-10-05',
      lodgedOn: '2026-10-06',
      approvingDirector: 'Independent Director',
    }),
  );
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(2);
  expect(submissions()[0]).not.toHaveProperty('effectiveOn');
  expect(submissions()[0]).not.toHaveProperty('wallet');
  expect(submissions()[0]).not.toHaveProperty('payment');
});

it.each([RECIPIENT, PURGED])(
  'returns member %s under their stable ID, retaining or freshly recording particulars',
  async (recipient) => {
    const view = await open();
    await fill(view, recipient);
    await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
    expect(submissions()[0]).toEqual(
      expect.objectContaining({ fromMember: MEMBER, toMember: recipient, newMember: false }),
    );
    if (recipient === PURGED)
      expect(submissions()[0]).toEqual(
        expect.objectContaining({ name: 'Synthetic New Member', residentialAddress: ADDRESS }),
      );
    else expect(submissions()[0]).not.toHaveProperty('name');
  },
);

it('replays the same uncertain transfer and its two evidence copies', async () => {
  prepare.mockRejectedValueOnce({ response: { status: 503 } });
  const view = await open();
  await fill(view, RECIPIENT);
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await view.findByRole('alert');
  await waitFor(() => expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(submissions()).toHaveLength(2);
  expect(submissions()[1]).toEqual(submissions()[0]);
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(2);
});

it.each(['recipient particulars', 'source balance'])(
  'replays the original uncertain preparation after refreshed %s changed',
  async (change) => {
    prepare.mockRejectedValueOnce({ response: { status: 503 } });
    const view = await open();
    await fill(view, PURGED);
    await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
    await view.findByRole('alert');
    const key = transferMembersKey(getSessionEpoch(), 'ordinary');
    await act(async () => {
      client.setQueryData(key, (rows: { member: string; currentShares: string }[] | undefined) =>
        rows?.map((row) =>
          row.member === MEMBER && change === 'source balance'
            ? { ...row, currentShares: '0', enteredOn: null }
            : row.member === PURGED && change === 'recipient particulars'
              ? {
                  ...row,
                  name: 'Synthetic New Member',
                  residentialAddress: ADDRESS,
                  particularsRetained: true,
                  currentShares: '20',
                  enteredOn: '2026-10-07',
                }
              : row,
        ),
      );
    });
    expect(view.getByLabelText(COPY.NAME)).toBeTruthy();
    await waitFor(() => expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeEnabled());
    prepare.mockImplementationOnce(async (body: RegisterTransferPreparation) => ({
      data: {
        ...transferFrom(body),
        status: 'applied',
        stage: 'applied',
        registerEntry: 'entry-recorded',
        effectiveOn: '2026-10-07',
      },
    }));
    await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
    await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
    expect(submissions()).toHaveLength(2);
    expect(submissions()[1]).toEqual(submissions()[0]);
    expect(submissions()[1]).toEqual(
      expect.objectContaining({
        toMember: PURGED,
        newMember: false,
        name: 'Synthetic New Member',
        residentialAddress: ADDRESS,
      }),
    );
    expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_EVIDENCE)).toHaveLength(2);
  },
);

it('a deliberate draft edit starts a new preparation after an ambiguous response', async () => {
  prepare.mockRejectedValueOnce({ response: { status: 503 } });
  const view = await open();
  await fill(view, RECIPIENT);
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await view.findByRole('alert');
  await fireEvent.changeText(view.getByLabelText(COPY.REASON), 'Updated reason');
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await waitFor(() => expect(mockGoBack).toHaveBeenCalledTimes(1));
  expect(submissions()).toHaveLength(2);
  expect(submissions()[1].operationId).not.toBe(submissions()[0].operationId);
  expect(submissions()[1].reason).toBe('Updated reason');
});

it('blocks an amount above the transferor holding and signing after lodgement', async () => {
  const view = await open();
  await fill(view);
  await fireEvent.changeText(view.getByLabelText(COPY.SHARES), '21');
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  await fireEvent.changeText(view.getByLabelText(COPY.SHARES), '20');
  await fireEvent.changeText(view.getByLabelText(COPY.SIGNED_ON), '2026-10-07');
  expect(view.getByRole('button', { name: COPY.SUBMIT })).toBeDisabled();
  expect(submissions()).toHaveLength(0);
});

it('does not report preparation success for a different retained member', async () => {
  prepare.mockImplementationOnce(async (body: RegisterTransferPreparation) => ({
    data: { ...transferFrom(body), fromMember: 'another-member' },
  }));
  const view = await open();
  await fill(view);
  await fireEvent.press(view.getByRole('button', { name: COPY.SUBMIT }));
  await view.findByText(COPY.PREPARATION_RECEIPT_FAILED);
  expect(mockGoBack).not.toHaveBeenCalled();
});

it('hides preparation for a current appointment without the prepare capability', async () => {
  appointments = [{ ...appointment, capabilities: ['approve'] }];
  const view = await render(<PrepareRegisterTransferScreen />, { wrapper });
  await view.findByText(COPY.READ_ONLY_NOTE);
  expect(view.queryByRole('button', { name: COPY.SUBMIT })).toBeNull();
  expect(post).not.toHaveBeenCalled();
});

const PREPARATION: RegisterTransferPreparation = {
  operationId: 'transfer-a',
  appointment: appointment.uuid,
  tokenId: 'ordinary',
  fromMember: MEMBER,
  toMember: RECIPIENT,
  newMember: false,
  shares: '20',
  signedOn: '2026-10-05',
  lodgedOn: '2026-10-06',
  terms: 'Non-paid family transfer',
  approvingDirector: 'Independent Director',
  authorityReference: 'Resolution 1',
  reason: 'Family gift',
  authorityEvidence: 'authority-a',
  instrumentEvidence: 'instrument-a',
};
const TRANSFER = transferFrom(PREPARATION);
it('opens retained authority and signed instrument copies through their exact private routes', async () => {
  get.mockResolvedValue({ data: new Uint8Array([1, 2, 3]).buffer, headers: { 'content-type': 'application/pdf' } });
  const epoch = getSessionEpoch();
  const view = await render(<TransferRecord transfer={TRANSFER} epoch={epoch} last onSettled={jest.fn()} />, {
    wrapper,
  });
  for (const [index, kind] of (['authority', 'instrument'] as const).entries()) {
    await fireEvent.press(view.getByRole('button', { name: new RegExp(`^Download ${kind} document`) }));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(index + 1));
  }
  expect(get.mock.calls).toEqual([
    [URLS.REGISTER_TRANSFER_FILE(TRANSFER.uuid), { responseType: 'arraybuffer', ledovaSessionEpoch: epoch }],
    [URLS.REGISTER_TRANSFER_INSTRUMENT_FILE(TRANSFER.uuid), { responseType: 'arraybuffer', ledovaSessionEpoch: epoch }],
  ]);
});

it('reads the genuine register outcome after an interrupted application response', async () => {
  let recorded = TRANSFER;
  get.mockImplementation(async (url) => ({
    data: { results: url === URLS.REGISTER_TRANSFERS ? [recorded] : [], count: 1, next: null },
  }));
  post.mockImplementation(async (url) => {
    if (url === URLS.REGISTER_TRANSFER_PREVIEW(TRANSFER.uuid))
      return {
        data: {
          ...TRANSFER,
          previewDigest: DIGEST,
          canDecide: true,
          unmetRequirements: [],
          registerSequence: 1,
          issuedSupply: '20',
          authorisedSupply: '100',
          afterIssuedSupply: '20',
          fromCurrentShares: '20',
          fromAfterShares: '0',
          toCurrentShares: '0',
          toAfterShares: '20',
          effectiveOn: '2026-10-07',
        },
      };
    recorded = {
      ...TRANSFER,
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
    <ClassTransfers
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
  await fireEvent.press(await view.findByRole('button', { name: /^Apply the non-paid transfer/ }));
  await waitFor(() => expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled());
  await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
  await view.findByRole('alert');
  await fireEvent.press(view.getByRole('button', { name: 'Cancel' }));
  await fireEvent.press(view.getByRole('button', { name: 'Refresh transfers' }));
  await view.findByText('entry-recorded');
  expect(post.mock.calls.filter(([url]) => url === URLS.REGISTER_TRANSFER_DECIDE(TRANSFER.uuid))).toHaveLength(1);
});

it.each<RegisterDecisionKind>(['approve', 'apply', 'reject'])(
  'previews and confirms the company’s exact %s transfer decision',
  async (kind) => {
    const settled = jest.fn();
    post.mockImplementation(async (url, raw) => {
      const request = raw as RegisterTransferDecideRequest;
      if (url === URLS.REGISTER_TRANSFER_PREVIEW(TRANSFER.uuid))
        return {
          data: {
            ...TRANSFER,
            previewDigest: DIGEST,
            canDecide: kind !== 'reject' || !!request.reason,
            unmetRequirements: kind === 'reject' && !request.reason ? ['reason_required'] : [],
            registerSequence: 1,
            issuedSupply: '20',
            authorisedSupply: '100',
            afterIssuedSupply: '20',
            fromCurrentShares: '20',
            fromAfterShares: '0',
            toCurrentShares: '0',
            toAfterShares: '20',
            effectiveOn: '2026-10-07',
          },
        };
      if (url === URLS.REGISTER_TRANSFER_DECIDE(TRANSFER.uuid)) {
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
            ...TRANSFER,
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
      <TransferRecord
        transfer={TRANSFER}
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
      view.getByRole('button', { name: new RegExp(`^${COPY.DECISIONS[kind]} the non-paid transfer`) }),
    );
    await view.findByText('Transferor holding');
    expect(view.getByText('20 → 0')).toBeTruthy();
    expect(view.getByText('20 → 20')).toBeTruthy();
    if (kind === 'reject') {
      await fireEvent.changeText(view.getByLabelText(COPY.REJECTION_REASON), ' Terms need correction ');
      await fireEvent.press(view.getByRole('button', { name: 'Preview rejection' }));
    }
    await waitFor(() => expect(view.getByRole('button', { name: 'Confirm' })).toBeEnabled());
    await fireEvent.press(view.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
    expect(post.mock.calls.find(([url]) => url === URLS.REGISTER_TRANSFER_DECIDE(TRANSFER.uuid))?.[1]).toEqual(
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
