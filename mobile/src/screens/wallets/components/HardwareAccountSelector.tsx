import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { CheckIcon } from 'phosphor-react-native';
import { useAppTheme, useThemedStyles } from '../../../contexts';
import { Action, Rows } from '../../../components/Ledger';
import { ModalActions, useDialogStyles } from '../../../components/modal';
import type { DerivedAddress, HardwareWalletImport } from '@ledova/shared';
import { extractFromKeystoneQR } from '../../../utils/keystone/bcurDecoder';
import { getBlockchainDisplayName, describeFailure, importOnEvmNetwork, importAddressKey } from '@ledova/shared';
import { useFetchBalances } from '../../../hooks/useFetchBalances';
import { WalletNetworkSelector } from './WalletNetworkSelector';

interface HardwareAccountSelectorProps {
  urString: string;
  disabled?: boolean;
  onSelectAccounts: (addresses: DerivedAddress[], importData: HardwareWalletImport) => void;
  onCancel: () => void;
}

export function useAccountRowStyles() {
  return useThemedStyles((theme) => ({
    item: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.smd,
      paddingVertical: theme.spacing.smd,
    },
    checkbox: {
      width: theme.spacing.lg,
      height: theme.spacing.lg,
      borderRadius: theme.borderRadius.sm,
      borderWidth: 2,
      borderColor: theme.colors.border.strong,
      justifyContent: 'center',
      alignItems: 'center',
    },
    checkboxSelected: {
      backgroundColor: theme.colors.interactive.default,
      borderColor: theme.colors.interactive.default,
    },
    info: {
      flex: 1,
      gap: theme.spacing.xs,
    },
    header: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
    network: {
      fontFamily: theme.fontFamily.semibold,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
    },
    balance: {
      fontFamily: theme.fontFamily.semibold,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
    },
    address: {
      fontSize: theme.fontSize.xs,
      fontFamily: 'monospace',
      color: theme.colors.text.muted,
    },
  }));
}

export function HardwareAccountSelector({
  urString,
  onSelectAccounts,
  onCancel,
  disabled = false,
}: HardwareAccountSelectorProps) {
  const theme = useAppTheme();
  const text = useDialogStyles();
  const row = useAccountRowStyles();
  const styles = useThemedStyles((theme) => ({
    container: {
      gap: theme.spacing.md,
    },
    loading: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.sm,
    },
  }));
  const [evmNetwork, setEvmNetwork] = useState<'ETH' | 'BASE'>('ETH');
  const [selectedAddresses, setSelectedAddresses] = useState<Set<string>>(new Set());
  const [addresses, setAddresses] = useState<DerivedAddress[]>([]);
  const [importData, setImportData] = useState<HardwareWalletImport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const { balances, fetchBalances } = useFetchBalances();

  useEffect(() => {
    setIsLoading(true);
    try {
      const decoded = extractFromKeystoneQR(urString);
      if (decoded) {
        const result = importOnEvmNetwork(decoded, evmNetwork);
        setAddresses(result.addresses);
        setImportData(result);
        setSelectedAddresses(new Set(result.addresses.map(importAddressKey)));
        fetchBalances(result.addresses);
      }
    } catch (error) {
      console.error(`Failed to extract QR data: ${describeFailure(error)}`);
    } finally {
      setIsLoading(false);
    }
  }, [urString, evmNetwork, fetchBalances]);

  const toggleSelection = (address: string) => {
    const newSelected = new Set(selectedAddresses);
    if (newSelected.has(address)) {
      newSelected.delete(address);
    } else {
      newSelected.add(address);
    }
    setSelectedAddresses(newSelected);
  };

  const handleImport = () => {
    if (!importData || disabled) return;
    const selected = addresses.filter((addr) => selectedAddresses.has(importAddressKey(addr)));
    onSelectAccounts(selected, importData);
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="small" color={theme.colors.interactive.default} />
        <Text style={text.muted}>Loading accounts...</Text>
      </View>
    );
  }

  const renderAddressItem = (derivedAddress: DerivedAddress) => {
    const isSelected = selectedAddresses.has(importAddressKey(derivedAddress));
    const balance = balances.get(importAddressKey(derivedAddress)) || 'Loading...';
    const networkName = getBlockchainDisplayName(derivedAddress.networkType);

    return (
      <TouchableOpacity
        key={importAddressKey(derivedAddress)}
        accessibilityRole="button"
        accessibilityState={{ selected: isSelected }}
        style={row.item}
        disabled={disabled}
        onPress={() => toggleSelection(importAddressKey(derivedAddress))}
      >
        <View style={[row.checkbox, isSelected && row.checkboxSelected]}>
          {isSelected && (
            <CheckIcon size={theme.icon.sizes.sm} color={theme.colors.utility.white} weight={theme.icon.weights.fill} />
          )}
        </View>

        <View style={row.info}>
          <View style={row.header}>
            <Text style={row.network}>{networkName}</Text>
            <Text style={row.balance}>{balance}</Text>
          </View>
          <Text style={row.address}>
            {derivedAddress.address.slice(0, 10)}...{derivedAddress.address.slice(-8)}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <Text style={text.muted}>Review the accounts to import</Text>

      {addresses.some((item) => item.networkType !== 'BTC') && (
        <WalletNetworkSelector
          evmOnly
          disabled={disabled}
          network={evmNetwork === 'BASE' ? 'base' : 'ethereum'}
          onChange={(network) => setEvmNetwork(network === 'base' ? 'BASE' : 'ETH')}
        />
      )}
      <Rows>{addresses.map(renderAddressItem)}</Rows>

      <ModalActions>
        <Action label="Cancel" disabled={disabled} onPress={onCancel} />
        <Action
          label="Import Wallet"
          primary
          disabled={disabled || selectedAddresses.size === 0}
          onPress={handleImport}
        />
      </ModalActions>
    </View>
  );
}
