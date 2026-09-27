import { View, type ViewStyle } from 'react-native';
import { Action } from '../../../components/Ledger';
import { useMarketStyles } from '../styles';

interface BuySellButtonsProps {
  tokenSymbol?: string;
  onBuy: () => void;
  onSell: () => void;
  disabled?: boolean;
  style?: ViewStyle;
}

export function BuySellButtons({ tokenSymbol, onBuy, onSell, disabled, style }: BuySellButtonsProps) {
  const styles = useMarketStyles();
  return (
    <View style={[styles.actions, style]}>
      <Action
        label={tokenSymbol ? `New buy order — ${tokenSymbol}` : 'New buy order'}
        onPress={onBuy}
        disabled={disabled}
        primary
      />
      <Action
        label={tokenSymbol ? `New sell order — ${tokenSymbol}` : 'New sell order'}
        onPress={onSell}
        disabled={disabled}
      />
    </View>
  );
}
