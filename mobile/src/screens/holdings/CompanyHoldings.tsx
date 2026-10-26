import { Pressable, Text, TextInput, View } from 'react-native';
import { CaretRightIcon, MagnifyingGlassIcon } from 'phosphor-react-native';
import { formatShareCount } from '@ledova/shared';
import { Row, Rows, useCardStyles } from '../../components/Ledger';
import { useAppTheme, useThemedStyles } from '../../contexts';
import { awardParts, initials, type CompanyHolding, type MemberAward } from './holdings';

function useHoldingStyles() {
  return useThemedStyles((theme) => ({
    header: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: theme.spacing.smd },
    avatar: {
      width: 32,
      height: 32,
      borderRadius: theme.borderRadius.md,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      backgroundColor: theme.colors.brand.tint,
    },
    initials: { fontFamily: theme.fontFamily.medium, fontSize: 12, color: theme.colors.brand.light },
    name: { flex: 1, fontFamily: theme.fontFamily.medium, fontSize: 16, color: theme.colors.text.primary },
    subtitle: { fontFamily: theme.fontFamily.regular, fontSize: 13, color: theme.colors.text.muted },
    award: { gap: theme.spacing.sm, paddingVertical: 10 },
    line: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, gap: theme.spacing.sm },
    label: { fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.muted },
    value: { fontFamily: theme.fontFamily.regular, fontSize: 14, color: theme.colors.text.primary },
    bar: {
      flexDirection: 'row' as const,
      height: 6,
      borderRadius: 3,
      overflow: 'hidden' as const,
      backgroundColor: theme.colors.surface.tertiary,
    },
    issued: { backgroundColor: theme.colors.brand.mid },
    available: { backgroundColor: theme.colors.brand.mid, opacity: 0.45 },
    unvested: { backgroundColor: theme.colors.text.muted, opacity: 0.35 },
    ended: { backgroundColor: theme.colors.text.muted, opacity: 0.7 },
    search: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.sm,
      paddingHorizontal: theme.spacing.smd,
      borderWidth: 1,
      borderColor: theme.colors.border.default,
      borderRadius: theme.borderRadius.md,
      backgroundColor: theme.colors.surface.raised,
    },
    input: {
      flex: 1,
      paddingVertical: theme.spacing.smd,
      fontFamily: theme.fontFamily.regular,
      fontSize: 16,
      color: theme.colors.text.primary,
    },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      gap: theme.spacing.smd,
      paddingVertical: theme.spacing.smd,
    },
    text: { flex: 1, gap: 2 },
  }));
}

function Avatar({ name }: { name: string }) {
  const styles = useHoldingStyles();
  return (
    <View style={styles.avatar} accessible={false}>
      <Text style={styles.initials}>{initials(name)}</Text>
    </View>
  );
}

function AwardLine({ award }: { award: MemberAward }) {
  const styles = useHoldingStyles();
  const parts = awardParts(award);
  return (
    <View style={styles.award}>
      <View style={styles.line}>
        <Text style={styles.label}>Award</Text>
        <Text style={styles.value}>
          {parts
            ? `${formatShareCount(award.vestedShares)} of ${formatShareCount(award.shares)} vested`
            : 'Quantities unavailable'}
        </Text>
      </View>
      {parts && (
        <View style={styles.bar} accessible={false}>
          {parts.map(({ part, width }) => (
            <View
              key={part}
              style={[styles[part as 'issued' | 'available' | 'unvested' | 'ended'], { width: `${width}%` }]}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function contents(holding: CompanyHolding) {
  return [...holding.classes.map((item) => item.name), ...(holding.awards.length > 0 ? ['Award'] : [])].join(' · ');
}

export function CompanyCard({ holding, onOpen }: { holding: CompanyHolding; onOpen: (record: string) => void }) {
  const card = useCardStyles();
  const styles = useHoldingStyles();
  const theme = useAppTheme();
  const { record } = holding;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${record.company.name}: ${contents(holding)}`}
      onPress={() => onOpen(record.uuid)}
      style={card.card}
    >
      <View style={styles.header}>
        <Avatar name={record.company.name} />
        <Text style={styles.name}>{record.company.name}</Text>
        <CaretRightIcon size={16} color={theme.colors.text.muted} />
      </View>
      <Rows>
        {holding.classes.map((item) => (
          <Row key={item.uuid} label={item.name}>
            {formatShareCount(item.shares)}
          </Row>
        ))}
        {holding.awards.map((award) => (
          <AwardLine key={award.uuid} award={award} />
        ))}
      </Rows>
    </Pressable>
  );
}

export function CompanyList({
  holdings,
  query,
  onQuery,
  onOpen,
}: {
  holdings: CompanyHolding[];
  query: string;
  onQuery: (query: string) => void;
  onOpen: (record: string) => void;
}) {
  const card = useCardStyles();
  const styles = useHoldingStyles();
  const theme = useAppTheme();
  const search = query.trim().toLowerCase();
  const shown = holdings.filter((holding) => holding.record.company.name.toLowerCase().includes(search));
  return (
    <>
      <View style={styles.search}>
        <MagnifyingGlassIcon size={16} color={theme.colors.text.muted} />
        <TextInput
          accessibilityLabel="Search companies"
          placeholder="Search companies"
          placeholderTextColor={theme.colors.text.muted}
          value={query}
          onChangeText={onQuery}
          autoCorrect={false}
          style={styles.input}
        />
      </View>
      <View style={card.card}>
        {shown.length === 0 ? (
          <Text style={styles.subtitle}>No company matches your search.</Text>
        ) : (
          <Rows>
            {shown.map((holding) => (
              <Pressable
                key={holding.record.uuid}
                accessibilityRole="button"
                accessibilityLabel={`${holding.record.company.name}: ${contents(holding)}`}
                onPress={() => onOpen(holding.record.uuid)}
                style={styles.row}
              >
                <Avatar name={holding.record.company.name} />
                <View style={styles.text}>
                  <Text style={styles.value}>{holding.record.company.name}</Text>
                  <Text style={styles.subtitle}>{contents(holding)}</Text>
                </View>
                <CaretRightIcon size={16} color={theme.colors.text.muted} />
              </Pressable>
            ))}
          </Rows>
        )}
      </View>
    </>
  );
}
