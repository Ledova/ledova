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
import { useCompanyRegister } from './useCompanyRegister';
import { useCompanyStyles } from './styles';
import { ClassRecords } from './ClassRecords';
import { CompanyLinks } from './CompanyLinks';
import { CompanyParticulars } from './CompanyParticulars';
import { RegisterDownload } from './RegisterDownload';

export function CompanyRegisterScreen() {
  const epoch = useSyncExternalStore(subscribeSession, getSessionEpoch);
  return <CompanyRegister key={epoch} epoch={epoch} />;
}

function CompanyRegister({ epoch }: { epoch: number }) {
  const { classes, companies, company, selectCompany, registers, isFetching, refresh } = useCompanyRegister(epoch);
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
                  <LinkRow
                    label="Share class"
                    accessibilityLabel={`Open ${register.token.name}`}
                    onPress={() => navigation.navigate('TokenDetail', { uuid, name: register.token.name })}
                  />
                  {open && (
                    <View style={styles.group}>
                      <RegisterDownload
                        uuid={uuid}
                        disabled={!register.initialized}
                        accessibilityLabel={`${REGISTER_COPY.DOWNLOAD} for ${register.token.name}`}
                      />
                      <ClassRecords
                        epoch={epoch}
                        company={company.uuid}
                        register={register}
                        refreshHolders={registers.refetch}
                        onOpen={() =>
                          navigation.navigate('PrepareRegisterOpening', { tokenUuid: uuid, companyUuid: company.uuid })
                        }
                        onPrepareImport={() =>
                          navigation.navigate('PrepareRegisterImport', { tokenUuid: uuid, companyUuid: company.uuid })
                        }
                        onPrepareGrant={() =>
                          navigation.navigate('PrepareRegisterGrant', { tokenUuid: uuid, companyUuid: company.uuid })
                        }
                        onPrepareTransfer={() =>
                          navigation.navigate('PrepareRegisterTransfer', { tokenUuid: uuid, companyUuid: company.uuid })
                        }
                        onCorrect={(entry) =>
                          navigation.navigate('PrepareRegisterCorrection', {
                            tokenUuid: uuid,
                            companyUuid: company.uuid,
                            entryUuid: entry.uuid,
                          })
                        }
                        onChangeParticulars={(member) =>
                          navigation.navigate('PrepareRegisterParticulars', {
                            tokenUuid: uuid,
                            companyUuid: company.uuid,
                            memberUuid: member,
                          })
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
      {company && registers.isSuccess && (
        <>
          <CompanyParticulars
            epoch={epoch}
            company={company.uuid}
            registers={registers.data}
            refreshHolders={registers.refetch}
          />
          <CompanyLinks
            epoch={epoch}
            company={company.uuid}
            registers={registers.data}
            refreshHolders={registers.refetch}
            onPrepare={() => navigation.navigate('PrepareRegisterLink', { company: company.uuid })}
          />
        </>
      )}
      <Section title="Register instructions">
        <Text style={styles.muted}>
          Company appointees run the supported register commands above, including non-paid grants and direct transfers
          for imported draft classes. They prepare, approve and apply empty-class deployment from the Share class page;
          this creates no shares and does not mirror existing holdings. AUD payment workflows, tokenisation of existing
          holdings and other corporate actions remain planned. Supported tokenised issues, wallet approvals, capital
          increases and pause changes use separate company workflows with exact company approval. Certificates,
          inspection copies, publications and the company pack are prepared by staff on written instruction.
        </Text>
      </Section>
    </Page>
  );
}
