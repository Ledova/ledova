import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  WALLET_VERIFICATION_STATUS,
  getChainConfig,
  getChainShortCode,
  isBitcoinChain,
  type Wallet,
} from '@ledova/shared';
import type { WalletsStackParamList } from '../../../navigation/WalletsStackNavigator';
import { Action } from '../../../components/Ledger';

export function CryptoActions({ wallets }: { wallets: Wallet[] | null }) {
  const navigation = useNavigation<NativeStackNavigationProp<WalletsStackParamList>>();
  const verified = (wallets ?? []).filter(
    (wallet) =>
      getChainConfig(wallet.chain)?.isActive && wallet.verificationStatus === WALLET_VERIFICATION_STATUS.VERIFIED,
  );
  const onlyVerified = verified.length === 1 ? verified[0] : null;
  const send = () => {
    if (!onlyVerified) navigation.navigate('Send', { screen: 'SendMain' });
    else if (isBitcoinChain(getChainShortCode(onlyVerified.chain)))
      navigation.navigate('BitcoinSend', { wallet: onlyVerified });
    else navigation.navigate('Send', { screen: 'SendMain', params: { wallet: onlyVerified } });
  };
  return (
    <>
      <Action label="Buy crypto" onPress={() => navigation.navigate('Buy', { screen: 'BuySelect' })} />
      <Action label="Send" onPress={send} />
    </>
  );
}
