import { Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { formatDate, formatMoney, useDirectoryTokens, type DirectoryToken } from '@ledova/shared';
import type { DirectoryStackParamList } from '../../navigation/DirectoryStackNavigator';
import { Action, LinkRow, Rows, Section } from '../../components/Ledger';
import { DirectoryPage, useDirectoryStyles } from './DirectoryPage';
import { EligibilityLinks } from '../eligibility-records/EligibilityLinks';

export function DirectoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<DirectoryStackParamList>>();
  const styles = useDirectoryStyles();
  const { tokens, isReady, isLoading, hasError, isRefreshing, retry } = useDirectoryTokens();
  const issuers = new Map<string, DirectoryToken[]>();
  for (const token of tokens) issuers.set(token.companyUuid, [...(issuers.get(token.companyUuid) ?? []), token]);
  return (
    <DirectoryPage loading={isLoading} refreshing={isRefreshing} refresh={() => void retry()}>
      {hasError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.message}>
            The directory could not be loaded. Try again before continuing.
          </Text>
          <Action label="Try again" onPress={() => void retry()} disabled={isRefreshing} />
        </View>
      ) : !isReady ? (
        <Section title="Check your investor account">
          <Text style={styles.help}>
            Account and identity checks are prerequisites. Each company separately decides eligibility for its
            offerings.
          </Text>
          <LinkRow label="Verification" onPress={() => navigation.getParent()?.navigate('InvestorEligibility')} />
        </Section>
      ) : (
        <>
          {tokens.length === 0 ? (
            <Section title="Share classes">
              <Text style={styles.help}>No share classes available under your current company decisions.</Text>
              <Text style={styles.help}>Use the company or offering UUID supplied to you to request eligibility.</Text>
              <EligibilityLinks participant />
            </Section>
          ) : (
            [...issuers.entries()].map(([uuid, classes]) => {
              const company = classes[0].company;
              return (
                <Section key={uuid} title={company.displayName}>
                  {[company.industry, company.city, company.state].some(Boolean) && (
                    <Text style={styles.help}>
                      {[company.industry, company.city, company.state].filter(Boolean).join(' · ')}
                    </Text>
                  )}
                  <Rows>
                    {classes.map((token) => (
                      <LinkRow
                        key={token.uuid}
                        label={token.name}
                        accessibilityLabel={`Open ${token.name}`}
                        onPress={() => navigation.navigate('DirectoryClass', { uuid: token.uuid })}
                      >
                        <Text style={styles.help}>{token.symbol}</Text>
                        <Text style={styles.message}>{token.openOffering ? 'Offering open' : 'No offering open'}</Text>
                        {token.openOffering && (
                          <>
                            <Text style={styles.message}>
                              {formatMoney(token.openOffering.pricePerShare, token.openOffering.priceCurrency)} per
                              share
                            </Text>
                            <Text style={styles.help}>
                              {token.openOffering.closesAt
                                ? `Closes ${formatDate(token.openOffering.closesAt)}`
                                : 'No closing date'}
                            </Text>
                          </>
                        )}
                      </LinkRow>
                    ))}
                  </Rows>
                </Section>
              );
            })
          )}
        </>
      )}
    </DirectoryPage>
  );
}
