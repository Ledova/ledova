import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  HOLDER_TYPE_LABELS,
  formatShareCount,
  searchRows,
  sharePercentage,
  REGISTER_PARTICULARS_COPY,
  type Person,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, Choice, Disclosure, Row, Rows, Section } from '../../components/Ledger';
import { Field } from '../../components/register/RegisterFields';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

type Holding = { register: TokenHoldersResponse; holder: TokenHoldersResponse['holders'][number] };
type Shareholder = { member: string; name: string; holdings: Holding[] };

const PAGE_SIZE = 25;

const counted = (count: number) => `${formatShareCount(String(count))} ${count === 1 ? 'person' : 'people'}`;

function needsIdentityReview({ holder }: Pick<Holding, 'holder'>) {
  return holder.holderType === 'ambiguous' || holder.holderType === 'unidentified';
}

export function CompanyShareholders({
  ready,
  registers,
  people,
  blocked,
  onChangeParticulars,
}: {
  ready: boolean;
  registers: TokenHoldersResponse[];
  people: Person[];
  blocked: boolean;
  onChangeParticulars?: (member: string, token: string) => void;
}) {
  const styles = useCompanyStyles();
  const [search, setSearch] = useState('');
  const [chosenClass, setChosenClass] = useState('');
  const [shown, setShown] = useState(PAGE_SIZE);
  const [openPerson, setOpenPerson] = useState('');
  if (!ready) return null;
  const grouped = new Map<string, Shareholder>();
  for (const register of registers) {
    for (const holder of register.holders) {
      const existing = grouped.get(holder.member);
      const holding = { register, holder };
      if (existing) existing.holdings.push(holding);
      else
        grouped.set(holder.member, {
          member: holder.member,
          name: holder.name || HOLDER_TYPE_LABELS[holder.holderType],
          holdings: [holding],
        });
    }
  }
  const shareholders = [...grouped.values()].sort(
    (left, right) => left.name.localeCompare(right.name) || left.member.localeCompare(right.member),
  );
  const classFilter = registers.some(({ token }) => token.uuid === chosenClass) ? chosenClass : '';
  const found = searchRows(
    classFilter
      ? shareholders.filter((member) => member.holdings.some(({ register }) => register.token.uuid === classFilter))
      : shareholders,
    (member) => [member.name, ...member.holdings.map(({ holder }) => holder.name ?? '')].join(' '),
    search,
  );
  const withoutShares = classFilter
    ? []
    : searchRows(
        people.filter((person) => person.onRegister === false && !person.hasAwards && !person.awardOnly),
        (person) => `${person.name} ${person.residentialAddress}`,
        search,
      );
  const count = found.length + withoutShares.length;
  const shownShareholders = found.slice(0, shown);
  const shownPeople = withoutShares.slice(0, Math.max(0, shown - found.length));
  const unresolved = shareholders.filter(({ holdings }) => holdings.some(needsIdentityReview)).length;
  const choose = (value: string) => {
    setChosenClass(value);
    setShown(PAGE_SIZE);
  };
  return (
    <Section title="Current shareholders">
      {registers.some(({ initialized }) => !initialized) && (
        <Text style={styles.muted}>
          Unopened classes have no recorded holdings. This list includes only the opened registers.
        </Text>
      )}
      {shareholders.length === 0 && people.length === 0 ? (
        <Text style={styles.muted}>No current shareholders yet.</Text>
      ) : (
        <>
          <Field
            label="Search people"
            value={search}
            editable
            maxLength={100}
            clearable
            onChange={(value) => {
              setSearch(value);
              setShown(PAGE_SIZE);
            }}
          />
          <View style={styles.group}>
            <Text style={styles.muted}>Share class</Text>
            <View accessibilityRole="radiogroup" accessibilityLabel="Share class" style={styles.choices}>
              <Choice
                label="All classes"
                accessibilityRole="radio"
                selected={!classFilter}
                onPress={() => choose('')}
              />
              {registers.map(({ token }) => (
                <Choice
                  key={token.uuid}
                  label={`${token.name} · ${token.symbol}`}
                  accessibilityRole="radio"
                  selected={classFilter === token.uuid}
                  onPress={() => choose(token.uuid)}
                />
              ))}
            </View>
          </View>
          {(!!search.trim() || !!classFilter) && (
            <Text style={styles.muted}>
              {count === 0 ? 'No people' : counted(count)} {count === 1 ? 'matches' : 'match'}
              {search.trim() ? ' your search' : ''}.
            </Text>
          )}
          {unresolved > 0 && (
            <Text style={styles.muted}>
              {unresolved} {unresolved === 1 ? 'shareholder needs' : 'shareholders need'} identity review.
            </Text>
          )}
          {shownShareholders.map((member, index) => (
            <View
              key={member.member}
              style={[styles.entry, index === shownShareholders.length - 1 && !shownPeople.length && styles.lastEntry]}
            >
              <Text style={styles.heading}>{member.name}</Text>
              {member.holdings.some(needsIdentityReview) && <Text style={styles.muted}>Identity needs review</Text>}
              <Rows>
                {member.holdings
                  .filter(({ register }) => !classFilter || register.token.uuid === classFilter)
                  .map(({ register, holder }) => (
                    <Row key={register.token.uuid} label={`${register.token.name} · ${register.token.symbol}`}>
                      {formatShareCount(holder.balance)} · {sharePercentage(holder.balance, register.issuedSupply)}
                    </Row>
                  ))}
              </Rows>
              {onChangeParticulars && (
                <Action
                  label={REGISTER_PARTICULARS_COPY.PREPARE}
                  accessibilityLabel={`${REGISTER_PARTICULARS_COPY.PREPARE} for ${member.name}`}
                  disabled={blocked}
                  onPress={() => onChangeParticulars(member.member, member.holdings[0].register.token.uuid)}
                />
              )}
            </View>
          ))}
          {shareholders.length === 0 && <Text style={styles.muted}>No current shareholders yet.</Text>}
          {shownPeople.length > 0 && (
            <View style={styles.group}>
              <Text accessibilityRole="header" style={styles.heading}>
                People without shares
              </Text>
              {shownPeople.map((person) => (
                <Disclosure
                  key={person.member}
                  open={openPerson === person.member}
                  onToggle={() => setOpenPerson(openPerson === person.member ? '' : person.member)}
                  summary={<Text style={styles.text}>{person.name}</Text>}
                >
                  <Rows>
                    <Row label="Residential address">{person.residentialAddress}</Row>
                  </Rows>
                </Disclosure>
              ))}
            </View>
          )}
          {count > shown && <Action label="Load more people" onPress={() => setShown(shown + PAGE_SIZE)} />}
        </>
      )}
    </Section>
  );
}
