import { Text, View } from 'react-native';
import {
  formatShareCount,
  HOLDER_TYPE_LABELS,
  REGISTER_COPY,
  REGISTER_PARTICULARS_COPY,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, Row, Rows } from '../../components/Ledger';
import { useCompanyStyles } from './styles';

export function ClassRegister({
  register,
  onChangeParticulars,
}: {
  register: TokenHoldersResponse;
  onChangeParticulars?: (member: string) => void;
}) {
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
            register.holders.map((holder, index) => {
              const label = holder.name || HOLDER_TYPE_LABELS[holder.holderType];
              return (
                <View
                  key={holder.member}
                  style={[styles.entry, index === register.holders.length - 1 && styles.lastEntry]}
                >
                  <Text style={styles.heading}>{label}</Text>
                  <Text style={styles.text}>
                    {formatShareCount(holder.balance)} {holder.balance === '1' ? 'share' : 'shares'}
                  </Text>
                  <Text style={styles.muted}>
                    {HOLDER_TYPE_LABELS[holder.holderType]} · Entered {holder.enteredOn}
                  </Text>
                  {holder.holderType === 'ambiguous' && (
                    <Text style={styles.muted}>{REGISTER_COPY.AMBIGUOUS_NOTE}</Text>
                  )}
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
                  {onChangeParticulars && (
                    <Action
                      label={REGISTER_PARTICULARS_COPY.PREPARE}
                      accessibilityLabel={`${REGISTER_PARTICULARS_COPY.PREPARE} for ${label} in ${register.token.name}`}
                      onPress={() => onChangeParticulars(holder.member)}
                    />
                  )}
                </View>
              );
            })
          )}
          {!!register.formerMembers?.length && (
            <View style={styles.group}>
              <Text accessibilityRole="header" style={styles.heading}>
                {REGISTER_COPY.FORMER_TITLE} · {register.formerMembers.length}
              </Text>
              <Text style={styles.muted}>{REGISTER_COPY.FORMER_NOTE}</Text>
              {register.formerMembersStale && (
                <Text style={styles.muted}>The former-member history needs a refresh before relying on it.</Text>
              )}
              {register.formerMembers.map((former, index) => (
                <View
                  key={former.uuid}
                  style={[styles.entry, index === register.formerMembers.length - 1 && styles.lastEntry]}
                >
                  <Text style={styles.heading}>{former.name || 'Name not recorded'}</Text>
                  <Rows>
                    {former.member && <Row label="Member ID">{former.member}</Row>}
                    <Row label="Shares at cessation">{formatShareCount(former.sharesAtCessation)}</Row>
                    <Row label="Ceased on">{former.ceasedOn}</Row>
                    <Row label="Identity source">{former.identitySourceDisplay}</Row>
                    {former.sourceEntry && <Row label="Cessation entry">{former.sourceEntry}</Row>}
                    {former.sourceEntrySequence !== null && (
                      <Row label="Cessation entry sequence">{former.sourceEntrySequence}</Row>
                    )}
                    {former.sourceEntryKind && <Row label="Cessation entry kind">{former.sourceEntryKind}</Row>}
                    {former.sourceEffectiveOn && <Row label="Source effective date">{former.sourceEffectiveOn}</Row>}
                    {former.corrects && <Row label="Corrects entry">{former.corrects}</Row>}
                    {former.correctedBy && <Row label="Corrected by entry">{former.correctedBy}</Row>}
                    {former.returnedOn && <Row label="Returned on">{former.returnedOn}</Row>}
                    {former.returnedEntry && <Row label="Return entry">{former.returnedEntry}</Row>}
                    {former.walletAddress && <Row label="Recorded wallet">{former.walletAddress}</Row>}
                    {former.ceasedAtBlock !== null && (
                      <Row label="Recorded cessation block">{former.ceasedAtBlock}</Row>
                    )}
                  </Rows>
                </View>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  );
}
