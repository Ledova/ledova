import axios from 'axios';
import { REGISTER_LINK_COPY } from '../../src/constants/business/register-links';
import {
  decideRegisterLink,
  downloadRegisterLinkFile,
  getRegisterLinks,
  getRegisterWaitingWallets,
  prepareRegisterLink,
  previewRegisterLinkDecision,
} from '../../src/services/register-links';

const SESSION = { timeout: 1000, ledovaSessionEpoch: 3 };
const ROUTE = '/api/v1/tokens/register-links/';
const LINK = { address: '0x' + '1'.repeat(40), member: 'member-a' };
const RECORD = { uuid: 'link-a', mapping: [LINK] };
const page = (results: unknown[], next: number | null) => ({
  data: { results, next: next === null ? null : `https://api.example.com${ROUTE}?page=${next}` },
});

afterEach(() => jest.restoreAllMocks());

it('reads the waiting wallets, prepares, previews, decides and downloads through the link routes', async () => {
  const api = axios.create();
  const waiting = {
    wallets: [{ address: LINK.address, waiting: 2, walletProof: 'proven', holderType: 'member', holderName: 'Ada' }],
  };
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: RECORD });
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: waiting });
  const preparation = {
    operationId: 'link-a',
    appointment: 'appointment-a',
    companyId: 'company-a',
    authorityEvidence: 'authority-a',
    mapping: [LINK],
    authority: 'director_resolution' as const,
    approvingDirector: 'Synthetic Director',
    authorityReference: 'SYNTHETIC-LINK-1',
    reason: "Link the new subscriber's wallet to their member record",
  };
  const decision = {
    appointment: 'appointment-a',
    kind: 'apply' as const,
    reason: '',
    idempotencyKey: 'key-a',
    previewDigest: 'a'.repeat(64),
    confirmation: true,
  };
  expect((await getRegisterWaitingWallets(api, 'company-a', SESSION)).data).toEqual(waiting);
  expect((await prepareRegisterLink(api, preparation, SESSION)).data).toEqual(RECORD);
  await previewRegisterLinkDecision(api, 'link-a', { appointment: 'appointment-a', kind: 'apply' }, SESSION);
  expect((await decideRegisterLink(api, 'link-a', decision, SESSION)).data).toEqual(RECORD);
  await downloadRegisterLinkFile(api, 'link-a', SESSION);
  expect(get.mock.calls).toEqual([
    [`${ROUTE}waiting-wallets/`, { ...SESSION, params: { company: 'company-a' } }],
    [`${ROUTE}link-a/file/`, { ...SESSION, responseType: 'blob' }],
  ]);
  expect(post.mock.calls).toEqual([
    [ROUTE, preparation, SESSION],
    [`${ROUTE}link-a/decision-preview/`, { appointment: 'appointment-a', kind: 'apply' }, SESSION],
    [`${ROUTE}link-a/decide/`, decision, SESSION],
  ]);
});

it('lists every page of links with the company and status filters, in page order', async () => {
  const api = axios.create();
  const later = { uuid: 'link-b', mapping: [{ ...LINK, member: 'member-b' }] };
  const get = jest
    .spyOn(api, 'get')
    .mockResolvedValueOnce(page([RECORD], 2))
    .mockResolvedValueOnce(page([later], null));
  const filters = { company: 'company-a', status: 'submitted' as const };
  expect(await getRegisterLinks(api, filters, SESSION)).toEqual([RECORD, later]);
  expect(get.mock.calls).toEqual([
    [ROUTE, { ...SESSION, params: { ...filters, page: 1 } }],
    [ROUTE, { ...SESSION, params: { ...filters, page: 2 } }],
  ]);
});

it('lists, reads the waiting wallets, previews and downloads without a session config', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue(page([], null));
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  await getRegisterLinks(api);
  await getRegisterWaitingWallets(api, 'company-a');
  await previewRegisterLinkDecision(api, 'link-a', { appointment: 'appointment-a', kind: 'approve' });
  await downloadRegisterLinkFile(api, 'link-a');
  expect(get.mock.calls).toEqual([
    [ROUTE, { params: { page: 1 } }],
    [`${ROUTE}waiting-wallets/`, { params: { company: 'company-a' } }],
    [`${ROUTE}link-a/file/`, { responseType: 'blob' }],
  ]);
  expect(post.mock.calls).toEqual([
    [`${ROUTE}link-a/decision-preview/`, { appointment: 'appointment-a', kind: 'approve' }, {}],
  ]);
});

it('types the mapping of every link read and refuses a mapping it cannot read', async () => {
  const api = axios.create();
  jest.spyOn(api, 'get').mockResolvedValueOnce(page([RECORD], null));
  const [listed] = await getRegisterLinks(api);
  expect(listed).toEqual(RECORD);
  expect(listed!.mapping[0]!.member).toBe('member-a');
  jest.spyOn(api, 'post').mockResolvedValueOnce({ data: RECORD }).mockResolvedValueOnce({ data: RECORD });
  expect((await prepareRegisterLink(api, {} as never)).data).toEqual(RECORD);
  expect((await decideRegisterLink(api, 'link-a', {} as never)).data).toEqual(RECORD);
  for (const mapping of [undefined, null, {}, 'none', [null], [{ address: LINK.address }], [{ ...LINK, member: 7 }]]) {
    jest.spyOn(api, 'post').mockResolvedValueOnce({ data: { ...RECORD, mapping } });
    await expect(decideRegisterLink(api, 'link-a', {} as never)).rejects.toThrow(REGISTER_LINK_COPY.MAPPING_UNREADABLE);
  }
  jest.spyOn(api, 'post').mockResolvedValueOnce({ data: { ...RECORD, mapping: [{ ...LINK, address: null }] } });
  await expect(prepareRegisterLink(api, {} as never)).rejects.toThrow(REGISTER_LINK_COPY.MAPPING_UNREADABLE);
  jest
    .spyOn(api, 'get')
    .mockResolvedValueOnce(page([RECORD], 2))
    .mockResolvedValueOnce(page([{ ...RECORD, uuid: 'link-b', mapping: [7] }], null));
  await expect(getRegisterLinks(api)).rejects.toThrow(REGISTER_LINK_COPY.MAPPING_UNREADABLE);
});
