import { cleanup, render, renderHook } from '@testing-library/react-native';
import { formatWalletAddressMedium, formatWalletAddressShort, type TransactionData, type Wallet } from '@ledova/shared';
import { useAppTheme } from '../../../contexts';
import { ReviewTransaction } from './ReviewTransaction';
import { SoftwareSignTransaction } from './SoftwareSignTransaction';
import { BitcoinSignTransaction } from './BitcoinSignTransaction';

jest.mock('../../../services/secureKeyStorage', () => ({ getSeedPhrase: jest.fn() }));
jest.mock('../../../utils/softwareWallet', () => ({ signEthereumTransaction: jest.fn() }));

const fromAddress = `0x${'1'.repeat(40)}`;
const toAddress = `0x${'2'.repeat(40)}`;

async function mono() {
  const view = await renderHook(() => useAppTheme());
  return view.result.current.fontFamily.mono;
}

afterEach(async () => {
  await cleanup();
});

it('sets the review addresses in monospace and leaves its amounts in the text face', async () => {
  const family = await mono();
  const data = {
    transaction: '',
    fromAddress,
    toAddress,
    amountEth: '1',
    gasCostEth: '0.01',
    totalCostEth: '1.01',
    gasPriceGwei: '2',
    gasLimit: '21000',
  } as TransactionData;
  const view = await render(<ReviewTransaction transactionData={data} chainShortName="ETH" />);
  expect(view.getByText(formatWalletAddressMedium(fromAddress))).toHaveStyle({ fontFamily: family });
  expect(view.getByText(formatWalletAddressMedium(toAddress))).toHaveStyle({ fontFamily: family });
  expect(view.getByText('1 ETH')).not.toHaveStyle({ fontFamily: family });
});

it('sets every value of the software signing summary in monospace', async () => {
  const family = await mono();
  const data = { transaction: '{}', fromAddress, toAddress, amountEth: '1', gasCostEth: '0.01' } as TransactionData;
  const view = await render(
    <SoftwareSignTransaction wallet={{ uuid: 'wallet' } as Wallet} transactionData={data} onSignComplete={jest.fn()} />,
  );
  for (const value of [
    formatWalletAddressShort(fromAddress),
    formatWalletAddressShort(toAddress),
    '1 ETH',
    '0.01 ETH',
  ]) {
    expect(view.getByText(value)).toHaveStyle({ fontFamily: family });
  }
});

it('sets every value of the Bitcoin signing summary and the signed hex in monospace', async () => {
  const family = await mono();
  const data = {
    transaction: '',
    fromAddress: 'tb1qsenderaddressfictional0000000000aaaa',
    toAddress: 'tb1qrecipientaddressfictional000000bbbb',
    amountBtc: '0.5',
    feePerByte: '12',
    estimatedTxSize: 140,
    totalCostBtc: '0.50001680',
  } as TransactionData;
  const view = await render(
    <BitcoinSignTransaction transactionData={data} signedHex="0200" onChangeSignedHex={jest.fn()} error={null} />,
  );
  for (const value of [
    formatWalletAddressShort(data.fromAddress),
    formatWalletAddressShort(data.toAddress),
    '0.5 BTC',
    '12 sat/vB',
    '140 vB',
    '0.50001680 BTC',
  ]) {
    expect(view.getByText(value)).toHaveStyle({ fontFamily: family });
  }
  expect(view.getByDisplayValue('0200')).toHaveStyle({ fontFamily: family });
});
