import { FIELD_LIMITS, type ClassRightsAttributes } from '@ledova/shared';

type Choice = { value: string; label: string };
type RightsField = {
  key: string;
  label: string;
  kind?: 'decimal' | 'select' | 'checkbox' | 'conditions';
  types?: readonly string[];
  options?: readonly Choice[];
  positive?: boolean;
  hint?: string;
};
type RightsGroup = {
  key: keyof ClassRightsAttributes;
  label: string;
  options: readonly Choice[];
  fields: readonly RightsField[];
  measure?: { label: string; options: readonly Choice[] };
};

const UNKNOWN = { value: 'not_recorded', label: 'Not recorded' };
const CUSTOM = { value: 'custom', label: 'Custom terms' };
const CONDITIONS = { key: 'conditions', label: 'Conditions', kind: 'conditions' } as const;

export const RIGHTS_GROUPS: readonly RightsGroup[] = [
  {
    key: 'voting',
    label: 'Voting',
    options: [
      UNKNOWN,
      { value: 'general', label: 'General voting' },
      { value: 'conditional', label: 'Limited or conditional voting' },
      { value: 'no_general_vote', label: 'No general voting' },
      CUSTOM,
    ],
    fields: [
      {
        key: 'votesPerShare',
        label: 'Votes per share on a poll',
        kind: 'decimal',
        positive: true,
        types: ['general', 'conditional'],
      },
      CONDITIONS,
    ],
  },
  {
    key: 'dividends',
    label: 'Dividends',
    options: [
      UNKNOWN,
      { value: 'participating', label: 'Participates when declared' },
      { value: 'preferential', label: 'Preferential entitlement' },
      { value: 'none', label: 'No dividend entitlement' },
      CUSTOM,
    ],
    measure: {
      label: 'Preference measure',
      options: [UNKNOWN, { value: 'rate', label: 'Rate' }, { value: 'amount', label: 'Fixed amount' }],
    },
    fields: [
      { key: 'rate', label: 'Rate (%)', kind: 'decimal', types: ['preferential'] },
      { key: 'amount', label: 'Amount', kind: 'decimal', types: ['preferential'] },
      { key: 'basis', label: 'Calculation basis', types: ['preferential'] },
      { key: 'currency', label: 'Currency', types: ['preferential'] },
      {
        key: 'cumulative',
        label: 'Accumulation',
        kind: 'select',
        types: ['preferential'],
        options: [
          UNKNOWN,
          { value: 'cumulative', label: 'Cumulative' },
          { value: 'non_cumulative', label: 'Non-cumulative' },
        ],
      },
      CONDITIONS,
    ],
  },
  {
    key: 'capital',
    label: 'Capital on winding-up',
    options: [
      UNKNOWN,
      { value: 'residual', label: 'Participates in remaining assets' },
      { value: 'preferential', label: 'Preferential entitlement' },
      CUSTOM,
    ],
    measure: {
      label: 'Preference measure',
      options: [UNKNOWN, { value: 'multiple', label: 'Multiple' }, { value: 'amount', label: 'Fixed amount' }],
    },
    fields: [
      { key: 'multiple', label: 'Multiple', kind: 'decimal', positive: true, types: ['preferential'] },
      { key: 'amount', label: 'Amount', kind: 'decimal', types: ['preferential'] },
      { key: 'basis', label: 'Calculation basis', types: ['preferential'] },
      { key: 'currency', label: 'Currency', types: ['preferential'] },
      { key: 'ranking', label: 'Priority relative to other classes', types: ['preferential'] },
      {
        key: 'participation',
        label: 'Further participation',
        kind: 'select',
        types: ['preferential'],
        options: [
          UNKNOWN,
          { value: 'non_participating', label: 'No further participation' },
          { value: 'participating', label: 'Participates after preference' },
          { value: 'capped', label: 'Participates up to a cap' },
        ],
      },
      { key: 'cap', label: 'Participation cap', types: ['preferential'] },
      CONDITIONS,
    ],
  },
  {
    key: 'transfers',
    label: 'Transfers',
    options: [
      UNKNOWN,
      { value: 'restricted', label: 'Restrictions apply' },
      { value: 'no_class_restrictions', label: 'No class-specific restrictions' },
      CUSTOM,
    ],
    fields: [
      { key: 'boardConsent', label: 'Board consent', kind: 'checkbox', types: ['restricted'] },
      { key: 'preEmption', label: 'Transfer pre-emption', kind: 'checkbox', types: ['restricted'] },
      CONDITIONS,
    ],
  },
  {
    key: 'conversion',
    label: 'Conversion',
    options: [
      UNKNOWN,
      { value: 'convertible', label: 'Convertible under its terms' },
      { value: 'none', label: 'No conversion right' },
      CUSTOM,
    ],
    fields: [
      { key: 'targetClass', label: 'Converts into class', types: ['convertible'] },
      {
        key: 'ratio',
        label: 'Target shares per share',
        hint: 'A ratio of 1 records one target share for each share converted.',
        kind: 'decimal',
        positive: true,
        types: ['convertible'],
      },
      CONDITIONS,
    ],
  },
  {
    key: 'redemption',
    label: 'Redemption',
    options: [
      UNKNOWN,
      { value: 'redeemable', label: 'Redeemable under its terms' },
      { value: 'not_redeemable', label: 'Not redeemable' },
      CUSTOM,
    ],
    fields: [
      {
        key: 'trigger',
        label: 'Redemption initiated by',
        kind: 'select',
        types: ['redeemable'],
        options: [
          UNKNOWN,
          { value: 'company', label: 'Company' },
          { value: 'holder', label: 'Shareholder' },
          { value: 'event', label: 'Specified event' },
          CUSTOM,
        ],
      },
      { ...CONDITIONS, hint: 'Record when redemption applies and its price or calculation basis.' },
    ],
  },
];

export function rightsGroupValues(attributes: ClassRightsAttributes, key: keyof ClassRightsAttributes) {
  return (attributes[key] ?? {}) as Record<string, unknown>;
}

export function preferenceMeasure(group: RightsGroup, values: Record<string, unknown>) {
  return group.measure?.options.find((option) => option.value in values)?.value ?? 'not_recorded';
}

function allowedRightsFields(group: RightsGroup, values: Record<string, unknown>) {
  if (!values.type || values.type === 'not_recorded') return [];
  return group.fields.filter((field) => !field.types || field.types.includes(String(values.type)));
}

export function visibleRightsFields(group: RightsGroup, values: Record<string, unknown>) {
  return allowedRightsFields(group, values).filter((field) => {
    if (field.kind === 'conditions') return false;
    if (group.measure && ['rate', 'multiple', 'amount'].includes(field.key))
      return field.key === preferenceMeasure(group, values);
    if (field.key === 'basis') return preferenceMeasure(group, values) !== 'not_recorded';
    if (field.key === 'currency') return preferenceMeasure(group, values) === 'amount';
    if (field.key === 'cap') return values.participation === 'capped';
    return true;
  });
}

const DECIMAL = /^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,8})?$/;

export function rightsAttributeProblems(attributes: ClassRightsAttributes) {
  const problems: Record<string, string | false> = {};
  for (const group of RIGHTS_GROUPS) {
    const values = rightsGroupValues(attributes, group.key);
    for (const field of visibleRightsFields(group, values)) {
      const value = values[field.key];
      const text = typeof value === 'string' ? value.trim() : '';
      const key = `${group.key}.${field.key}`;
      if (group.measure && field.key === preferenceMeasure(group, values) && !text)
        problems[key] = 'Enter a value for the selected preference measure.';
      if (field.kind === 'decimal' && text)
        problems[key] =
          (!DECIMAL.test(text) || (!!field.positive && !/[1-9]/.test(text))) &&
          `Enter ${field.label.toLowerCase()} as ${field.positive ? 'a positive' : 'a non-negative'} number with up to 16 whole digits and 8 decimal places.`;
      if (!field.kind) {
        if (text.length > FIELD_LIMITS.NAME)
          problems[key] = `Keep ${field.label.toLowerCase()} within ${FIELD_LIMITS.NAME} characters.`;
      }
      if (field.key === 'currency' && text && !/^[A-Z]{3}$/.test(text))
        problems[key] = 'Use a three-letter currency code, such as AUD.';
      if (field.key === 'basis' && !text && ['rate', 'amount', 'multiple'].some((key) => values[key]))
        problems[key] = 'Record what the preference applies to.';
      if (field.key === 'currency' && !text && values.amount) problems[key] = 'Record the currency for this amount.';
      if (field.key === 'cap' && !text) problems[key] = 'Record the participation cap.';
      if (field.key === 'targetClass' && !text && values.ratio)
        problems[key] = 'Record the class these shares convert into.';
    }
  }
  return problems;
}

export function classRightsTerms(attributes: ClassRightsAttributes, summary: string) {
  const conditions = RIGHTS_GROUPS.flatMap((group) => {
    const text = attributes[group.key]?.conditions;
    return text?.trim() ? [`${group.label}: ${text}`] : [];
  });
  return [...conditions, summary].filter((text) => text.trim()).join('\n\n');
}

export function rightsWithoutConditions(attributes: ClassRightsAttributes): ClassRightsAttributes {
  return Object.fromEntries(
    Object.entries(attributes).map(([key, value]) => {
      const fields = { ...value };
      delete fields.conditions;
      return [key, fields];
    }),
  );
}

export function cleanRightsAttributes(attributes: ClassRightsAttributes): ClassRightsAttributes {
  return Object.fromEntries(
    RIGHTS_GROUPS.flatMap((group) => {
      const values = rightsGroupValues(attributes, group.key);
      if (!values.type) return [];
      const allowed = new Set(['type', ...allowedRightsFields(group, values).map((field) => field.key)]);
      return [
        [
          group.key,
          Object.fromEntries(
            Object.entries(values).flatMap(([key, value]) => {
              if (!allowed.has(key) || value === undefined) return [];
              if (typeof value === 'string') return value.trim() ? [[key, value.trim()]] : [];
              return [[key, value]];
            }),
          ),
        ],
      ];
    }),
  ) as ClassRightsAttributes;
}

export function sameRightsAttributes(left: ClassRightsAttributes, right: ClassRightsAttributes) {
  const ordered = (value: ClassRightsAttributes) =>
    JSON.stringify(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, group]) => [key, Object.entries(group).sort(([left], [right]) => left.localeCompare(right))]),
    );
  return ordered(left) === ordered(right);
}

export function isRightsAttributes(value: unknown): value is ClassRightsAttributes {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.entries(value).every(([key, raw]) => {
    const group = RIGHTS_GROUPS.find((group) => group.key === key);
    if (!group || !raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const values = raw as Record<string, unknown>;
    if (!group.options.some((option) => option.value === values.type)) return false;
    const fields = Object.entries(values).every(([key, value]) => {
      if (key === 'type') return true;
      const field = allowedRightsFields(group, values).find((field) => field.key === key);
      if (!field) return false;
      if (field.kind === 'checkbox') return typeof value === 'boolean';
      if (typeof value !== 'string') return false;
      if (field.kind === 'select')
        return (
          (field.key !== 'trigger' || value !== 'not_recorded') &&
          field.options!.some((option) => option.value === value)
        );
      if (field.kind === 'decimal') return DECIMAL.test(value) && (!field.positive || /[1-9]/.test(value));
      if (field.key === 'currency' && !/^[A-Z]{3}$/.test(value)) return false;
      return field.kind === 'conditions'
        ? Array.from(value).length <= FIELD_LIMITS.CLASS_RIGHTS_CONDITIONS
        : value.length <= FIELD_LIMITS.NAME;
    });
    if (!fields) return false;
    const has = (key: string) => Object.prototype.hasOwnProperty.call(values, key);
    const recorded = (key: string) => typeof values[key] === 'string' && !!values[key].trim();
    if (has('ratio') && !recorded('targetClass')) return false;
    const measure = ['rate', 'amount', 'multiple'].some(has);
    if (measure && !recorded('basis')) return false;
    if (has('basis') && !measure) return false;
    if (has('amount') !== has('currency')) return false;
    if ((has('rate') || has('multiple')) && has('amount')) return false;
    if (values.participation === 'capped' && !recorded('cap')) return false;
    if (has('cap') && values.participation !== 'capped') return false;
    return true;
  });
}

export function structuredRightsRows(attributes: ClassRightsAttributes) {
  return RIGHTS_GROUPS.map((group) => {
    const values = rightsGroupValues(attributes, group.key);
    const parts = [group.options.find((option) => option.value === values.type)?.label ?? 'Not recorded'];
    if (group.key === 'voting' && ['general', 'conditional'].includes(String(values.type)) && !values.votesPerShare)
      parts.push('Poll weight not recorded');
    for (const field of group.fields) {
      if (field.kind === 'conditions') continue;
      const value = values[field.key];
      if (value === undefined || value === '' || value === 'not_recorded') continue;
      if (field.kind === 'checkbox') {
        if (value) parts.push(`${field.label} required`);
      } else if (field.kind === 'select') {
        parts.push(
          `${field.label}: ${field.options!.find((option) => option.value === value)?.label ?? 'Not recorded'}`,
        );
      } else {
        parts.push(`${field.label}: ${String(value)}`);
      }
    }
    return { label: group.label, value: parts.join(' · ') };
  });
}
