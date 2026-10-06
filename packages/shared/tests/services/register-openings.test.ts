import axios from 'axios';
import { REGISTER_OPENING_COPY } from '../../src/constants/business/register-openings';
import {
  decideRegisterOpening,
  downloadRegisterOpeningFile,
  getRegisterOpeningHolders,
  getRegisterOpenings,
  prepareRegisterOpening,
  previewRegisterOpeningDecision,
} from '../../src/services/register-openings';

const SESSION = { timeout: 1000, ledovaSessionEpoch: 3 };
const LINK = { address: '0x' + '1'.repeat(40), member: 'member-a' };

afterEach(() => jest.restoreAllMocks());

it('reads holders, lists, prepares, previews, decides and downloads through the opening routes', async () => {
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: { mapping: [] } });
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [] } });
  const preparation = {
    operationId: 'opening-a',
    appointment: 'appointment-a',
    tokenId: 'class-a',
    authorityEvidence: 'authority-a',
    mapping: [LINK],
    authority: 'director_resolution' as const,
    approvingDirector: 'Synthetic Director',
    authorityReference: 'SYNTHETIC-1',
    reason: 'Open the register from the chain',
  };
  const decision = {
    appointment: 'appointment-a',
    kind: 'approve' as const,
    reason: '',
    idempotencyKey: 'key-a',
    previewDigest: 'a'.repeat(64),
    confirmation: true,
  };
  await getRegisterOpeningHolders(api, 'class-a', SESSION);
  await getRegisterOpenings(api, { company: 'company-a', token: 'class-a', status: 'submitted', page: 2 }, SESSION);
  await prepareRegisterOpening(api, preparation, SESSION);
  await previewRegisterOpeningDecision(api, 'opening-a', { appointment: 'appointment-a', kind: 'approve' });
  await decideRegisterOpening(api, 'opening-a', decision, SESSION);
  await downloadRegisterOpeningFile(api, 'opening-a', SESSION);
  expect(get.mock.calls).toEqual([
    ['/api/v1/tokens/class-a/register/opening-holders/', SESSION],
    [
      '/api/v1/tokens/register-openings/',
      { ...SESSION, params: { company: 'company-a', token: 'class-a', status: 'submitted', page: 2 } },
    ],
    ['/api/v1/tokens/register-openings/opening-a/file/', { ...SESSION, responseType: 'blob' }],
  ]);
  expect(post.mock.calls).toEqual([
    ['/api/v1/tokens/register-openings/', preparation, SESSION],
    [
      '/api/v1/tokens/register-openings/opening-a/decision-preview/',
      { appointment: 'appointment-a', kind: 'approve' },
      {},
    ],
    ['/api/v1/tokens/register-openings/opening-a/decide/', decision, SESSION],
  ]);
});

it('reads the holders and lists openings without a session config', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [] } });
  await getRegisterOpeningHolders(api, 'class-a');
  await getRegisterOpenings(api);
  await downloadRegisterOpeningFile(api, 'opening-a');
  expect(get.mock.calls).toEqual([
    ['/api/v1/tokens/class-a/register/opening-holders/', {}],
    ['/api/v1/tokens/register-openings/', { params: {} }],
    ['/api/v1/tokens/register-openings/opening-a/file/', { responseType: 'blob' }],
  ]);
});

it('answers the holders read as the API gives it', async () => {
  const api = axios.create();
  const holders = {
    block: { number: 12, hash: '0x' + 'c'.repeat(64), date: '2026-09-20' },
    holdings: [{ address: LINK.address, shares: '9007199254740993', member: null, memberName: null }],
  };
  jest.spyOn(api, 'get').mockResolvedValueOnce({ data: holders });
  expect((await getRegisterOpeningHolders(api, 'class-a')).data).toEqual(holders);
});

it('types the mapping of every opening read and refuses a mapping it cannot read', async () => {
  const api = axios.create();
  const record = { uuid: 'opening-a', mapping: [LINK] };
  jest.spyOn(api, 'get').mockResolvedValueOnce({ data: { results: [record], next: null } });
  const { data } = await getRegisterOpenings(api);
  expect(data.results).toEqual([record]);
  expect(data.results[0]!.mapping[0]!.member).toBe('member-a');
  jest.spyOn(api, 'post').mockResolvedValueOnce({ data: record }).mockResolvedValueOnce({ data: record });
  expect((await prepareRegisterOpening(api, {} as never)).data).toEqual(record);
  expect((await decideRegisterOpening(api, 'opening-a', {} as never)).data).toEqual(record);
  for (const mapping of [undefined, null, {}, 'none', [null], [{ address: LINK.address }], [{ ...LINK, member: 7 }]]) {
    jest.spyOn(api, 'post').mockResolvedValueOnce({ data: { ...record, mapping } });
    await expect(decideRegisterOpening(api, 'opening-a', {} as never)).rejects.toThrow(
      REGISTER_OPENING_COPY.MAPPING_UNREADABLE,
    );
  }
  jest.spyOn(api, 'post').mockResolvedValueOnce({ data: { ...record, mapping: [{ ...LINK, address: null }] } });
  await expect(prepareRegisterOpening(api, {} as never)).rejects.toThrow(REGISTER_OPENING_COPY.MAPPING_UNREADABLE);
  jest.spyOn(api, 'get').mockResolvedValueOnce({ data: { results: [{ ...record, mapping: [7] }], next: null } });
  await expect(getRegisterOpenings(api)).rejects.toThrow(REGISTER_OPENING_COPY.MAPPING_UNREADABLE);
});
