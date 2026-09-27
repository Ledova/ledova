import { Pressable, Text, TextInput, View } from 'react-native';
import {
  formatMoney,
  getErrorMessage,
  SUBSCRIPTION_COPY,
  type DirectoryOpenOffering,
  type Wallet,
} from '@ledova/shared';
import { Action, Row, Section } from '../../components/Ledger';
import { useThemedStyles } from '../../contexts';
import { useApplicationStyles } from './ApplicationsPage';
import { applicationAmount } from './presentation';

export type ApplicationDraft = { quantity: string; wallet: string | null };

export function ApplyForm({
  offering,
  draft,
  onDraftChange,
  wallets,
  busy,
  blocked,
  error,
  onCreate,
  openWallets,
}: {
  offering: DirectoryOpenOffering;
  draft: ApplicationDraft;
  onDraftChange: (draft: ApplicationDraft) => void;
  wallets: Wallet[];
  busy: boolean;
  blocked: boolean;
  error: unknown;
  onCreate: (input: { wallet: string; quantity: number }) => void;
  openWallets: () => void;
}) {
  const styles = useApplicationStyles();
  const fields = useThemedStyles((theme) => ({
    input: {
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: 6,
      padding: 12,
      fontFamily: theme.fontFamily.regular,
      fontSize: 16,
      color: theme.colors.text.primary,
    },
    wallet: { padding: 12, gap: 6, borderWidth: 1, borderColor: theme.colors.border.default, borderRadius: 6 },
    selected: { borderColor: theme.colors.brand.default, backgroundColor: theme.colors.surface.base },
  }));
  const chosen =
    draft.wallet === null
      ? (wallets[0]?.uuid ?? '')
      : (wallets.find((wallet) => wallet.uuid === draft.wallet)?.uuid ?? '');
  const amount = applicationAmount(draft.quantity, offering.pricePerShare);
  const message = getErrorMessage(error, 'The application could not be created. Check the details and try again.');
  if (wallets.length === 0)
    return (
      <Section title="Add a receiving wallet">
        <Text style={styles.help}>
          Shares are issued to a verified Base wallet you control. Add and verify one in Wallets before applying.
        </Text>
        <Action label="Open Wallets" onPress={openWallets} />
      </Section>
    );
  return (
    <Section title="Apply for shares">
      <Text style={styles.help}>
        Choose your whole shares and receiving wallet. The offering price is stored on your application when you create
        the draft.
      </Text>
      <View style={styles.group}>
        <Text style={styles.label}>Shares</Text>
        <TextInput
          accessibilityLabel="Shares"
          placeholder="Whole shares"
          inputMode="numeric"
          value={draft.quantity}
          editable={!busy}
          onChangeText={(quantity) => onDraftChange({ ...draft, quantity })}
          style={fields.input}
        />
        {draft.quantity !== '' && amount === null && (
          <Text accessibilityRole="alert" style={styles.message}>
            Enter a positive whole number of shares.
          </Text>
        )}
      </View>
      <Text style={styles.label}>Receiving wallet (Base)</Text>
      {wallets.map((wallet) => (
        <Pressable
          key={wallet.uuid}
          accessibilityRole="radio"
          accessibilityLabel={`Receiving wallet ${wallet.name || wallet.address}`}
          accessibilityState={{ checked: chosen === wallet.uuid, disabled: busy }}
          disabled={busy}
          onPress={() => onDraftChange({ ...draft, wallet: wallet.uuid })}
          style={[fields.wallet, chosen === wallet.uuid && fields.selected]}
        >
          {wallet.name && <Text style={styles.label}>{wallet.name}</Text>}
          <Text selectable style={styles.help}>
            {wallet.address}
          </Text>
          {chosen === wallet.uuid && <Text style={styles.message}>Selected</Text>}
        </Pressable>
      ))}
      <Row label="Amount on acceptance">{amount === null ? '—' : formatMoney(amount, offering.priceCurrency)}</Row>
      {message && (
        <Text accessibilityRole="alert" style={styles.message}>
          {message}
        </Text>
      )}
      <Action
        label={busy ? 'Creating draft…' : 'Create application'}
        primary
        disabled={busy || blocked || amount === null || !chosen}
        onPress={() => {
          if (!busy && !blocked && amount !== null && chosen)
            onCreate({ wallet: chosen, quantity: Number(draft.quantity) });
        }}
      />
      <Text style={styles.help}>{SUBSCRIPTION_COPY.DRAFT_HELP}</Text>
    </Section>
  );
}
