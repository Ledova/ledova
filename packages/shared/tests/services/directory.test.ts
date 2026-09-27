import axios from 'axios';
import { getDirectoryTokens } from '../../src/services/directory';

afterEach(() => jest.restoreAllMocks());

it('preserves the default directory request and can fetch another page without following its URL', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [] } });
  await getDirectoryTokens(api);
  await getDirectoryTokens(api, 2);
  expect(get).toHaveBeenNthCalledWith(1, '/api/v1/directory/tokens/');
  expect(get).toHaveBeenNthCalledWith(2, '/api/v1/directory/tokens/', { params: { page: 2 } });
});
