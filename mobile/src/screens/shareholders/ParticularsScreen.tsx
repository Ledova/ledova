import { useMemo, useState, type ReactNode } from 'react';
import { Keyboard, Text, View } from 'react-native';
import { useNavigation, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { randomUUID } from 'expo-crypto';
import {
  DESTINATIONS,
  FIELD_LIMITS,
  REGISTER_PARTICULARS_COPY as COPY,
  useErrorSummary,
  useParticularsEdit,
  useParticularsMember,
  useSubmissionOwner,
  useUserPreferences,
  type OrderSubmissionOwner,
} from '@ledova/shared';
import { Action, FormActions, LoadError, Loading, Row, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { Field } from '../../components/register/RegisterFields';
import { useMemberRecordsState } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { RegisterAccess } from './RegisterAccess';
import { useShareholderStyles } from './useShareholderStyles';

const TITLE = DESTINATIONS.companyRegisterParticulars.title;
const LEDE =
  "Change a member's name and residential address on the register. The change is recorded at once, dated today " +
  "(UTC), and kept in the register's history.";

export function ParticularsScreen({ route }: { route: RouteProp<SignedInStackParamList, 'ShareholderParticulars'> }) {
  const { company, member } = route.params;
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const preferences = useUserPreferences();
  const { directory, companies } = useMemberRecordsState();
  const readable = companies.some((row) => row.uuid === company && row.canReadRegister);
  if (owner && !preferences.isError && readable && !directory.hasError && !directory.isLoading)
    return (
      <OwnParticulars
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company}/${member}`}
        owner={owner}
        currentOwner={boundary.get}
        company={company}
        member={member}
      />
    );
  return (
    <Page testID="particulars-scroll" title={TITLE} lede={LEDE}>
      <RegisterAccess owner={owner} />
    </Page>
  );
}

function OwnParticulars({
  owner,
  currentOwner,
  company,
  member,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
  member: string;
}) {
  const look = useShareholderStyles();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const guard = useMemo(
    () => () => {
      if (currentOwner() !== owner) throw new Error('Your signed-in account changed. Reopen the register.');
    },
    [owner, currentOwner],
  );
  const { classes, appointments, editing, registers, people, found } = useParticularsMember(
    owner,
    guard,
    member,
    orderSubmissionSession,
  );
  const [formOpen, setFormOpen] = useState(false);
  if (
    !formOpen &&
    found?.particulars.isSuccess &&
    found.particulars.isFetchedAfterMount &&
    found.particulars.fetchStatus === 'idle'
  )
    setFormOpen(true);
  const reads = [...registers, ...people];
  const retry = () => {
    if (classes.isError) void classes.refetch();
    if (appointments.isError) void appointments.refetch();
    for (const read of reads) if (read.isError) void read.refetch();
  };
  const fetching = classes.isFetching || appointments.isFetching || reads.some((read) => read.isFetching);
  const stale =
    classes.isError || appointments.isError || (found ? found.read.isError : reads.some((read) => read.isError));
  let content: ReactNode;
  if (!classes.data || !appointments.data)
    content =
      classes.isError || appointments.isError ? (
        <LoadError retry={retry} busy={fetching}>
          {classes.isError ? 'The register could not be loaded.' : 'Your appointments could not be loaded.'}
        </LoadError>
      ) : (
        <Loading>Loading the register…</Loading>
      );
  else if (found && found.company.uuid !== company)
    content = <Text style={look.muted}>This share class is not in a register you can read.</Text>;
  else if (editing.length === 0) content = <Text style={look.muted}>{COPY.AUTHORITY_NOTE}</Text>;
  else if (!found)
    content = reads.some((read) => read.isPending) ? (
      <Loading>Loading the register…</Loading>
    ) : stale ? (
      <LoadError retry={retry} busy={fetching}>
        The register or your appointments could not be loaded.
      </LoadError>
    ) : (
      <Text style={look.muted}>This member is not a current member of a register you can change.</Text>
    );
  else if (found.particulars.isPending) content = <Loading>Loading the register…</Loading>;
  else {
    const recorded = found.particulars.data?.members.find((row) => row.member === member);
    content = (
      <>
        <Section title="Current particulars">
          {found.particulars.isError ? (
            <LoadError retry={() => found.particulars.refetch()} busy={found.particulars.isFetching}>
              Their recorded particulars could not be loaded.
            </LoadError>
          ) : (
            <Rows>
              <Row label="Name">{recorded?.name || found.name || 'Not recorded'}</Row>
              <Row label="Residential address">{recorded?.residentialAddress || 'Not recorded'}</Row>
            </Rows>
          )}
          <Text style={look.muted}>{recorded?.followsProfile ? COPY.FOLLOWS_PROFILE : COPY.PRECEDENCE_NOTE}</Text>
        </Section>
        {recorded?.followsProfile ? null : formOpen ? (
          <Section title={COPY.PREPARE}>
            {stale && (
              <LoadError retry={retry} busy={fetching}>
                The register or your appointments could not be loaded.
              </LoadError>
            )}
            <ParticularsForm
              owner={owner}
              guard={guard}
              company={found.company.uuid}
              member={member}
              appointment={found.company.appointment}
              current={{ name: recorded?.name || found.name || '', address: recorded?.residentialAddress ?? '' }}
              recorded={{ name: recorded?.name ?? '', address: recorded?.residentialAddress ?? '' }}
              blocked={stale}
              onConflict={() => {
                void found.read.refetch();
                void found.particulars.refetch();
                void appointments.refetch();
              }}
              onMissing={() => void appointments.refetch()}
              onChanged={() => {
                Keyboard.dismiss();
                navigation.popTo('Shareholder', { company, member, outcome: 'Particulars changed.' });
              }}
            />
          </Section>
        ) : (
          !found.particulars.isError && <Loading>Loading their particulars…</Loading>
        )}
      </>
    );
  }
  return (
    <Page testID="particulars-scroll" title={TITLE} lede={LEDE}>
      {content}
    </Page>
  );
}

function ParticularsForm(props: Omit<Parameters<typeof useParticularsEdit>[0], 'newKey' | 'session'>) {
  const styles = useCompanyStyles();
  const look = useShareholderStyles();
  const { draft, busy, error, conflict, update, reload, problems, submit } = useParticularsEdit({
    ...props,
    newKey: randomUUID,
    session: orderSubmissionSession,
  });
  const checks = useErrorSummary(problems);
  return (
    <View style={look.form}>
      <Field
        label={COPY.NAME}
        value={draft.name}
        maxLength={FIELD_LIMITS.NAME}
        editable={!busy}
        error={checks.field('name').error}
        onChange={(name) => update({ name })}
      />
      <Field
        label={COPY.RESIDENTIAL_ADDRESS}
        value={draft.address}
        maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
        multiline
        rows={3}
        editable={!busy}
        error={checks.field('address').error}
        onChange={(address) => update({ address })}
      />
      <View style={styles.group}>
        <Field
          label={`${COPY.REASON} (optional)`}
          value={draft.reason}
          maxLength={FIELD_LIMITS.REASON}
          multiline
          rows={3}
          editable={!busy}
          onChange={(reason) => update({ reason })}
        />
        <Text style={look.muted}>{COPY.REASON_NOTE}</Text>
      </View>
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <FormActions>
        {conflict && <Action label={COPY.RELOAD} onPress={reload} />}
        <Action
          primary
          label={busy ? 'Saving change…' : COPY.SUBMIT}
          disabled={busy || props.blocked || conflict}
          onPress={() => {
            if (!checks.check()) return;
            Keyboard.dismiss();
            void submit();
          }}
        />
      </FormActions>
    </View>
  );
}
