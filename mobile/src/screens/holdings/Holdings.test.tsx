import {
  ApiClientProvider,
  AUTH_QUERY_KEY,
  COMPANY_AUTHORITY_DECLARATION,
  COMPANY_AUTHORITY_DECLARATION_VERSION,
  COMPANY_ENDPOINTS,
  COMPANY_SIGNUP_DECLARATION,
  COMPANY_SIGNUP_DECLARATION_VERSION,
  COMPANY_TOKEN_ENDPOINTS as URLS,
  REGISTER_ALLOTMENT_COPY,
  REGISTER_AWARD_COPY,
  REGISTER_CORRECTION_COPY,
  REGISTER_GRANT_COPY,
  REGISTER_IMPORT_COPY,
  REGISTER_TRANSFER_COPY,
  USER_PREFERENCES_QUERY_KEY,
  USER_PROFILE_ENDPOINTS,
  TECHNICAL_SHARE_LIMIT,
  formatDate,
  formatShortDate,
  ownAppointmentsKey,
  ownershipCompaniesKey,
  sydneyToday,
  utcToday,
  type ClassRightsRequest,
  type ClassRightsRevision,
  type CompanyAuthorityRequest,
  type CompanyTeamAppointment,
  type OwnCompanyAppointment,
  type OwnMemberRecord,
  type RegisterAllotment,
  type RegisterAllotmentDecideRequest,
  type RegisterAllotmentDecisionRequest,
  type RegisterAllotmentPreparation,
  type RegisterAward,
  type RegisterAwardPreparation,
  type RegisterAwardVesting,
  type RegisterAwardVestingPreparation,
  type RegisterCorrection,
  type RegisterCorrectionPreparation,
  type RegisterDecideRequest,
  type RegisterEntry,
  type RegisterGrant,
  type RegisterGrantPreparation,
  type RegisterImport,
  type RegisterImportPreparation,
  type RegisterMemberDocumentRequest,
  type RegisterParticularsChange,
  type RegisterTransfer,
  type RegisterTransferDecideRequest,
  type RegisterTransferDecisionRequest,
  type RegisterTransferPreparation,
  type TokenCreate,
} from '@ledova/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { AxiosInstance } from 'axios';
import * as Sharing from 'expo-sharing';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { MemberRecordsProvider } from '../../contexts';
import { AppMenu } from '../../navigation/AppMenu';
import { apiClient } from '../../services/apiClient';
import { getSessionEpoch } from '../../services/sessionScope';
import { REGISTER, awardFrom, vestingFrom } from '../../../../packages/shared/tests/fixtures/employee-awards';
import {
  allotmentDecision,
  allotmentFrom,
  allotmentPreview,
} from '../../../../packages/shared/tests/fixtures/external-allotments';
import { MEMBER_CODE, MEMBER_ENTRY, MEMBER_RECORD } from '../../../../packages/shared/tests/fixtures/member-access';
import { TRANSFER } from '../../../../packages/shared/tests/fixtures/register-transfers';
import { destinationOf } from '../../components/notifications/NotificationsPanel';
import { CertificatesScreen } from '../documents/CertificatesScreen';
import { CompanyPackScreen } from '../documents/CompanyPackScreen';
import { InspectionCopiesScreen } from '../documents/InspectionCopiesScreen';
import { CorrectionPreparationScreen } from '../ledger/CorrectionPreparationScreen';
import { CorrectionsScreen } from '../ledger/CorrectionsScreen';
import { IssueSharesScreen } from '../ledger/IssueSharesScreen';
import { LedgerScreen } from '../ledger/LedgerScreen';
import { RegisterSetupScreen } from '../ledger/RegisterSetupScreen';
import { ShareClassScreen } from '../ledger/ShareClassScreen';
import { TransferPreparationScreen } from '../ledger/TransferPreparationScreen';
import { TransferSharesScreen } from '../ledger/TransferSharesScreen';
import { AuthorityRequestScreen } from '../settings/AuthorityRequestScreen';
import { AuthorityScreen } from '../settings/AuthorityScreen';
import { TeamScreen } from '../settings/TeamScreen';
import { EmployeeAwardScreen } from '../shareholders/EmployeeAwardScreen';
import { EmployeeSchemeScreen } from '../shareholders/EmployeeSchemeScreen';
import { MemberAccessScreen } from '../shareholders/MemberAccessScreen';
import { ShareholderScreen } from '../shareholders/ShareholderScreen';
import { ShareholdersScreen } from '../shareholders/ShareholdersScreen';
import { DashboardScreen } from './DashboardScreen';
import { InvitationScreen } from './InvitationScreen';

const mockNavigate = jest.fn();
const mockSetParams = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({
    navigate: mockNavigate,
    popTo: mockNavigate,
    replace: mockNavigate,
    getState: () => ({ routes: [] }),
    setOptions: jest.fn(),
    setParams: mockSetParams,
  }),
  useIsFocused: () => true,
  useFocusEffect: (effect: () => void) =>
    jest.requireActual<typeof import('react')>('react').useEffect(effect, [effect]),
}));
jest.mock('../../components/AnchoredPanel', () => ({
  ...jest.requireActual('../../components/AnchoredPanel'),
  useAnchor: () => (button: unknown, open: (anchor: { top: number; right: number }) => void) =>
    button && open({ top: 0, right: 0 }),
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn(async () => true), shareAsync: jest.fn(async () => {}) }));
jest.mock('expo-crypto', () => {
  let count = 0;
  return { randomUUID: () => `00000000-0000-4000-8000-${String((count += 1)).padStart(12, '0')}` };
});
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    exists = false;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = parts.map((part) => (typeof part === 'string' ? part : part.uri)).join('/');
    }
    list() {
      return [];
    }
  }
  class File extends Directory {
    static pickFileAsync = async () => ({ uri: 'file:///picked/synthetic.pdf' });
    type = 'application/pdf';
    size = 4;
    get name() {
      return this.uri.split('/').pop() ?? '';
    }
    create() {}
    write() {}
  }
  return { Directory, File, Paths: { cache: new Directory('file:///cache'), document: new Directory('file:///docs') } };
});
jest.mock('../../services/apiClient', () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
const api = { get: jest.mocked(apiClient.get), post: jest.mocked(apiClient.post) };
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: 0 } },
});
afterEach(async () => {
  await cleanup();
  client.clear();
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
const ADMINISTERED = {
  uuid: '26262626-2626-4626-8626-262626262626',
  name: 'Synthetic Administered Company',
  isOwner: true,
  status: 'active',
  administrativeAccess: { capabilities: ['admin'], draftSetup: false },
};
const FOUNDERS = { uuid: '27272727-2727-4727-8727-272727272727', name: 'Founders', symbol: 'FND' };
const ELSEWHERE = { uuid: '41414141-4141-4141-8141-414141414141', name: 'Elsewhere', symbol: 'ELS' };
const ELSEWHERE_COMPANY = '42424242-4242-4242-8242-424242424242';
const HOLDERS = Array.from({ length: 26 }, (_, index) => ({
  member: `holder-${index + 1}`,
  name: `Synthetic Holder ${index + 1}`,
  balance: index === 0 ? '5' : '1',
  percentage: '0',
}));
const HOLDER_A = {
  member: '35353535-3535-4535-8535-353535353535',
  name: 'Synthetic Holder A',
  balance: '5',
  percentage: 62.5,
  enteredOn: '2026-10-26',
  holderType: 'member' as const,
  identitySource: 'recorded',
  shareClass: FOUNDERS.uuid,
  source: 'register',
  wallets: [],
};
const HOLDER_B = { ...HOLDER_A, member: '36363636-3636-4636-8636-363636363636', name: 'Synthetic Holder B' };
const HOLDER_C = {
  ...HOLDER_A,
  member: '44444444-4444-4444-8444-444444444444',
  name: 'Synthetic Holder C',
  balance: '1',
  percentage: 11.11,
};
const LINK = {
  uuid: '37373737-3737-4737-8737-373737373737',
  company: ADMINISTERED.uuid,
  member: HOLDER_A.member,
  acceptedEmail: 'holder-a@example.test',
  createdAt: '2026-10-27T00:00:00Z',
  current: true,
  invitation: '38383838-3838-4838-8838-383838383838',
  user: 2,
  userAccount: '39393939-3939-4939-8939-393939393939',
};
const LINKS = [
  LINK,
  {
    ...LINK,
    uuid: '40404040-4040-4040-8040-404040404040',
    member: HOLDER_B.member,
    acceptedEmail: 'holder-b@example.test',
  },
];
const APPOINTMENTS = '/api/v1/company-authority/appointments/';
const ADMINISTRATION: OwnCompanyAppointment = {
  uuid: '28282828-2828-4828-8828-282828282828',
  company: ADMINISTERED.uuid,
  companyName: ADMINISTERED.name,
  companyStatus: 'active',
  companyStatusDisplay: 'Active',
  capabilities: ['admin'],
  delegatableCapabilities: [],
  status: 'active',
  isEffective: true,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  source: 'legacy_owner',
  declarationText: null,
  declarationVersion: null,
  signupTerms: null,
};
const READER: CompanyTeamAppointment = {
  uuid: '29292929-2929-4929-8929-292929292929',
  company: ADMINISTERED.uuid,
  name: 'Synthetic Register Reader',
  email: 'reader@example.test',
  capabilities: ['read_register'],
  delegatableCapabilities: [],
  status: 'active',
  isEffective: true,
  expiresAt: null,
  revokedAt: null,
  createdAt: '2026-10-20T00:00:00Z',
  source: 'invitation',
};
const REVOKED = { status: 'revoked' as const, revokedAt: '2026-11-03T00:00:00Z', isEffective: false };
const AUTHORITY_REQUESTS = '/api/v1/company-authority/requests/';
const IDENTITY = { name: ADMINISTERED.name, acn: '992000021', abn: '', companyType: 'pty' as const };
const PERSON = { userId: 1, profileUuid: 'profile-one', email: PROFILE.email, fullName: PROFILE.fullName };
const ADMITTED: CompanyAuthorityRequest = {
  uuid: '30303030-3030-4030-8030-303030303030',
  company: ADMINISTERED.uuid,
  requesterProfile: 'profile-one',
  idempotencyKey: '31313131-3131-4131-8131-313131313131',
  purpose: 'initial',
  companyIdentityRaw: IDENTITY,
  companyIdentity: IDENTITY,
  personIdentityRaw: PERSON,
  personIdentity: PERSON,
  requestedCapabilities: ['admin'],
  delegatableCapabilities: [],
  requestedExpiresAt: null,
  originalFilename: '',
  fileSize: 0,
  mimeType: '',
  fileSha256: '',
  requestDigest: 'synthetic-digest',
  createdAt: '2026-10-27T00:00:00Z',
  fileUrl: null,
  status: 'admitted',
  withdrawnAt: null,
  verificationStatus: 'self_declared',
  verificationMessage: 'Authorisation declared by the company representative.',
  appointment: {
    uuid: '32323232-3232-4232-8232-323232323232',
    capabilities: ['admin'],
    delegatableCapabilities: [],
    expiresAt: null,
    createdAt: '2026-10-27T00:00:00Z',
    revokedAt: null,
    status: 'active',
    isEffective: true,
    declarationVersion: COMPANY_SIGNUP_DECLARATION_VERSION,
    declarationText: COMPANY_SIGNUP_DECLARATION,
  },
};
const PENDING: CompanyAuthorityRequest = {
  ...ADMITTED,
  uuid: '33333333-3333-4333-8333-333333333333',
  companyIdentityRaw: { ...IDENTITY, name: 'Synthetic Draft Company' },
  status: 'pending',
  verificationStatus: 'unavailable',
  appointment: null,
};
const CERTIFIED: RegisterEntry = {
  uuid: '34343434-3434-4434-8434-343434343434',
  sequence: 13,
  kind: 'issue',
  companyEventOn: '2026-10-26',
  effectiveOn: '2026-10-26',
  recordedAt: '2026-10-26T00:00:00Z',
  corrects: null,
  correctedBy: null,
  correctable: true,
  changes: [{ member: 'holder-1', name: 'Synthetic Holder 1', shares: '5' }],
};
const DIGEST = 'b'.repeat(64);
const correctionFrom = ({
  operationId,
  correctsId,
  appointment,
  ...request
}: RegisterCorrectionPreparation): RegisterCorrection => ({
  ...request,
  uuid: operationId,
  company: ADMINISTERED.uuid,
  register: FOUNDERS.uuid,
  corrects: correctsId,
  changes: CERTIFIED.changes.map(({ member, shares }) => ({ member, shares: String(-BigInt(shares)) })),
  approvingDirector: request.approvingDirector ?? '',
  preparingAppointment: appointment,
  preparedByName: 'Synthetic Preparer',
  providedBy: 'company',
  status: 'submitted',
  stage: 'submitted',
  decisions: [],
  baseHash: 'a'.repeat(64),
  baseSequence: 13,
  appliedEntry: null,
  evidenceFingerprint: 'a'.repeat(64),
  evidenceSnapshot: {},
  sourceDocument: null,
  rejectionReason: '',
  reviewedAt: null,
  reviewedBy: null,
  submittedBy: 1,
  createdAt: '2026-11-04T05:00:00Z',
});
const OPENING: RegisterImport = {
  uuid: '49494949-4949-4949-8949-494949494949',
  company: ADMINISTERED.uuid,
  token: FOUNDERS.uuid,
  asAt: '2026-10-26',
  members: [
    {
      member: HOLDER_A.member,
      name: HOLDER_A.name,
      residentialAddress: `${HOLDER_A.name} address`,
      shares: '5',
      enteredOn: '2026-10-26',
      amountPaid: null,
    },
  ],
  formerMembers: [],
  approvingDirector: 'Synthetic Director',
  authority: 'director_resolution',
  authorityReference: 'Synthetic opening minute',
  reason: 'Opening records',
  sourceReference: '',
  sourceConfirmed: false,
  sourceDocument: null,
  registerEvidence: null,
  registerSequence: null,
  asicDocument: null,
  asicEvidence: null,
  asicFingerprint: '',
  asicIssuedTotal: null,
  asicMemberCount: null,
  asicSnapshot: {},
  correctionAllowed: false,
  correctionOf: null,
  decisions: [],
  evidenceFingerprint: '',
  evidenceSnapshot: {},
  preparedByName: 'Synthetic Preparer',
  preparingAppointment: ADMINISTRATION.uuid,
  providedBy: 'company',
  rejectionReason: '',
  reviewedAt: null,
  reviewedBy: null,
  status: 'submitted',
  stage: 'submitted',
  submittedBy: 1,
  createdAt: '2026-10-26T00:00:00Z',
};
const PREFERENCE = { uuid: '53535353-5353-4353-8353-535353535353', name: 'Preference shares', symbol: 'PRF' };
const importFrom = ({
  operationId,
  tokenId,
  appointment,
  members,
  registerEvidence,
  asicEvidence,
  asicIssuedTotal,
  asicMemberCount,
  correctionOf,
  ...request
}: RegisterImportPreparation): RegisterImport => ({
  ...OPENING,
  ...request,
  uuid: operationId,
  token: tokenId,
  preparingAppointment: appointment,
  members: members.map(({ documents, ...member }) => ({
    ...member,
    amountPaid: null,
    ...(documents && {
      documents: documents.map((document) => ({
        ...document,
        snapshot: {
          evidence: document.evidence,
          company: ADMINISTERED.uuid,
          documentType: 'supporting',
          providedBy: 'company',
          name: 'synthetic.pdf',
          fileSize: 4,
          mimeType: 'application/pdf',
          sha256: 'a'.repeat(64),
        },
      })),
    }),
  })),
  registerEvidence: registerEvidence ?? null,
  asicEvidence: asicEvidence ?? null,
  asicIssuedTotal: asicIssuedTotal ?? null,
  asicMemberCount: asicMemberCount ?? null,
  correctionOf: correctionOf ?? null,
  authority: 'company_records',
  authorityReference: request.sourceReference,
  approvingDirector: '',
  createdAt: '2026-11-04T08:00:00Z',
});
const PARTICULARS_EDIT: RegisterParticularsChange = {
  uuid: '50505050-5050-4050-8050-505050505050',
  company: ADMINISTERED.uuid,
  member: HOLDER_A.member,
  name: HOLDER_A.name,
  residentialAddress: `${HOLDER_A.name} new address`,
  asAt: '2026-10-28',
  reason: '',
  previousParticulars: { name: HOLDER_A.name, residentialAddress: `${HOLDER_A.name} address`, asAt: '2026-10-26' },
  preparingAppointment: ADMINISTRATION.uuid,
  preparedByName: 'Synthetic Preparer',
  providedBy: 'company',
  status: 'applied',
  stage: 'applied',
  decisions: [],
  evidenceFingerprint: '',
  evidenceSnapshot: {},
  supportingEvidence: null,
  rejectionReason: '',
  reviewedAt: '2026-10-28T00:00:00Z',
  reviewedBy: 1,
  submittedBy: 1,
  createdAt: '2026-10-28T00:00:00Z',
};
const SECOND_ENTRY = {
  ...MEMBER_ENTRY,
  uuid: '19191919-1919-4919-8919-191919191919',
  sequence: 2,
  kind: 'TRANSFER',
  delta: '5',
};

it('associates a member by invitation code, switches to their company on Dashboard with its shared ownership, class and awards, keeps an interrupted acceptance recoverable across screens, opens its certificate records but none from another company for an ended association, reads no company register without register access, lists and opens an administered company’s overview with its paged shareholders, reads its team only with current administration and revokes only the confirmed appointment, opens a representative authority request from its list and revokes only that request’s appointment after its confirmation, establishes a pending request’s appointment only once its declaration is ticked, offers and reads company documents, shareholders and member access only with register access, prepares each document for only the chosen entry, class or company, reporting a share sheet that cannot open, lists the company’s shareholders and opens one, revokes only the confirmed person’s member access, refuses cached records after current read loss, and routes each notification to its page and an old certificate or publication notice nowhere', async () => {
  const preferences = { userProfile: 'profile-one', userAccount: { uuid: 'account-one', role: 'investor' } };
  client.setQueryData(AUTH_QUERY_KEY, { data: { valid: true } });
  client.setQueryData(USER_PREFERENCES_QUERY_KEY, { data: preferences });
  let ownRecord: OwnMemberRecord = OWNED_RECORD;
  let associated = false;
  let refused = false;
  let administered = false;
  let appointed = false;
  let own = ADMINISTRATION;
  let revoked = false;
  let revokedLink = '';
  let awards: RegisterAward[] = [];
  let vestings: RegisterAwardVesting[] = [];
  let rights: ClassRightsRevision[] = [];
  let thirdHolder = false;
  let allotments: RegisterAllotment[] = [];
  let grants: RegisterGrant[] = [];
  let transfers: RegisterTransfer[] = [];
  let corrections: RegisterCorrection[] = [];
  let imports: RegisterImport[] = [OPENING];
  api.get.mockReset().mockImplementation(async (url, config) => {
    if (url === '/api/user-preferences/') return { data: preferences };
    if (url === USER_PROFILE_ENDPOINTS.BASE) return page([PROFILE]);
    if (url === COMPANY_ENDPOINTS.BASE) return page(administered ? [ADMINISTERED] : []);
    if (url === APPOINTMENTS) return page(appointed ? [own] : []);
    if (url === `${APPOINTMENTS}team/`) return { data: [revoked ? { ...READER, ...REVOKED } : READER] };
    if (url === '/api/v1/company-authority/invitations/') return page([]);
    if (url === AUTHORITY_REQUESTS) return page([PENDING, ADMITTED]);
    if (url === URLS.REGISTER) {
      const company = (config?.params as { company_uuid?: string } | undefined)?.company_uuid;
      const classes = [
        { ...FOUNDERS, companyUuid: ADMINISTERED.uuid, tokenTypeDisplay: 'Ordinary', totalSupply: '1000' },
        { ...ELSEWHERE, companyUuid: ELSEWHERE_COMPANY },
      ];
      return page(classes.filter((item) => !company || item.companyUuid === company));
    }
    if (url === URLS.HOLDERS(ELSEWHERE.uuid)) {
      const holders = [{ ...HOLDER_A, member: 'elsewhere-holder', name: 'Synthetic Elsewhere Holder', balance: '1' }];
      return { data: { ...REGISTER, token: { ...REGISTER.token, ...ELSEWHERE }, issuedSupply: '1', holders } };
    }
    if (url === URLS.HOLDERS(FOUNDERS.uuid)) {
      const holders = [HOLDER_A, { ...HOLDER_B, balance: '3', percentage: 37.5 }, ...(thirdHolder ? [HOLDER_C] : [])];
      const issuedSupply = thirdHolder ? '9' : '8';
      return {
        data: {
          ...REGISTER,
          token: { ...REGISTER.token, ...FOUNDERS },
          issuedSupply,
          totalHolders: holders.length,
          holders,
        },
      };
    }
    if (url === URLS.REGISTER_PEOPLE) return { data: { company: ADMINISTERED.uuid, members: [] } };
    if (url === URLS.HOLDERS(PREFERENCE.uuid)) {
      const token = { ...REGISTER.token, ...PREFERENCE, totalSupply: TECHNICAL_SHARE_LIMIT };
      return { data: { ...REGISTER, token, initialized: false, issuedSupply: null } };
    }
    if (url === URLS.REGISTER_MEMBERS(FOUNDERS.uuid) || url === URLS.REGISTER_MEMBERS(PREFERENCE.uuid)) {
      const members = [HOLDER_A, HOLDER_B].map(({ member, name }) => ({
        member,
        name,
        residentialAddress: `${name} address`,
        currentShares: '1',
        enteredOn: '2026-10-26',
        lastCeasedOn: null,
        walletless: true,
        particularsRetained: true,
      }));
      return { data: { members, awardRecipients: [] } };
    }
    if (url === URLS.REGISTER_AWARDS) {
      const { token, member } = (config?.params ?? {}) as { token?: string; member?: string };
      return page(awards.filter((award) => (!token || award.token === token) && (!member || award.member === member)));
    }
    if (awards.some((award) => url === URLS.REGISTER_AWARD(award.uuid)))
      return { data: awards.find((award) => url === URLS.REGISTER_AWARD(award.uuid)) };
    if (url === URLS.REGISTER_AWARD_VESTINGS) return page(vestings);
    if (url === URLS.REGISTER_AWARD_ENDS || url === URLS.REGISTER_AWARD_VESTING_REVERSALS) return page([]);
    if (url === URLS.REGISTER_GRANTS) return page(grants);
    if (url === URLS.REGISTER_ALLOTMENTS) return page(allotments);
    if (url === URLS.REGISTER_TRANSFERS) return page(transfers);
    if (url === URLS.REGISTER_CORRECTIONS) return page(corrections);
    if (url === URLS.REGISTER_IMPORTS) {
      const { token } = (config?.params ?? {}) as { token?: string };
      return page(imports.filter((proposal) => proposal.token === token));
    }
    if (url === URLS.REGISTER_PARTICULARS_CHANGES) return page([PARTICULARS_EDIT]);
    if (url === URLS.MEMBER_INVITATIONS) return page([]);
    if (url === URLS.REGISTER_ENTRIES(FOUNDERS.uuid)) return { data: { results: [CERTIFIED], next: null, count: 1 } };
    if (url === URLS.DETAIL(FOUNDERS.uuid)) {
      const company = { company: ADMINISTERED.uuid, companyUuid: ADMINISTERED.uuid, companyName: ADMINISTERED.name };
      return { data: { ...FOUNDERS, ...company, status: 'draft', tokenTypeDisplay: 'Ordinary', totalSupply: '1000' } };
    }
    if (url === URLS.CLASS_RIGHTS(FOUNDERS.uuid)) {
      const administrationAppointment = own.capabilities.includes('admin') ? own.uuid : null;
      return { data: { ...page(rights).data, previous: null, current: rights[0] ?? null, administrationAppointment } };
    }
    if (url === URLS.REGISTER_MEMBER_DOCUMENTS) return page([]);
    const preview = {
      token: FOUNDERS.uuid,
      appointment: ADMINISTRATION.uuid,
      registerSequence: 13,
      sourceDigest: DIGEST,
    };
    if (url === URLS.REGISTER_CERTIFICATE(FOUNDERS.uuid))
      return { data: { ...preview, entry: CERTIFIED.uuid, sequence: 13, pageCount: 1 } };
    if (url === URLS.REGISTER_INSPECTION_COPY(FOUNDERS.uuid)) return { data: preview };
    if (url === URLS.REGISTER_INSPECTION_COPIES(FOUNDERS.uuid)) return { data: { copies: [] } };
    if (url === COMPANY_ENDPOINTS.PACKS(ADMINISTERED.uuid)) return { data: { packs: [] } };
    if (url === URLS.OWNERSHIP) {
      const founders = { ...FOUNDERS, tokenType: 'ordinary', initialized: true, recordedAt: '2026-11-01T00:00:00Z' };
      const totals = { issuedSupply: '30', totalHolders: 26 };
      const classes = [{ ...founders, ...totals, sequence: 1 }];
      return { data: { company: ADMINISTERED.uuid, asAt: '2026-11-01T00:00:00Z', complete: true, ...totals, classes } };
    }
    if (url === URLS.OWNERSHIP_HOLDERS(FOUNDERS.uuid)) {
      const shown = (config?.params as { page: number }).page;
      const results = HOLDERS.slice((shown - 1) * 25, shown * 25);
      return { data: { count: 26, token: FOUNDERS.uuid, sequence: 1, issuedSupply: '30', results } };
    }
    if (url === URLS.MEMBER_ASSOCIATIONS)
      return page(LINKS.map((link) => ({ ...link, current: link.uuid !== revokedLink })));
    if (url === URLS.MEMBER_RECORDS) {
      if (refused) throw Object.assign(new Error('Current member access refused'), { response: { status: 404 } });
      return page(associated ? [PAST_RECORD, ownRecord] : []);
    }
    if (url === URLS.MEMBER_RECORD(MEMBER_RECORD.uuid)) return { data: ownRecord };
    if (url === URLS.MEMBER_ENTRIES(MEMBER_RECORD.uuid))
      return { data: { entries: [{ ...MEMBER_ENTRY, companyEventOn: null }, SECOND_ENTRY] } };
    throw new Error(`Unexpected GET ${url}`);
  });
  api.post.mockReset().mockImplementation(async (url, value) => {
    const body = value as Record<string, string>;
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
    if (url === URLS.REGISTER_EVIDENCE) {
      const field = (name: string) => String((value as FormData).getAll(name)[0]);
      return {
        data: {
          uuid: field('idempotency_key').replace(/^0{8}/, 'eeeeeeee'),
          company: field('company_id'),
          appointment: field('appointment'),
          kind: field('kind'),
          idempotencyKey: field('idempotency_key'),
          originalFilename: 'synthetic.pdf',
          fileSize: 4,
          mimeType: 'application/pdf',
          sha256: 'a'.repeat(64),
          providedBy: 'company',
          createdAt: '2026-11-04T00:00:00Z',
        },
      };
    }
    if (url === URLS.REGISTER_AWARDS) {
      const award = { ...awardFrom(value as RegisterAwardPreparation), company: ADMINISTERED.uuid };
      awards = [{ ...award, name: HOLDER_B.name, recipientName: HOLDER_B.name }];
      return { data: awards[0] };
    }
    if (url === URLS.REGISTER_AWARD_VESTINGS) {
      const vesting = { ...vestingFrom(value as RegisterAwardVestingPreparation), company: ADMINISTERED.uuid };
      vestings = [vesting];
      awards = awards.map((award) => ({
        ...award,
        vestedShares: vesting.shares,
        availableShares: vesting.shares,
        unvestedRemainingShares: String(BigInt(award.shares) - BigInt(vesting.shares)),
      }));
      return { data: vesting };
    }
    if (url === URLS.REGISTER_ALLOTMENTS) {
      const address = `${HOLDER_A.name} address`;
      const prepared = allotmentFrom(value as RegisterAllotmentPreparation);
      allotments = [{ ...prepared, company: ADMINISTERED.uuid, name: HOLDER_A.name, residentialAddress: address }];
      return { data: allotments[0] };
    }
    if (allotments[0] && url === URLS.REGISTER_ALLOTMENT_PREVIEW(allotments[0].uuid)) {
      const request = value as RegisterAllotmentDecisionRequest;
      const currentHolders = [HOLDER_A, { ...HOLDER_B, balance: '3' }].map(({ member, name, balance }) => ({
        member,
        name,
        shares: balance,
      }));
      return {
        data: {
          ...allotmentPreview(allotments[0]),
          completeIssue: !!request.completeIssue,
          applyAppointment: request.applyAppointment ?? null,
          className: FOUNDERS.name,
          classCode: FOUNDERS.symbol,
          currentHolders,
          currentShares: '5',
          afterShares: '7',
          issuedSupply: '8',
          afterIssuedSupply: '10',
        },
      };
    }
    if (allotments[0] && url === URLS.REGISTER_ALLOTMENT_DECIDE(allotments[0].uuid)) {
      allotments = [allotmentDecision(allotments[0], value as RegisterAllotmentDecideRequest)];
      return { data: allotments[0] };
    }
    if (url === URLS.REGISTER_GRANTS) {
      const { operationId, tokenId, ...request } = value as RegisterGrantPreparation;
      grants = [
        {
          ...request,
          uuid: operationId,
          company: ADMINISTERED.uuid,
          token: tokenId,
          award: request.award ?? null,
          name: HOLDER_B.name,
          residentialAddress: `${HOLDER_B.name} address`,
          acceptanceEvidence: request.acceptanceEvidence ?? null,
          preparingAppointment: request.appointment,
          providedBy: 'company',
          status: 'submitted',
          stage: 'submitted',
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
          createdAt: '2026-11-04T01:00:00Z',
        },
      ];
      return { data: grants[0] };
    }
    if (grants[0] && url === URLS.REGISTER_GRANT_PREVIEW(grants[0].uuid)) {
      const applying = (value as RegisterDecideRequest).kind === 'apply';
      return {
        data: {
          ...grants[0],
          effectiveOn: grants[0].companyEventOn,
          previewDigest: DIGEST,
          canDecide: true,
          unmetRequirements: [],
          registerSequence: 1,
          currentShares: '3',
          afterShares: applying ? '13' : '3',
          issuedSupply: '8',
          afterIssuedSupply: applying ? '18' : '8',
          authorisedSupply: '1000',
          awardPromisedShares: '40',
          awardVestedShares: '10',
          awardIssuedShares: '0',
          awardAvailableShares: '10',
        },
      };
    }
    if (grants[0] && url === URLS.REGISTER_GRANT_DECIDE(grants[0].uuid)) {
      const request = value as RegisterDecideRequest;
      const decidedAt = '2026-11-04T02:00:00Z';
      const decision = {
        uuid: request.idempotencyKey,
        appointment: request.appointment,
        kind: request.kind,
        digest: request.previewDigest,
        idempotencyKey: request.idempotencyKey,
        reason: request.reason ?? '',
        decidedAt,
        decidedBy: 1,
        decidedByName: PROFILE.fullName,
      };
      const applied =
        request.kind === 'apply'
          ? {
              status: 'applied' as const,
              registerEntry: '46464646-4646-4646-8646-464646464646',
              effectiveOn: grants[0].companyEventOn,
              reviewedAt: decidedAt,
              reviewedBy: 1,
            }
          : {};
      grants = [
        {
          ...grants[0],
          ...applied,
          stage: request.kind === 'apply' ? 'applied' : 'approved',
          decisions: [...grants[0].decisions, decision],
        },
      ];
      if (request.kind === 'apply')
        awards = awards.map((award) => ({
          ...award,
          issuedShares: '10',
          availableShares: '0',
          remainingUnissuedShares: '30',
        }));
      return { data: grants[0] };
    }
    if (url === URLS.REGISTER_TRANSFERS) {
      const { operationId, tokenId, appointment, ...request } = value as RegisterTransferPreparation;
      transfers = [
        {
          ...TRANSFER,
          ...request,
          uuid: operationId,
          company: ADMINISTERED.uuid,
          token: tokenId,
          preparingAppointment: appointment,
          fromName: HOLDER_A.name,
          fromResidentialAddress: `${HOLDER_A.name} address`,
          name: HOLDER_B.name,
          residentialAddress: `${HOLDER_B.name} address`,
          createdAt: '2026-11-04T03:00:00Z',
        },
      ];
      return { data: transfers[0] };
    }
    if (transfers[0] && url === URLS.REGISTER_TRANSFER_PREVIEW(transfers[0].uuid)) {
      const request = value as RegisterTransferDecisionRequest;
      return {
        data: {
          ...transfers[0],
          effectiveOn: transfers[0].companyEventOn,
          previewDigest: DIGEST,
          completeTransfer: request.completeTransfer === true,
          applyAppointment: request.applyAppointment ?? null,
          canDecide: true,
          unmetRequirements: [],
          registerSequence: 1,
          fromCurrentShares: '5',
          fromAfterShares: '4',
          toCurrentShares: '3',
          toAfterShares: '4',
          issuedSupply: '8',
          afterIssuedSupply: '8',
          authorisedSupply: '1000',
        },
      };
    }
    if (transfers[0] && url === URLS.REGISTER_TRANSFER_DECIDE(transfers[0].uuid)) {
      const request = value as RegisterTransferDecideRequest;
      const decidedAt = '2026-11-04T04:00:00Z';
      const decision = {
        uuid: request.idempotencyKey,
        appointment: request.applyAppointment ?? request.appointment,
        kind: 'apply' as const,
        digest: request.previewDigest,
        idempotencyKey: request.idempotencyKey,
        reason: '',
        decidedAt,
        decidedBy: 1,
        decidedByName: PROFILE.fullName,
        completeTransfer: true,
        approvalAppointment: request.appointment,
      };
      transfers = [
        {
          ...transfers[0],
          status: 'applied',
          stage: 'applied',
          registerEntry: '47474747-4747-4747-8747-474747474747',
          effectiveOn: transfers[0].companyEventOn,
          reviewedAt: decidedAt,
          reviewedBy: 1,
          decisions: [decision],
        },
      ];
      return { data: transfers[0] };
    }
    if (url === URLS.REGISTER_CORRECTIONS) {
      corrections = [correctionFrom(value as RegisterCorrectionPreparation)];
      return { data: corrections[0] };
    }
    if (url === URLS.BASE) {
      const request = value as TokenCreate;
      const detail = { chain: null, contractAddress: null, deployedAt: null, deploymentTxHash: null };
      return { data: { ...request, ...detail, uuid: PREFERENCE.uuid, companyUuid: request.company, status: 'draft' } };
    }
    if (url === URLS.REGISTER_IMPORTS) {
      imports = [importFrom(value as RegisterImportPreparation), ...imports];
      return { data: imports[0] };
    }
    const opening = imports.find(
      ({ uuid }) => url === URLS.REGISTER_IMPORT_PREVIEW(uuid) || url === URLS.REGISTER_IMPORT_DECIDE(uuid),
    );
    if (opening && url === URLS.REGISTER_IMPORT_PREVIEW(opening.uuid)) {
      const comparison = opening.members.map(({ member, name, shares, enteredOn }) => ({
        member,
        name,
        imported: shares,
        importedEnteredOn: enteredOn,
        stored: null,
        enteredOn: null,
        liveName: name,
        liveAddress: null,
        wallets: [],
      }));
      const totals = { importedTotal: '5', importedMemberCount: opening.members.length };
      const figures = { statedTotal: null, statedMemberCount: null, sourceReference: opening.sourceReference };
      const preview = { previewDigest: DIGEST, registerSequence: 13, canDecide: true, unmetRequirements: [] };
      const correcting = { correctionOf: opening.correctionOf, correctionAllowed: false };
      return { data: { ...preview, ...totals, ...figures, ...correcting, comparison, opensRegister: true } };
    }
    if (opening && url === URLS.REGISTER_IMPORT_DECIDE(opening.uuid)) {
      const request = value as RegisterDecideRequest;
      const decidedAt = '2026-11-04T09:00:00Z';
      const decision = {
        uuid: request.idempotencyKey,
        appointment: request.appointment,
        kind: request.kind,
        digest: request.previewDigest,
        idempotencyKey: request.idempotencyKey,
        reason: request.reason ?? '',
        decidedAt,
        decidedBy: 1,
        decidedByName: PROFILE.fullName,
      };
      const applied =
        request.kind === 'apply'
          ? { status: 'applied' as const, stage: 'applied', reviewedAt: decidedAt, correctionAllowed: true }
          : { stage: 'approved' };
      const decided = { ...opening, ...applied, decisions: [...opening.decisions, decision] };
      imports = imports.map((proposal) => (proposal.uuid === opening.uuid ? decided : proposal));
      return { data: decided };
    }
    if (corrections[0] && url === URLS.REGISTER_CORRECTION_PREVIEW(corrections[0].uuid)) {
      const { changes, effectiveOn } = corrections[0];
      const originalChanges = CERTIFIED.changes.map(({ member, shares }) => ({ member, shares }));
      const preview = { changes, effectiveOn, originalChanges, previewDigest: DIGEST, registerSequence: 13 };
      return { data: { ...preview, canDecide: true, unmetRequirements: [] } };
    }
    if (corrections[0] && url === URLS.REGISTER_CORRECTION_DECIDE(corrections[0].uuid)) {
      const request = value as RegisterDecideRequest;
      const decidedAt = request.kind === 'apply' ? '2026-11-04T06:00:00Z' : '2026-11-04T05:30:00Z';
      const decision = {
        uuid: request.idempotencyKey,
        appointment: request.appointment,
        kind: request.kind,
        digest: request.previewDigest,
        idempotencyKey: request.idempotencyKey,
        reason: request.reason ?? '',
        decidedAt,
        decidedBy: 1,
        decidedByName: PROFILE.fullName,
      };
      const applied =
        request.kind === 'apply'
          ? {
              status: 'applied' as const,
              stage: 'applied',
              appliedEntry: '52525252-5252-4252-8252-525252525252',
              reviewedAt: decidedAt,
              reviewedBy: 1,
            }
          : { stage: 'approved' };
      corrections = [{ ...corrections[0], ...applied, decisions: [...corrections[0].decisions, decision] }];
      return { data: corrections[0] };
    }
    if (url === URLS.REGISTER_MEMBER_DOCUMENTS) {
      const request = value as RegisterMemberDocumentRequest;
      const snapshot = {
        evidence: request.evidence,
        company: request.companyId,
        documentType: 'supporting',
        providedBy: 'company',
        name: 'synthetic.pdf',
        fileSize: 4,
        mimeType: 'application/pdf',
        sha256: 'a'.repeat(64),
      };
      const { companyId, ...document } = request;
      return {
        data: {
          ...document,
          uuid: '45454545-4545-4545-8545-454545454545',
          company: companyId,
          sourceImport: null,
          snapshot,
          createdAt: '2026-11-04T00:00:00Z',
        },
      };
    }
    if (url === URLS.CLASS_RIGHTS(FOUNDERS.uuid)) {
      const request = value as ClassRightsRequest;
      rights = [
        {
          uuid: '43434343-4343-4343-8343-434343434343',
          token: FOUNDERS.uuid,
          revision: request.previousRevision + 1,
          appointment: request.appointment,
          summary: request.summary,
          attributes: request.attributes ?? {},
          effectiveDate: request.effectiveDate ?? null,
          documentReference: '',
          documents: [],
          idempotencyKey: request.idempotencyKey,
          recordedBy: 1,
          recordedByName: PROFILE.fullName,
          createdAt: '2026-11-04T00:00:00Z',
        },
      ];
      return { data: rights[0] };
    }
    const file = (type: string) => ({ data: new ArrayBuffer(4), headers: { 'content-type': type } });
    if (url === URLS.REGISTER_CERTIFICATE(FOUNDERS.uuid)) return file('application/pdf');
    if (url === URLS.REGISTER_INSPECTION_COPY(FOUNDERS.uuid)) return file('text/csv');
    if (url === COMPANY_ENDPOINTS.PACK(ADMINISTERED.uuid)) return file('application/zip');
    if (url === `${AUTHORITY_REQUESTS}${PENDING.uuid}/admit/`)
      return { data: { ...PENDING, status: 'admitted', appointment: ADMITTED.appointment } };
    if (url === `${AUTHORITY_REQUESTS}${ADMITTED.uuid}/revoke/`)
      return { data: { ...ADMITTED, appointment: { ...ADMITTED.appointment!, ...REVOKED } } };
    if (url === URLS.MEMBER_ASSOCIATION_REVOKE(LINK.uuid)) {
      revokedLink = LINK.uuid;
      return { data: { ...LINK, current: false } };
    }
    if (url === `${APPOINTMENTS}${READER.uuid}/revoke/`) {
      revoked = true;
      const { name: _name, email: _email, ...appointment } = READER;
      return {
        data: {
          ...appointment,
          ...REVOKED,
          companyName: ADMINISTERED.name,
          companyStatus: 'active',
          companyStatusDisplay: 'Active',
          declarationText: COMPANY_AUTHORITY_DECLARATION,
          declarationVersion: COMPANY_AUTHORITY_DECLARATION_VERSION,
          signupTerms: null,
        },
      };
    }
    throw new Error(`Unexpected POST ${url}`);
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ApiClientProvider client={api as unknown as AxiosInstance}>
        <SafeAreaInsetsContext.Provider value={{ top: 0, right: 0, bottom: 0, left: 0 }}>
          <MemberRecordsProvider>{children}</MemberRecordsProvider>
        </SafeAreaInsetsContext.Provider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
  const dashboard = <DashboardScreen route={{ key: 'dashboard', name: 'Dashboard', params: undefined }} />;
  const view = await render(dashboard, { wrapper });
  await fireEvent.press(await screen.findByRole('button', { name: 'Accept invitation' }));
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
  expect(screen.queryByLabelText('Your companies')).toBeNull();
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
  await view.rerender(certificatesPage);
  await act(async () => screen.getByTestId('certificates-scroll').props.refreshControl.props.onRefresh());
  expect(await screen.findByText('Transfer · ORD · entry 2')).toBeTruthy();
  const registerReads = () =>
    api.get.mock.calls.filter(
      ([url]) =>
        url === URLS.OWNERSHIP ||
        url === URLS.DETAIL(MEMBER_RECORD.classes[0].uuid) ||
        /\/(register|holders|packs|class-rights|register-member-documents)\/|-holders\/$/.test(url),
    );
  const outputPosts = () => api.post.mock.calls.filter(([url]) => /\/register\/|\/pack\/$/.test(url));
  const menu = <AppMenu visible current="Documents" route="Certificates" onSelect={jest.fn()} onClose={jest.fn()} />;
  await view.rerender(menu);
  expect(await screen.findByRole('button', { name: 'Documents', selected: true })).toBeTruthy();
  expect(
    screen.queryByRole('button', {
      name: /Ledger|Issue shares|Transfer shares|Corrections|Inspection copies|Company pack|Documents navigation|Shareholders|Employee scheme|Member access/,
    }),
  ).toBeNull();
  const shareholder = { company: ADMINISTERED.uuid, member: HOLDER_A.member };
  for (const page of [
    <InspectionCopiesScreen key="copies" />,
    <CompanyPackScreen key="pack" />,
    <ShareholdersScreen key="shareholders" />,
    <MemberAccessScreen
      key="access"
      route={{
        key: 'access',
        name: 'MemberAccess',
        params: { company: ADMINISTERED.uuid, inviteMember: HOLDER_A.member },
      }}
    />,
    <ShareholderScreen key="shareholder" route={{ key: 'shareholder', name: 'Shareholder', params: shareholder }} />,
    <ShareholderScreen
      key="member-company"
      route={{
        key: 'member-company',
        name: 'Shareholder',
        params: { company: MEMBER_RECORD.company.uuid, member: MEMBER_RECORD.member },
      }}
    />,
    <EmployeeSchemeScreen key="scheme" />,
    <LedgerScreen key="ledger" />,
    <IssueSharesScreen key="issues" route={{ key: 'issues', name: 'IssueShares', params: undefined }} />,
    <TransferSharesScreen key="transfers" route={{ key: 'transfers', name: 'TransferShares', params: undefined }} />,
    <CorrectionsScreen key="corrections" route={{ key: 'corrections', name: 'Corrections', params: undefined }} />,
    <CorrectionPreparationScreen
      key="correction"
      route={{
        key: 'correction',
        name: 'CorrectionPreparation',
        params: { company: MEMBER_RECORD.company.uuid, token, entry: MEMBER_ENTRY.uuid },
      }}
    />,
    <RegisterSetupScreen
      key="setup"
      route={{ key: 'setup', name: 'RegisterSetup', params: { company: MEMBER_RECORD.company.uuid } }}
    />,
    <TransferPreparationScreen
      key="transfer"
      route={{
        key: 'transfer',
        name: 'TransferPreparation',
        params: { company: MEMBER_RECORD.company.uuid, token, fromMember: MEMBER_RECORD.member },
      }}
    />,
    <ShareClassScreen
      key="class"
      route={{ key: 'class', name: 'ShareClass', params: { company: MEMBER_RECORD.company.uuid, token } }}
    />,
    <EmployeeAwardScreen
      key="award"
      route={{
        key: 'award',
        name: 'EmployeeAward',
        params: { company: MEMBER_RECORD.company.uuid, token: MEMBER_RECORD.classes[0].uuid, award: 'own-award' },
      }}
    />,
  ]) {
    await view.rerender(page);
    expect(await screen.findByText('Choose company on Dashboard')).toBeTruthy();
  }
  const peopleReads = () =>
    api.get.mock.calls.filter(([url]) =>
      /\/(register-people|register-award[a-z-]*|register-allotments|register-grants|register-transfers|register-corrections|register-imports|register-particulars-changes|member-invitations|member-associations)\//.test(
        url,
      ),
    );
  await view.rerender(<CertificatesScreen route={{ key: 'member', name: 'Certificates', params: undefined }} />);
  expect(await screen.findByText('Transfer · ORD · entry 2')).toBeTruthy();
  expect(registerReads()).toHaveLength(0);
  expect(peopleReads()).toHaveLength(0);
  expect(outputPosts()).toHaveLength(0);
  administered = true;
  await act(async () => {
    await client.refetchQueries({
      queryKey: ownershipCompaniesKey({ userUuid: 'profile-one', ownerAccountUuid: 'account-one' }),
    });
  });
  await view.rerender(dashboard);
  await fireEvent.press(await screen.findByRole('button', { name: 'Switch company' }));
  expect(screen.getByRole('button', { name: `${PAST_RECORD.company.name}, Member` })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: `${ADMINISTERED.name}, Company administrator` }));
  expect(await screen.findByLabelText('Issued shares: 30')).toBeTruthy();
  expect(screen.getByText('Company administrator')).toBeTruthy();
  expect(screen.getByLabelText('Current shareholders: 26')).toBeTruthy();
  expect(screen.queryByLabelText(/^Your shares/)).toBeNull();
  await fireEvent.press(
    screen.getByRole('button', { name: 'Explore Founders (FND), 30 issued shares, 100.00% of company issued shares' }),
  );
  expect(
    await screen.findByRole('button', { name: 'Highlight Synthetic Holder 1’s holding, 5 shares, 16.67% of FND' }),
  ).toBeTruthy();
  expect(screen.getByText('1–25 of 26 shareholders')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Next (Class shareholders)' }));
  expect(await screen.findByText('26–26 of 26 shareholders')).toBeTruthy();
  const founders = { company: ADMINISTERED.uuid, token: FOUNDERS.uuid };
  await fireEvent.press(screen.getByRole('button', { name: 'Class details (Founders)' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('ShareClass', founders);
  expect(
    registerReads().every(
      ([url, config]) =>
        url === URLS.OWNERSHIP_HOLDERS(FOUNDERS.uuid) ||
        Object.values((config as { params: object }).params).includes(ADMINISTERED.uuid),
    ),
  ).toBe(true);
  await view.rerender(<TeamScreen />);
  expect(
    await screen.findByText(
      'Current personal Manage company information and team authority is required to read or change other appointments.',
    ),
  ).toBeTruthy();
  expect(api.get.mock.calls.filter(([url]) => url === `${APPOINTMENTS}team/`)).toHaveLength(0);
  appointed = true;
  await act(async () => screen.getByTestId('team-scroll').props.refreshControl.props.onRefresh());
  await fireEvent.press(await screen.findByRole('button', { name: /^Revoke appointment \(Synthetic Register Reader/ }));
  const revocations = () => api.post.mock.calls.filter(([url]) => url.endsWith('/revoke/'));
  expect(revocations()).toHaveLength(0);
  await fireEvent.press(screen.getByRole('button', { name: 'Permanently revoke appointment' }));
  expect(revocations()).toEqual([[`${APPOINTMENTS}${READER.uuid}/revoke/`, {}, expect.anything()]]);
  expect(
    await screen.findByRole('button', { name: /^Revoke appointment \(Synthetic Administered Company/ }),
  ).toBeTruthy();
  expect(await screen.findByText(/^Revoked /)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Revoke appointment \(Synthetic Register Reader/ })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: /^Revoke appointment \(Synthetic Administered Company/ }));
  expect(screen.getByText(/^Permanently remove your appointment for Synthetic Administered Company\?/)).toBeTruthy();
  expect(revocations()).toHaveLength(1);
  await view.rerender(<AuthorityScreen />);
  await fireEvent.press(
    await screen.findByRole('button', { name: /^Synthetic Administered Company \(authority request .+, admitted\)$/ }),
  );
  expect(mockNavigate).toHaveBeenCalledWith('AuthorityRequest', { uuid: ADMITTED.uuid });
  await view.rerender(
    <AuthorityRequestScreen route={{ key: 'authority', name: 'AuthorityRequest', params: { uuid: ADMITTED.uuid } }} />,
  );
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Revoke appointment (Synthetic Administered Company)', disabled: false }),
  );
  const authorityPosts = () => api.post.mock.calls.filter(([url]) => url.startsWith(AUTHORITY_REQUESTS));
  expect(authorityPosts()).toHaveLength(0);
  await fireEvent.press(screen.getByRole('button', { name: 'Permanently revoke appointment' }));
  expect(authorityPosts()).toEqual([[`${AUTHORITY_REQUESTS}${ADMITTED.uuid}/revoke/`, {}, expect.anything()]]);
  expect(await screen.findByText('Appointment revoked')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Revoke appointment/ })).toBeNull();
  await view.rerender(
    <AuthorityRequestScreen route={{ key: 'pending', name: 'AuthorityRequest', params: { uuid: PENDING.uuid } }} />,
  );
  const establish = { name: 'Establish appointment (Synthetic Draft Company)', disabled: false };
  await fireEvent.press(await screen.findByRole('button', establish));
  expect(screen.getByText('Accept the authority declaration and Terms.')).toBeTruthy();
  expect(authorityPosts()).toHaveLength(1);
  await fireEvent.press(
    screen.getByRole('checkbox', { name: 'Accept authority declaration and Terms for Synthetic Draft Company' }),
  );
  await fireEvent.press(screen.getByRole('button', establish));
  expect(authorityPosts().slice(1)).toEqual([
    [
      `${AUTHORITY_REQUESTS}${PENDING.uuid}/admit/`,
      expect.objectContaining({ acceptDeclaration: true }),
      expect.anything(),
    ],
  ]);
  await view.rerender(menu);
  expect(await screen.findByRole('button', { name: 'Inspection copies' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Company pack' })).toBeTruthy();
  expect(
    screen.getAllByText(/^(Dashboard|Ledger|Shareholders|Documents|Settings)$/).map(({ props }) => props.children),
  ).toEqual(['Dashboard', 'Ledger', 'Shareholders', 'Documents', 'Settings']);
  await fireEvent.press(screen.getByRole('button', { name: 'Expand Shareholders navigation' }));
  expect(screen.getAllByText(/^(Employee scheme|Member access)$/).map(({ props }) => props.children)).toEqual([
    'Employee scheme',
    'Member access',
  ]);
  await fireEvent.press(screen.getByRole('button', { name: 'Expand Ledger navigation' }));
  expect(
    screen.getAllByText(/^(Issue shares|Transfer shares|Corrections)$/).map(({ props }) => props.children),
  ).toEqual(['Issue shares', 'Transfer shares', 'Corrections']);
  await view.rerender(<LedgerScreen />);
  expect(await screen.findByText('Founders · FND')).toBeTruthy();
  expect(screen.getByLabelText('Issued shares: 8')).toBeTruthy();
  expect(screen.getByLabelText('Current shareholders: 2')).toBeTruthy();
  expect(screen.queryByText('Elsewhere · ELS')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Class details (Founders)' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('ShareClass', founders);
  await fireEvent.press(await screen.findByRole('button', { name: 'Add share class' }));
  const setup = { company: ADMINISTERED.uuid };
  expect(mockNavigate).toHaveBeenLastCalledWith('RegisterSetup', setup);
  await view.rerender(<ShareholdersScreen />);
  expect(await screen.findByText('FND 5 · 62.50%')).toBeTruthy();
  expect(screen.getByText('1–2 of 2 people')).toBeTruthy();
  expect(screen.queryByText('Synthetic Elsewhere Holder')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Synthetic Holder A' }));
  expect(mockNavigate).toHaveBeenCalledWith('Shareholder', shareholder);
  await view.rerender(<MemberAccessScreen route={{ key: 'access', name: 'MemberAccess', params: undefined }} />);
  await fireEvent.press(
    await screen.findByRole('button', { name: 'Revoke access (Synthetic Holder A, holder-a@example.test)' }),
  );
  await fireEvent.changeText(screen.getByLabelText('Company action reason'), 'Synthetic revocation reason');
  await fireEvent.press(screen.getByRole('button', { name: 'Revoke access for Synthetic Holder A' }));
  const accessPosts = () => api.post.mock.calls.filter(([url]) => /\/member-associations\/|send-email\/$/.test(url));
  expect(screen.getByText('They lose access to their own records. Relinking needs a new invitation.')).toBeTruthy();
  expect(accessPosts()).toHaveLength(0);
  await fireEvent.press(screen.getByRole('button', { name: 'Revoke access' }));
  await waitFor(() =>
    expect(accessPosts()).toEqual([
      [
        URLS.MEMBER_ASSOCIATION_REVOKE(LINK.uuid),
        expect.objectContaining({ appointment: ADMINISTRATION.uuid, reason: 'Synthetic revocation reason' }),
        expect.anything(),
      ],
    ]),
  );
  expect(await screen.findByText('Revoked access')).toBeTruthy();
  expect(api.get.mock.calls.filter(([url]) => url === URLS.HOLDERS(ELSEWHERE.uuid))).toHaveLength(0);
  expect(
    screen.getByRole('button', { name: 'Revoke access (Synthetic Holder B, holder-b@example.test)' }),
  ).toBeTruthy();
  const scheme = <EmployeeSchemeScreen />;
  await view.rerender(scheme);
  expect(await screen.findByText(REGISTER_AWARD_COPY.EMPTY)).toBeTruthy();
  expect(screen.getByText('Founders · FND')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: REGISTER_AWARD_COPY.PREPARE, disabled: false }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Recipient: New person' }));
  await fireEvent.press(screen.getByRole('radio', { name: /^Synthetic Holder B/ }));
  await fireEvent.changeText(screen.getByLabelText(REGISTER_AWARD_COPY.SHARES), '40');
  await fireEvent.press(screen.getByRole('button', { name: 'Document. Choose file' }));
  await screen.findByRole('button', { name: 'Document, synthetic.pdf. Choose file' });
  await fireEvent.changeText(screen.getByLabelText('Terms'), 'Synthetic award terms');
  await fireEvent.changeText(screen.getByLabelText('Schedule'), 'Synthetic vesting schedule');
  const awardPosts = () =>
    api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_AWARDS || url === URLS.REGISTER_AWARD_VESTINGS);
  await fireEvent.press(screen.getByRole('button', { name: REGISTER_AWARD_COPY.SUBMIT }));
  const agreement = `${HOLDER_B.name} (employee award, agreement ${formatDate(utcToday())})`;
  await fireEvent.press(await screen.findByRole('button', { name: agreement }));
  const evidence = expect.stringMatching(/^eeeeeeee-/);
  const recorded = awards[0];
  expect(awardPosts()).toEqual([
    [
      URLS.REGISTER_AWARDS,
      {
        operationId: recorded.uuid,
        appointment: ADMINISTRATION.uuid,
        tokenId: FOUNDERS.uuid,
        member: HOLDER_B.member,
        newMember: false,
        shares: '40',
        termsOn: utcToday(),
        terms: 'Synthetic award terms',
        schedule: 'Synthetic vesting schedule',
        agreementEvidence: evidence,
      },
      expect.anything(),
    ],
  ]);
  const awarded = { company: ADMINISTERED.uuid, token: FOUNDERS.uuid, award: recorded.uuid };
  expect(mockNavigate).toHaveBeenCalledWith('EmployeeAward', awarded);
  const awardPage = <EmployeeAwardScreen route={{ key: 'awarded', name: 'EmployeeAward', params: awarded }} />;
  await view.rerender(awardPage);
  expect(await screen.findByText('40 shares promised · 0 company-recorded vested')).toBeTruthy();
  await fireEvent.press(await screen.findByRole('button', { name: 'Record vesting', disabled: false }));
  await fireEvent.changeText(screen.getByLabelText('Shares in this event'), '10');
  await fireEvent.press(screen.getByRole('button', { name: 'Document. Choose file' }));
  await screen.findByRole('button', { name: 'Document, synthetic.pdf. Choose file' });
  await fireEvent.press(screen.getByRole('button', { name: 'Record vesting' }));
  expect(await screen.findByText('Vesting history')).toBeTruthy();
  expect(awardPosts().slice(1)).toEqual([
    [
      URLS.REGISTER_AWARD_VESTINGS,
      {
        operationId: vestings[0].uuid,
        appointment: ADMINISTRATION.uuid,
        award: recorded.uuid,
        shares: '10',
        vestedOn: utcToday(),
        evidence,
      },
      expect.anything(),
    ],
  ]);
  const issuePosts = () => api.post.mock.calls.filter(([url]) => /\/register-(allotments|grants)\//.test(url));
  const settled = () => waitFor(() => expect(client.isFetching()).toBe(0));
  await fireEvent.press(await screen.findByRole('button', { name: 'Issue vested shares' }));
  const vestedIssue = { company: ADMINISTERED.uuid, token: FOUNDERS.uuid, award: recorded.uuid };
  expect(mockNavigate).toHaveBeenLastCalledWith('IssueShares', vestedIssue);
  await view.rerender(<IssueSharesScreen route={{ key: 'vested', name: 'IssueShares', params: vestedIssue }} />);
  expect(await screen.findByText('10 vested shares available to issue')).toBeTruthy();
  await settled();
  expect(screen.getByRole('radio', { name: 'Non-paid issue', checked: true })).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText(REGISTER_GRANT_COPY.SHARES), '10');
  await fireEvent.changeText(screen.getByLabelText(REGISTER_GRANT_COPY.COMPANY_EVENT_ON), utcToday());
  await fireEvent.changeText(screen.getByLabelText(REGISTER_GRANT_COPY.DIRECTOR), 'Synthetic Director');
  await fireEvent.changeText(screen.getByLabelText(REGISTER_GRANT_COPY.AUTHORITY_REFERENCE), 'Synthetic minute');
  await fireEvent.changeText(screen.getByLabelText(REGISTER_GRANT_COPY.REASON), 'Vested award issue');
  await fireEvent.press(screen.getByRole('button', { name: 'Authority document. Choose file' }));
  await screen.findByRole('button', { name: 'Authority document, synthetic.pdf. Choose file' });
  expect(issuePosts()).toHaveLength(0);
  await fireEvent.press(screen.getByRole('button', { name: 'Prepare vested share issue' }));
  const grantSummary = 'Synthetic Holder B, 10 shares. Show details and documents';
  expect(await screen.findByRole('button', { name: grantSummary })).toBeTruthy();
  await settled();
  expect(screen.getByText('Needs a decision · 1')).toBeTruthy();
  expect(screen.getByLabelText('Status: Prepared')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^Record issue/ })).toBeNull();
  const grant = grants[0];
  expect(issuePosts()).toEqual([
    [
      URLS.REGISTER_GRANTS,
      {
        operationId: grant.uuid,
        appointment: ADMINISTRATION.uuid,
        tokenId: FOUNDERS.uuid,
        member: HOLDER_B.member,
        newMember: false,
        award: recorded.uuid,
        shares: '10',
        companyEventOn: utcToday(),
        termsOn: utcToday(),
        terms: 'Synthetic award terms',
        approvingDirector: 'Synthetic Director',
        authorityReference: 'Synthetic minute',
        reason: 'Vested award issue',
        authorityEvidence: evidence,
        termsEvidence: recorded.agreementEvidence,
        acceptanceRequired: false,
        acceptanceEvidence: null,
      },
      expect.anything(),
    ],
  ]);
  await fireEvent.press(screen.getByRole('button', { name: /^Review and approve \(grant for Synthetic Holder B / }));
  expect(await screen.findByText('Approval alone does not issue shares.')).toBeTruthy();
  await fireEvent.press(await screen.findByRole('button', { name: 'Approve', disabled: false }));
  expect(await screen.findByLabelText('Status: Approved')).toBeTruthy();
  await settled();
  await fireEvent.press(screen.getByRole('button', { name: /^Record issue \(grant for Synthetic Holder B / }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Record issue', disabled: false }));
  expect(await screen.findByText('Issued · 1')).toBeTruthy();
  const decision = (kind: string) => ({ appointment: ADMINISTRATION.uuid, kind, reason: '' });
  const decided = (kind: string) => ({
    ...decision(kind),
    idempotencyKey: expect.stringMatching(/^00000000-0000-4000-8000-/),
    previewDigest: DIGEST,
    confirmation: true,
  });
  expect(issuePosts().slice(1)).toEqual([
    [URLS.REGISTER_GRANT_PREVIEW(grant.uuid), decision('approve'), expect.anything()],
    [URLS.REGISTER_GRANT_DECIDE(grant.uuid), decided('approve'), expect.anything()],
    [URLS.REGISTER_GRANT_PREVIEW(grant.uuid), decision('apply'), expect.anything()],
    [URLS.REGISTER_GRANT_DECIDE(grant.uuid), decided('apply'), expect.anything()],
  ]);
  await view.rerender(<ShareholderScreen route={{ key: 'holder-a', name: 'Shareholder', params: shareholder }} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Issue shares to them' }));
  const investorIssue = { company: ADMINISTERED.uuid, token: FOUNDERS.uuid, member: HOLDER_A.member };
  expect(mockNavigate).toHaveBeenLastCalledWith('IssueShares', investorIssue);
  await view.rerender(<IssueSharesScreen route={{ key: 'investor', name: 'IssueShares', params: investorIssue }} />);
  expect(await screen.findByRole('button', { name: 'Issue to: Synthetic Holder A' })).toBeTruthy();
  await settled();
  await fireEvent.changeText(screen.getByLabelText(REGISTER_ALLOTMENT_COPY.SHARES), '2');
  await fireEvent.changeText(screen.getByLabelText(REGISTER_ALLOTMENT_COPY.CONSIDERATION), '20');
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.changeText(screen.getByLabelText('Agreement reference'), 'Synthetic agreement');
  await fireEvent.changeText(screen.getByLabelText('Agreement terms'), 'Fully paid in AUD');
  await fireEvent.press(screen.getByRole('button', { name: 'Agreement document. Choose file' }));
  await screen.findByRole('button', { name: 'Agreement document, synthetic.pdf. Choose file' });
  await fireEvent.changeText(screen.getByLabelText('Amount received (AUD)'), '20');
  await fireEvent.press(screen.getByRole('button', { name: 'Receipt document. Choose file' }));
  await screen.findByRole('button', { name: 'Receipt document, synthetic.pdf. Choose file' });
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.changeText(screen.getByLabelText(REGISTER_ALLOTMENT_COPY.COMPANY_EVENT_ON), utcToday());
  await fireEvent.changeText(screen.getByLabelText(REGISTER_ALLOTMENT_COPY.DIRECTOR), 'Synthetic Director');
  await fireEvent.changeText(screen.getByLabelText(REGISTER_ALLOTMENT_COPY.AUTHORITY_REFERENCE), 'Synthetic minute');
  await fireEvent.changeText(screen.getByLabelText(REGISTER_ALLOTMENT_COPY.REASON), 'External capital');
  await fireEvent.press(screen.getByRole('button', { name: 'Authority document. Choose file' }));
  await screen.findByRole('button', { name: 'Authority document, synthetic.pdf. Choose file' });
  await fireEvent.press(screen.getByRole('button', { name: REGISTER_ALLOTMENT_COPY.SUBMIT }));
  const allotmentSummary = 'Synthetic Holder A, 2 shares. Show details and documents';
  expect(await screen.findByRole('button', { name: allotmentSummary })).toBeTruthy();
  await settled();
  const allotment = allotments[0];
  expect(issuePosts().slice(5)).toEqual([
    [
      URLS.REGISTER_ALLOTMENTS,
      {
        operationId: allotment.uuid,
        appointment: ADMINISTRATION.uuid,
        tokenId: FOUNDERS.uuid,
        member: HOLDER_A.member,
        newMember: false,
        shares: '2',
        companyEventOn: utcToday(),
        consideration: '20.00',
        receivedAmount: '20.00',
        currency: 'AUD',
        agreementReference: 'Synthetic agreement',
        agreementOn: utcToday(),
        terms: 'Fully paid in AUD',
        receivedOn: utcToday(),
        approvingDirector: 'Synthetic Director',
        authorityReference: 'Synthetic minute',
        reason: 'External capital',
        authorityEvidence: evidence,
        agreementEvidence: evidence,
        receiptEvidence: evidence,
      },
      expect.anything(),
    ],
  ]);
  await fireEvent.press(
    screen.getByRole('button', { name: /^Review and approve \(allotment for Synthetic Holder A / }),
  );
  expect(await screen.findByText('Ownership impact')).toBeTruthy();
  await fireEvent.press(await screen.findByRole('button', { name: 'Approve', disabled: false }));
  expect(await screen.findByText('Issued · 2')).toBeTruthy();
  const combined = { completeIssue: true, applyAppointment: ADMINISTRATION.uuid };
  expect(issuePosts().slice(6)).toEqual([
    [URLS.REGISTER_ALLOTMENT_PREVIEW(allotment.uuid), { ...decision('approve'), ...combined }, expect.anything()],
    [URLS.REGISTER_ALLOTMENT_DECIDE(allotment.uuid), { ...decided('approve'), ...combined }, expect.anything()],
  ]);
  const transferPosts = () => api.post.mock.calls.filter(([url]) => url.startsWith(URLS.REGISTER_TRANSFERS));
  await view.rerender(<ShareholderScreen route={{ key: 'transferor', name: 'Shareholder', params: shareholder }} />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Transfer shares (Founders)' }));
  const transferFrom = { company: ADMINISTERED.uuid, token: FOUNDERS.uuid, fromMember: HOLDER_A.member };
  expect(mockNavigate).toHaveBeenLastCalledWith('TransferPreparation', transferFrom);
  await view.rerender(
    <TransferPreparationScreen route={{ key: 'transfer', name: 'TransferPreparation', params: transferFrom }} />,
  );
  expect(await screen.findByRole('button', { name: 'Transferor: Synthetic Holder A' })).toBeTruthy();
  await settled();
  await fireEvent.press(screen.getByRole('button', { name: 'Recipient: none chosen' }));
  await fireEvent.press(screen.getByRole('radio', { name: /^Synthetic Holder B/ }));
  await fireEvent.changeText(screen.getByLabelText(REGISTER_TRANSFER_COPY.SHARES), '1');
  await fireEvent.changeText(screen.getByLabelText(REGISTER_TRANSFER_COPY.COMPANY_EVENT_ON), utcToday());
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.changeText(screen.getByLabelText('Transfer terms'), 'Gift for no consideration');
  await fireEvent.press(screen.getByRole('button', { name: 'Signed transfer instrument. Choose file' }));
  await screen.findByRole('button', { name: 'Signed transfer instrument, synthetic.pdf. Choose file' });
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.changeText(screen.getByLabelText(REGISTER_TRANSFER_COPY.DIRECTOR), 'Synthetic Director');
  await fireEvent.changeText(screen.getByLabelText('Authority reference'), 'Synthetic transfer minute');
  await fireEvent.changeText(screen.getByLabelText('Reason'), 'Family gift');
  await fireEvent.press(screen.getByRole('button', { name: 'Authority document. Choose file' }));
  await screen.findByRole('button', { name: 'Authority document, synthetic.pdf. Choose file' });
  expect(transferPosts()).toHaveLength(0);
  await fireEvent.press(screen.getByRole('button', { name: REGISTER_TRANSFER_COPY.SUBMIT }));
  await waitFor(() => expect(mockNavigate).toHaveBeenLastCalledWith('TransferShares', expect.anything()));
  const transfer = transfers[0];
  const landed = {
    company: ADMINISTERED.uuid,
    token: FOUNDERS.uuid,
    record: transfer.uuid,
    outcome: REGISTER_TRANSFER_COPY.PREPARED,
  };
  expect(mockNavigate).toHaveBeenLastCalledWith('TransferShares', landed);
  expect(transferPosts()).toEqual([
    [
      URLS.REGISTER_TRANSFERS,
      {
        operationId: transfer.uuid,
        appointment: ADMINISTRATION.uuid,
        tokenId: FOUNDERS.uuid,
        fromMember: HOLDER_A.member,
        toMember: HOLDER_B.member,
        newMember: false,
        shares: '1',
        companyEventOn: utcToday(),
        signedOn: utcToday(),
        lodgedOn: utcToday(),
        terms: 'Gift for no consideration',
        approvingDirector: 'Synthetic Director',
        authorityReference: 'Synthetic transfer minute',
        reason: 'Family gift',
        authorityEvidence: evidence,
        instrumentEvidence: evidence,
      },
      expect.anything(),
    ],
  ]);
  await view.rerender(<TransferSharesScreen route={{ key: 'transfers', name: 'TransferShares', params: landed }} />);
  expect(await screen.findByText(REGISTER_TRANSFER_COPY.PREPARED)).toBeTruthy();
  const transferSummary = 'Synthetic Holder A to Synthetic Holder B, 1 share. Show details and documents';
  expect(screen.getByRole('button', { name: transferSummary })).toBeTruthy();
  expect(screen.getByText('Needs a decision · 1')).toBeTruthy();
  expect(screen.getByLabelText('Status: Prepared')).toBeTruthy();
  await settled();
  await fireEvent.press(screen.getByRole('button', { name: REGISTER_TRANSFER_COPY.PREPARE }));
  expect(mockNavigate).toHaveBeenLastCalledWith('TransferPreparation', founders);
  await fireEvent.press(
    screen.getByRole('button', {
      name: /^Review and approve \(transfer from Synthetic Holder A to Synthetic Holder B /,
    }),
  );
  expect(await screen.findByText('Ownership impact')).toBeTruthy();
  await fireEvent.press(await screen.findByRole('button', { name: 'Approve', disabled: false }));
  expect(await screen.findByText('Transferred · 1')).toBeTruthy();
  const completed = { completeTransfer: true, applyAppointment: ADMINISTRATION.uuid };
  expect(transferPosts().slice(1)).toEqual([
    [URLS.REGISTER_TRANSFER_PREVIEW(transfer.uuid), { ...decision('approve'), ...completed }, expect.anything()],
    [URLS.REGISTER_TRANSFER_DECIDE(transfer.uuid), { ...decided('approve'), ...completed }, expect.anything()],
  ]);
  const correctionPosts = () => api.post.mock.calls.filter(([url]) => url.startsWith(URLS.REGISTER_CORRECTIONS));
  const certified = `issue of ${formatDate(CERTIFIED.companyEventOn)}`;
  await view.rerender(<CorrectionsScreen route={{ key: 'corrections', name: 'Corrections', params: undefined }} />);
  const correct = await screen.findByRole('button', { name: `Correct (${certified}, Synthetic Holder 1)` });
  expect(screen.getByLabelText('Share movements: Synthetic Holder 1: +5')).toBeTruthy();
  expect(await screen.findByText('Copied opening')).toBeTruthy();
  expect(screen.getByLabelText('Status: Prepared')).toBeTruthy();
  const particulars = await screen.findByRole('button', { name: `${HOLDER_A.name}. Show details and documents` });
  expect(screen.getByText(`Address changed · ${formatShortDate(PARTICULARS_EDIT.asAt)}`)).toBeTruthy();
  expect(screen.queryByText(`${HOLDER_A.name} new address`)).toBeNull();
  await fireEvent.press(particulars);
  expect(screen.getByText(`${HOLDER_A.name} new address`)).toBeTruthy();
  const opening = `copied opening, record date ${formatDate(OPENING.asAt)}`;
  expect(screen.getByRole('button', { name: `Review (${opening})` })).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Bring records (Founders)' }));
  const bringing = { company: ADMINISTERED.uuid, token: FOUNDERS.uuid, from: 'Corrections' as const };
  expect(mockNavigate).toHaveBeenLastCalledWith('RegisterSetup', bringing);
  await fireEvent.press(correct);
  const correcting = { company: ADMINISTERED.uuid, token: FOUNDERS.uuid, entry: CERTIFIED.uuid };
  expect(mockNavigate).toHaveBeenLastCalledWith('CorrectionPreparation', correcting);
  await view.rerender(
    <CorrectionPreparationScreen route={{ key: 'correct', name: 'CorrectionPreparation', params: correcting }} />,
  );
  await fireEvent.changeText(
    await screen.findByLabelText(REGISTER_CORRECTION_COPY.APPROVING_DIRECTOR),
    'Synthetic Director',
  );
  expect(screen.getByText('Synthetic Holder 1: -5')).toBeTruthy();
  await fireEvent.changeText(screen.getByLabelText(REGISTER_CORRECTION_COPY.AUTHORITY_REFERENCE), 'Synthetic minute');
  await fireEvent.changeText(screen.getByLabelText(REGISTER_CORRECTION_COPY.REASON), 'Issued in error');
  await fireEvent.press(screen.getByRole('button', { name: 'Authority document. Choose file' }));
  await screen.findByRole('button', { name: 'Authority document, synthetic.pdf. Choose file' });
  expect(correctionPosts()).toHaveLength(0);
  await fireEvent.press(screen.getByRole('button', { name: REGISTER_CORRECTION_COPY.SUBMIT }));
  await waitFor(() => expect(mockNavigate).toHaveBeenLastCalledWith('Corrections', expect.anything()));
  const correction = corrections[0];
  const preparedCorrection = {
    company: ADMINISTERED.uuid,
    token: FOUNDERS.uuid,
    record: correction.uuid,
    outcome: REGISTER_CORRECTION_COPY.PREPARED,
  };
  expect(mockNavigate).toHaveBeenLastCalledWith('Corrections', preparedCorrection);
  expect(correctionPosts()).toEqual([
    [
      URLS.REGISTER_CORRECTIONS,
      {
        operationId: correction.uuid,
        appointment: ADMINISTRATION.uuid,
        correctsId: CERTIFIED.uuid,
        authorityEvidence: evidence,
        effectiveOn: utcToday(),
        authority: 'director_resolution',
        approvingDirector: 'Synthetic Director',
        authorityReference: 'Synthetic minute',
        reason: 'Issued in error',
      },
      expect.anything(),
    ],
  ]);
  await view.rerender(
    <CorrectionsScreen route={{ key: 'corrected', name: 'Corrections', params: preparedCorrection }} />,
  );
  expect(await screen.findByText(REGISTER_CORRECTION_COPY.PREPARED)).toBeTruthy();
  await settled();
  expect(screen.getByText('Needs a decision · 1')).toBeTruthy();
  await fireEvent.press(
    screen.getByRole('button', { name: `Approve (correction of the ${certified}, Synthetic Holder 1)` }),
  );
  await fireEvent.press(await screen.findByRole('button', { name: 'Approve correction', disabled: false }));
  await waitFor(() => expect(correctionPosts()).toHaveLength(3));
  await settled();
  await fireEvent.press(
    screen.getByRole('button', { name: `Apply (correction of the ${certified}, Synthetic Holder 1)` }),
  );
  expect(await screen.findByText(REGISTER_CORRECTION_COPY.COMPENSATION_NOTE)).toBeTruthy();
  await fireEvent.press(await screen.findByRole('button', { name: 'Apply correction', disabled: false }));
  await waitFor(() => expect(correctionPosts()).toHaveLength(5));
  await settled();
  expect(screen.queryByRole('button', { name: /^(Approve|Apply|Reject) \(correction/ })).toBeNull();
  expect(correctionPosts().slice(1)).toEqual([
    [URLS.REGISTER_CORRECTION_PREVIEW(correction.uuid), decision('approve'), expect.anything()],
    [URLS.REGISTER_CORRECTION_DECIDE(correction.uuid), decided('approve'), expect.anything()],
    [URLS.REGISTER_CORRECTION_PREVIEW(correction.uuid), decision('apply'), expect.anything()],
    [URLS.REGISTER_CORRECTION_DECIDE(correction.uuid), decided('apply'), expect.anything()],
  ]);
  const importPosts = () =>
    api.post.mock.calls.filter(([url]) => url === URLS.BASE || url.startsWith(URLS.REGISTER_IMPORTS));
  await fireEvent.press(screen.getByRole('button', { name: `Review (${opening})` }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Review import', disabled: false }));
  await waitFor(() => expect(importPosts()).toHaveLength(2));
  await settled();
  await fireEvent.press(screen.getByRole('button', { name: `Confirm (${opening})` }));
  expect(await screen.findByText(REGISTER_IMPORT_COPY.NOT_ON_CHAIN_NOTE)).toBeTruthy();
  await fireEvent.press(await screen.findByRole('button', { name: 'Confirm import', disabled: false }));
  await waitFor(() => expect(importPosts()).toHaveLength(4));
  await settled();
  expect(importPosts()).toEqual([
    [URLS.REGISTER_IMPORT_PREVIEW(OPENING.uuid), decision('approve'), expect.anything()],
    [URLS.REGISTER_IMPORT_DECIDE(OPENING.uuid), decided('approve'), expect.anything()],
    [URLS.REGISTER_IMPORT_PREVIEW(OPENING.uuid), decision('apply'), expect.anything()],
    [URLS.REGISTER_IMPORT_DECIDE(OPENING.uuid), decided('apply'), expect.anything()],
  ]);
  await fireEvent.press(screen.getByRole('button', { name: 'Correct copied opening (Founders)' }));
  expect(mockNavigate).toHaveBeenLastCalledWith('RegisterSetup', bringing);
  await view.rerender(<RegisterSetupScreen route={{ key: 'opening', name: 'RegisterSetup', params: bringing }} />);
  await fireEvent.changeText(
    await screen.findByLabelText('Reason for correcting the mirror'),
    'Synthetic opening correction',
  );
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save draft and review' }));
  await waitFor(() =>
    expect(mockSetParams).toHaveBeenLastCalledWith({ token: FOUNDERS.uuid, record: imports[0].uuid }),
  );
  const replacement = imports[0];
  const holderA = { member: HOLDER_A.member, name: HOLDER_A.name, residentialAddress: `${HOLDER_A.name} address` };
  const copied = { sourceReference: 'Company-provided share records', sourceConfirmed: true, formerMembers: [] };
  expect(importPosts()[4]).toEqual([
    URLS.REGISTER_IMPORTS,
    {
      operationId: replacement.uuid,
      appointment: ADMINISTRATION.uuid,
      tokenId: FOUNDERS.uuid,
      asAt: OPENING.asAt,
      members: [{ ...holderA, shares: '5', enteredOn: '2026-10-26', allotments: [] }],
      ...copied,
      correctionOf: OPENING.uuid,
      reason: 'Synthetic opening correction',
    },
    expect.anything(),
  ]);
  await fireEvent.press(await screen.findByRole('button', { name: 'Cancel (ledger setup)', disabled: false }));
  expect(mockNavigate).toHaveBeenLastCalledWith('Corrections', { company: ADMINISTERED.uuid, token: FOUNDERS.uuid });
  await settled();
  const posted = importPosts().length;
  await view.rerender(<RegisterSetupScreen route={{ key: 'new-class', name: 'RegisterSetup', params: setup }} />);
  await fireEvent.press(await screen.findByRole('radio', { name: 'Preference (PRF)' }));
  await settled();
  await fireEvent.press(screen.getByRole('button', { name: 'Continue' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Add a shareholder' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Company shareholder: none chosen' }));
  await fireEvent.press(screen.getByRole('radio', { name: /^Synthetic Holder A/ }));
  await fireEvent.changeText(screen.getByLabelText('Date first added to register'), '2026-10-26');
  await fireEvent.changeText(screen.getByLabelText('Current shares held'), '5');
  await fireEvent.press(screen.getByRole('button', { name: 'Add allocation (shareholder 1)' }));
  await fireEvent.changeText(screen.getByLabelText('Allocation date'), '2026-10-26');
  await fireEvent.changeText(screen.getByLabelText('Allocation shares'), '5');
  await fireEvent.changeText(screen.getByLabelText('Amount paid'), '5');
  await fireEvent.press(screen.getByRole('button', { name: 'Add document' }));
  await fireEvent.press(screen.getByRole('button', { name: 'File. Choose file' }));
  await screen.findByRole('button', { name: 'File, synthetic.pdf. Choose file' });
  await fireEvent.press(screen.getByRole('button', { name: 'Add shareholder' }));
  expect(importPosts()).toHaveLength(posted);
  await fireEvent.press(screen.getByRole('button', { name: 'Save draft and review' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Confirm', disabled: false }));
  await waitFor(() => expect(mockNavigate).toHaveBeenLastCalledWith('Dashboard'));
  const opened = imports[0];
  expect(mockSetParams).toHaveBeenLastCalledWith({ token: PREFERENCE.uuid, record: opened.uuid });
  const allocation = {
    allottedOn: '2026-10-26',
    fullyPaid: true,
    beneficiallyHeld: null,
    shares: '5',
    amountPaid: '5.00',
    amountUnpaid: '0.00',
    shareReference: null,
    certificateReference: null,
  };
  expect(importPosts().slice(posted)).toEqual([
    [
      URLS.BASE,
      {
        company: ADMINISTERED.uuid,
        name: PREFERENCE.name,
        symbol: PREFERENCE.symbol,
        tokenType: 'preference',
        totalSupply: TECHNICAL_SHARE_LIMIT,
      },
      expect.anything(),
    ],
    [
      URLS.REGISTER_IMPORTS,
      {
        operationId: opened.uuid,
        appointment: ADMINISTRATION.uuid,
        tokenId: PREFERENCE.uuid,
        asAt: utcToday(),
        members: [
          {
            ...holderA,
            shares: '5',
            enteredOn: '2026-10-26',
            documents: [{ evidence, category: 'other' }],
            allotments: [allocation],
          },
        ],
        ...copied,
        reason: 'Mirror the company’s existing share records.',
      },
      expect.anything(),
    ],
    [URLS.REGISTER_IMPORT_PREVIEW(opened.uuid), decision('approve'), expect.anything()],
    [URLS.REGISTER_IMPORT_DECIDE(opened.uuid), decided('approve'), expect.anything()],
    [URLS.REGISTER_IMPORT_PREVIEW(opened.uuid), decision('apply'), expect.anything()],
    [URLS.REGISTER_IMPORT_DECIDE(opened.uuid), decided('apply'), expect.anything()],
  ]);
  await view.rerender(awardPage);
  await fireEvent.press(
    await screen.findByRole('button', {
      name: /^10 shares, prepared .+ \(issue from the award for Synthetic Holder B\), Shares issued$/,
    }),
  );
  expect(mockNavigate).toHaveBeenLastCalledWith('IssueShares', {
    company: ADMINISTERED.uuid,
    token: FOUNDERS.uuid,
    record: grant.uuid,
  });
  own = { ...ADMINISTRATION, capabilities: ['read_register'] };
  const owner = { userUuid: 'profile-one', ownerAccountUuid: 'account-one' };
  await act(async () => {
    await client.refetchQueries({ queryKey: ownAppointmentsKey(owner), exact: true });
  });
  expect(await screen.findByText(REGISTER_AWARD_COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(screen.getByText('40 shares promised · 10 company-recorded vested')).toBeTruthy();
  expect(
    screen.queryByRole('button', { name: /^(Record vesting|End unissued rights|Correct a vesting event)/ }),
  ).toBeNull();
  await view.rerender(scheme);
  expect(await screen.findByText(REGISTER_AWARD_COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(screen.queryByRole('button', { name: REGISTER_AWARD_COPY.PREPARE })).toBeNull();
  expect(awardPosts()).toHaveLength(2);
  await view.rerender(<IssueSharesScreen route={{ key: 'read-only', name: 'IssueShares', params: undefined }} />);
  expect(await screen.findByText(REGISTER_ALLOTMENT_COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(screen.getByText(REGISTER_GRANT_COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(await screen.findByText('Issued · 2')).toBeTruthy();
  expect(screen.getByRole('button', { name: allotmentSummary })).toBeTruthy();
  expect(screen.getByRole('button', { name: grantSummary })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^(Prepare issue|Review and approve|Record issue|Reject)/ })).toBeNull();
  expect(issuePosts()).toHaveLength(8);
  const pending = { ...transfers[0], uuid: '48484848-4848-4848-8848-484848484848', status: 'submitted' as const };
  transfers = [{ ...pending, stage: 'submitted', registerEntry: null, reviewedAt: null, decisions: [] }, ...transfers];
  await view.rerender(
    <TransferSharesScreen route={{ key: 'read-only-transfers', name: 'TransferShares', params: undefined }} />,
  );
  expect(await screen.findByText(REGISTER_TRANSFER_COPY.READ_ONLY_NOTE)).toBeTruthy();
  await act(async () => screen.getByTestId('transfer-shares-scroll').props.refreshControl.props.onRefresh());
  expect(await screen.findByLabelText('Status: Prepared')).toBeTruthy();
  expect(screen.getByText('Transferred · 1')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^(Prepare a non-paid transfer|Review and approve|Reject)/ })).toBeNull();
  await view.rerender(<ShareholderScreen route={{ key: 'read-only', name: 'Shareholder', params: shareholder }} />);
  expect(await screen.findByText('Founders · FND')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^(Transfer shares|Issue shares to them)/ })).toBeNull();
  expect(transferPosts()).toHaveLength(3);
  const pendingCorrection = {
    ...correction,
    uuid: '51515151-5151-4151-8151-515151515151',
    createdAt: '2026-11-04T07:00:00Z',
  };
  corrections = [pendingCorrection, ...corrections];
  await view.rerender(
    <CorrectionsScreen route={{ key: 'read-only-corrections', name: 'Corrections', params: undefined }} />,
  );
  await act(async () => screen.getByTestId('corrections-scroll').props.refreshControl.props.onRefresh());
  expect(await screen.findByText(REGISTER_CORRECTION_COPY.READ_ONLY_NOTE)).toBeTruthy();
  const corrected = `Correction of the issue of ${formatShortDate(CERTIFIED.companyEventOn)} to Synthetic Holder 1`;
  await waitFor(() => expect(screen.getAllByText(corrected)).toHaveLength(2));
  await settled();
  expect(screen.getByLabelText('Share movements: Synthetic Holder 1: +5')).toBeTruthy();
  expect(screen.getAllByText('Copied opening correction')).toHaveLength(1);
  expect(
    screen.queryByRole('button', { name: /^(Correct|Approve|Apply|Reject|Review|Confirm|Bring records)( |$)/ }),
  ).toBeNull();
  expect(correctionPosts()).toHaveLength(5);
  const decidedImports = importPosts().length;
  await view.rerender(<LedgerScreen />);
  expect(await screen.findByText('Founders · FND')).toBeTruthy();
  await settled();
  expect(screen.queryByRole('button', { name: 'Add share class' })).toBeNull();
  await view.rerender(
    <RegisterSetupScreen route={{ key: 'read-only-setup', name: 'RegisterSetup', params: bringing }} />,
  );
  expect(await screen.findByText(REGISTER_IMPORT_COPY.READ_ONLY_NOTE)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /^(Continue|Save draft and review|Edit records|Confirm)$/ })).toBeNull();
  expect(importPosts()).toHaveLength(decidedImports);
  await view.rerender(<ShareClassScreen route={{ key: 'founders', name: 'ShareClass', params: founders }} />);
  expect(await screen.findByText('No rights recorded.')).toBeTruthy();
  expect(screen.getByText('FND · Ordinary')).toBeTruthy();
  expect(screen.getByLabelText('Issued shares: 8')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Edit (Class rights)' })).toBeNull();
  own = ADMINISTRATION;
  await act(async () => {
    await client.refetchQueries({ queryKey: ownAppointmentsKey(owner), exact: true });
  });
  await act(async () => screen.getByTestId('share-class-scroll').props.refreshControl.props.onRefresh());
  await fireEvent.press(await screen.findByRole('button', { name: 'Edit (Class rights)' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Voting: Not recorded' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'General voting' }));
  await fireEvent.changeText(screen.getByLabelText('Additional terms'), ' Synthetic class terms ');
  const rightsPosts = () => api.post.mock.calls.filter(([url]) => url.endsWith('/class-rights/'));
  expect(rightsPosts()).toHaveLength(0);
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  expect(await screen.findByText('Class rights saved.')).toBeTruthy();
  expect(rightsPosts()).toEqual([
    [
      URLS.CLASS_RIGHTS(FOUNDERS.uuid),
      {
        appointment: ADMINISTRATION.uuid,
        previousRevision: 0,
        summary: 'Synthetic class terms',
        attributes: { voting: { type: 'general' } },
        effectiveDate: null,
        documents: [],
        idempotencyKey: expect.stringMatching(/^00000000-0000-4000-8000-/),
      },
      expect.anything(),
    ],
  ]);
  thirdHolder = true;
  await act(async () => screen.getByTestId('share-class-scroll').props.refreshControl.props.onRefresh());
  await fireEvent.press(await screen.findByRole('button', { name: 'Add documents', disabled: false }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Shareholder: Synthetic Holder A' }));
  expect(screen.getByRole('radio', { name: 'Synthetic Holder C' })).toBeTruthy();
  await fireEvent.press(screen.getByRole('radio', { name: 'Synthetic Holder B' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Add document' }));
  await fireEvent.press(screen.getByRole('button', { name: 'File. Choose file' }));
  await screen.findByRole('button', { name: 'File, synthetic.pdf. Choose file' });
  await fireEvent.press(screen.getByRole('button', { name: 'Save documents' }));
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Save documents' })).toBeNull());
  expect(api.post.mock.calls.filter(([url]) => url === URLS.REGISTER_MEMBER_DOCUMENTS)).toEqual([
    [
      URLS.REGISTER_MEMBER_DOCUMENTS,
      expect.objectContaining({
        companyId: ADMINISTERED.uuid,
        member: HOLDER_B.member,
        token: FOUNDERS.uuid,
        category: 'other',
        appointment: ADMINISTRATION.uuid,
      }),
      expect.anything(),
    ],
  ]);
  thirdHolder = false;
  await view.rerender(<CertificatesScreen route={{ key: 'register', name: 'Certificates', params: undefined }} />);
  expect(await screen.findByText('Certificate: Can prepare')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Prepare certificate (entry 13)', disabled: false }));
  const certificate = { name: 'Download PDF (unsigned certificate for entry 13)', disabled: false };
  const preview = { name: 'Preview (unsigned certificate for entry 13)' };
  const refusal = 'The certificate could not be downloaded. Refresh the preview and try again.';
  const shares = jest.mocked(Sharing.shareAsync);
  shares.mockRejectedValueOnce(new Error('Synthetic share sheet refusal'));
  await fireEvent.press(screen.getByRole('button', preview));
  await fireEvent.press(await screen.findByRole('button', certificate));
  expect(await screen.findByText(refusal)).toBeTruthy();
  expect(screen.queryByText('The unsigned certificate was downloaded.')).toBeNull();
  await fireEvent.press(screen.getByRole('button', preview));
  await fireEvent.press(await screen.findByRole('button', certificate));
  expect(await screen.findByText('The unsigned certificate was downloaded.')).toBeTruthy();
  expect(screen.queryByText(refusal)).toBeNull();
  await view.rerender(<InspectionCopiesScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Prepare inspection copy', disabled: false }));
  await fireEvent.changeText(screen.getByLabelText('Written instruction reference'), 'Synthetic instruction');
  await fireEvent.changeText(screen.getByLabelText('Recipient'), 'Synthetic recipient');
  await fireEvent.press(screen.getByRole('button', { name: 'Preview inspection copy' }));
  const copy = { name: 'Confirm and download inspection copy', disabled: false };
  await fireEvent.press(await screen.findByRole('button', copy));
  expect(await screen.findByText('The inspection copy was downloaded.')).toBeTruthy();
  await view.rerender(<CompanyPackScreen />);
  await fireEvent.press(await screen.findByRole('button', { name: 'Prepare company pack', disabled: false }));
  await fireEvent.changeText(screen.getByLabelText('Pack instruction reference'), 'Synthetic pack instruction');
  await fireEvent.changeText(screen.getByLabelText('Pack recipient'), 'Synthetic pack recipient');
  await fireEvent.press(screen.getByRole('button', { name: 'Prepare and download company pack' }));
  expect(await screen.findByText('The company pack was downloaded.')).toBeTruthy();
  const bytes = expect.objectContaining({ responseType: 'arraybuffer' });
  const issued = [
    URLS.REGISTER_CERTIFICATE(FOUNDERS.uuid),
    { appointment: ADMINISTRATION.uuid, sequence: 13, sourceDigest: DIGEST },
    bytes,
  ];
  expect(outputPosts()).toEqual([
    issued,
    issued,
    [
      URLS.REGISTER_INSPECTION_COPY(FOUNDERS.uuid),
      {
        instruction: 'Synthetic instruction',
        recipient: 'Synthetic recipient',
        requestedOn: sydneyToday(),
        appointment: ADMINISTRATION.uuid,
        sourceDigest: DIGEST,
      },
      bytes,
    ],
    [
      COMPANY_ENDPOINTS.PACK(ADMINISTERED.uuid),
      {
        appointment: ADMINISTRATION.uuid,
        instruction: 'Synthetic pack instruction',
        recipient: 'Synthetic pack recipient',
      },
      bytes,
    ],
  ]);
  const sheet = (name: string, mimeType: string) => [`file:///cache/ledova-document-views-v1/${name}`, { mimeType }];
  expect(shares.mock.calls).toEqual([
    sheet('certificate-FND-13.pdf', 'application/pdf'),
    sheet('certificate-FND-13.pdf', 'application/pdf'),
    sheet('register-FND-inspection-copy.csv', 'text/csv'),
    sheet(`company-pack-${ADMINISTERED.uuid}.zip`, 'application/zip'),
  ]);
  await view.rerender(certificatesPage);
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
  expect(destinationOf({ type: 'publication', event: 'published', kind: 'meeting_notice' })).toBeUndefined();
  expect(destinationOf({ type: 'certificate', event: 'ready', company: MEMBER_RECORD.company.uuid })).toBeUndefined();
  const award = 'f5f5f5f5-f5f5-4f5f-8f5f-f5f5f5f5f5f5';
  const vested = { type: 'award', event: 'vested', record: MEMBER_RECORD.uuid, award };
  expect(destinationOf(vested)).toEqual({
    screen: 'Dashboard',
    params: { record: MEMBER_RECORD.uuid, award },
    pop: true,
  });
  expect(destinationOf({ ...vested, award: undefined })).toBeUndefined();
});
