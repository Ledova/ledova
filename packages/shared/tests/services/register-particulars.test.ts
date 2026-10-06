import axios from 'axios';
import {
  decideRegisterParticularsChange,
  downloadRegisterParticularsChangeFile,
  getRegisterParticularsChanges,
  prepareRegisterParticularsChange,
  previewRegisterParticularsChangeDecision,
} from '../../src/services/register-particulars';

const SESSION = { timeout: 1000, ledovaSessionEpoch: 3 };
const ROUTE = '/api/v1/tokens/register-particulars-changes/';

afterEach(() => jest.restoreAllMocks());

it('lists, prepares, previews, decides and downloads through the particulars change routes', async () => {
  const api = axios.create();
  const record = { uuid: 'change-a', evidenceSnapshot: { name: 'deed-poll.pdf' } };
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: record });
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [record], next: null } });
  const preparation = {
    operationId: 'change-a',
    appointment: 'appointment-a',
    member: 'member-a',
    supportingEvidence: 'supporting-a',
    name: 'Synthetic Member Renamed',
    residentialAddress: '8 Synthetic Street, Melbourne VIC 3000',
    asAt: '2026-09-20',
    reason: 'The member changed their name by deed poll and moved',
  };
  const decision = {
    appointment: 'appointment-a',
    kind: 'apply' as const,
    reason: '',
    idempotencyKey: 'key-a',
    previewDigest: 'a'.repeat(64),
    confirmation: true,
  };
  const query = { company: 'company-a', member: 'member-a', status: 'submitted' as const, page: 2 };
  expect((await getRegisterParticularsChanges(api, query, SESSION)).data.results).toEqual([record]);
  expect((await prepareRegisterParticularsChange(api, preparation, SESSION)).data).toEqual(record);
  await previewRegisterParticularsChangeDecision(
    api,
    'change-a',
    { appointment: 'appointment-a', kind: 'apply' },
    SESSION,
  );
  expect((await decideRegisterParticularsChange(api, 'change-a', decision, SESSION)).data).toEqual(record);
  await downloadRegisterParticularsChangeFile(api, 'change-a', SESSION);
  expect(get.mock.calls).toEqual([
    [ROUTE, { ...SESSION, params: query }],
    [`${ROUTE}change-a/file/`, { ...SESSION, responseType: 'blob' }],
  ]);
  expect(post.mock.calls).toEqual([
    [ROUTE, preparation, SESSION],
    [`${ROUTE}change-a/decision-preview/`, { appointment: 'appointment-a', kind: 'apply' }, SESSION],
    [`${ROUTE}change-a/decide/`, decision, SESSION],
  ]);
});

it('lists, previews and downloads without a session config', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [] } });
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  await getRegisterParticularsChanges(api);
  await previewRegisterParticularsChangeDecision(api, 'change-a', { appointment: 'appointment-a', kind: 'approve' });
  await downloadRegisterParticularsChangeFile(api, 'change-a');
  expect(get.mock.calls).toEqual([
    [ROUTE, { params: {} }],
    [`${ROUTE}change-a/file/`, { responseType: 'blob' }],
  ]);
  expect(post.mock.calls).toEqual([
    [`${ROUTE}change-a/decision-preview/`, { appointment: 'appointment-a', kind: 'approve' }, {}],
  ]);
});
