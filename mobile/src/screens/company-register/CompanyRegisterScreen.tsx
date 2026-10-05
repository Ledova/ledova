import { useState, useSyncExternalStore } from 'react';
import { Text, View, RefreshControl, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { REGISTER_COPY } from '@ledova/shared';
import { Action, LinkRow, Rows, Section } from '../../components/Ledger';
import { Page } from '../../components/Page';
import type { CompanyStackParamList } from '../../navigation/CompanyStackNavigator';
import { getSessionEpoch, subscribeSession } from '../../services/sessionScope';
import { CompanySelection } from '../company/CompanySelection';
import { useCompanyAccess, useCompanyRegister } from './useCompanyRegister';
import { useCompanyStyles } from './styles';
import { ClassImports } from './ClassImports';
import { ClassRegister } from './ClassRegister';
import { RegisterDownload } from './RegisterDownload';

export function CompanyRegisterScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  return <CompanyRegister key={epoch} epoch={epoch} />;
}

function CompanyRegister({ epoch }: { epoch: number }) {
  const { classes, companies, company, selectCompany, registers, isFetching, refresh } = useCompanyRegister(epoch);
  const classPageOpens = useCompanyAccess().allowed;
  const styles = useCompanyStyles();
  const navigation = useNavigation<NativeStackNavigationProp<CompanyStackParamList>>();
  const [expanded, setExpanded] = useState<string[]>([]);
  return (
    <Page
      testID="register-screen"
      title="Register"
      lede="The stored register records your company’s members and their shares; wallet balances do not replace it."
      refreshControl={<RefreshControl refreshing={isFetching} onRefresh={() => void refresh()} />}
    >
      <CompanySelection
        read={{ companies, companyUuid: company?.uuid, selectionBlocked: classes.isFetching, selectCompany }}
      />
      <Section title="Share classes">
        {classes.isPending ? (
          <Text style={styles.muted}>Loading your register…</Text>
        ) : classes.isError || registers.isError ? (
          <View style={styles.group}>
            <Text accessibilityRole="alert" style={styles.error}>
              We couldn’t load the complete register.
            </Text>
            <Action label="Retry register" disabled={isFetching} onPress={() => void refresh()} />
          </View>
        ) : companies.length === 0 ? (
          <Text style={styles.muted}>{REGISTER_COPY.NO_REGISTER}</Text>
        ) : !company ? (
          <Text style={styles.muted}>Choose a company above.</Text>
        ) : registers.isPending ? (
          <Text style={styles.muted}>Loading your register…</Text>
        ) : (
          registers.data.map((register, index) => {
            const uuid = register.token.uuid;
            const open = expanded.includes(uuid);
            return (
              <View key={uuid} style={[styles.entry, index === registers.data.length - 1 && styles.lastEntry]}>
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
                    {company.name} · {register.token.symbol}
                  </Text>
                  <Text style={styles.muted}>{open ? 'Hide members' : 'Show members'}</Text>
                </Pressable>
                <Rows>
                  {classPageOpens && (
                    <LinkRow
                      label="Share class"
                      accessibilityLabel={`Open ${register.token.name}`}
                      onPress={() => navigation.navigate('TokenDetail', { uuid, name: register.token.name })}
                    />
                  )}
                  {open && (
                    <View style={styles.group}>
                      <RegisterDownload
                        uuid={uuid}
                        disabled={!register.initialized}
                        accessibilityLabel={`${REGISTER_COPY.DOWNLOAD} for ${register.token.name}`}
                      />
                      <ClassRegister register={register} />
                      <ClassImports
                        epoch={epoch}
                        company={company.uuid}
                        register={register}
                        refreshHolders={registers.refetch}
                        onPrepare={() =>
                          navigation.navigate('PrepareRegisterImport', { tokenUuid: uuid, companyUuid: company.uuid })
                        }
                      />
                    </View>
                  )}
                </Rows>
              </View>
            );
          })
        )}
      </Section>
      <Section title="Register instructions">
        <Text style={styles.muted}>
          The company owner submits written register instructions. Staff verify and apply them. Certificates, inspection
          copies, publications and the company pack are prepared by staff on written instruction.
        </Text>
      </Section>
    </Page>
  );
}
