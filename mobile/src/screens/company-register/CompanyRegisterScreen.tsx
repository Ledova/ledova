import { useState } from 'react';
import { Text, View, RefreshControl, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Action, LinkRow, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { useCompanyRegister } from './useCompanyRegister';
import { useCompanyStyles } from './styles';
import { ClassRegister } from './ClassRegister';

export function CompanyRegisterScreen() {
  const { access, query } = useCompanyRegister();
  const styles = useCompanyStyles();
  const navigation = useNavigation<NativeStackNavigationProp<CompanyStackParamList>>();
  const [expanded, setExpanded] = useState<string[]>([]);
  return (
    <Page
      testID="register-screen"
      title="Register"
      lede="The stored register records your company’s members and their shares; wallet balances do not replace it."
      refreshControl={
        <RefreshControl
          refreshing={query.isFetching}
          onRefresh={() => {
            if (access.allowed) void query.refetch();
          }}
        />
      }
    >
      {access.isLoading ? (
        <Text style={styles.muted}>Loading your company access…</Text>
      ) : access.isError ? (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            Company access could not be verified.
          </Text>
          <Action label="Retry company access" onPress={() => void access.refetch()} />
        </View>
      ) : !access.allowed ? (
        <Text style={styles.muted}>The Register is available to company accounts.</Text>
      ) : (
        <>
          <Section title="Share classes">
            {query.isPending ? (
              <Text style={styles.muted}>Loading your register…</Text>
            ) : query.isError ? (
              <View style={styles.group}>
                <Text accessibilityRole="alert" style={styles.error}>
                  We couldn’t load the complete register.
                </Text>
                <Action label="Retry register" disabled={query.isFetching} onPress={() => void query.refetch()} />
              </View>
            ) : query.data.length === 0 ? (
              <Text style={styles.muted}>Your company has no share classes yet.</Text>
            ) : (
              query.data.map(({ companyName, register }, index) => {
                const uuid = register.token.uuid;
                const open = expanded.includes(uuid);
                return (
                  <View key={uuid} style={[styles.entry, index === query.data.length - 1 && styles.lastEntry]}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ expanded: open }}
                      accessibilityLabel={`${register.token.name} register`}
                      onPress={() =>
                        setExpanded((values) => (open ? values.filter((value) => value !== uuid) : [...values, uuid]))
                      }
                    >
                      <Text style={styles.heading}>{register.token.name}</Text>
                      <Text style={styles.muted}>
                        {companyName} · {register.token.symbol}
                      </Text>
                      <Text style={styles.muted}>{open ? 'Hide members' : 'Show members'}</Text>
                    </Pressable>
                    <Rows>
                      <LinkRow
                        label="Share class"
                        accessibilityLabel={`Open ${register.token.name}`}
                        onPress={() => navigation.navigate('TokenDetail', { uuid, name: register.token.name })}
                      />
                      {open && <ClassRegister register={register} />}
                    </Rows>
                  </View>
                );
              })
            )}
          </Section>
          <Section title="Register instructions">
            <Text style={styles.muted}>
              The company owner submits written register instructions. Staff verify and apply them. Certificates,
              inspection copies, publications and the company pack are prepared by staff on written instruction.
            </Text>
          </Section>
        </>
      )}
    </Page>
  );
}
