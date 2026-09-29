import type { Ref } from 'react';
import { Text, View } from 'react-native';
import { Dropdown } from 'react-native-element-dropdown';
import { BLOCKCHAIN, formatDate, type TransactionFilters, type Wallet } from '@ledova/shared';
import { useThemedStyles } from '../../../../contexts';
import { Action, Choice, Disclosure } from '../../../../components/Ledger';
import { DatePickerField } from '../../../../components/date-picker';
import { ModalActions } from '../../../../components/modal';

interface Props {
  ref?: Ref<View>;
  open: boolean;
  onToggle: () => void;
  applied: TransactionFilters;
  filters: TransactionFilters;
  wallets: Wallet[];
  walletsLoading: boolean;
  walletsFailed: boolean;
  walletsRefreshing: boolean;
  onRetryWallets: () => void;
  onUpdateFilters: (filters: TransactionFilters) => void;
  onApplyFilters: () => void;
  onClearFilters: () => void;
}

const directions = [
  { value: '', label: 'All' },
  { value: 'incoming', label: 'Incoming' },
  { value: 'outgoing', label: 'Outgoing' },
];
const networks = [
  { value: '', label: 'All' },
  { value: BLOCKCHAIN.ETHEREUM, label: 'Ethereum' },
  { value: BLOCKCHAIN.BITCOIN, label: 'Bitcoin' },
  { value: BLOCKCHAIN.BASE, label: 'Base' },
];

function appliedSummary(applied: TransactionFilters, wallets: Wallet[]) {
  const parts: string[] = [];
  const direction = directions.find((option) => option.value && option.value === applied.direction);
  if (direction) parts.push(direction.label);
  const network = networks.find((option) => option.value && option.value === applied.chain);
  if (network) parts.push(network.label);
  if (applied.wallet) {
    const wallet = wallets.find((candidate) => candidate.uuid === applied.wallet);
    parts.push(wallet ? wallet.name || wallet.address : 'Selected wallet');
  }
  if (applied.start_date && applied.end_date) {
    parts.push(`${formatDate(applied.start_date)} to ${formatDate(applied.end_date)}`);
  } else if (applied.start_date) {
    parts.push(`From ${formatDate(applied.start_date)}`);
  } else if (applied.end_date) {
    parts.push(`Through ${formatDate(applied.end_date)}`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'All transfers';
}

export function TransactionFilter({
  ref,
  open,
  onToggle,
  applied,
  filters,
  wallets,
  walletsLoading,
  walletsFailed,
  walletsRefreshing,
  onRetryWallets,
  onUpdateFilters,
  onApplyFilters,
  onClearFilters,
}: Props) {
  const styles = useThemedStyles((theme) => ({
    filter: { borderBottomWidth: 1, borderBottomColor: theme.colors.border.default },
    summary: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      justifyContent: 'space-between' as const,
      columnGap: theme.spacing.md,
      rowGap: theme.spacing.xs,
    },
    label: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 21, color: theme.colors.text.primary },
    applied: {
      flexShrink: 1,
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      lineHeight: 21,
      color: theme.colors.text.muted,
    },
    body: { gap: theme.spacing.md },
    group: { gap: 10 },
    options: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8 },
    text: { fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.primary },
    help: { fontFamily: theme.fontFamily.regular, fontSize: 13, lineHeight: 20, color: theme.colors.text.muted },
    dropdown: { borderWidth: 1, borderColor: theme.colors.border.default, padding: 10, borderRadius: 6 },
    field: { backgroundColor: theme.colors.surface.raised },
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
          <Choice
            key={option.value}
            label={option.label}
            selected={(filters[field] ?? '') === option.value}
            accessibilityRole="radio"
            accessibilityLabel={`${title}: ${option.label}`}
            onPress={() => change(field, option.value)}
          />
        ))}
      </View>
    </View>
  );
  return (
    <View style={styles.filter}>
      <Disclosure
        ref={ref}
        open={open}
        onToggle={onToggle}
        summary={
          <View style={styles.summary}>
            <Text style={styles.label}>Filter</Text>
            <Text style={styles.applied}>{appliedSummary(applied, wallets)}</Text>
          </View>
        }
      >
        <View style={styles.body}>
          {choices('direction', 'Direction', directions)}
          {choices('chain', 'Network', networks)}
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
            fieldStyle={styles.field}
          />
          <DatePickerField
            label="Through date"
            value={filters.end_date ? new Date(`${filters.end_date}T12:00:00`) : undefined}
            onChange={(date) => change('end_date', dayString(date))}
            fieldStyle={styles.field}
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
          <ModalActions>
            <Action label="Clear filters" onPress={onClearFilters} />
            <Action
              label="Apply"
              primary
              disabled={datesInvalid}
              onPress={() => {
                if (!datesInvalid) onApplyFilters();
              }}
            />
          </ModalActions>
        </View>
      </Disclosure>
    </View>
  );
}
