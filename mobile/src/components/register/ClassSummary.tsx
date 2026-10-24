import { Text, View } from 'react-native';
import { formatShareCount, REGISTER_COPY, TECHNICAL_SHARE_LIMIT, type TokenHoldersResponse } from '@ledova/shared';
import { Row, Rows, Status } from '../Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

export function ClassSummary({ register }: { register: TokenHoldersResponse }) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      <Rows>
        <Row label="Issued shares">
          {register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply)}
        </Row>
        <Row label="Current shareholders">{register.initialized ? register.totalHolders : 'Not recorded'}</Row>
        {register.token.totalSupply !== TECHNICAL_SHARE_LIMIT && (
          <Row label="Authorised shares">{formatShareCount(register.token.totalSupply)}</Row>
        )}
      </Rows>
      <Status tone={register.initialized ? 'done' : 'waiting'}>
        {register.initialized ? 'Ledger opened' : 'Ledger not opened'}
      </Status>
      {!register.initialized ? (
        <Text style={styles.muted}>{REGISTER_COPY.NOT_OPENED_NOTE}</Text>
      ) : (
        <>
          {register.waitingEffects === null ? (
            <Text style={styles.muted}>{REGISTER_COPY.WAITING_UNKNOWN_NOTE}</Text>
          ) : register.waitingEffects > 0 ? (
            <Text style={styles.muted}>{REGISTER_COPY.WAITING_NOTE(register.waitingEffects)}</Text>
          ) : null}
          {register.holders.length === 0 && <Text style={styles.muted}>No current members yet.</Text>}
        </>
      )}
    </View>
  );
}
