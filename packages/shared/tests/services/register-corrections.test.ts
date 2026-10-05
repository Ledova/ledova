import axios from 'axios';
import { REGISTER_CORRECTION_COPY } from '../../src/constants/business/register-corrections';
import {
  decideRegisterCorrection,
  downloadRegisterCorrectionFile,
  getRegisterCorrections,
  getRegisterEntries,
  prepareRegisterCorrection,
  previewRegisterCorrectionDecision,
} from '../../src/services/register-corrections';

const SESSION = { timeout: 1000, ledovaSessionEpoch: 3 };
const CHANGE = { member: 'member-a', shares: '-9007199254740993' };

afterEach(() => jest.restoreAllMocks());

it('reads entries, lists, prepares, previews, decides and downloads through the correction routes', async () => {
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: { changes: [] } });
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [] } });
  const preparation = {
    operationId: 'correction-a',
    appointment: 'appointment-a',
    correctsId: 'entry-a',
    authorityEvidence: 'authority-a',
    effectiveOn: '2026-09-20',
    authority: 'director_resolution' as const,
    approvingDirector: 'Synthetic Director',
    authorityReference: 'SYNTHETIC-1',
    reason: 'Reverse the duplicate issue',
  };
  const decision = {
    appointment: 'appointment-a',
    kind: 'approve' as const,
    reason: '',
    idempotencyKey: 'key-a',
    previewDigest: 'a'.repeat(64),
    confirmation: true,
  };
  await getRegisterEntries(api, 'class-a', { page: 2 }, SESSION);
  await getRegisterCorrections(api, { company: 'company-a', register: 'register-a', status: 'submitted', page: 2 });
  await prepareRegisterCorrection(api, preparation, SESSION);
  await previewRegisterCorrectionDecision(api, 'correction-a', { appointment: 'appointment-a', kind: 'approve' });
  await decideRegisterCorrection(api, 'correction-a', decision, SESSION);
  await downloadRegisterCorrectionFile(api, 'correction-a', SESSION);
  expect(get.mock.calls).toEqual([
    [
      '/api/v1/tokens/class-a/register/entries/',
      { ...SESSION, params: { page: 2 }, paramsSerializer: { indexes: null } },
    ],
    [
      '/api/v1/tokens/register-corrections/',
      { params: { company: 'company-a', register: 'register-a', status: 'submitted', page: 2 } },
    ],
    ['/api/v1/tokens/register-corrections/correction-a/file/', { ...SESSION, responseType: 'blob' }],
  ]);
  expect(post.mock.calls).toEqual([
    ['/api/v1/tokens/register-corrections/', preparation, SESSION],
    [
      '/api/v1/tokens/register-corrections/correction-a/decision-preview/',
      { appointment: 'appointment-a', kind: 'approve' },
      {},
    ],
    ['/api/v1/tokens/register-corrections/correction-a/decide/', decision, SESSION],
  ]);
});

it('names each wanted register entry in its own entry parameter', async () => {
  const api = axios.create({ baseURL: 'https://api.example.test' });
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [] } });
  await getRegisterEntries(api, 'class-a', { entry: ['entry-a', 'entry-b'], page: 1 });
  const [url, config] = get.mock.calls[0]!;
  expect(api.getUri({ ...config, url })).toBe(
    'https://api.example.test/api/v1/tokens/class-a/register/entries/?entry=entry-a&entry=entry-b&page=1',
  );
});

it('types the changes of every correction read and refuses changes it cannot read', async () => {
  const api = axios.create();
  const record = { uuid: 'correction-a', changes: [CHANGE] };
  jest.spyOn(api, 'get').mockResolvedValueOnce({ data: { results: [record], next: null } });
  const { data } = await getRegisterCorrections(api);
  expect(data.results).toEqual([record]);
  expect(data.results[0]!.changes[0]!.shares).toBe('-9007199254740993');
  jest.spyOn(api, 'post').mockResolvedValueOnce({ data: record }).mockResolvedValueOnce({ data: record });
  expect((await prepareRegisterCorrection(api, {} as never)).data).toEqual(record);
  expect((await decideRegisterCorrection(api, 'correction-a', {} as never)).data).toEqual(record);
  for (const changes of [undefined, null, {}, [{ ...CHANGE, shares: -5 }], [{ shares: '5' }], [null]]) {
    jest.spyOn(api, 'post').mockResolvedValueOnce({ data: { ...record, changes } });
    await expect(decideRegisterCorrection(api, 'correction-a', {} as never)).rejects.toThrow(
      REGISTER_CORRECTION_COPY.CHANGES_UNREADABLE,
    );
  }
  jest.spyOn(api, 'post').mockResolvedValueOnce({ data: { ...record, changes: [{ member: 7, shares: '5' }] } });
  await expect(prepareRegisterCorrection(api, {} as never)).rejects.toThrow(
    REGISTER_CORRECTION_COPY.CHANGES_UNREADABLE,
  );
  jest.spyOn(api, 'get').mockResolvedValueOnce({ data: { results: [{ ...record, changes: 'none' }], next: null } });
  await expect(getRegisterCorrections(api)).rejects.toThrow(REGISTER_CORRECTION_COPY.CHANGES_UNREADABLE);
});
