import { Text, View, Pressable } from 'react-native';
import { Dropdown } from 'react-native-element-dropdown';
import type { Wallet } from '@ledova/shared';
import { BLOCKCHAIN } from '@ledova/shared';
import { useThemedStyles } from '../../../../contexts';
import { Action } from '../../../../components/Ledger';
import { DatePickerField } from '../../../../components/date-picker';
import { ActivityModal } from '../ActivityModal';
import type { TransactionFilters } from '../../useTransactions';

interface Props {
  isOpen: boolean;
  filters: TransactionFilters;
  wallets: Wallet[];
  walletsLoading: boolean;
  walletsFailed: boolean;
  walletsRefreshing: boolean;
  onRetryWallets: () => void;
  onClose: () => void;
  onUpdateFilters: (filters: TransactionFilters) => void;
  onApplyFilters: () => void;
  onClearFilters: () => void;
}

export function TransactionFiltersModal({
  isOpen,
  filters,
  wallets,
  walletsLoading,
  walletsFailed,
  walletsRefreshing,
  onRetryWallets,
  onClose,
  onUpdateFilters,
  onApplyFilters,
  onClearFilters,
}: Props) {
  const styles = useThemedStyles((theme) => ({
    group: { gap: 10 },
    options: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
    option: { borderWidth: 1, borderColor: theme.colors.border.default, borderRadius: 6, padding: 10 },
    selected: { borderColor: theme.colors.brand.default, backgroundColor: theme.colors.surface.tertiary },
    text: { fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.primary },
    help: { fontFamily: theme.fontFamily.regular, fontSize: 13, lineHeight: 20, color: theme.colors.text.muted },
    dropdown: { borderWidth: 1, borderColor: theme.colors.border.default, padding: 10, borderRadius: 6 },
    menu: { backgroundColor: theme.colors.surface.base },
  }));
  const change = (field: keyof TransactionFilters, value: string) =>
    onUpdateFilters({ ...filters, [field]: value || undefined });
  const dayString = (date: Date | undefined) =>
    date
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      : '';
  const datesInvalid = Boolean(filters.start_date && filters.end_date && filters.start_date > filters.end_date);
  const walletOptions = [
    { value: '', label: 'All wallets' },
    ...(filters.wallet && !wallets.some((wallet) => wallet.uuid === filters.wallet)
      ? [{ value: filters.wallet, label: 'Selected wallet unavailable' }]
      : []),
    ...wallets.map((wallet) => ({
      value: wallet.uuid,
      label: `${wallet.name ? `${wallet.name} · ` : ''}${wallet.address}`,
    })),
  ];
  const choices = (field: 'chain' | 'direction', title: string, options: { value: string; label: string }[]) => (
    <View style={styles.group}>
      <Text style={styles.text}>{title}</Text>
      <View style={styles.options}>
        {options.map((option) => (
          <Pressable
            key={option.value}
            accessibilityRole="radio"
            accessibilityLabel={`${title}: ${option.label}`}
            accessibilityState={{ checked: (filters[field] ?? '') === option.value }}
            onPress={() => change(field, option.value)}
            style={[styles.option, (filters[field] ?? '') === option.value && styles.selected]}
          >
            <Text style={styles.text}>{option.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
  return (
    <ActivityModal
      visible={isOpen}
      title="Filter activity"
      onClose={onClose}
      actions={
        <>
          <Action label="Clear filters" onPress={onClearFilters} />
          <Action
            label="Apply"
            primary
            disabled={datesInvalid}
            onPress={() => {
              if (!datesInvalid) onApplyFilters();
            }}
          />
        </>
      }
    >
      {choices('direction', 'Direction', [
        { value: '', label: 'All' },
        { value: 'incoming', label: 'Incoming' },
        { value: 'outgoing', label: 'Outgoing' },
      ])}
      {choices('chain', 'Network', [
        { value: '', label: 'All' },
        { value: BLOCKCHAIN.ETHEREUM, label: 'Ethereum' },
        { value: BLOCKCHAIN.BITCOIN, label: 'Bitcoin' },
        { value: BLOCKCHAIN.BASE, label: 'Base' },
      ])}
      <View style={styles.group}>
        <Text style={styles.text}>Wallet</Text>
        <Dropdown
          accessibilityLabel="Wallet filter"
          style={styles.dropdown}
          containerStyle={styles.menu}
          selectedTextStyle={styles.text}
          itemTextStyle={styles.text}
          placeholderStyle={styles.help}
          data={walletOptions}
          labelField="label"
          valueField="value"
          value={filters.wallet ?? ''}
          placeholder="All wallets"
          maxHeight={240}
          disable={walletsLoading || walletsFailed}
          onChange={(item) => change('wallet', item.value)}
        />
        {walletsLoading && <Text style={styles.help}>Loading wallets…</Text>}
        {walletsFailed && (
          <>
            <Text accessibilityRole="alert" style={styles.text}>
              Wallet filters could not be loaded. Your activity can still be viewed.
            </Text>
            <Action label="Try wallets again" onPress={onRetryWallets} disabled={walletsRefreshing} />
          </>
        )}
      </View>
      <DatePickerField
        label="From date"
        value={filters.start_date ? new Date(`${filters.start_date}T12:00:00`) : undefined}
        onChange={(date) => change('start_date', dayString(date))}
      />
      <DatePickerField
        label="Through date"
        value={filters.end_date ? new Date(`${filters.end_date}T12:00:00`) : undefined}
        onChange={(date) => change('end_date', dayString(date))}
      />
      <Text style={styles.help}>
        Dates filter block time across the whole selected days in your local time. Records without a block time are
        excluded when dates are set.
      </Text>
      {datesInvalid && (
        <Text accessibilityRole="alert" style={styles.text}>
          The through date must be on or after the from date.
        </Text>
      )}
    </ActivityModal>
  );
}
