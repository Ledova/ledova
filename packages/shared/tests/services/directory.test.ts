import axios from 'axios';
import { downloadDirectoryDocument, getDirectoryDocuments, getDirectoryTokens } from '../../src/services/directory';

afterEach(() => jest.restoreAllMocks());

it('preserves the default directory request and can fetch another page without following its URL', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: { results: [] } });
  await getDirectoryTokens(api);
  await getDirectoryTokens(api, 2);
  expect(get).toHaveBeenNthCalledWith(1, '/api/v1/directory/tokens/');
  expect(get).toHaveBeenNthCalledWith(2, '/api/v1/directory/tokens/', { params: { page: 2 } });
});

it('reads the offer documents of a class and downloads one as bytes through its own route', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: [] });
  await getDirectoryDocuments(api, 'class-a');
  await downloadDirectoryDocument(api, 'class-a', 'memorandum', { timeout: 5 });
  expect(get).toHaveBeenNthCalledWith(1, '/api/v1/directory/tokens/class-a/documents/');
  expect(get).toHaveBeenNthCalledWith(2, '/api/v1/directory/tokens/class-a/documents/memorandum/file/', {
    timeout: 5,
    responseType: 'arraybuffer',
  });
});
