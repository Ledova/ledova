import { Pressable, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { formatDate, formatMoney, type DirectoryToken } from '@ledova/shared';
import type { DirectoryStackParamList } from '../../navigation/DirectoryStackNavigator';
import { Action, Section } from '../../components/Ledger';
import { DirectoryPage, useDirectoryStyles } from './DirectoryPage';
import { useDirectoryTokens } from './useDirectory';

export function DirectoryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<DirectoryStackParamList>>();
  const styles = useDirectoryStyles();
  const { tokens, isEligible, isLoading, hasError, isRefreshing, retry } = useDirectoryTokens();
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
      ) : !isEligible ? (
        <Section title="Verify your investor status">
          <Text style={styles.help}>
            The directory shows share classes available to eligible investors. Submit your evidence for the operator to
            review.
          </Text>
          <Action label="Open Verification" onPress={() => navigation.getParent()?.navigate('InvestorEligibility')} />
        </Section>
      ) : (
        <>
          <Text style={styles.help}>Share classes and current offerings available to you.</Text>
          {tokens.length === 0 ? (
            <Section title="Share classes">
              <Text style={styles.help}>No share classes available.</Text>
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
                  {classes.map((token) => (
                    <Pressable
                      key={token.uuid}
                      accessibilityRole="button"
                      accessibilityLabel={`Open ${token.name}`}
                      onPress={() => navigation.navigate('DirectoryClass', { uuid: token.uuid })}
                      style={styles.item}
                    >
                      <Text style={styles.label}>{token.name}</Text>
                      <Text style={styles.help}>{token.symbol}</Text>
                      <Text style={styles.message}>{token.openOffering ? 'Offering open' : 'No offering open'}</Text>
                      {token.openOffering && (
                        <>
                          <Text style={styles.message}>
                            {formatMoney(token.openOffering.pricePerShare, token.openOffering.priceCurrency)} per share
                          </Text>
                          <Text style={styles.help}>
                            {token.openOffering.closesAt
                              ? `Closes ${formatDate(token.openOffering.closesAt)}`
                              : 'No closing date'}
                          </Text>
                        </>
                      )}
                    </Pressable>
                  ))}
                </Section>
              );
            })
          )}
        </>
      )}
    </DirectoryPage>
  );
}
