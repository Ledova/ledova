import { useState } from 'react';
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

const SHOWN = 25;

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
  const entries = useRegisterEntries(epoch, register.token.uuid);
  const [shown, setShown] = useState(SHOWN);
  const sequences = new Map((entries.data ?? []).map((entry) => [entry.uuid, entry.sequence]));
  return (
    <View style={styles.group}>
      <Text accessibilityRole="header" style={styles.heading}>
        {COPY.ENTRIES_TITLE}
      </Text>
      {entries.isPending ? (
        <Text style={styles.muted}>Loading register entries…</Text>
      ) : entries.isError ? (
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
      ) : entries.data.length === 0 ? (
        <Text style={styles.muted}>{COPY.ENTRIES_EMPTY}</Text>
      ) : (
        <>
          {entries.data.slice(0, shown).map((entry, index, listed) => (
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
                  {!!entry.corrects && <Row label="Corrects">Entry {sequences.get(entry.corrects)}</Row>}
                  {!!entry.correctedBy && <Row label="Reversed by">Entry {sequences.get(entry.correctedBy)}</Row>}
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
          {entries.data.length > shown && (
            <Action
              label="Load more entries"
              accessibilityLabel={`Load more entries of ${name}`}
              onPress={() => setShown((count) => count + SHOWN)}
            />
          )}
        </>
      )}
    </View>
  );
}
