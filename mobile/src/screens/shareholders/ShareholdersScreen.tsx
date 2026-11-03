import { useEffect, useState } from 'react';
import { Keyboard, RefreshControl, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { randomUUID } from 'expo-crypto';
import {
  FIELD_LIMITS,
  PAGE_SIZE,
  REGISTER_COPY,
  REGISTER_CORRECTION_COPY,
  formatDate,
  formatShareCount,
  needsIdentityReview,
  sharePercentage,
  shareholderList,
  useErrorSummary,
  usePersonRegistration,
  useSubmissionOwner,
  type OrderSubmissionOwner,
  type Person,
  type RegisterEntryKind,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { AccountCheck } from '../../components/AccountCheck';
import { CompanyContextNotice } from '../../components/CompanyContextNotice';
import { FilterPopover } from '../../components/FilterPopover';
import {
  Action,
  Actions,
  FormActions,
  LinkRow,
  LoadError,
  Loading,
  Outcome,
  Row,
  Rows,
  Section,
  ShowMore,
} from '../../components/Ledger';
import { Page } from '../../components/Page';
import { Pager } from '../../components/Pager';
import { Field } from '../../components/register/RegisterFields';
import { SelectField } from '../../components/SelectField';
import { useAppTheme, useMemberRecordsState } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { useCompanyRegisters } from './useCompanyRegisters';
import { useShareholderStyles } from './useShareholderStyles';

const TITLE = 'Shareholders';
const LEDE = 'Who holds shares and what they hold in each class.';
const SEARCH_DELAY_MS = 300;
const NOUN = ['person', 'people'] as const;

const counted = (count: number) => `${formatShareCount(String(count))} ${count === 1 ? NOUN[0] : NOUN[1]}`;

export function ShareholdersScreen() {
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  const { directory, companies, company } = useMemberRecordsState();
  const choosing = directory.isLoading || (!company && companies.length > 0);
  if (owner && company?.canReadRegister && !directory.hasError && !choosing)
    return (
      <CompanyShareholders
        key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}/${company.uuid}`}
        owner={owner}
        currentOwner={boundary.get}
        company={company.uuid}
      />
    );
  return (
    <Page testID="shareholders-scroll" title={TITLE} lede={LEDE}>
      {!owner ? (
        <AccountCheck />
      ) : directory.hasError ? (
        <LoadError retry={directory.retry} busy={directory.isRefreshing}>
          Your company access could not be confirmed.
        </LoadError>
      ) : choosing ? (
        <Loading>Loading the register…</Loading>
      ) : (
        <CompanyContextNotice />
      )}
    </Page>
  );
}

function CompanyShareholders({
  owner,
  currentOwner,
  company,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  company: string;
}) {
  const theme = useAppTheme();
  const form = useCompanyStyles();
  const look = useShareholderStyles();
  const navigation = useNavigation<NativeStackNavigationProp<SignedInStackParamList>>();
  const source = useCompanyRegisters(owner, currentOwner, company, 'Shareholders');
  const [held, setHeld] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [classFilter, setClassFilter] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => {
    const text = typed.trim();
    if (text === search) return;
    const timer = setTimeout(() => {
      setSearch(text);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed, search]);
  const person = usePersonRegistration({
    owner,
    guard: source.guard,
    company,
    sourceReady: source.ownershipReady,
    onHeldChange: setHeld,
    newKey: randomUUID,
    session: orderSubmissionSession,
  });
  const registers = source.ownershipReady ? (source.registers ?? []) : [];
  const people: Person[] = person.peopleReady ? (person.query.data ?? []) : [];
  const list = shareholderList(registers, people, { class: classFilter, search, page });
  const { shareholders, count, visibleClasses, shownShareholders, shownPeople, unresolved } = list;
  const open = (member: string) => navigation.navigate('Shareholder', { company, member });
  const clear = () => {
    setTyped('');
    setSearch('');
    setPage(1);
  };
  const filtered = !!list.classFilter;
  const status =
    search || filtered
      ? `${count === 0 ? `No ${NOUN[1]}` : counted(count)} ${count === 1 ? 'matches' : 'match'}${search ? ' your search' : ''}.`
      : '';
  return (
    <Page
      testID="shareholders-scroll"
      title={TITLE}
      lede={LEDE}
      titleAction={
        source.ownershipReady && (shareholders.length > 0 || people.length > 0) ? (
          <FilterPopover active={filtered || !!search}>
            {(close) => (
              <>
                <View style={form.group}>
                  <Text style={form.text}>Search people</Text>
                  <View style={look.line}>
                    <TextInput
                      accessibilityLabel="Search people"
                      value={typed}
                      maxLength={100}
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChangeText={setTyped}
                      style={[form.input, look.fill]}
                    />
                    {(!!typed || !!search) && (
                      <Action label="Clear" accessibilityLabel="Clear (Search people)" onPress={clear} />
                    )}
                  </View>
                  {!!status && (
                    <Text accessibilityLiveRegion="polite" style={look.muted}>
                      {status}
                    </Text>
                  )}
                </View>
                <SelectField
                  label="Share class"
                  options={[
                    { value: '', label: 'All classes' },
                    ...registers.map(({ token }) => ({ value: token.uuid, label: `${token.name} · ${token.symbol}` })),
                  ]}
                  value={list.classFilter}
                  onChange={(value) => {
                    close();
                    setClassFilter(value);
                    setPage(1);
                  }}
                />
              </>
            )}
          </FilterPopover>
        ) : undefined
      }
      refreshControl={
        <RefreshControl
          testID="shareholders-refresh"
          refreshing={refreshing}
          tintColor={theme.colors.interactive.active}
          onRefresh={() => {
            if (refreshing || person.editing || held) return;
            setRefreshing(true);
            void Promise.all([
              source.retry(),
              person.appointments.refetch(),
              ...(person.readable ? [person.query.refetch()] : []),
            ]).finally(() => setRefreshing(false));
          }}
        />
      }
    >
      {source.accountError ? (
        <LoadError retry={source.retryAccount} busy={source.isRefreshing}>
          Your account could not be loaded.
        </LoadError>
      ) : source.hasError || source.invalid ? (
        <LoadError retry={source.retry} busy={source.isRefreshing}>
          The register could not be loaded.
        </LoadError>
      ) : !source.ownershipReady ? (
        <Loading>Loading the register…</Loading>
      ) : (
        <>
          <Section title="Current shareholders">
            {registers.some(({ initialized }) => !initialized) && (
              <Text style={look.muted}>
                Unopened classes have no recorded holdings. This list includes only the opened registers.
              </Text>
            )}
            {shareholders.length === 0 && people.length === 0 ? (
              <Text style={look.muted}>No current shareholders yet.</Text>
            ) : (
              <>
                {count === 0 && (!!search || filtered) && (
                  <Text accessibilityLiveRegion="polite" style={look.muted}>
                    No people match these filters.
                  </Text>
                )}
                {unresolved > 0 && (
                  <Text style={look.muted}>
                    {unresolved} {unresolved === 1 ? 'shareholder needs' : 'shareholders need'} identity review. Open
                    their details before relying on these records.
                  </Text>
                )}
                {shownShareholders.length > 0 && (
                  <View accessibilityLabel="Company shareholders">
                    <Rows>
                      {shownShareholders.map((member) => {
                        const details = (
                          <>
                            {visibleClasses.map((register) => {
                              const holding =
                                register.initialized &&
                                member.holdings.find(({ register: kept }) => kept.token.uuid === register.token.uuid);
                              return (
                                holding && (
                                  <Text key={register.token.uuid} style={look.muted}>
                                    {register.token.symbol} {formatShareCount(holding.holder.balance)} ·{' '}
                                    {sharePercentage(holding.holder.balance, register.issuedSupply)}
                                  </Text>
                                )
                              );
                            })}
                            {member.holdings.some(needsIdentityReview) && (
                              <Text style={look.small}>Identity needs review</Text>
                            )}
                          </>
                        );
                        return held ? (
                          <View key={member.member} style={look.row}>
                            <Text style={look.title}>{member.name}</Text>
                            {details}
                          </View>
                        ) : (
                          <LinkRow key={member.member} label={member.name} onPress={() => open(member.member)}>
                            {details}
                          </LinkRow>
                        );
                      })}
                    </Rows>
                  </View>
                )}
                {shareholders.length === 0 && <Text style={look.muted}>No current shareholders yet.</Text>}
                {shownPeople.length > 0 && (
                  <View style={look.stack}>
                    <Text accessibilityRole="header" style={look.heading}>
                      People without shares
                    </Text>
                    <Rows>
                      {shownPeople.map((row) => (
                        <View key={row.member} style={look.row}>
                          <Text style={look.text}>{row.name}</Text>
                          <Text style={look.muted}>{row.residentialAddress}</Text>
                        </View>
                      ))}
                    </Rows>
                  </View>
                )}
                <Pager label="Shareholder pages" page={page} count={count} noun={NOUN} onPage={setPage} />
              </>
            )}
          </Section>
          <FormerShareholders registers={registers} blocked={held} onOpen={open} />
          {person.readable && person.query.isError ? (
            <LoadError retry={() => person.query.refetch()} busy={person.query.isFetching}>
              The company people could not be loaded.
            </LoadError>
          ) : person.readable && !person.peopleReady ? (
            <Loading>Loading company people…</Loading>
          ) : null}
          {!!person.outcome && <Outcome>{person.outcome}</Outcome>}
          {person.appointments.isError && (
            <LoadError retry={() => person.appointments.refetch()} busy={person.appointments.isFetching}>
              Your appointments could not be loaded.
            </LoadError>
          )}
          {person.editing ? (
            <PersonForm person={person} />
          ) : person.canPrepare ? (
            <Actions>
              <Action primary label="Add person" disabled={held || !person.peopleReady} onPress={person.open} />
            </Actions>
          ) : null}
        </>
      )}
    </Page>
  );
}

function PersonForm({ person }: { person: ReturnType<typeof usePersonRegistration> }) {
  const styles = useCompanyStyles();
  const checks = useErrorSummary(person.problems);
  const locked = person.busy || person.held || !person.canPrepare;
  return (
    <Section title="Add person">
      <Field
        label="Name"
        value={person.name}
        maxLength={FIELD_LIMITS.NAME}
        editable={!locked}
        autoFocus
        error={checks.field('name').error}
        onChange={person.setName}
      />
      <Field
        label="Residential address"
        value={person.address}
        maxLength={FIELD_LIMITS.RESIDENTIAL_ADDRESS}
        multiline
        editable={!locked}
        error={checks.field('address').error}
        onChange={person.setAddress}
      />
      {!!person.error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {person.error}
        </Text>
      )}
      <FormActions>
        <Action
          label="Cancel"
          disabled={person.busy || person.held}
          onPress={() => {
            Keyboard.dismiss();
            person.close();
          }}
        />
        <Action
          primary
          label={person.busy ? 'Adding person…' : person.held ? 'Retry original save' : 'Add person'}
          disabled={person.busy || (!person.held && (!person.canPrepare || !person.peopleReady))}
          onPress={() => {
            if (!person.held && !checks.check()) return;
            Keyboard.dismiss();
            void person.save();
          }}
        />
      </FormActions>
    </Section>
  );
}

function FormerShareholders({
  registers,
  blocked,
  onOpen,
}: {
  registers: TokenHoldersResponse[];
  blocked: boolean;
  onOpen: (member: string) => void;
}) {
  const look = useShareholderStyles();
  const classes = registers.filter((register) => register.initialized && register.formerMembers?.length);
  if (!classes.length) return null;
  return (
    <Section title="Former shareholders">
      {classes.map((register) => (
        <View key={register.token.uuid} style={look.stack}>
          <Text accessibilityRole="header" style={look.heading}>
            {register.token.name} · {register.token.symbol}
          </Text>
          <FormerMembers register={register} blocked={blocked} onOpen={onOpen} />
        </View>
      ))}
    </Section>
  );
}

function FormerMembers({
  register,
  blocked,
  onOpen,
}: {
  register: TokenHoldersResponse;
  blocked: boolean;
  onOpen: (member: string) => void;
}) {
  const look = useShareholderStyles();
  const [shown, setShown] = useState(PAGE_SIZE);
  const formers = register.formerMembers ?? [];
  const title = REGISTER_COPY.FORMER_TITLE.toLowerCase();
  return (
    <View style={look.group}>
      <ShowMore show={`Show ${title} (${formers.length})`} hide={`Hide ${title}`}>
        <Text style={look.muted}>{REGISTER_COPY.FORMER_NOTE}</Text>
        {register.formerMembersStale && (
          <Text style={look.muted}>The former-member history needs a refresh before relying on it.</Text>
        )}
        <Rows>
          {formers.slice(0, shown).map((former) => {
            const name = former.name || 'Name not recorded';
            return (
              <View key={former.uuid} style={look.row}>
                <Text style={look.name}>{name}</Text>
                {!!former.member && (
                  <Action
                    label="Details"
                    accessibilityLabel={`Details (${name})`}
                    disabled={blocked}
                    onPress={() => onOpen(former.member!)}
                  />
                )}
                <Rows>
                  <Row label="Shares at cessation">{formatShareCount(former.sharesAtCessation)}</Row>
                  <Row label="Ceased on">{formatDate(former.ceasedOn)}</Row>
                  <Row label="Identity source">{former.identitySourceDisplay}</Row>
                  {former.sourceEntrySequence !== null && (
                    <Row label="Cessation entry">{String(former.sourceEntrySequence)}</Row>
                  )}
                  {!!former.sourceEntryKind && (
                    <Row label="Cessation entry kind">
                      {REGISTER_CORRECTION_COPY.ENTRY_KINDS[former.sourceEntryKind as RegisterEntryKind]}
                    </Row>
                  )}
                  {!!former.sourceEffectiveOn && (
                    <Row label="Source effective date">{formatDate(former.sourceEffectiveOn)}</Row>
                  )}
                  {!!former.correctedBy && <Row label="Correction">Cessation corrected by a later entry</Row>}
                  {!!former.returnedOn && <Row label="Returned on">{formatDate(former.returnedOn)}</Row>}
                  {!!former.walletAddress && (
                    <Row label="Recorded wallet" mono>
                      {former.walletAddress}
                    </Row>
                  )}
                </Rows>
              </View>
            );
          })}
        </Rows>
        {formers.length > shown && (
          <Action label="Load more former shareholders" onPress={() => setShown(shown + PAGE_SIZE)} />
        )}
      </ShowMore>
    </View>
  );
}
