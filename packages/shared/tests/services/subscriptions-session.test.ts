import axios from 'axios';
import { createSubscription, submitSubscription, withdrawSubscription } from '../../src';

it('preserves default subscription calls and forwards caller guards unchanged', async () => {
  const api = axios.create();
  const post = jest.spyOn(api, 'post').mockResolvedValue({ data: {} });
  const input = { offering: 'offering-a', wallet: 'wallet-a', quantity: 3 };
  const config = { timeout: 1000, headers: { 'X-Test': 'fictional' } };
  await createSubscription(api, input);
  await createSubscription(api, input, config);
  await submitSubscription(api, 'application-a');
  await submitSubscription(api, 'application-a', config);
  await withdrawSubscription(api, 'application-a', 'Fictional withdrawal');
  await withdrawSubscription(api, 'application-a', 'Fictional withdrawal', config);
  expect(post.mock.calls).toEqual([
    ['/api/v1/subscriptions/', input],
    ['/api/v1/subscriptions/', input, config],
    ['/api/v1/subscriptions/application-a/submit/', {}],
    ['/api/v1/subscriptions/application-a/submit/', {}, config],
    ['/api/v1/subscriptions/application-a/withdraw/', { reason: 'Fictional withdrawal' }],
    ['/api/v1/subscriptions/application-a/withdraw/', { reason: 'Fictional withdrawal' }, config],
  ]);
});
