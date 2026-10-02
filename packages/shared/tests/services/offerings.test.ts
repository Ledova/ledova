import axios from 'axios';
import { getOfferings, getOfferingSubscriptions } from '../../src/services/offerings';

afterEach(() => jest.restoreAllMocks());

it('preserves the default issuer reads and requests explicit subsequent pages', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [], next: null } });

  await getOfferings(api);
  await getOfferings(api, 3);
  await getOfferingSubscriptions(api, 'offering-one');
  await getOfferingSubscriptions(api, 'offering-one', 4);

  expect(get).toHaveBeenNthCalledWith(1, '/api/v1/offerings/');
  expect(get).toHaveBeenNthCalledWith(2, '/api/v1/offerings/', { params: { page: 3 } });
  expect(get).toHaveBeenNthCalledWith(3, '/api/v1/offerings/offering-one/subscriptions/');
  expect(get).toHaveBeenNthCalledWith(4, '/api/v1/offerings/offering-one/subscriptions/', { params: { page: 4 } });
});

it('preserves unconfigured write call shapes and forwards explicit transport configs', async () => {
  const { addOfferingDocuments, createOffering, updateOffering, deleteOffering, submitOffering, withdrawOffering } =
    await import('../../src/services/offerings');
  const { updateCompany } = await import('../../src/services/companies');
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  const patch = jest.spyOn(api, 'patch').mockResolvedValue({ data: {} });
  const remove = jest.spyOn(api, 'delete').mockResolvedValue({ data: {} });
  const data = {} as Parameters<typeof createOffering>[1];
  const config = { timeout: 1234 };
  await createOffering(api, data);
  await updateOffering(api, 'one', data);
  await submitOffering(api, 'one');
  await withdrawOffering(api, 'one', 'Example');
  await addOfferingDocuments(api, 'one', ['memorandum', 'supplement']);
  await deleteOffering(api, 'one');
  await updateCompany(api, 'company', { isOpenToInvestors: true });
  expect(post.mock.calls).toEqual([
    ['/api/v1/offerings/', data],
    ['/api/v1/offerings/one/submit/', {}],
    ['/api/v1/offerings/one/withdraw/', { reason: 'Example' }],
    ['/api/v1/offerings/one/documents/', { documents: ['memorandum', 'supplement'] }],
  ]);
  expect(patch.mock.calls).toEqual([
    ['/api/v1/offerings/one/', data],
    ['/api/v1/companies/company/', { isOpenToInvestors: true }],
  ]);
  expect(remove).toHaveBeenCalledWith('/api/v1/offerings/one/');
  post.mockClear();
  patch.mockClear();
  remove.mockClear();
  await createOffering(api, data, config);
  await updateOffering(api, 'one', data, config);
  await submitOffering(api, 'one', config);
  await withdrawOffering(api, 'one', 'Example', config);
  await addOfferingDocuments(api, 'one', ['supplement'], config);
  await deleteOffering(api, 'one', config);
  await updateCompany(api, 'company', { isOpenToInvestors: true }, config);
  expect([...post.mock.calls, ...patch.mock.calls, ...remove.mock.calls].every((call) => call.at(-1) === config)).toBe(
    true,
  );
});
