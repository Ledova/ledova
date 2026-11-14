import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useNavigation, type NavigationProp, type RouteProp } from '@react-navigation/native';
import { BuildingsIcon, CaretRightIcon } from 'phosphor-react-native';
import {
  DESTINATIONS,
  formatDate,
  formatShareCount,
  ownershipColorIndex,
  ownershipView,
  rankOwnershipClasses,
  REGISTER_IMPORT_COPY,
  sharePercentage,
  useCompanyOwnership,
  useSubmissionOwner,
  type ClassOwnershipHolders,
  type OrderSubmissionOwner,
  type OwnershipClass,
  type OwnershipCompany,
  type OwnMemberRecord,
  type useMemberRecords,
} from '@ledova/shared';
import { AwardStatus } from '../../components/AwardStatus';
import { FilterPopover } from '../../components/FilterPopover';
import { Action, Actions, Fact, LinkRow, LoadError, Rows, Section, Status } from '../../components/Ledger';
import { MemberNotice, useMemberRefresh } from '../../components/MemberRecords';
import { Page } from '../../components/Page';
import { Pager } from '../../components/Pager';
import { memberOf, useAppTheme, useMemberRecordsState, useThemedStyles } from '../../contexts';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';
import type { SignedInStackParamList } from '../../navigation/SignedInNavigator';
import { orderSubmissionSession } from '../../services/orderSubmissions';
import { CompanyPicker } from './CompanyPicker';

type Read = ReturnType<typeof useMemberRecords>;
type Ownership = NonNullable<ReturnType<typeof ownershipView>>;
type CompanyRead = ReturnType<typeof useCompanyOwnership>;
type Place = { company: string; token: string; page: number };

const LEDE = 'Explore your companies and their share ownership.';

function useDashboardStyles() {
  return useThemedStyles((theme) => ({
    cards: { gap: 20 },
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
    wide: { width: '100%' as const },
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
    classLine: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: theme.spacing.smd },
    grow: { flex: 1, minWidth: 0 },
    figure: { fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.primary },
    holdersArea: { minHeight: 192 },
    loading: {
      paddingVertical: 12,
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      lineHeight: 20,
      color: theme.colors.text.muted,
    },
    holder: {
      gap: theme.spacing.sm,
      minHeight: 44,
      paddingHorizontal: 12,
      paddingVertical: theme.spacing.sm,
      borderRadius: theme.borderRadius.md,
    },
    holderName: { fontFamily: theme.fontFamily.medium, fontSize: 14, lineHeight: 20, color: theme.colors.text.primary },
    holderFigures: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: 12 },
    holderFigure: {
      flexShrink: 1,
      fontFamily: theme.fontFamily.regular,
      fontSize: 14,
      lineHeight: 20,
      color: theme.colors.text.primary,
    },
    bar: { height: 12, borderRadius: theme.borderRadius.sm, overflow: 'hidden' as const },
    fill: { height: '100%' as const },
    award: { gap: theme.spacing.smd, paddingVertical: theme.spacing.smd },
    awardTitle: { fontFamily: theme.fontFamily.medium, fontSize: 14, color: theme.colors.text.primary },
    toggle: { paddingVertical: 6, fontFamily: theme.fontFamily.medium, fontSize: 14, color: theme.colors.brand.light },
  }));
}

export function DashboardScreen({ route }: { route: RouteProp<SignedInStackParamList, 'Dashboard'> }) {
  const styles = useCompanyStyles();
  const { read } = useMemberRecordsState();
  const { owner, boundary } = useSubmissionOwner(orderSubmissionSession);
  return owner ? (
    <Dashboard
      key={`${owner.userUuid}/${owner.ownerAccountUuid}/${orderSubmissionSession.getEpoch()}`}
      owner={owner}
      currentOwner={boundary.get}
      read={read}
      route={route}
    />
  ) : (
    <Page testID="dashboard-scroll" title="Dashboard" lede={LEDE}>
      <MemberNotice read={read} />
      <Text style={styles.muted}>Check your signed-in account before opening your holdings.</Text>
    </Page>
  );
}

function Dashboard({
  owner,
  currentOwner,
  read,
  route,
}: {
  owner: OrderSubmissionOwner;
  currentOwner: () => OrderSubmissionOwner | null;
  read: Read;
  route: RouteProp<SignedInStackParamList, 'Dashboard'>;
}) {
  const styles = useCompanyStyles();
  const theme = useAppTheme();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const { directory, companies, company, member, selectCompany } = useMemberRecordsState();
  const [place, setPlace] = useState<Place | null>(null);
  const opened = route.params?.record;
  const openedAward = route.params?.award;
  useEffect(() => {
    if (!opened) return;
    const target = read.records.find((row) => row.uuid === opened);
    if (!target || !selectCompany(target.company.uuid)) return;
    const token = target.awards.find((award) => award.uuid === openedAward)?.token;
    const next =
      token && ownershipView(undefined, target)?.classes.some((row) => row.uuid === token)
        ? { company: target.company.uuid, token, page: 1 }
        : null;
    setPlace((current) => (current?.company === next?.company && current?.token === next?.token ? current : next));
    navigation.setParams({ record: undefined, award: undefined });
  }, [opened, openedAward, read.records, selectCompany, navigation]);
  const chosen = place && place.company === company?.uuid ? place : null;
  const current =
    directory.owner?.userUuid === owner.userUuid &&
    directory.owner?.ownerAccountUuid === owner.ownerAccountUuid &&
    !directory.hasError &&
    !directory.isLoading;
  const guard = useMemo(
    () => () => {
      if (currentOwner() !== owner) throw new Error('Your signed-in account changed. Reopen your dashboard.');
    },
    [owner, currentOwner],
  );
  const ownership = useCompanyOwnership(
    owner,
    guard,
    company?.uuid ?? '',
    current && !!company?.canReadRegister,
    {
      token: chosen?.token ?? '',
      page: chosen?.page ?? 1,
      toFirstPage: () => setPlace((value) => value && { ...value, page: 1 }),
    },
    orderSubmissionSession,
  );
  const officer = !!company && (company.canReadRegister || company.memberUuids.length === 0);
  const retry = () => Promise.all([directory.retry(), ...(company?.canReadRegister ? [ownership.recover()] : [])]);
  const refresh = useMemberRefresh(read, 'dashboard-refresh', async () => {
    await read.refresh();
    if (officer) await retry();
  });
  const choose = (token: string | null) =>
    setPlace(token && company ? { company: company.uuid, token, page: 1 } : null);
  return (
    <Page
      testID="dashboard-scroll"
      title="Dashboard"
      titleAction={
        current && company && companies.length > 1 ? (
          <FilterPopover
            label="Switch company"
            closeLabel="Close the company switcher"
            icon={<BuildingsIcon size={theme.icon.sizes.md} color={theme.colors.text.primary} />}
          >
            {(close) => (
              <CompanyPicker
                companies={companies}
                current={company.uuid}
                onChoose={(uuid) => {
                  if (uuid !== company.uuid) {
                    if (!selectCompany(uuid)) return;
                    setPlace(null);
                  }
                  close();
                }}
              />
            )}
          </FilterPopover>
        ) : undefined
      }
      lede={LEDE}
      refreshControl={refresh}
    >
      <MemberNotice read={read} />
      {directory.hasError ? (
        <LoadError retry={directory.retry} busy={directory.isRefreshing}>
          Your ownership records could not be loaded.
        </LoadError>
      ) : !current ? (
        <Text style={styles.muted}>Loading the register…</Text>
      ) : companies.length === 0 ? (
        !read.error && (
          <Section title="Your companies">
            <Text style={styles.muted}>
              No company relationships yet. Open an invitation email from your company to access your shares or employee
              awards.
            </Text>
            <Actions>
              <Action label="Accept invitation" primary onPress={() => navigation.navigate('Invitation')} />
            </Actions>
          </Section>
        )
      ) : !company ? (
        <Text style={styles.muted}>Loading the register…</Text>
      ) : officer ? (
        <CompanyRegister
          key={company.uuid}
          company={company}
          record={memberOf(company, directory.members)}
          ownership={ownership}
          chosen={chosen}
          onChoose={choose}
          onPage={(page) => setPlace((value) => value && { ...value, page })}
          retry={retry}
          busy={directory.isRefreshing}
        />
      ) : !read.owner ? (
        <Text style={styles.muted}>Check your signed-in account before opening your holdings.</Text>
      ) : read.loading || (!read.listReady && !read.error) ? (
        <Text style={styles.muted}>Loading the register…</Text>
      ) : read.readFailed ? (
        <Actions>
          <Action label="Try again" disabled={read.busy} onPress={() => void read.refresh()} />
        </Actions>
      ) : member ? (
        <CompanyOwnership key={member.uuid} company={member} chosen={chosen?.token ?? null} onChoose={choose} />
      ) : (
        <Text style={styles.muted}>Loading the register…</Text>
      )}
    </Page>
  );
}

function Trail({ symbol, onBack }: { symbol: string | undefined; onBack: () => void }) {
  const look = useDashboardStyles();
  return (
    <View accessibilityRole="toolbar" accessibilityLabel="Ownership trail" style={look.trail}>
      <Pressable accessibilityRole="button" onPress={onBack}>
        <Text style={look.trailLink}>Company ownership</Text>
      </Pressable>
      {!!symbol && (
        <>
          <Text accessibilityElementsHidden importantForAccessibility="no" style={look.trailLink}>
            /
          </Text>
          <Text style={look.trailHere}>{symbol}</Text>
        </>
      )}
    </View>
  );
}

function CompanyRegister({
  company,
  record,
  ownership,
  chosen,
  onChoose,
  onPage,
  retry,
  busy,
}: {
  company: OwnershipCompany;
  record: OwnMemberRecord | undefined;
  ownership: CompanyRead;
  chosen: Place | null;
  onChoose: (token: string | null) => void;
  onPage: (page: number) => void;
  retry: () => unknown;
  busy: boolean;
}) {
  const styles = useCompanyStyles();
  const look = useDashboardStyles();
  const theme = useAppTheme();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const registerReady =
    !company.canReadRegister ||
    (ownership.classes.isSuccess &&
      !ownership.classes.isFetching &&
      ownership.overview.isSuccess &&
      !ownership.overview.isFetching);
  const summary = registerReady && company.canReadRegister ? ownership.overview.data : undefined;
  const view = useMemo(() => ownershipView(summary, record), [summary, record]);
  const registered = !!summary?.classes.some(({ initialized }) => initialized);
  const failed =
    company.canReadRegister && (ownership.classes.isError || ownership.overview.isError || ownership.scopeError);
  const selected = view?.classes.find(({ uuid }) => uuid === chosen?.token);
  const { holders } = ownership;
  return (
    <>
      {chosen && <Trail symbol={selected?.symbol} onBack={() => onChoose(null)} />}
      <View style={look.cards}>
        {failed ? (
          <LoadError retry={retry} busy={busy}>
            Your ownership records could not be loaded.
          </LoadError>
        ) : !registerReady ? (
          <Section title="Ownership overview">
            <Text style={styles.muted}>Loading the register…</Text>
          </Section>
        ) : (
          <>
            {company.canManage && !registered && <GettingStarted />}
            {view ? (
              <>
                <Section title="Ownership overview">
                  <Text style={styles.muted}>
                    {[
                      company.canManage ? 'Company administrator' : company.canReadRegister ? 'Company access' : null,
                      record ? 'Member' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                  <Metrics view={view} own={record ? ownTotal(view) : undefined} />
                  <OwnershipClasses view={view} chosen={chosen?.token ?? null} onChoose={onChoose} />
                </Section>
                {chosen && (
                  <ClassDetails view={view} record={record} chosen={selected}>
                    {selected &&
                      (!selected.initialized ? (
                        <Text style={styles.muted}>
                          Current ownership is not available for this class. Its ledger must be opened and its figures
                          confirmed.
                        </Text>
                      ) : (
                        <>
                          <View
                            style={look.holdersArea}
                            accessibilityState={{ busy: holders.isPending || holders.isFetching }}
                          >
                            {holders.isPending || holders.isFetching ? (
                              <Text style={look.loading}>Loading shareholders…</Text>
                            ) : holders.isError ? (
                              <LoadError retry={() => holders.refetch()}>
                                The class’s shareholders could not be confirmed.
                              </LoadError>
                            ) : holders.data.count === 0 ? (
                              <Text style={styles.muted}>No current shareholders yet.</Text>
                            ) : (
                              <OwnershipHolders
                                holders={holders.data}
                                name={selected.name}
                                symbol={selected.symbol}
                                color={theme.colors.chart[ownershipColorIndex(view.classes, selected.uuid)]}
                              />
                            )}
                          </View>
                          {holders.isSuccess && !holders.isFetching && (
                            <Pager
                              label="Class shareholders"
                              page={chosen.page}
                              count={holders.data.count}
                              noun={['shareholder', 'shareholders']}
                              onPage={onPage}
                            />
                          )}
                        </>
                      ))}
                    {selected && company.canReadRegister && (
                      <Rows>
                        <LinkRow
                          label="Class details"
                          accessibilityLabel={`Class details (${selected.name})`}
                          onPress={() =>
                            navigation.navigate('ShareClass', { company: company.uuid, token: selected.uuid })
                          }
                        />
                      </Rows>
                    )}
                  </ClassDetails>
                )}
              </>
            ) : (
              <Section title="Ownership overview">
                <Text accessibilityRole="alert" style={styles.muted}>
                  The current ownership figures could not be confirmed.
                </Text>
              </Section>
            )}
            {record && <MemberAwards record={record} token={chosen?.token ?? null} />}
          </>
        )}
      </View>
    </>
  );
}

function GettingStarted() {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  const label = DESTINATIONS.companyRegisterSetup.title;
  return (
    <Section title="Getting started">
      <LinkRow
        label={label}
        accessibilityLabel={`${label}, to do. ${REGISTER_IMPORT_COPY.SETUP_NOTE}`}
        figure={<Status tone="waiting">To do</Status>}
        onPress={() => navigation.navigate('Ledger')}
      >
        <Text style={styles.muted}>{REGISTER_IMPORT_COPY.SETUP_NOTE}</Text>
      </LinkRow>
    </Section>
  );
}

function OwnershipHolders({
  holders,
  name,
  symbol,
  color,
}: {
  holders: ClassOwnershipHolders;
  name: string;
  symbol: string;
  color: string;
}) {
  const look = useDashboardStyles();
  const [selected, setSelected] = useState<string | null>(null);
  return (
    <View accessibilityLabel={`${name} shareholders`}>
      <Rows>
        {holders.results.map((holder) => {
          const holderName = holder.name || 'Unnamed shareholder';
          const shares = formatShareCount(holder.balance);
          const percentage = sharePercentage(holder.balance, holders.issuedSupply);
          const active = selected === holder.member;
          const width =
            holders.issuedSupply === '0' ? 0 : (Number(holder.balance) / Number(holders.issuedSupply)) * 100;
          return (
            <Pressable
              key={holder.member}
              accessibilityRole="button"
              accessibilityLabel={`Highlight ${holderName}’s holding, ${shares} shares, ${percentage} of ${symbol}`}
              accessibilityState={{ selected: active }}
              onPress={() => setSelected(active ? null : holder.member)}
              style={[look.holder, active && look.classSelected]}
            >
              <Text style={look.holderName}>{holderName}</Text>
              <View style={look.holderFigures}>
                <Text style={look.holderFigure}>{shares} shares</Text>
                <Text style={look.holderFigure}>{percentage}</Text>
              </View>
              <View style={look.bar}>
                <View style={[look.fill, { width: `${width}%`, backgroundColor: color, opacity: active ? 1 : 0.8 }]} />
              </View>
            </Pressable>
          );
        })}
      </Rows>
    </View>
  );
}

function ownTotal(view: Ownership) {
  return String(view.classes.reduce((sum, row) => sum + BigInt(row.ownShares ?? '0'), 0n));
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
  const view = useMemo(() => ownershipView(undefined, company), [company]);
  const chosenClass = view?.classes.find((row) => row.uuid === chosen);
  return (
    <>
      {chosen && <Trail symbol={chosenClass?.symbol} onBack={() => onChoose(null)} />}
      {view ? (
        <>
          <Section title="Ownership overview">
            <Text style={styles.muted}>Member</Text>
            <Metrics view={view} own={ownTotal(view)} />
            <OwnershipClasses view={view} chosen={chosen} onChoose={onChoose} />
          </Section>
          {chosen && (
            <ClassDetails view={view} record={company} chosen={chosenClass}>
              {chosenClass && <OwnRecords record={company} chosen={chosenClass} />}
            </ClassDetails>
          )}
        </>
      ) : (
        <Section title="Ownership overview">
          <Text accessibilityRole="alert" style={styles.muted}>
            The current ownership figures could not be confirmed.
          </Text>
        </Section>
      )}
      <MemberAwards record={company} token={chosen} />
    </>
  );
}

function Metrics({ view, own }: { view: Ownership; own: string | undefined }) {
  const look = useDashboardStyles();
  const styles = useCompanyStyles();
  const figures: [string, string][] = view.summary
    ? [
        ...(own === undefined ? [] : [['Your shares', formatShareCount(own)] as [string, string]]),
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
      {figures.map(([label, value], index) => (
        <View
          key={label}
          accessible
          accessibilityLabel={`${label}: ${value}`}
          style={[look.metric, index === 0 && figures.length === 3 && look.wide]}
        >
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
            accessibilityLabel={[
              `Explore ${row.name} (${row.symbol})`,
              row.issuedSupply === null
                ? 'Not recorded'
                : `${formatShareCount(row.issuedSupply)} ${personalOnly ? 'held by you' : 'issued shares'}`,
              shown && row.issuedSupply !== null
                ? `${sharePercentage(row.issuedSupply, total)} ${personalOnly ? 'of your shares in this company' : 'of company issued shares'}`
                : null,
              !personalOnly && row.ownShares !== null && BigInt(row.ownShares) > 0n
                ? `You: ${formatShareCount(row.ownShares)}`
                : null,
            ]
              .filter(Boolean)
              .join(', ')}
            accessibilityState={{ selected: row.uuid === chosen }}
            onPress={() => onChoose(row.uuid)}
            style={[look.classRow, row.uuid === chosen && look.classSelected]}
          >
            <View style={[look.dot, { backgroundColor: theme.colors.chart[ownershipColorIndex(classes, row.uuid)] }]} />
            <View style={look.grow}>
              <View style={look.classLine}>
                <Text style={[look.className, look.grow]}>{row.name}</Text>
                <Text style={look.figure}>
                  {row.issuedSupply === null ? 'Not recorded' : formatShareCount(row.issuedSupply)}
                </Text>
              </View>
              <Text style={look.small}>
                {[
                  row.symbol,
                  shown && row.issuedSupply !== null ? sharePercentage(row.issuedSupply, total) : null,
                  !personalOnly && row.ownShares !== null && BigInt(row.ownShares) > 0n
                    ? `You: ${formatShareCount(row.ownShares)}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
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

function ClassDetails({
  view,
  record,
  chosen,
  children,
}: {
  view: Ownership;
  record: OwnMemberRecord | undefined;
  chosen: OwnershipClass | undefined;
  children: ReactNode;
}) {
  const styles = useCompanyStyles();
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
        {record && (
          <Fact label="Your shares">
            {chosen.ownShares === null ? 'Not recorded' : formatShareCount(chosen.ownShares)}
          </Fact>
        )}
        {record &&
          !view.personalOnly &&
          chosen.issuedSupply !== null &&
          chosen.issuedSupply !== '0' &&
          chosen.ownShares !== null && (
            <Fact label="Your share of this class">{sharePercentage(chosen.ownShares, chosen.issuedSupply)}</Fact>
          )}
      </Rows>
      {children}
    </Section>
  );
}

function OwnRecords({ record, chosen }: { record: OwnMemberRecord; chosen: OwnershipClass }) {
  const styles = useCompanyStyles();
  const navigation = useNavigation<NavigationProp<SignedInStackParamList>>();
  return (
    <>
      <Text style={styles.muted}>
        Only your own holdings and awards are shown. Other shareholders’ records are private.
      </Text>
      {record.classes.some(({ uuid }) => uuid === chosen.uuid) && (
        <Rows>
          <LinkRow
            label="Certificates"
            onPress={() => navigation.navigate('Certificates', { record: record.uuid, token: chosen.uuid })}
          />
        </Rows>
      )}
    </>
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
              <Text accessibilityRole="header" style={look.awardTitle}>
                {record.classes.find(({ uuid }) => uuid === award.token)?.name ?? 'Employee award'} ·{' '}
                {formatDate(award.termsOn)}
              </Text>
              <AwardStatus award={award} holdingNote />
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
