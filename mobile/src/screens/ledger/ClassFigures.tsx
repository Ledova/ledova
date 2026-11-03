import { Text, View } from 'react-native';
import { useLedgerStyles } from './useLedgerStyles';

export function ClassFigures({ label, issued, holders }: { label: string; issued: string; holders: string }) {
  const look = useLedgerStyles();
  return (
    <View accessibilityLabel={label} style={look.figures}>
      {[
        ['Issued shares', issued],
        ['Current shareholders', holders],
      ].map(([name, value]) => (
        <View key={name} accessible accessibilityLabel={`${name}: ${value}`} style={look.figure}>
          <Text style={look.figureLabel}>{name}</Text>
          <Text style={look.figureValue}>{value}</Text>
        </View>
      ))}
    </View>
  );
}
