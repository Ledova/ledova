import { Text, View } from 'react-native';
import {
  formatDate,
  formatRegisterChanges,
  REGISTER_CORRECTION_COPY as COPY,
  type OwnCompanyAppointment,
  type RegisterEntry,
  type RegisterStep,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, Row, Rows } from '../../components/Ledger';
import { useCompanyStyles } from './styles';
import { useRegisterEntries } from './useCompanyRegister';

export const NOT_LOADED = 'An entry not loaded yet';

export function ClassEntries({
  epoch,
  register,
  steps,
  onCorrect,
}: {
  epoch: number;
  register: TokenHoldersResponse;
  steps?: Record<RegisterStep, OwnCompanyAppointment | undefined>;
  onCorrect: (entry: RegisterEntry) => void;
}) {
  const styles = useCompanyStyles();
  const name = register.token.name;
  const { entries, listed, hasError, moreFailed, loadMore } = useRegisterEntries(epoch, register.token.uuid);
  const sequences = new Map(listed.map((entry) => [entry.uuid, entry.sequence]));
  const linked = (uuid: string) => (sequences.has(uuid) ? `Entry ${sequences.get(uuid)}` : NOT_LOADED);
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {COPY.ENTRIES_TITLE}
      </Text>
      {entries.isPending ? (
        <Text style={styles.muted}>Loading register entries…</Text>
      ) : hasError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            The register entries could not be loaded.
          </Text>
          <Action
            label="Retry register entries"
            accessibilityLabel={`Retry register entries for ${name}`}
            disabled={entries.isFetching}
            onPress={() => void entries.refetch()}
          />
        </View>
      ) : listed.length === 0 ? (
        <Text style={styles.muted}>{COPY.ENTRIES_EMPTY}</Text>
      ) : (
        <>
          {listed.map((entry, index) => (
            <View key={entry.uuid} style={[styles.entry, index === listed.length - 1 && styles.lastEntry]}>
              <Text style={styles.heading}>
                Entry {entry.sequence} · {COPY.ENTRY_KINDS[entry.kind]}
              </Text>
              <Text style={styles.muted}>Effective {formatDate(entry.effectiveOn)}</Text>
              {formatRegisterChanges(entry.changes).map((line, number) => (
                <Text key={number} style={styles.text}>
                  {line}
                </Text>
              ))}
              {!!(entry.corrects || entry.correctedBy) && (
                <Rows>
                  {!!entry.corrects && <Row label="Corrects">{linked(entry.corrects)}</Row>}
                  {!!entry.correctedBy && <Row label="Reversed by">{linked(entry.correctedBy)}</Row>}
                </Rows>
              )}
              {entry.correctable && steps?.prepare && (
                <Action
                  label={COPY.PREPARE}
                  accessibilityLabel={`Correct entry ${entry.sequence} of ${name}`}
                  onPress={() => onCorrect(entry)}
                />
              )}
            </View>
          ))}
          {moreFailed ? (
            <View style={styles.group}>
              <Text accessibilityRole="alert" style={styles.error}>
                More register entries could not be loaded. The history above is incomplete.
              </Text>
              <Action
                label="Try more entries again"
                accessibilityLabel={`Try more entries of ${name} again`}
                disabled={entries.isFetching}
                onPress={() => void loadMore()}
              />
            </View>
          ) : (
            entries.hasNextPage && (
              <Action
                label={entries.isFetchingNextPage ? 'Loading entries…' : 'Load more entries'}
                accessibilityLabel={`Load more entries of ${name}`}
                disabled={entries.isFetching}
                onPress={() => void loadMore()}
              />
            )
          )}
        </>
      )}
    </View>
  );
}
