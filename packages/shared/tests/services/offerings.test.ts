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
