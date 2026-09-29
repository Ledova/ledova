import { WalletNetworkSelector } from './WalletNetworkSelector';
import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { CheckIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { Action, Rows } from '../../../components/Ledger';
import { ModalActions, useDialogStyles } from '../../../components/modal';
import type { DerivedAddress } from '@ledova/shared';
import { getBlockchainDisplayName, importAddressKey } from '@ledova/shared';
import { useAccountRowStyles } from './HardwareAccountSelector';

interface SeedAccountSelectorProps {
  disabled?: boolean;
  onNetworkChange: (network: string) => void;
  addresses: DerivedAddress[];
  selectedAddresses: Set<string>;
  balances: Map<string, string>;
  storeError: string | null;
  onToggleAddress: (address: string) => void;
  onConfirm: () => void;
  onBack: () => void;
}

export function SeedAccountSelector({
  onNetworkChange,
  disabled = false,
  addresses,
  selectedAddresses,
  balances,
  storeError,
  onToggleAddress,
  onConfirm,
  onBack,
}: SeedAccountSelectorProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const row = useAccountRowStyles();
  const styles = useThemedStyles((theme) => ({
    container: {
      gap: theme.spacing.md,
    },
  }));
  return (
    <View style={styles.container}>
      <Text style={text.muted}>Choose which accounts to add to your wallet</Text>

      <WalletNetworkSelector
        evmOnly
        disabled={disabled}
        network={
          addresses.find((address) => address.networkType !== 'BTC')?.networkType === 'BASE' ? 'base' : 'ethereum'
        }
        onChange={onNetworkChange}
      />
      <Rows>
        {addresses.map((addr) => {
          const isSelected = selectedAddresses.has(importAddressKey(addr));
          const balance = balances.get(importAddressKey(addr)) || 'Loading...';
          const networkName = getBlockchainDisplayName(addr.networkType);

          return (
            <TouchableOpacity
              key={importAddressKey(addr)}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              style={row.item}
              disabled={disabled}
              onPress={() => onToggleAddress(importAddressKey(addr))}
            >
              <View style={[row.checkbox, isSelected && row.checkboxSelected]}>
                {isSelected && (
                  <CheckIcon size={theme.icon.sizes.sm} color={theme.colors.utility.white} weight="bold" />
                )}
              </View>
              <View style={row.info}>
                <View style={row.header}>
                  <Text style={row.network}>{networkName}</Text>
                  <Text style={row.balance}>{balance}</Text>
                </View>
                <Text style={row.address}>
                  {addr.address.slice(0, 10)}...{addr.address.slice(-8)}
                </Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </Rows>

      {storeError && <Text style={text.error}>{storeError}</Text>}

      <ModalActions>
        <Action label="Back" onPress={onBack} />
        <Action label="Create Wallet" primary disabled={disabled || selectedAddresses.size === 0} onPress={onConfirm} />
      </ModalActions>
    </View>
  );
}
