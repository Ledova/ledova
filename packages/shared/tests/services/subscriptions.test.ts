import axios from 'axios';
import { getSubscriptions } from '../../src/services/subscriptions';

afterEach(() => jest.restoreAllMocks());

it('preserves the existing first-page call and can request subsequent applicant pages', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [], next: null } });

  await getSubscriptions(api);
  await getSubscriptions(api, 3);

  expect(get).toHaveBeenNthCalledWith(1, '/api/v1/subscriptions/');
  expect(get).toHaveBeenNthCalledWith(2, '/api/v1/subscriptions/', { params: { page: 3 } });
});
