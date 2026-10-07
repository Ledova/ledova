import axios from 'axios';
import { getRegisterClasses, createCapitalIncrease, submitCapitalIncrease } from '../../src/services/company-tokens';

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

it('binds existing owner capital requests to their captured transport guard and native epoch', async () => {
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  const config = { ledovaSessionEpoch: 3, ledovaSubmissionGuard: () => undefined };
  const capital = {
    token: 'class',
    additionalShares: 2,
    newAuthorizedTotal: 102,
    purpose: 'Synthetic capital',
    boardResolutionReference: 'BOARD-1',
  };
  await createCapitalIncrease(api, capital, config);
  await submitCapitalIncrease(api, 'capital', config);
  expect(post.mock.calls).toEqual([
    ['/api/v1/tokens/capital-increases/', capital, config],
    ['/api/v1/tokens/capital-increases/capital/submit/', undefined, config],
  ]);
});
