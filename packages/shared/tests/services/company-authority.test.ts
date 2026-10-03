import axios from 'axios';
import { getCompanies } from '../../src/services/companies';
import {
  admitCompanyAuthorityRequest,
  downloadCompanyAuthorityFile,
  getCompanyAuthorityRequests,
  revokeCompanyAuthorityAppointment,
  submitCompanyAuthorityRequest,
  withdrawCompanyAuthorityRequest,
} from '../../src/services/company-authority';

afterEach(() => jest.restoreAllMocks());

it('admits the exact retained request using only the accepted declaration version and preserves transport scope', async () => {
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: { status: 'admitted' } });
  const config = { timeout: 1000, ledovaSessionEpoch: 4 };
  await admitCompanyAuthorityRequest(api, 'request-a', config);
  expect(post).toHaveBeenCalledWith(
    '/api/v1/company-authority/requests/request-a/admit/',
    { declarationVersion: '2026-10-04', acceptDeclaration: true },
    config,
  );
});

it('revokes the requester appointment for the exact request without caller authority claims', async () => {
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: { status: 'admitted' } });
  const config = { timeout: 1000, ledovaSessionEpoch: 4 };
  await revokeCompanyAuthorityAppointment(api, 'request-a', config);
  expect(post).toHaveBeenCalledWith('/api/v1/company-authority/requests/request-a/revoke/', {}, config);
});

it('withdraws the exact request with no caller claims and preserves the authenticated transport scope', async () => {
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: { status: 'withdrawn' } });
  const config = { timeout: 1000, ledovaSessionEpoch: 4 };
  const response = await withdrawCompanyAuthorityRequest(api, 'request-a', config);
  expect(post).toHaveBeenCalledWith('/api/v1/company-authority/requests/request-a/withdraw/', {}, config);
  expect(response.data.status).toBe('withdrawn');
});

it('preserves existing company reads and requests the selected owned-company page', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [], next: null } });
  await getCompanies(api);
  await getCompanies(api, 2);
  expect(get).toHaveBeenNthCalledWith(1, '/api/v1/companies/');
  expect(get).toHaveBeenNthCalledWith(2, '/api/v1/companies/', { params: { page: 2 } });
});

it('submits only proposed scope and evidence, with independent personal and delegation capabilities', async () => {
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: { status: 'pending' } });
  const file = new Blob(['synthetic authority evidence'], { type: 'application/pdf' });
  const config = { timeout: 1000, ledovaSessionEpoch: 4 };
  await submitCompanyAuthorityRequest(
    api,
    {
      company: 'company-a',
      idempotencyKey: 'idempotency-a',
      file,
      requestedCapabilities: ['prepare', 'read_register'],
      delegatableCapabilities: ['approve'],
      requestedExpiresAt: '2027-01-31T23:59:59Z',
    },
    config,
  );
  const [url, form, sentConfig] = post.mock.calls[0]!;
  expect(url).toBe('/api/v1/company-authority/requests/');
  expect(Array.from((form as FormData).keys())).toEqual([
    'company',
    'idempotency_key',
    'file',
    'requested_capabilities',
    'requested_capabilities',
    'delegatable_capabilities',
    'requested_expires_at',
  ]);
  expect((form as FormData).get('company')).toBe('company-a');
  expect((form as FormData).get('idempotency_key')).toBe('idempotency-a');
  expect((form as FormData).getAll('requested_capabilities')).toEqual(['prepare', 'read_register']);
  expect((form as FormData).getAll('delegatable_capabilities')).toEqual(['approve']);
  expect(sentConfig).toEqual({
    timeout: 1000,
    ledovaSessionEpoch: 4,
    headers: { 'Content-Type': 'multipart/form-data' },
  });
});

it('allows an independently requested delegation scope without a personal capability', async () => {
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  await submitCompanyAuthorityRequest(api, {
    company: 'company-a',
    idempotencyKey: 'key-a',
    file: new Blob(),
    requestedCapabilities: [],
    delegatableCapabilities: ['approve'],
  });
  const form = post.mock.calls[0]![1] as FormData;
  expect(form.getAll('requested_capabilities')).toEqual([]);
  expect(form.getAll('delegatable_capabilities')).toEqual(['approve']);
  expect(form.has('requested_expires_at')).toBe(false);
});

it('reads requester history using company filters and downloads private bytes through the authenticated client', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: {} });
  await getCompanyAuthorityRequests(api, 'company-a', 2);
  const config = { timeout: 1000, ledovaSessionEpoch: 4 };
  await downloadCompanyAuthorityFile(api, 'request-a', config);
  expect(get).toHaveBeenNthCalledWith(1, '/api/v1/company-authority/requests/', {
    params: { page: 2, company: 'company-a' },
  });
  expect(get).toHaveBeenNthCalledWith(2, '/api/v1/company-authority/requests/request-a/file/', {
    ledovaSessionEpoch: 4,
    timeout: 1000,
    responseType: 'arraybuffer',
  });
});
