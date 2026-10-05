import axios from 'axios';
import {
  decideRegisterImport,
  downloadRegisterImportFile,
  getRegisterImports,
  prepareRegisterImport,
  previewRegisterImportDecision,
  uploadRegisterEvidence,
} from '../../src/services/register-imports';

afterEach(() => jest.restoreAllMocks());

it('uploads one evidence file as multipart with the company, appointment, kind and retry key', async () => {
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  const file = new Blob(['%PDF'], { type: 'application/pdf' });
  const session = { timeout: 1000, ledovaSessionEpoch: 3 };
  await uploadRegisterEvidence(
    api,
    { companyId: 'company-a', appointment: 'appointment-a', kind: 'asic_extract', idempotencyKey: 'key-a', file },
    session,
  );
  const [path, form, config] = post.mock.calls[0] as [string, FormData, Record<string, unknown>];
  expect(path).toBe('/api/v1/tokens/register-evidence/');
  expect(['company_id', 'appointment', 'kind', 'idempotency_key'].map((name) => [name, form.get(name)])).toEqual([
    ['company_id', 'company-a'],
    ['appointment', 'appointment-a'],
    ['kind', 'asic_extract'],
    ['idempotency_key', 'key-a'],
  ]);
  expect(form.get('file')).toBeInstanceOf(Blob);
  expect(config).toEqual({ ...session, headers: { 'Content-Type': 'multipart/form-data' } });
});

it('prepares, lists, previews, decides and downloads through the import routes', async () => {
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: { members: [], formerMembers: [] } });
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [] } });
  const preparation = {
    operationId: 'import-a',
    appointment: 'appointment-a',
    tokenId: 'class-a',
    registerEvidence: 'register-a',
    asicEvidence: 'asic-a',
    asicIssuedTotal: '100',
    asicMemberCount: 1,
    asAt: '2026-09-20',
    members: [],
    formerMembers: [],
    authority: 'director_resolution' as const,
    approvingDirector: 'Synthetic Director',
    authorityReference: 'SYNTHETIC-1',
    reason: 'Import the register',
  };
  await prepareRegisterImport(api, preparation);
  await getRegisterImports(api, { token: 'class-a', status: 'submitted', page: 2 });
  await previewRegisterImportDecision(api, 'import-a', { appointment: 'appointment-a', kind: 'approve', reason: '' });
  await decideRegisterImport(api, 'import-a', {
    appointment: 'appointment-a',
    kind: 'approve',
    reason: '',
    idempotencyKey: 'key-b',
    previewDigest: 'a'.repeat(64),
    confirmation: true,
  });
  await downloadRegisterImportFile(api, 'import-a', 'asic');
  await downloadRegisterImportFile(api, 'import-a', 'register');
  expect(post.mock.calls.map(([path]) => path)).toEqual([
    '/api/v1/tokens/register-imports/',
    '/api/v1/tokens/register-imports/import-a/decision-preview/',
    '/api/v1/tokens/register-imports/import-a/decide/',
  ]);
  expect(post.mock.calls[0]![1]).toBe(preparation);
  expect(get.mock.calls).toEqual([
    ['/api/v1/tokens/register-imports/', { params: { token: 'class-a', status: 'submitted', page: 2 } }],
    ['/api/v1/tokens/register-imports/import-a/asic-file/', { responseType: 'blob' }],
    ['/api/v1/tokens/register-imports/import-a/file/', { responseType: 'blob' }],
  ]);
});

it('types the rows of every import read and refuses rows it cannot read', async () => {
  const api = axios.create();
  const member = {
    name: 'Synthetic Member',
    member: 'member-a',
    shares: '9007199254740993',
    enteredOn: '2019-05-01',
    amountPaid: null,
    residentialAddress: '1 Synthetic Street',
  };
  const former = {
    name: 'Synthetic Former',
    shares: '40',
    ceasedOn: '2022-03-01',
    residentialAddress: '2 Synthetic Road',
  };
  const record = { uuid: 'import-a', members: [member], formerMembers: [former] };
  jest.spyOn(api, 'get').mockResolvedValueOnce({ data: { results: [record], next: null } });
  const { data } = await getRegisterImports(api, { token: 'class-a' });
  expect(data.results).toEqual([record]);
  expect(data.results[0]!.members[0]!.shares).toBe('9007199254740993');
  for (const members of [undefined, [{ ...member, amountPaid: 250 }], [{ ...member, residentialAddress: undefined }]]) {
    jest.spyOn(api, 'post').mockResolvedValueOnce({ data: { ...record, members } });
    await expect(decideRegisterImport(api, 'import-a', {} as never)).rejects.toThrow(
      'The register import rows could not be read.',
    );
  }
  jest
    .spyOn(api, 'post')
    .mockResolvedValueOnce({ data: { ...record, formerMembers: [{ ...former, ceasedOn: null }] } });
  await expect(prepareRegisterImport(api, {} as never)).rejects.toThrow('The register import rows could not be read.');
});
