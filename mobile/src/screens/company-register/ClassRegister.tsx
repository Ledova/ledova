import { Text, View } from 'react-native';
import { formatShareCount, HOLDER_TYPE_LABELS, REGISTER_COPY, type TokenHoldersResponse } from '@ledova/shared';
import { Row, Rows } from '../../components/Ledger';
import { useCompanyStyles } from './styles';

export function ClassRegister({ register }: { register: TokenHoldersResponse }) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      <Rows>
        <Row label="Issued shares">
          {register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply)}
        </Row>
        <Row label="Authorised shares">{formatShareCount(register.token.totalSupply)}</Row>
        <Row label="Register">{register.initialized ? 'Opened' : 'Not opened'}</Row>
      </Rows>
      {!register.initialized ? (
        <Text style={styles.muted}>{REGISTER_COPY.NOT_OPENED_NOTE}</Text>
      ) : (
        <>
          {register.waitingEffects === null ? (
            <Text style={styles.muted}>{REGISTER_COPY.WAITING_UNKNOWN_NOTE}</Text>
          ) : register.waitingEffects > 0 ? (
            <Text style={styles.muted}>{REGISTER_COPY.WAITING_NOTE(register.waitingEffects)}</Text>
          ) : null}
          <Text accessibilityRole="header" style={styles.heading}>
            Current members · {register.totalHolders}
          </Text>
          {register.holders.length === 0 ? (
            <Text style={styles.muted}>No current members are recorded for this class.</Text>
          ) : (
            register.holders.map((holder, index) => (
              <View
                key={holder.member}
                style={[styles.entry, index === register.holders.length - 1 && styles.lastEntry]}
              >
                <Text style={styles.heading}>{holder.name || HOLDER_TYPE_LABELS[holder.holderType]}</Text>
                <Text style={styles.text}>
                  {formatShareCount(holder.balance)} {holder.balance === '1' ? 'share' : 'shares'}
                </Text>
                <Text style={styles.muted}>
                  {HOLDER_TYPE_LABELS[holder.holderType]} · Entered {holder.enteredOn}
                </Text>
                {holder.holderType === 'ambiguous' && <Text style={styles.muted}>{REGISTER_COPY.AMBIGUOUS_NOTE}</Text>}
                {holder.holderType === 'unidentified' && (
                  <Text style={styles.muted}>{REGISTER_COPY.UNIDENTIFIED_NOTE}</Text>
                )}
                {holder.wallets.length === 0 ? (
                  <Text style={styles.muted}>{REGISTER_COPY.NO_WALLET}</Text>
                ) : (
                  holder.wallets.map((wallet) => (
                    <Text selectable key={wallet.address} style={styles.muted}>
                      {wallet.address} · {wallet.whitelistStatus}
                    </Text>
                  ))
                )}
              </View>
            ))
          )}
        </>
      )}
    </View>
  );
}
