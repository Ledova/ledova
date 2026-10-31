import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, TouchableOpacity, View } from 'react-native';
import { useNavigation, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { BuildingsIcon, CaretRightIcon } from 'phosphor-react-native';
import {
  formatDate,
  formatShareCount,
  ownershipColorIndex,
  ownershipView,
  rankOwnershipClasses,
  sharePercentage,
  type OwnershipClass,
  type OwnMemberRecord,
  type useMemberRecords,
} from '@ledova/shared';
import { Action, LinkRow, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { AwardStatus } from './AwardStatus';
import { CompanyPicker } from './CompanyPicker';
import { MemberNotice, useCompanyRecord, useMemberRecordsState, useMemberRefresh } from './MemberRecordsProvider';

type Read = ReturnType<typeof useMemberRecords>;
type Ownership = NonNullable<ReturnType<typeof ownershipView>>;

function useDashboardStyles() {
  return useThemedStyles((theme) => ({
    switcher: {
      width: 40,
      height: 40,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
    },
    trail: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, alignItems: 'center' as const, gap: 12 },
    trailLink: {
      paddingVertical: 8,
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      color: theme.colors.text.muted,
    },
    trailHere: { fontFamily: theme.fontFamily.medium, fontSize: 14, color: theme.colors.text.primary },
    metrics: {
      flexDirection: 'row' as const,
      flexWrap: 'wrap' as const,
      rowGap: theme.spacing.md,
      paddingBottom: theme.spacing.md,
      borderBottomWidth: 1,
      borderBottomColor: theme.colors.border.subtle,
    },
    metric: { width: '50%' as const, gap: 4, paddingRight: theme.spacing.sm },
    metricLabel: { fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.muted },
    metricValue: { fontFamily: theme.fontFamily.medium, fontSize: 24, color: theme.colors.text.primary },
    classRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.smd,
      paddingHorizontal: theme.spacing.sm,
      paddingVertical: 12,
      borderRadius: theme.borderRadius.md,
    },
    classSelected: { backgroundColor: theme.colors.surface.tertiary },
    dot: { width: 10, height: 10, borderRadius: 5 },
    className: { fontFamily: theme.fontFamily.medium, fontSize: 14, color: theme.colors.text.primary },
    small: { fontFamily: theme.fontFamily.regular, fontSize: 12, color: theme.colors.text.muted },
    figures: { alignItems: 'flex-end' as const },
    figure: { fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.primary },
    fact: { gap: 2, paddingVertical: 10 },
    award: { gap: theme.spacing.smd, paddingVertical: theme.spacing.smd },
    awardTitle: { fontFamily: theme.fontFamily.medium, fontSize: 14, color: theme.colors.text.primary },
    toggle: { paddingVertical: 6, fontFamily: theme.fontFamily.medium, fontSize: 14, color: theme.colors.brand.light },
  }));
}

export function DashboardScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Dashboard'> }) {
  const { read } = useMemberRecordsState();
  return (
    <Dashboard
      key={`${read.owner?.userUuid}/${read.owner?.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}`}
      read={read}
      route={route}
    />
  );
}

function Dashboard({ read, route }: { read: Read; route: RouteProp<SignedInStackParamList, 'Dashboard'> }) {
  const styles = useCompanyStyles();
  const look = useDashboardStyles();
  const theme = useAppTheme();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const { companies, company, selectCompany } = useMemberRecordsState();
  const refresh = useMemberRefresh(read, 'dashboard-refresh');
  const [picking, setPicking] = useState(false);
  const [chosenClass, setChosenClass] = useState<{ company: string; token: string } | null>(null);
  const opened = route.params?.record;
  const openedAward = route.params?.award;
  useEffect(() => {
    if (!opened) return;
    const target = companies.find((row) => row.uuid === opened);
    if (!target || !selectCompany(target.company.uuid)) return;
    const token = target.awards.find((award) => award.uuid === openedAward)?.token;
    if (token) setChosenClass({ company: target.company.uuid, token });
    navigation.setParams({ record: undefined, award: undefined });
  }, [opened, openedAward, companies, selectCompany, navigation]);
  const chosen = chosenClass && chosenClass.company === company?.company.uuid ? chosenClass.token : null;
  return (
    <Page
      testID="dashboard-scroll"
      title="Dashboard"
      titleAction={
        company && companies.length > 1 ? (
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Switch company"
            onPress={() => setPicking(true)}
            hitSlop={2}
            style={look.switcher}
          >
            <BuildingsIcon size={theme.icon.sizes.md} color={theme.colors.text.primary} />
          </TouchableOpacity>
        ) : undefined
      }
      lede="Explore your companies and their share ownership."
      refreshControl={refresh}
    >
      <MemberNotice read={read} />
      {!read.owner ? (
        <Text style={styles.muted}>Check your signed-in account before opening your holdings.</Text>
      ) : read.loading || (!read.listReady && !read.error) || (companies.length > 0 && !company) ? (
        <Text style={styles.muted}>Loading the register…</Text>
      ) : !company ? (
        !read.error && (
          <Section title="Your companies">
            <Text style={styles.muted}>
              No company relationships yet. Open an invitation email from your company to access your shares or employee
              awards.
            </Text>
            <Action label="Accept an invitation" primary onPress={() => navigation.navigate('Invitation')} />
          </Section>
        )
      ) : (
        <CompanyOwnership
          key={company.uuid}
          company={company}
          chosen={chosen}
          onChoose={(token) => setChosenClass(token ? { company: company.company.uuid, token } : null)}
        />
      )}
      <CompanyPicker
        visible={picking}
        companies={companies}
        current={company?.company.uuid}
        onChoose={(uuid) => {
          if (selectCompany(uuid)) setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </Page>
  );
}

function CompanyOwnership({
  company,
  chosen,
  onChoose,
}: {
  company: OwnMemberRecord;
  chosen: string | null;
  onChoose: (token: string | null) => void;
}) {
  const styles = useCompanyStyles();
  const look = useDashboardStyles();
  const { record, selected } = useCompanyRecord(company.uuid);
  const source = selected ?? record ?? company;
  const view = useMemo(() => ownershipView(undefined, source), [source]);
  const chosenClass = view?.classes.find((row) => row.uuid === chosen);
  return (
    <>
      {chosen && (
        <View accessibilityRole="toolbar" accessibilityLabel="Ownership trail" style={look.trail}>
          <Pressable accessibilityRole="button" onPress={() => onChoose(null)}>
            <Text style={look.trailLink}>Company ownership</Text>
          </Pressable>
          {chosenClass && (
            <>
              <Text style={look.trailLink}>/</Text>
              <Text style={look.trailHere}>{chosenClass.symbol}</Text>
            </>
          )}
        </View>
      )}
      {view ? (
        <>
          <Section title="Ownership overview">
            <Text style={styles.muted}>Member</Text>
            <Metrics view={view} />
            <OwnershipClasses view={view} chosen={chosen} onChoose={onChoose} />
          </Section>
          {chosen && <ClassDetails view={view} record={source} chosen={chosenClass} />}
        </>
      ) : (
        <Section title="Ownership overview">
          <Text accessibilityRole="alert" style={styles.muted}>
            The current ownership figures could not be confirmed.
          </Text>
        </Section>
      )}
      <MemberAwards record={source} token={chosen} />
    </>
  );
}

function Metrics({ view }: { view: Ownership }) {
  const look = useDashboardStyles();
  const styles = useCompanyStyles();
  const own = String(view.classes.reduce((sum, row) => sum + BigInt(row.ownShares ?? '0'), 0n));
  const figures: [string, string][] = view.summary
    ? [
        ['Your shares', formatShareCount(own)],
        [
          'Issued shares',
          view.summary.issuedSupply === null ? 'Not complete' : formatShareCount(view.summary.issuedSupply),
        ],
        [
          'Current shareholders',
          view.summary.totalHolders === null ? 'Not complete' : String(view.summary.totalHolders),
        ],
        ['Share classes', String(view.summary.classes.length)],
      ]
    : [
        ['Your issued shares', formatShareCount(view.total ?? '0')],
        [
          'Classes held',
          String(view.classes.filter(({ ownShares }) => ownShares !== null && BigInt(ownShares) > 0n).length),
        ],
      ];
  const unopened = view.summary ? view.summary.classes.filter(({ initialized }) => !initialized).length : 0;
  return (
    <View accessibilityLabel="Company ownership summary" style={look.metrics}>
      {figures.map(([label, value]) => (
        <View key={label} accessible accessibilityLabel={`${label}: ${value}`} style={look.metric}>
          <Text style={look.metricLabel}>{label}</Text>
          <Text style={look.metricValue}>{value}</Text>
        </View>
      ))}
      {unopened > 0 && (
        <Text style={styles.muted}>
          {unopened} {unopened === 1 ? 'class has' : 'classes have'} no opened register. Company totals are not
          complete.
        </Text>
      )}
    </View>
  );
}

function OwnershipClasses({
  view,
  chosen,
  onChoose,
}: {
  view: Ownership;
  chosen: string | null;
  onChoose: (token: string) => void;
}) {
  const styles = useCompanyStyles();
  const look = useDashboardStyles();
  const theme = useAppTheme();
  const { classes, total, complete, personalOnly } = view;
  const shown = complete && total !== null && total !== '0';
  return (
    <>
      <Text style={styles.muted}>
        {personalOnly ? 'Your issued shares by class' : 'Company ownership by issued share count'}
      </Text>
      {!complete && (
        <Text style={styles.muted}>
          {classes.length
            ? 'Company totals are incomplete until every class has an opened ledger.'
            : 'Set up the ledger to record company ownership.'}
        </Text>
      )}
      {total === '0' && <Text style={styles.muted}>No issued shares yet.</Text>}
      <Rows>
        {rankOwnershipClasses(classes).map((row: OwnershipClass) => (
          <Pressable
            key={row.uuid}
            accessibilityRole="button"
            accessibilityLabel={`Explore ${row.name} (${row.symbol})`}
            accessibilityState={{ selected: row.uuid === chosen }}
            onPress={() => onChoose(row.uuid)}
            style={[look.classRow, row.uuid === chosen && look.classSelected]}
          >
            <View style={[look.dot, { backgroundColor: theme.colors.chart[ownershipColorIndex(classes, row.uuid)] }]} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={look.className}>{row.name}</Text>
              <Text style={look.small}>{row.symbol}</Text>
            </View>
            <View style={look.figures}>
              <Text style={look.figure}>
                {row.issuedSupply === null ? 'Not recorded' : formatShareCount(row.issuedSupply)}
              </Text>
              {shown && row.issuedSupply !== null && (
                <Text style={look.small}>{sharePercentage(row.issuedSupply, total)}</Text>
              )}
              {!personalOnly && row.ownShares !== null && BigInt(row.ownShares) > 0n && (
                <Text style={look.small}>You: {formatShareCount(row.ownShares)}</Text>
              )}
            </View>
            <CaretRightIcon size={16} color={theme.colors.text.muted} />
          </Pressable>
        ))}
      </Rows>
      {classes.length === 0 && <Text style={styles.muted}>No share classes yet.</Text>}
      <Text style={look.small}>
        {personalOnly
          ? 'Company ownership is unavailable. These figures show your issued shares.'
          : 'Share counts show composition, not voting power or value.'}
      </Text>
    </>
  );
}

function Fact({ label, children }: { label: string; children: string }) {
  const look = useDashboardStyles();
  const styles = useCompanyStyles();
  return (
    <View accessible accessibilityLabel={`${label}: ${children}`} style={look.fact}>
      <Text style={styles.muted}>{label}</Text>
      <Text style={styles.text}>{children}</Text>
    </View>
  );
}

function ClassDetails({
  view,
  record,
  chosen,
}: {
  view: Ownership;
  record: OwnMemberRecord;
  chosen: OwnershipClass | undefined;
}) {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  if (!chosen)
    return (
      <Section title="Class unavailable">
        <Text style={styles.muted}>This share class is no longer available in the company overview.</Text>
      </Section>
    );
  return (
    <Section title={chosen.name}>
      <Rows>
        <Fact label="Share class">{chosen.symbol}</Fact>
        {!view.personalOnly && (
          <Fact label="Issued shares">
            {chosen.issuedSupply === null ? 'Not recorded' : formatShareCount(chosen.issuedSupply)}
          </Fact>
        )}
        <Fact label="Your shares">
          {chosen.ownShares === null ? 'Not recorded' : formatShareCount(chosen.ownShares)}
        </Fact>
        {!view.personalOnly &&
          chosen.issuedSupply !== null &&
          chosen.issuedSupply !== '0' &&
          chosen.ownShares !== null && (
            <Fact label="Your share of this class">{sharePercentage(chosen.ownShares, chosen.issuedSupply)}</Fact>
          )}
      </Rows>
      <Text style={styles.muted}>
        Only your own holdings and awards are shown. Other shareholders’ records are private.
      </Text>
      {record.classes.some(({ uuid }) => uuid === chosen.uuid) && (
        <Rows>
          <LinkRow
            label="Certificates and history"
            onPress={() => navigation.navigate('Class', { record: record.uuid, token: chosen.uuid })}
          />
        </Rows>
      )}
    </Section>
  );
}

function MemberAwards({ record, token }: { record: OwnMemberRecord; token: string | null }) {
  const look = useDashboardStyles();
  const styles = useCompanyStyles();
  const [open, setOpen] = useState<string[]>([]);
  const awards = record.awards.filter((award) => !token || award.token === token);
  if (!awards.length) return null;
  return (
    <Section title="Your employee awards">
      <Rows>
        {awards.map((award) => {
          const shown = open.includes(award.uuid);
          const vestingOf = (uuid: string) => {
            const vesting = award.vestings.find((item) => item.uuid === uuid);
            return vesting
              ? `from ${formatShareCount(vesting.shares)} vested ${formatDate(vesting.vestedOn)}`
              : 'from an earlier vesting';
          };
          return (
            <View key={award.uuid} style={look.award}>
              <Text style={look.awardTitle}>
                {record.classes.find(({ uuid }) => uuid === award.token)?.name ?? 'Employee award'} ·{' '}
                {formatDate(award.termsOn)}
              </Text>
              <AwardStatus award={award} />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: shown }}
                onPress={() =>
                  setOpen((items) => (shown ? items.filter((item) => item !== award.uuid) : [...items, award.uuid]))
                }
              >
                <Text style={look.toggle}>{shown ? 'Hide award details' : 'Show award details'}</Text>
              </Pressable>
              {shown && (
                <View style={{ gap: 6 }}>
                  <Text style={styles.muted}>{award.terms}</Text>
                  <Text style={styles.muted}>{award.schedule}</Text>
                  <Text style={styles.muted}>Dates do not vest an award automatically.</Text>
                  {award.vestings.map((vesting) => (
                    <Text key={vesting.uuid} style={styles.muted}>
                      {formatDate(vesting.vestedOn)} · {formatShareCount(vesting.shares)} recorded vested
                    </Text>
                  ))}
                  {award.ends.map((event) => (
                    <Text key={event.uuid} style={styles.muted}>
                      {formatDate(event.companyEventOn)} · {formatShareCount(event.unvestedShares)} unvested and{' '}
                      {formatShareCount(event.vestedShares)} vested unissued rights ended · {event.reason}
                    </Text>
                  ))}
                  {award.vestingReversals.map((event) => (
                    <Text key={event.uuid} style={styles.muted}>
                      {formatDate(event.companyEventOn)} · {formatShareCount(event.reversedShares)} vesting reversed ·{' '}
                      {vestingOf(event.vesting)} · {event.reason}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </Rows>
    </Section>
  );
}
