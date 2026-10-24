import { useState } from 'react';
import { Text, View } from 'react-native';
import {
  formatDate,
  formatShareCount,
  HOLDER_TYPE_LABELS,
  REGISTER_COPY,
  REGISTER_CORRECTION_COPY,
  shortReference,
  TECHNICAL_SHARE_LIMIT,
  type RegisterEntryKind,
  type TokenHoldersResponse,
} from '@ledova/shared';
import { Action, Disclosure, Row, Rows, Section } from '../Ledger';
import { useCompanyStyles } from '../../hooks/useCompanyStyles';

export function ClassRegister({ register }: { register: TokenHoldersResponse }) {
  const styles = useCompanyStyles();
  return (
    <View style={styles.group}>
      <Rows>
        <Row label="Issued shares">
          {register.issuedSupply === null ? 'Not recorded' : formatShareCount(register.issuedSupply)}
        </Row>
        {register.token.totalSupply === TECHNICAL_SHARE_LIMIT ? (
          <Row label="Technical share limit">{REGISTER_COPY.QUANTITY_GUARD}</Row>
        ) : (
          <Row label="Authorised shares">{formatShareCount(register.token.totalSupply)}</Row>
        )}
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
                </View>
              );
            })
          )}
          <FormerMembers register={register} />
        </>
      )}
    </View>
  );
}

const PAGE_SIZE = 25;

export function FormerMembers({ register }: { register: TokenHoldersResponse }) {
  const styles = useCompanyStyles();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(PAGE_SIZE);
  const formers = register.formerMembers ?? [];
  if (!formers.length) return null;
  const visible = formers.slice(0, shown);
  return (
    <Disclosure
      open={open}
      onToggle={() => setOpen((value) => !value)}
      summary={
        <Text style={styles.heading}>
          {REGISTER_COPY.FORMER_TITLE} · {formers.length}
        </Text>
      }
    >
      <View style={styles.group}>
        <Text style={styles.muted}>{REGISTER_COPY.FORMER_NOTE}</Text>
        {register.formerMembersStale && (
          <Text style={styles.muted}>The former-member history needs a refresh before relying on it.</Text>
        )}
        {visible.map((former, index) => (
          <View key={former.uuid} style={[styles.entry, index === visible.length - 1 && styles.lastEntry]}>
            <Text style={styles.heading}>{former.name || 'Name not recorded'}</Text>
            <Rows>
              {former.member && <Row label="Member reference">{shortReference(former.member)}</Row>}
              <Row label="Shares at cessation">{formatShareCount(former.sharesAtCessation)}</Row>
              <Row label="Ceased on">{formatDate(former.ceasedOn)}</Row>
              <Row label="Identity source">{former.identitySourceDisplay}</Row>
              {former.sourceEntry && <Row label="Cessation entry">{shortReference(former.sourceEntry)}</Row>}
              {former.sourceEntrySequence !== null && (
                <Row label="Cessation entry sequence">{former.sourceEntrySequence}</Row>
              )}
              {former.sourceEntryKind && (
                <Row label="Cessation entry kind">
                  {REGISTER_CORRECTION_COPY.ENTRY_KINDS[former.sourceEntryKind as RegisterEntryKind]}
                </Row>
              )}
              {former.sourceEffectiveOn && (
                <Row label="Source effective date">{formatDate(former.sourceEffectiveOn)}</Row>
              )}
              {former.corrects && <Row label="Corrects entry">{shortReference(former.corrects)}</Row>}
              {former.correctedBy && <Row label="Corrected by entry">{shortReference(former.correctedBy)}</Row>}
              {former.returnedOn && <Row label="Returned on">{formatDate(former.returnedOn)}</Row>}
              {former.returnedEntry && <Row label="Return entry">{shortReference(former.returnedEntry)}</Row>}
              {former.walletAddress && <Row label="Recorded wallet">{former.walletAddress}</Row>}
              {former.ceasedAtBlock !== null && <Row label="Recorded cessation block">{former.ceasedAtBlock}</Row>}
            </Rows>
          </View>
        ))}
        {formers.length > shown && (
          <Action
            label="Load more former shareholders"
            accessibilityLabel={`Load more former shareholders of ${register.token.name}`}
            onPress={() => setShown(shown + PAGE_SIZE)}
          />
        )}
      </View>
    </Disclosure>
  );
}

export function FormerShareholders({ registers }: { registers: TokenHoldersResponse[] }) {
  const styles = useCompanyStyles();
  const classes = registers.filter((register) => register.initialized && register.formerMembers?.length);
  if (!classes.length) return null;
  return (
    <Section title="Former shareholders">
      {classes.map((register) => (
        <View key={register.token.uuid} style={styles.group}>
          <Text accessibilityRole="header" style={styles.heading}>
            {register.token.name} · {register.token.symbol}
          </Text>
          <FormerMembers register={register} />
        </View>
      ))}
    </Section>
  );
}
