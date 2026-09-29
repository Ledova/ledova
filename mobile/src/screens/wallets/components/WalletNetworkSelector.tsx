import React from 'react';
import { View } from 'react-native';
import { getActiveChains } from '@ledova/shared';
import { useThemedStyles } from '../../../contexts';
import { Choice } from '../../../components/Ledger';

interface WalletNetworkSelectorProps {
  network: string;
  onChange: (network: string) => void;
  evmOnly?: boolean;
  disabled?: boolean;
}

export function WalletNetworkSelector({
  network,
  onChange,
  evmOnly = false,
  disabled = false,
}: WalletNetworkSelectorProps) {
  const styles = useThemedStyles((theme) => ({
    row: { flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm },
  }));
  return (
    <View style={styles.row}>
      {getActiveChains()
        .filter((chain) => !evmOnly || chain.code === 'base' || chain.code === 'ethereum')
        .map((chain) => (
          <Choice
            key={chain.code}
            label={chain.name}
            selected={network === chain.code}
            disabled={disabled}
            accessibilityRole="radio"
            accessibilityLabel={`${chain.name} network`}
            onPress={() => onChange(chain.code)}
          />
        ))}
    </View>
  );
}
