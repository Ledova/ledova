import { useState, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import {
  REGISTER_CORRECTION_COPY as COPY,
  entryDate,
  entryName,
  formatDate,
  formatRegisterChanges,
  formatShortDate,
  type RegisterEntry,
} from '@ledova/shared';
import { MoreToggle, Status } from '../../components/Ledger';
import { useLedgerStyles } from './useLedgerStyles';

function Movements({ entry }: { entry: RegisterEntry }) {
  const look = useLedgerStyles();
  const [all, setAll] = useState(false);
  const { changes } = entry;
  const lines = formatRegisterChanges(all ? changes : changes.slice(0, 2));
  return (
    <View style={look.terms}>
      <View accessible accessibilityLabel={`Share movements: ${lines.join(', ')}`}>
        {lines.map((line, index) => (
          <Text key={index} style={look.text}>
            {line}
          </Text>
        ))}
      </View>
      {changes.length > 2 && (
        <MoreToggle open={all} onToggle={() => setAll((value) => !value)}>
          {all ? 'Show fewer share changes' : `Show all ${changes.length} share changes`}
        </MoreToggle>
      )}
    </View>
  );
}

function EntryRow({
  entry,
  entries,
  action,
  ruled,
}: {
  entry: RegisterEntry;
  entries: Map<string, RegisterEntry>;
  action: ReactNode;
  ruled: boolean;
}) {
  const look = useLedgerStyles();
  const corrected = entry.corrects ? entries.get(entry.corrects) : undefined;
  const reversal = entry.correctedBy ? entries.get(entry.correctedBy) : undefined;
  const companyDated = ['ISSUE', 'TRANSFER'].includes(entry.kind.toUpperCase());
  const kind = COPY.ENTRY_KINDS[entry.kind];
  const date = formatShortDate(companyDated ? entry.companyEventOn : entry.effectiveOn, 'Date not recorded');
  return (
    <View style={[look.record, ruled && look.ruled]}>
      <View style={look.terms}>
        <View style={look.split}>
          <Text accessibilityLabel={`${kind}, Date: ${date}`} style={[look.title, look.fill]}>
            {kind}
            <Text style={look.muted}>{` · ${date}`}</Text>
          </Text>
          {action}
        </View>
        {companyDated && entry.effectiveOn !== entry.companyEventOn && (
          <Text style={look.muted}>{`Ledger date ${formatShortDate(entry.effectiveOn)}`}</Text>
        )}
        {!!entry.correctedBy && (
          <Status tone="closed" muted>
            {reversal ? `Reversed on ${formatDate(entryDate(reversal))}` : 'Reversed'}
          </Status>
        )}
        {!!entry.corrects && (
          <Text style={look.muted}>
            {corrected ? `Corrects the ${entryName(corrected)}` : 'Corrects an earlier entry'}
          </Text>
        )}
        <Movements entry={entry} />
      </View>
    </View>
  );
}

export function ClassEntries({
  entries,
  visible,
  renderAction,
}: {
  entries: RegisterEntry[];
  visible: boolean;
  renderAction: (entry: RegisterEntry) => ReactNode;
}) {
  const named = new Map(entries.map((entry) => [entry.uuid, entry]));
  return (
    <View accessibilityLabel="Ledger changes">
      {visible &&
        entries.map((entry, index) => (
          <EntryRow key={entry.uuid} entry={entry} entries={named} action={renderAction(entry)} ruled={index > 0} />
        ))}
    </View>
  );
}
