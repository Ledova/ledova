import { useState } from 'react';
import { Switch, Text, TextInput, View } from 'react-native';
import {
  OFFERING_EXEMPTION_LABELS,
  type CompanyShareTokenListItem,
  type Offering,
  type OfferingExemption,
  type OfferingInput,
  type OperatorSettlementAsset,
} from '@ledova/shared';
import { Action } from '../../components/Ledger';
import { useCompanyStyles } from '../company-register/styles';
import { requestShares } from '../company-tokens/shareQuantities';
import { OfferingDateField } from './OfferingDateField';

export function OfferingForm({
  tokens,
  busy,
  blocked,
  settlementAssets,
  operatorName,
  editing,
  onSubmit,
  onClose,
  error,
}: {
  tokens: Pick<CompanyShareTokenListItem, 'uuid' | 'name' | 'symbol'>[];
  busy: boolean;
  blocked: boolean;
  settlementAssets: OperatorSettlementAsset[];
  operatorName: string;
  editing?: Offering;
  onSubmit: (input: OfferingInput) => void;
  onClose: () => void;
  error?: string;
}) {
  const styles = useCompanyStyles();
  const [token, setToken] = useState(editing?.tokenUuid ?? tokens[0]?.uuid ?? '');
  const [exemption, setExemption] = useState<OfferingExemption>(editing?.exemption ?? 's708_11_professional');
  const [pricePerShare, setPricePerShare] = useState(editing?.pricePerShare ?? '');
  const [minimumShares, setMinimumShares] = useState(editing ? String(editing.minimumShares) : '');
  const [targetShares, setTargetShares] = useState(editing ? String(editing.targetShares) : '');
  const [capShares, setCapShares] = useState(editing ? String(editing.capShares) : '');
  const [opensAt, setOpensAt] = useState(editing?.opensAt ?? '');
  const [closesAt, setClosesAt] = useState(editing?.closesAt ?? '');
  const [summary, setSummary] = useState(editing?.summary ?? '');
  const [useOfProceeds, setUseOfProceeds] = useState(editing?.useOfProceeds ?? '');
  const [acceptsBankTransfer, setAcceptsBankTransfer] = useState(editing?.acceptsBankTransfer ?? true);
  const [chosenAssets, setChosenAssets] = useState<string[]>(editing?.settlementAssets ?? []);
  const minimum = requestShares(minimumShares);
  const target = requestShares(targetShares);
  const cap = requestShares(capShares);
  const quantitiesValid = minimum !== null && target !== null && cap !== null && minimum <= target && target <= cap;
  const priceValid =
    /^\d+(?:\.\d{1,2})?$/.test(pricePerShare) &&
    BigInt(pricePerShare.split('.')[0]) <= 9_999_999_999_999_999n &&
    BigInt(pricePerShare.replace('.', '')) > 0n;
  const opens = new Date(opensAt).getTime();
  const closes = closesAt ? new Date(closesAt).getTime() : null;
  const datesValid = Number.isFinite(opens) && (closes === null || (Number.isFinite(closes) && closes > opens));
  const unavailableAssets = chosenAssets.filter((uuid) => !settlementAssets.some((asset) => asset.uuid === uuid));
  const hasARail = acceptsBankTransfer || chosenAssets.length > 0;
  const complete =
    tokens.some((each) => each.uuid === token) &&
    quantitiesValid &&
    priceValid &&
    datesValid &&
    hasARail &&
    unavailableAssets.length === 0;
  const submit = () => {
    if (!complete || busy || blocked) return;
    onSubmit({
      token,
      exemption,
      pricePerShare,
      acceptsBankTransfer,
      settlementAssets: chosenAssets,
      minimumShares: minimum!,
      targetShares: target!,
      capShares: cap!,
      opensAt: new Date(opensAt).toISOString(),
      closesAt: closesAt ? new Date(closesAt).toISOString() : null,
      summary,
      useOfProceeds,
    });
  };
  return (
    <View style={styles.group}>
      <Text style={styles.text}>Share class</Text>
      {tokens.map((each) => (
        <Action
          key={each.uuid}
          label={`${each.name} (${each.symbol})`}
          primary={each.uuid === token}
          disabled={busy || !!editing}
          onPress={() => setToken(each.uuid)}
        />
      ))}
      <Text style={styles.text}>Exemption relied on</Text>
      {(Object.entries(OFFERING_EXEMPTION_LABELS) as [OfferingExemption, string][]).map(([value, label]) => (
        <Action
          key={value}
          label={label}
          primary={exemption === value}
          disabled={busy}
          onPress={() => setExemption(value)}
        />
      ))}
      {(
        [
          ['Price per share (AUD)', pricePerShare, setPricePerShare],
          ['Minimum shares', minimumShares, setMinimumShares],
          ['Target shares', targetShares, setTargetShares],
          ['Cap shares', capShares, setCapShares],
        ] as const
      ).map(([label, value, onChangeText]) => (
        <View key={label} style={styles.group}>
          <Text style={styles.text}>{label}</Text>
          <TextInput
            accessibilityLabel={label}
            style={styles.input}
            keyboardType={label === 'Price per share (AUD)' ? 'decimal-pad' : 'number-pad'}
            value={value}
            onChangeText={onChangeText}
            editable={!busy}
          />
        </View>
      ))}
      <Text style={styles.muted}>Dates and times use this device’s local time.</Text>
      <OfferingDateField label="Opens at" value={opensAt} onChange={setOpensAt} busy={busy} />
      <OfferingDateField label="Closes at" value={closesAt} onChange={setClosesAt} busy={busy} optional />
      {(
        [
          ['Summary', summary, setSummary],
          ['Use of proceeds', useOfProceeds, setUseOfProceeds],
        ] as const
      ).map(([label, value, onChangeText]) => (
        <View key={label} style={styles.group}>
          <Text style={styles.text}>{label}</Text>
          <TextInput
            accessibilityLabel={label}
            style={styles.input}
            multiline
            value={value}
            onChangeText={onChangeText}
            editable={!busy}
          />
        </View>
      ))}
      <Text style={styles.heading}>How investors may pay</Text>
      <Text style={styles.text}>Accept bank transfer</Text>
      <Switch
        accessibilityLabel="Accept bank transfer"
        value={acceptsBankTransfer}
        onValueChange={setAcceptsBankTransfer}
        disabled={busy}
      />
      {settlementAssets.length === 0 ? (
        <Text style={styles.muted}>
          This offering can take bank transfer only: {operatorName} has not configured a settlement asset.
        </Text>
      ) : (
        settlementAssets.map((asset) => (
          <View key={asset.uuid} style={styles.group}>
            <Text style={styles.text}>{asset.symbol}</Text>
            <Switch
              accessibilityLabel={`Accept ${asset.symbol}`}
              value={chosenAssets.includes(asset.uuid)}
              disabled={busy}
              onValueChange={(value) =>
                setChosenAssets((chosen) =>
                  value ? [...chosen, asset.uuid] : chosen.filter((uuid) => uuid !== asset.uuid),
                )
              }
            />
          </View>
        ))
      )}
      {!hasARail && (
        <Text accessibilityRole="alert" style={styles.error}>
          Choose at least one way to be paid. An offering nobody can pay for cannot be submitted.
        </Text>
      )}
      {unavailableAssets.length > 0 && (
        <View style={styles.group}>
          <Text accessibilityRole="alert" style={styles.error}>
            A previously selected settlement asset is no longer available. Remove it before saving.
          </Text>
          <Action
            label="Remove unavailable settlement assets"
            disabled={busy}
            onPress={() => setChosenAssets(chosenAssets.filter((uuid) => !unavailableAssets.includes(uuid)))}
          />
        </View>
      )}
      {!quantitiesValid && !!(minimumShares || targetShares || capShares) && (
        <Text accessibilityRole="alert" style={styles.error}>
          Enter whole share quantities from 1 to 2,147,483,647, with minimum ≤ target ≤ cap.
        </Text>
      )}
      {!!pricePerShare && !priceValid && (
        <Text accessibilityRole="alert" style={styles.error}>
          Enter a positive AUD price with at most 16 digits before the decimal point and two after it.
        </Text>
      )}
      {!!closesAt && !datesValid && (
        <Text accessibilityRole="alert" style={styles.error}>
          The closing time must be after the opening time.
        </Text>
      )}
      {editing && (
        <Text style={styles.muted}>
          {editing.status === 'rejected'
            ? 'Rejected offerings are editable. Submitting it again sends it back for review.'
            : 'Draft offerings are editable. Submitting it for review locks it.'}
        </Text>
      )}
      {!!error && (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      <Action
        label={editing ? 'Save changes' : 'Create draft offering'}
        primary
        disabled={!complete || busy || blocked}
        onPress={submit}
      />
      <Action label="Cancel" disabled={busy} onPress={onClose} />
    </View>
  );
}
