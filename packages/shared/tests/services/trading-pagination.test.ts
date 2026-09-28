import type { AxiosInstance } from 'axios';
import { getShareTokens, getSwapOrders } from '../../src/services/trading';

it('preserves default trading requests and applies optional pagination without losing the wallet filter', () => {
  const get = jest.fn();
  const api = { get } as unknown as AxiosInstance;
  getShareTokens(api);
  getShareTokens(api, 2);
  getSwapOrders(api, 'fictional-wallet');
  getSwapOrders(api, 'fictional-wallet', 3);
  expect(get.mock.calls).toEqual([
    ['/api/v1/trading/tokens/', undefined],
    ['/api/v1/trading/tokens/', { params: { page: 2 } }],
    ['/api/v1/trading/swaps/', { params: { wallet_address: 'fictional-wallet' } }],
    ['/api/v1/trading/swaps/', { params: { wallet_address: 'fictional-wallet', page: 3 } }],
  ]);
});
