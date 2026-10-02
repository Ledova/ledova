import { shownSymbol } from '../../src/utils/asset-symbol';

const shareClass = { uuid: 'class-2', name: 'Ordinary Shares', symbol: 'ORD', companyName: 'Second Fictional Pty Ltd' };

it('shows a share class by its own symbol, not the unique symbol of the asset bridged from it', () => {
  expect(shownSymbol({ assetSymbol: 'ORD.123456782', shareClass })).toBe('ORD');
});

it('keeps the asset symbol for crypto and for a class the reader cannot see', () => {
  expect(shownSymbol({ assetSymbol: 'ETH', shareClass: null })).toBe('ETH');
  expect(shownSymbol({ assetSymbol: 'CPS.123456782', shareClass: null })).toBe('CPS.123456782');
});
