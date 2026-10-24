import { Text, View } from 'react-native';
import type { TokenHoldersResponse } from '@ledova/shared';
import { Action, Section } from '../../components/Ledger';
import { FormerShareholders } from '../../components/register/ClassRegister';
import { PersonFields } from '../../components/register/PersonPicker';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import { CompanyShareholders } from './CompanyShareholders';
import { usePersonRegistration } from './usePersonRegistration';

function PersonForm({ person }: { person: ReturnType<typeof usePersonRegistration> }) {
  const styles = useCompanyStyles();
  return (
    <Section title="Add person">
      <PersonFields
        name={person.name}
        residentialAddress={person.address}
        onName={person.setName}
        onResidentialAddress={person.setAddress}
        editable={!person.busy && !person.held && person.canPrepare}
      />
      {!!person.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {person.error}
        </Text>
      )}
      <View style={styles.actions}>
        <Action label="Cancel" disabled={person.busy || person.held} onPress={person.close} />
        <Action
          primary
          label={person.busy ? 'Adding person…' : person.held ? 'Retry original save' : 'Add person'}
          disabled={person.busy || (!person.held && (!person.canPrepare || !person.peopleReady))}
          onPress={() => void person.save()}
        />
      </View>
    </Section>
  );
}

export function CompanyPeople({
  epoch,
  company,
  registers,
  sourceReady,
  ready,
  blocked,
  onHeldChange,
  onOpen,
}: {
  epoch: number;
  company: string;
  registers: TokenHoldersResponse[];
  sourceReady: boolean;
  ready: boolean;
  blocked: boolean;
  onHeldChange: (held: boolean) => void;
  onOpen: (member: string) => void;
}) {
  const styles = useCompanyStyles();
  const person = usePersonRegistration({ epoch, company, sourceReady, onHeldChange });
  const listed = ready && person.authorised;
  return (
    <>
      <CompanyShareholders
        ready={listed}
        registers={registers}
        people={person.peopleReady && person.query.data ? person.query.data : []}
        blocked={blocked}
        onOpen={onOpen}
      />
      {listed && <FormerShareholders registers={registers} blocked={blocked} onOpen={onOpen} />}
      {(ready || person.editing) && (
        <>
          {person.readable && person.query.isError ? (
            <View style={styles.group}>
              <Text accessibilityRole="alert" style={styles.error}>
                The company people could not be loaded.
              </Text>
              <Action
                label="Retry company people"
                disabled={person.query.isFetching}
                onPress={() => void person.query.refetch()}
              />
            </View>
          ) : person.readable && !person.peopleReady ? (
            <Text style={styles.muted}>Loading company people…</Text>
          ) : null}
          {!!person.outcome && (
            <Text accessibilityLiveRegion="polite" style={styles.text}>
              {person.outcome}
            </Text>
          )}
          {person.appointments.isError && (
            <View style={styles.group}>
              <Text accessibilityRole="alert" style={styles.error}>
                Your appointments could not be loaded.
              </Text>
              <Action
                label="Retry appointments"
                disabled={person.appointments.isFetching}
                onPress={() => void person.appointments.refetch()}
              />
            </View>
          )}
          {person.editing ? (
            <PersonForm person={person} />
          ) : person.canPrepare ? (
            <View style={styles.actions}>
              <Action primary label="Add person" disabled={blocked || !person.peopleReady} onPress={person.open} />
            </View>
          ) : null}
        </>
      )}
    </>
  );
}
