import axios from 'axios';
import { getInvestorClassifications } from '../../src/services/investorClassifications';

afterEach(() => jest.restoreAllMocks());

it('preserves the existing first-page call and supports later verification claim pages', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [], next: null } });

  await getInvestorClassifications(api);
  await getInvestorClassifications(api, 3);

  expect(get).toHaveBeenNthCalledWith(1, '/api/v1/investor-classifications/');
  expect(get).toHaveBeenNthCalledWith(2, '/api/v1/investor-classifications/', { params: { page: 3 } });
});
