import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import {
  ListBulletsIcon,
  ShieldCheckIcon,
  SortAscendingIcon,
  TagIcon,
  CurrencyCircleDollarIcon,
  CoinsIcon,
  CheckIcon,
} from 'phosphor-react-native';
import { Choice, Rows } from '../Ledger';
import { CustomModal } from '../modal';
import { useAppTheme, useThemedStyles } from '../../contexts';

export type WalletChainFilter = 'all' | 'btc' | 'eth' | 'base';
export type WalletSortOption = 'default' | 'verified' | 'name' | 'namedFirst' | 'highestValue' | 'highestBalance';

interface WalletSortModalProps {
  visible: boolean;
  selectedChain: WalletChainFilter;
  selectedSort: WalletSortOption;
  onClose: () => void;
  onApply: (chain: WalletChainFilter, sort: WalletSortOption) => void;
}

export function WalletSortModal({ visible, selectedChain, selectedSort, onClose, onApply }: WalletSortModalProps) {
  const theme = useAppTheme();
  const styles = useThemedStyles((theme) => ({
    group: {
      gap: theme.spacing.sm,
    },
    sectionLabel: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.xs,
      color: theme.colors.text.subtle,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    chainContainer: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: theme.spacing.sm,
    },
    optionItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.spacing.smd,
      paddingVertical: theme.spacing.smd,
    },
    optionContent: {
      flex: 1,
    },
    optionLabel: {
      fontFamily: theme.fontFamily.medium,
      fontSize: theme.fontSize.sm,
      color: theme.colors.text.primary,
    },
    optionLabelSelected: {
      color: theme.colors.interactive.active,
    },
    optionDescription: {
      fontFamily: theme.fontFamily.regular,
      fontSize: 11,
      color: theme.colors.text.muted,
    },
  }));

  const chainOptions: Array<{ id: WalletChainFilter; label: string }> = [
    { id: 'all', label: 'All' },
    { id: 'btc', label: 'BTC' },
    { id: 'eth', label: 'ETH' },
    { id: 'base', label: 'BASE' },
  ];

  const sortOptions: Array<{ id: WalletSortOption; label: string; icon: React.ReactNode; description: string }> = [
    {
      id: 'default',
      label: 'Default',
      icon: <ListBulletsIcon size={theme.icon.sizes.sm} color={theme.colors.text.primary} weight="regular" />,
      description: 'Hardware signing preference first',
    },
    {
      id: 'verified',
      label: 'Verified First',
      icon: <ShieldCheckIcon size={theme.icon.sizes.sm} color={theme.colors.status.success.icon} weight="regular" />,
      description: 'Show verified wallets first',
    },
    {
      id: 'name',
      label: 'Alphabetical',
      icon: <SortAscendingIcon size={theme.icon.sizes.sm} color={theme.colors.text.primary} weight="regular" />,
      description: 'Sort by name (A-Z)',
    },
    {
      id: 'namedFirst',
      label: 'Named First',
      icon: <TagIcon size={theme.icon.sizes.sm} color={theme.colors.text.primary} weight="regular" />,
      description: 'Wallets with names before unnamed',
    },
    {
      id: 'highestValue',
      label: 'Highest Value',
      icon: <CurrencyCircleDollarIcon size={theme.icon.sizes.sm} color={theme.colors.text.primary} weight="regular" />,
      description: 'Sort by market value (highest first)',
    },
    {
      id: 'highestBalance',
      label: 'Most Coins',
      icon: <CoinsIcon size={theme.icon.sizes.sm} color={theme.colors.text.primary} weight="regular" />,
      description: 'Sort by native balance (highest first)',
    },
  ];

  const [localChain, setLocalChain] = React.useState<WalletChainFilter>(selectedChain);
  const [localSort, setLocalSort] = React.useState<WalletSortOption>(selectedSort);

  React.useEffect(() => {
    if (visible) {
      setLocalChain(selectedChain);
      setLocalSort(selectedSort);
    }
  }, [visible, selectedChain, selectedSort]);

  const handleApply = () => {
    onApply(localChain, localSort);
    onClose();
  };

  return (
    <CustomModal
      visible={visible}
      title="Sort Wallets"
      onClose={onClose}
      showFooter={true}
      showCancelButton={true}
      cancelLabel="Close"
      confirmLabel="Apply"
      onCancel={onClose}
      onConfirm={handleApply}
    >
      <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.sectionLabel}>
          Chain
        </Text>
        <View style={styles.chainContainer}>
          {chainOptions.map((option) => (
            <Choice
              key={option.id}
              label={option.label}
              selected={localChain === option.id}
              onPress={() => setLocalChain(option.id)}
            />
          ))}
        </View>
      </View>

      <View style={styles.group}>
        <Text accessibilityRole="header" style={styles.sectionLabel}>
          Sort By
        </Text>
        <Rows>
          {sortOptions.map((option) => {
            const isSelected = localSort === option.id;
            return (
              <TouchableOpacity
                key={option.id}
                accessibilityRole="button"
                accessibilityState={{ selected: isSelected }}
                style={styles.optionItem}
                onPress={() => setLocalSort(option.id)}
                activeOpacity={0.7}
              >
                {option.icon}
                <View style={styles.optionContent}>
                  <Text style={[styles.optionLabel, isSelected && styles.optionLabelSelected]}>{option.label}</Text>
                  <Text style={styles.optionDescription}>{option.description}</Text>
                </View>
                {isSelected && (
                  <CheckIcon size={theme.icon.sizes.sm} color={theme.colors.interactive.active} weight="bold" />
                )}
              </TouchableOpacity>
            );
          })}
        </Rows>
      </View>
    </CustomModal>
  );
}
