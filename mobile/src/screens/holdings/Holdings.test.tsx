import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  INVESTOR_CLASSIFICATION_ENDPOINTS as CLAIMS,
  PUBLICATION_NOTICE,
  USER_DOCUMENT_ENDPOINTS as DOCUMENTS,
  USER_PREFERENCES_QUERY_KEY,
  USER_PROFILE_ENDPOINTS,
  type OwnMemberRecord,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { getDocumentAsync } from 'expo-document-picker';
import { File } from 'expo-file-system';
import type { AxiosInstance } from 'axios';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch, invalidateSessionScope } from '../../services/sessionScope';
import { MEMBER_CODE, MEMBER_ENTRY, MEMBER_RECORD } from '../../../../packages/shared/tests/fixtures/member-access';
import { resetFiles } from '../../testSupport/documentFiles';
import { destinationOf } from '../../components/notifications/NotificationsModal';
import { CertificatesScreen } from '../documents/CertificatesScreen';
import { VerificationScreen } from '../eligibility/VerificationScreen';
import { SettingsScreen } from '../settings';
import { DashboardScreen } from './DashboardScreen';
import { InvitationScreen } from './InvitationScreen';
import { MemberRecordsProvider } from './MemberRecordsProvider';

const mockNavigate = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ navigate: mockNavigate, setOptions: jest.fn(), setParams: jest.fn() }),
  useIsFocused: () => true,
  useFocusEffect: (effect: () => void) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('expo-file-system', () => jest.requireActual('../../testSupport/documentFiles').nativeFileSystem);
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
const api = { get: jest.mocked(apiClient.get), post: jest.mocked(apiClient.post) };
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
});
afterEach(async () => {
  jest.useRealTimers();
  await cleanup();
  client.clear();
  resetFiles();
});
const page = (results: unknown[]) => ({ data: { results, next: null, count: results.length } });
const OTHER_CODE = 'B'.repeat(43);
const PROFILE = {
  uuid: 'profile-one',
  email: 'member@example.test',
  fullName: 'Synthetic Profile Person',
  residentialAddress: 'Synthetic personal address',
  citizenshipCountryName: 'Australia',
  isIdVerified: true,
  dateJoined: '2026-10-01T00:00:00Z',
  lastLogin: '2026-10-30T00:00:00Z',
};
const OTHER_MEMBER = '25252525-2525-4525-8525-252525252525';
const PAST_RECORD = {
  ...MEMBER_RECORD,
  uuid: '13131313-1313-4313-8313-131313131313',
  company: { uuid: '14141414-1414-4414-8414-141414141414', name: 'Alpha Former Company', acn: '987654321' },
  member: '15151515-1515-4515-8515-151515151515',
  classes: [
    { ...MEMBER_RECORD.classes[0], uuid: '16161616-1616-4616-8616-161616161616', shares: '0', ceasedOn: '2026-03-31' },
  ],
  awards: [],
};
const OWNED_RECORD = {
  ...MEMBER_RECORD,
  ownership: {
    company: MEMBER_RECORD.company.uuid,
    companyName: MEMBER_RECORD.company.name,
    asAt: '2026-10-31T00:00:00Z',
    complete: true,
    issuedSupply: '40',
    totalHolders: 3,
    classes: [
      {
        uuid: MEMBER_RECORD.classes[0].uuid,
        name: MEMBER_RECORD.classes[0].name,
        symbol: MEMBER_RECORD.classes[0].symbol,
        tokenType: 'ordinary',
        issuedSupply: '40',
        initialized: true,
        totalHolders: 3,
        ownShares: '10',
        recordedAt: '2026-10-30T00:00:00Z',
        sequence: 1,
      },
    ],
  },
};
const SECOND_ENTRY = {
  ...MEMBER_ENTRY,
  uuid: '19191919-1919-4919-8919-191919191919',
  sequence: 2,
  kind: 'TRANSFER',
  delta: '5',
};
const CLAIM = {
  uuid: '1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a',
  category: 'professional_investor',
  categoryDisplay: 'Professional investor',
  status: 'submitted',
  statusDisplay: 'Submitted',
  isExpired: false,
  submittedAt: '2026-10-31T00:00:00Z',
  reviewedAt: null,
  expiresAt: null,
  rejectionReason: '',
  createdAt: '2026-10-31T00:00:00Z',
};
const PAYSLIP = {
  uuid: '1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b',
  documentType: 'payslip',
  originalFilename: 'november.pdf',
  classification: null,
  retentionUntil: '2026-12-01T00:00:00Z',
  createdAt: '2026-11-01T00:00:00Z',
  latestExtraction: { status: 'running' },
};
const PICKED = 'file:///private/tmp/org.example.ledova-Inbox/';
const picked = (name: string, mimeType: string) => async () => {
  new File(`${PICKED}${name}`).write(new Uint8Array([37, 80, 68, 70]));
  return { canceled: false as const, assets: [{ uri: `${PICKED}${name}`, name, mimeType, size: 4, lastModified: 0 }] };
};

it('associates a member by invitation code, switches to their company on Dashboard with its shared ownership, class and awards, keeps an interrupted acceptance recoverable across screens, opens its certificate records but none from another company for an ended association, shows how the company records them on Profile, refuses cached records after current read loss, routes each notification to its page and an old certificate notice nowhere, saves an eligibility claim only with accepted evidence in the session that picked it, whose copy is removed after saving and on a session change, and uploads a payslip only in the session that picked it, removing its copy, then stops checking its extraction after a session change', async () => {
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'investor' } };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  let ownRecord: OwnMemberRecord = OWNED_RECORD;
  let associated = false;
  let refused = false;
  let claims: Record<string, unknown>[] = [];
  let documents: Record<string, unknown>[] = [];
  api.get.mockReset().mockImplementation(async (url) => {
    if (url === '/api/user-preferences/') return { data: preferences };
    if (url === CLAIMS.BASE) return page(claims);
    if (url === DOCUMENTS.BASE) return page(documents);
    if (url === DOCUMENTS.DETAIL(PAYSLIP.uuid)) return { data: PAYSLIP };
    if (url === USER_PROFILE_ENDPOINTS.BASE) return page([PROFILE]);
    if (url === URLS.MEMBER_ASSOCIATIONS) return page([]);
    if (url === URLS.MEMBER_RECORDS) {
      if (refused) throw Object.assign(new Error('Current member access refused'), { response: { status: 404 } });
      return page(associated ? [PAST_RECORD, ownRecord] : []);
    }
    if (url === URLS.MEMBER_RECORD(MEMBER_RECORD.uuid)) return { data: ownRecord };
    if (url === URLS.MEMBER_ENTRIES(MEMBER_RECORD.uuid))
      return { data: { entries: [{ ...MEMBER_ENTRY, companyEventOn: null }, SECOND_ENTRY] } };
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockReset().mockImplementation(async (url, value, options) => {
    const body = value as Record<string, string>;
    if (url === CLAIMS.BASE) {
      claims = [CLAIM];
      return { data: CLAIM };
    }
    if (url === DOCUMENTS.BASE) {
      if (options?.ledovaSessionEpoch !== getSessionEpoch()) throw new Error('The saved session changed.');
      documents = [PAYSLIP];
      return { data: PAYSLIP };
    }
    if (url === URLS.MEMBER_INVITATION_PREVIEW) {
      const other = body.code === OTHER_CODE;
      return {
        data: {
          company: { uuid: MEMBER_RECORD.company.uuid, name: MEMBER_RECORD.company.name },
          member: { uuid: other ? OTHER_MEMBER : MEMBER_RECORD.member, name: MEMBER_RECORD.name },
          intendedEmail: 'member@example.test',
          acceptanceDeadline: '2026-11-30T00:00:00Z',
          status: associated && !other ? 'accepted' : 'pending',
        },
      };
    }
    if (url === URLS.MEMBER_INVITATION_ACCEPT) {
      associated = true;
      if (
        body.code === OTHER_CODE &&
        api.post.mock.calls.filter(
          ([target, sent]) => target === url && (sent as Record<string, string>).code === OTHER_CODE,
        ).length === 1
      )
        throw new Error('Synthetic interrupted acceptance receipt');
      return {
        data: {
          uuid: MEMBER_RECORD.uuid,
          company: MEMBER_RECORD.company.uuid,
          member: MEMBER_RECORD.member,
          userAccount: body.userAccount,
          invitation: 'invite-one',
          current: true,
        },
      };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <MemberRecordsProvider>{children}</MemberRecordsProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
  const dashboard = <DashboardScreen route={{ key: 'dashboard', name: 'Dashboard', params: undefined }} />;
  const view = await render(dashboard, { wrapper });
  await fireEvent.press(await screen.findByRole('button', { name: 'Accept an invitation' }));
  expect(mockNavigate).toHaveBeenCalledWith('Invitation');
  await view.rerender(<InvitationScreen />);
  await fireEvent.changeText(
    screen.getByLabelText('Link or code from the email'),
    ` https://ledova.example/member-invitation#${MEMBER_CODE} `,
  );
  expect(await screen.findByText(MEMBER_RECORD.company.name)).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Accept invitation' }));
  expect(await screen.findByText('Invitation accepted. Your company records are available.')).toBeTruthy();
  await view.rerender(dashboard);
  expect(await screen.findByLabelText('Your issued shares: 0')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Switch company' }));
  expect(screen.getByRole('button', { name: `${PAST_RECORD.company.name}, Member` })).toBeSelected();
  await fireEvent.press(screen.getByRole('button', { name: `${MEMBER_RECORD.company.name}, Member` }));
  expect(await screen.findByLabelText('Issued shares: 40')).toBeTruthy();
  expect(screen.getByLabelText('Your shares: 10')).toBeTruthy();
  expect(screen.getByLabelText('Current shareholders: 3')).toBeTruthy();
  expect(screen.getByText('100.00%')).toBeTruthy();
  expect(screen.getByText('You: 10')).toBeTruthy();
  await view.rerender(<InvitationScreen />);
  await fireEvent.changeText(screen.getByLabelText('Link or code from the email'), OTHER_CODE);
  const acceptOther = await screen.findByRole('button', { name: 'Accept invitation' });
  expect(screen.queryByText('Invitation accepted. Your company records are available.')).toBeNull();
  await fireEvent.press(acceptOther);
  await screen.findByRole('button', { name: 'Retry original member action' });
  await view.rerender(
    <CertificatesScreen route={{ key: 'past', name: 'Certificates', params: { record: PAST_RECORD.uuid } }} />,
  );
  expect(screen.getByText('Retry or finish your pending request before opening this company.')).toBeTruthy();
  expect(screen.queryByText('Certificate records')).toBeNull();
  await view.rerender(dashboard);
  await fireEvent.press(await screen.findByRole('button', { name: 'Retry original member action' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Retry original member action' })).toBeNull());
  const acceptances = api.post.mock.calls.filter(([url]) => url === URLS.MEMBER_INVITATION_ACCEPT);
  expect(acceptances).toHaveLength(3);
  expect(acceptances[1][1]).toEqual(acceptances[2][1]);
  await fireEvent.press(
    await screen.findByRole('button', {
      name: 'Explore Ordinary (ORD), 40 issued shares, 100.00% of company issued shares, You: 10',
    }),
  );
  expect(screen.getByLabelText('Your share of this class: 25.00%')).toBeTruthy();
  const record = MEMBER_RECORD.uuid;
  const token = MEMBER_RECORD.classes[0].uuid;
  await fireEvent.press(screen.getByRole('button', { name: 'Certificates' }));
  expect(mockNavigate).toHaveBeenCalledWith('Certificates', { record, token });
  const certificatesPage = (
    <CertificatesScreen route={{ key: 'certificates', name: 'Certificates', params: { record, token } }} />
  );
  const profile = <SettingsScreen />;
  ownRecord = {
    ...OWNED_RECORD,
    awards: [
      {
        ...MEMBER_RECORD.awards[0],
        shares: '20',
        vestedShares: '6',
        issuedShares: '1',
        availableShares: '2',
        endedUnvestedShares: '4',
        endedVestedShares: '3',
        unvestedRemainingShares: '10',
        remainingUnissuedShares: '12',
        vestings: [{ ...MEMBER_RECORD.awards[0].vestings[0], shares: '8' }],
        ends: [
          {
            uuid: 'own-end',
            unvestedShares: '4',
            vestedShares: '3',
            companyEventOn: '2026-10-03',
            reason: 'Company selected reduction',
            createdAt: '2026-10-05T00:00:00Z',
          },
        ],
        vestingReversals: [
          {
            uuid: 'own-reversal',
            vesting: MEMBER_RECORD.awards[0].vestings[0].uuid,
            reversedShares: '2',
            companyEventOn: '2026-10-04',
            reason: 'Correct recorded quantity',
            createdAt: '2026-10-05T00:00:00Z',
          },
        ],
      },
    ],
  };
  await act(async () => screen.getByTestId('dashboard-scroll').props.refreshControl.props.onRefresh());
  await screen.findByLabelText('Vested rights ended: 3 shares');
  expect(screen.getByText('20 shares promised')).toBeTruthy();
  expect(screen.getByLabelText('Issued from award: 1 share')).toBeTruthy();
  expect(screen.getByLabelText('Vested, awaiting issue: 2 shares')).toBeTruthy();
  expect(screen.getByLabelText('Unvested: 10 shares')).toBeTruthy();
  expect(screen.getByLabelText('Unvested rights ended: 4 shares')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Show award details' }));
  expect(screen.getByText('2 October 2026 · 8 recorded vested')).toBeTruthy();
  expect(
    screen.getByText('3 October 2026 · 4 unvested and 3 vested unissued rights ended · Company selected reduction'),
  ).toBeTruthy();
  expect(
    screen.getByText('4 October 2026 · 2 vesting reversed · from 8 vested 2 October 2026 · Correct recorded quantity'),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Download.*(entitlement|correction)/ })).toBeNull();
  ownRecord = MEMBER_RECORD;
  await view.rerender(certificatesPage);
  expect(await screen.findByText('Transfer · ORD · entry 2')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /Filters|Request certificate|Withdraw request|Share PDF/ })).toBeNull();
  await view.rerender(
    <CertificatesScreen
      route={{ key: 'ended', name: 'Certificates', params: { record: 'ended-association', token } }}
    />,
  );
  expect(await screen.findByText('This company no longer records you as a member.')).toBeTruthy();
  expect(screen.queryByText('Certificate records')).toBeNull();
  await view.rerender(profile);
  expect(await screen.findByLabelText(`Name: ${MEMBER_RECORD.name}`)).toBeTruthy();
  expect(screen.getByText(`How ${MEMBER_RECORD.company.name} records you`)).toBeTruthy();
  expect(screen.getByLabelText(`Residential address: ${MEMBER_RECORD.residentialAddress}`)).toBeTruthy();
  expect(screen.getByText('Wrong? Contact the company.')).toBeTruthy();
  await view.rerender(certificatesPage);
  await act(async () => screen.getByTestId('certificates-scroll').props.refreshControl.props.onRefresh());
  expect(await screen.findByText('Transfer · ORD · entry 2')).toBeTruthy();
  refused = true;
  await act(async () => {
    await client.refetchQueries({
      queryKey: ['member-records', 'profile-one', 'account-one', getSessionEpoch()],
      exact: true,
    });
  });
  await waitFor(() => expect(screen.queryByText('Certificate records')).toBeNull());
  expect(screen.queryByText('Transfer · ORD · entry 2')).toBeNull();
  const notice = { type: PUBLICATION_NOTICE };
  expect(destinationOf(notice)).toEqual({ screen: 'Notices' });
  expect(destinationOf(notice)).not.toBe(destinationOf(notice));
  expect(destinationOf({ type: 'certificate', event: 'ready', company: MEMBER_RECORD.company.uuid })).toBeUndefined();
  const award = 'f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5';
  const vested = { type: 'award', event: 'vested', record: MEMBER_RECORD.uuid, award };
  expect(destinationOf(vested)).toEqual({
    screen: 'Dashboard',
    params: { record: MEMBER_RECORD.uuid, award },
    pop: true,
  });
  expect(destinationOf({ ...vested, award: undefined })).toBeUndefined();
  await view.rerender(<VerificationScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Submit evidence (Professional investor)' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save private evidence' }));
  expect(screen.getByText('Choose the evidence file.')).toBeTruthy();
  jest
    .mocked(getDocumentAsync)
    .mockImplementationOnce(picked('notes.txt', 'text/plain'))
    .mockImplementation(picked('licence.pdf', 'application/pdf'));
  await fireEvent.press(screen.getByRole('button', { name: 'Choose evidence file' }));
  expect(await screen.findByText('Choose a PDF, PNG or JPEG of up to 10 MB.')).toBeTruthy();
  expect(new File(`${PICKED}notes.txt`).info().exists).toBe(false);
  await fireEvent.press(screen.getByRole('button', { name: 'Choose evidence file' }));
  expect(await screen.findByText('licence.pdf')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText('Basis for the claim'), 'Synthetic AFS licence');
  await fireEvent.press(
    screen.getByRole('checkbox', {
      name: 'I declare that this category applies to me and that the evidence attached is genuine.',
    }),
  );
  const append = jest.spyOn(FormData.prototype, 'append');
  await fireEvent.press(screen.getByRole('button', { name: 'Save private evidence' }));
  expect(await screen.findByText('Available to share')).toBeTruthy();
  expect(append).toHaveBeenCalledWith('evidence_file', {
    uri: `${PICKED}licence.pdf`,
    name: 'licence.pdf',
    type: 'application/pdf',
  });
  const [, sent, options] = api.post.mock.calls.find(([url]) => url === CLAIMS.BASE)!;
  expect((sent as FormData).get('declared_basis')).toBe('Synthetic AFS licence');
  expect(options).toMatchObject({ ledovaSessionEpoch: getSessionEpoch() });
  expect(new File(`${PICKED}licence.pdf`).info().exists).toBe(false);
  const pickedIn = getSessionEpoch();
  jest
    .mocked(getDocumentAsync)
    .mockImplementationOnce(picked('october.pdf', 'application/pdf'))
    .mockImplementationOnce(picked('november.pdf', 'application/pdf'));
  await fireEvent.press(screen.getByRole('button', { name: 'Upload a payslip' }));
  await fireEvent.press(screen.getByRole('button', { name: 'File' }));
  expect(await screen.findByText('october.pdf')).toBeTruthy();
  await act(async () => invalidateSessionScope());
  expect(new File(`${PICKED}october.pdf`).info().exists).toBe(false);
  await fireEvent.press(screen.getByRole('button', { name: 'Upload and extract' }));
  expect(await screen.findByText('The payslip could not be uploaded.')).toBeTruthy();
  expect(api.post.mock.calls.find(([url]) => url === DOCUMENTS.BASE)?.[2]).toMatchObject({
    ledovaSessionEpoch: pickedIn,
  });
  await fireEvent.press(screen.getByRole('button', { name: 'File' }));
  expect(await screen.findByText('november.pdf')).toBeTruthy();
  jest.useFakeTimers();
  await fireEvent.press(screen.getByRole('button', { name: 'Upload and extract' }));
  expect(await screen.findByText('Extracting…')).toBeTruthy();
  expect(append).toHaveBeenCalledWith('file', {
    uri: `${PICKED}november.pdf`,
    name: 'november.pdf',
    type: 'application/pdf',
  });
  expect(new File(`${PICKED}november.pdf`).info().exists).toBe(false);
  const polls = () => api.get.mock.calls.filter(([url]) => url === DOCUMENTS.DETAIL(PAYSLIP.uuid)).length;
  const polled = polls();
  await act(async () => jest.advanceTimersByTimeAsync(3000));
  expect(polls()).toBeGreaterThan(polled);
  await fireEvent.press(screen.getByRole('button', { name: 'Add evidence (Professional investor)' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Choose evidence file' }));
  expect(await screen.findByText('licence.pdf')).toBeTruthy();
  await act(async () => invalidateSessionScope());
  expect(new File(`${PICKED}licence.pdf`).info().exists).toBe(false);
  const ended = polls();
  await act(async () => jest.advanceTimersByTimeAsync(9000));
  expect(polls()).toBe(ended);
});
