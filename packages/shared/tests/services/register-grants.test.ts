import axios from 'axios';
import { downloadRegisterGrantFile } from '../../src/services/register-grants';

afterEach(() => jest.restoreAllMocks());

it('reads authority, terms and acceptance through their exact private file routes with the session guard', async () => {
  const api = axios.create();
  const get = jest.spyOn(api, 'get').mockResolvedValue({ data: new Blob(['synthetic']) });
  const session = { ledovaSessionEpoch: 3, ledovaSubmissionGuard: () => {}, timeout: 1000 };
  await downloadRegisterGrantFile(api, 'grant-a', 'authority', session);
  await downloadRegisterGrantFile(api, 'grant-a', 'terms', session);
  await downloadRegisterGrantFile(api, 'grant-a', 'acceptance', session);
  expect(get.mock.calls).toEqual([
    ['/api/v1/tokens/register-grants/grant-a/file/', { ...session, responseType: 'blob' }],
    ['/api/v1/tokens/register-grants/grant-a/terms-file/', { ...session, responseType: 'blob' }],
    ['/api/v1/tokens/register-grants/grant-a/acceptance-file/', { ...session, responseType: 'blob' }],
  ]);
});
