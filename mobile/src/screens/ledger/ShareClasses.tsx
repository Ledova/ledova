import { useState } from 'react';
import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  classFacts,
  formatShareCount,
  useClassDeletion,
  type CompanyShareTokenListItem,
  type OrderSubmissionOwner,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Checkbox } from '../../components/Field';
import { Action, Actions, LinkRow, Outcome, Rows, Section } from '../../components/Ledger';
import { CustomModal } from '../../components/modal';
import { useThemedStyles } from '../../contexts';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useLedgerStyles } from './useLedgerStyles';

export function ShareClasses({
  owner,
  company,
  classes,
  registers,
  guard,
  available,
  ready,
  canAdd,
  onHeldChange,
}: {
  owner: OrderSubmissionOwner;
  company: string;
  classes: CompanyShareTokenListItem[];
  registers: TokenHoldersResponse[];
  guard: () => void;
  available: boolean;
  ready: boolean;
  canAdd: boolean;
  onHeldChange: (held: boolean) => void;
}) {
  const look = useLedgerStyles();
  const controls = useThemedStyles(() => ({
    row: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 12 },
    checkbox: {
      width: 44,
      minHeight: 44,
      paddingVertical: 0,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    all: { minHeight: 44, alignItems: 'center' as const, paddingLeft: 12, gap: 24 },
  }));
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const listed = classes.filter((row) => row.companyUuid === company);
  const hasControls = listed.some((row) => row.canDelete);
  const selectedCount = listed.filter(({ uuid }) => selected.has(uuid)).length;
  const deletableCount = listed.filter((row) => row.canDelete && selected.has(row.uuid)).length;
  const deletion = useClassDeletion({
    owner,
    company,
    classes,
    guard,
    available,
    onHeldChange,
    session: orderSubmissionSession,
  });
  const operation = deletion.removal;
  const locked = !!operation || !available || !ready;
  const close = async () => {
    if (await deletion.close()) setSelected(new Set());
  };
  return (
    <>
      <View style={[look.stack, !ready && look.hidden]}>
        <Section title="Share classes">
          {hasControls && listed.length > 1 && (
            <Checkbox
              label="Select all"
              checked={selectedCount === listed.length}
              indeterminate={selectedCount > 0 && selectedCount < listed.length}
              disabled={locked}
              error={null}
              style={controls.all}
              hitSlop={0}
              onChange={(checked) => setSelected(new Set(checked ? listed.map(({ uuid }) => uuid) : []))}
            />
          )}
          {registers.length === 0 ? (
            <Text style={look.muted}>No share classes yet.</Text>
          ) : (
            <Rows>
              {registers.map((register) => {
                const lifecycle = listed.find(({ uuid }) => uuid === register.token.uuid);
                const issued =
                  register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply);
                const facts = classFacts(register);
                return (
                  <View key={register.token.uuid} style={controls.row}>
                    {hasControls && (
                      <Checkbox
                        label=""
                        accessibilityLabel={`Select ${register.token.name}`}
                        checked={selected.has(register.token.uuid)}
                        disabled={locked}
                        error={null}
                        style={controls.checkbox}
                        hitSlop={0}
                        onChange={(checked) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (checked) next.add(register.token.uuid);
                            else next.delete(register.token.uuid);
                            return next;
                          })
                        }
                      />
                    )}
                    <View style={look.fill}>
                      <LinkRow
                        label={register.token.name}
                        accessibilityLabel={[
                          register.token.name,
                          register.issuedSupply === null ? 'issued shares not recorded' : `${issued} issued shares`,
                          facts,
                          lifecycle?.deletionBlockedReason,
                        ]
                          .filter(Boolean)
                          .join(', ')}
                        figure={issued}
                        disabled={locked}
                        onPress={() => navigation.navigate('ShareClass', { company, token: register.token.uuid })}
                      >
                        <Text style={look.small}>{facts}</Text>
                        {!!lifecycle?.deletionBlockedReason && (
                          <Text style={look.small}>{lifecycle.deletionBlockedReason}</Text>
                        )}
                      </LinkRow>
                    </View>
                  </View>
                );
              })}
            </Rows>
          )}
        </Section>
        {(hasControls || canAdd) && (
          <Actions>
            {hasControls && (
              <Action
                label="Delete selected"
                disabled={locked || deletableCount === 0}
                onPress={() => deletion.open(selected)}
              />
            )}
            {canAdd && (
              <Action
                primary
                label="Add share class"
                disabled={locked}
                onPress={() => navigation.navigate('RegisterSetup', { company })}
              />
            )}
          </Actions>
        )}
      </View>
      {!!deletion.outcome && <Outcome>{deletion.outcome}</Outcome>}
      {!operation && !!deletion.error && (
        <Text accessibilityRole="alert" style={look.smallError}>
          {deletion.error}
        </Text>
      )}
      <CustomModal
        visible={!!operation}
        title={`Delete ${operation?.targets.length ?? 0} ${operation?.targets.length === 1 ? 'share class' : 'share classes'}?`}
        onClose={() => void close()}
        busy={deletion.busy || !!operation?.pending}
        cancelLabel={operation?.finished ? 'Close' : 'Cancel'}
        actions={
          operation && !operation.finished ? (
            <Action
              label={
                deletion.busy
                  ? operation.pending
                    ? 'Checking…'
                    : 'Deleting…'
                  : operation.pending
                    ? operation.retry
                      ? 'Retry original deletion'
                      : 'Check original deletion'
                    : 'Delete selected'
              }
              disabled={!available || deletion.busy}
              onPress={() => void (operation.pending ? deletion.recover() : deletion.execute())}
            />
          ) : null
        }
      >
        {operation && (
          <>
            <Text style={look.muted}>
              Unused classes are removed from active use and their saved setup reviews are retired automatically. Their
              records and audit history are kept. Each class is checked separately; deletion stops if a result cannot be
              confirmed.
            </Text>
            <View style={look.list}>
              {operation.targets.map((target, index) => (
                <Text key={target.uuid} style={look.text}>
                  {target.name} · {target.symbol}
                  {index < operation.next ? ' — deleted' : ''}
                </Text>
              ))}
            </View>
            {operation.kept.length > 0 && (
              <View style={look.list}>
                <Text accessibilityRole="header" style={look.title}>
                  Will be kept
                </Text>
                {operation.kept.map((target) => (
                  <View key={target.uuid} style={look.terms}>
                    <Text style={look.text}>
                      {target.name} · {target.symbol}
                    </Text>
                    <Text style={look.small}>{target.deletionBlockedReason ?? 'This class cannot be deleted.'}</Text>
                  </View>
                ))}
              </View>
            )}
            {(operation.finished || operation.pending) && (
              <Text accessibilityRole="summary" style={look.muted}>
                {operation.next} deleted · {operation.targets.length - operation.next} not confirmed
              </Text>
            )}
            {!!deletion.error && (
              <Text accessibilityRole="alert" style={look.smallError}>
                {deletion.error}
              </Text>
            )}
          </>
        )}
      </CustomModal>
    </>
  );
}
