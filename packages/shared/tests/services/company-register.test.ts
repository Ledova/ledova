import axios from 'axios';
import { getRegisterClasses } from '../../src/services/company-tokens';

afterEach(() => jest.restoreAllMocks());

it('reads register classes with the requested company and page and keeps the session scope', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [], next: null } });
  const config = { timeout: 1000, ledovaSessionEpoch: 2 };
  await getRegisterClasses(api, { company_uuid: 'company-a', page: 2 }, config);
  expect(get).toHaveBeenCalledWith('/api/v1/tokens/register/', {
    timeout: 1000,
    ledovaSessionEpoch: 2,
    params: { company_uuid: 'company-a', page: 2 },
  });
});

it('reads every readable register class when no company is named', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [], next: null } });
  await getRegisterClasses(api);
  expect(get).toHaveBeenCalledWith('/api/v1/tokens/register/', { params: {} });
});
