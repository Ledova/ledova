import { createUserFriendlyError, registerImportMoney, wholeShares, type RegisterTransferMember } from '@ledova/shared';
import { blankAllotment, type MemberDraft } from './preparation';

export const REGISTER_CSV_MAX_BYTES = 1024 * 1024;
export const REGISTER_CSV_MAX_ROWS = 500;
const ENCODING_COLUMN = 'value_encoding';
const TEMPLATE_ENCODING = 'ledova-excel-safe-v1';
export const REGISTER_CSV_COLUMNS = [
  'holder_reference',
  'name',
  'address',
  'entered_on',
  'holding_shares',
  'allotted_on',
  'allotment_shares',
  'amount_paid',
  'amount_unpaid',
  'fully_paid',
  'beneficially_held',
  'share_reference',
  'certificate_reference',
];

function csvRows(text: string) {
  if (new TextEncoder().encode(text).length > REGISTER_CSV_MAX_BYTES || text.includes('\0'))
    throw createUserFriendlyError('Choose a UTF-8 CSV no larger than 1 MB.');
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let closed = false;
  const cell = () => {
    row.push(value);
    value = '';
    closed = false;
  };
  const line = () => {
    cell();
    if (row.some((value) => value.trim())) rows.push(row);
    if (rows.length > REGISTER_CSV_MAX_ROWS + 1)
      throw createUserFriendlyError('A CSV can contain at most 500 allotment rows.');
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
        closed = true;
      } else value += char;
    } else if (char === '"') {
      if (value || closed) throw createUserFriendlyError('A CSV quote must enclose the whole field.');
      quoted = true;
    } else if (char === ',') cell();
    else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      line();
    } else {
      if (closed && char.trim()) throw createUserFriendlyError('Unexpected text after a quoted CSV field.');
      if (!closed) value += char;
    }
  }
  if (quoted) throw createUserFriendlyError('An opening CSV quote has no closing quote.');
  if (value || row.length || closed) line();
  return rows;
}

function flag(value: string, label: string, row: number) {
  if (/^(true|yes)$/i.test(value)) return true;
  if (/^(false|no)$/i.test(value)) return false;
  throw createUserFriendlyError(`Row ${row}: ${label} must be yes or no.`);
}

function templateValue(value: string, row: number) {
  if (!value.startsWith("'")) {
    if (/^[=+\-@]/.test(value))
      throw createUserFriendlyError(
        `Row ${row}: keep the template’s safety prefixes on values beginning with =, +, - or @.`,
      );
    return value;
  }
  if (!/^'[=+\-@']/.test(value))
    throw createUserFriendlyError(
      `Row ${row}: the marked template contains an invalid escaped value. Use an unmarked source CSV for literal text.`,
    );
  return value.slice(1);
}

export function readRegisterCsv(
  text: string,
  current: MemberDraft[] = [],
  preserveMembers = false,
  companyMembers: RegisterTransferMember[] = [],
): MemberDraft[] {
  const rows = csvRows(text.replace(/^\uFEFF/, ''));
  const headers = rows.shift()?.map((header) => header.trim());
  const encoded = headers?.includes(ENCODING_COLUMN) ?? false;
  const expected = [...REGISTER_CSV_COLUMNS, ...(encoded ? [ENCODING_COLUMN] : [])];
  if (
    !headers ||
    headers.length !== expected.length ||
    new Set(headers).size !== headers.length ||
    expected.some((column) => !headers.includes(column))
  )
    throw createUserFriendlyError('Use the template column names, with no missing, duplicate or additional columns.');
  if (!rows.length) throw createUserFriendlyError('Add at least one shareholder and allotment row.');
  const members = new Map<string, MemberDraft>();
  for (const [index, values] of rows.entries()) {
    const line = index + 2;
    if (values.length !== headers.length)
      throw createUserFriendlyError(`Row ${line}: the number of fields differs from the header.`);
    if (encoded && values[headers.indexOf(ENCODING_COLUMN)] !== TEMPLATE_ENCODING)
      throw createUserFriendlyError(`Row ${line}: the template value_encoding marker must be ${TEMPLATE_ENCODING}.`);
    const row = Object.fromEntries(
      headers.map((header, at) => [
        header,
        (encoded && header !== ENCODING_COLUMN ? templateValue(values[at], line) : values[at]).trim(),
      ]),
    );
    if (!row.holder_reference || row.holder_reference.length > 100)
      throw createUserFriendlyError(`Row ${line}: give a shareholder reference of at most 100 characters.`);
    const known = current.find((member) => member.member === row.holder_reference);
    const companyMember = companyMembers.find((member) => member.member === row.holder_reference);
    if (preserveMembers && !known)
      throw createUserFriendlyError(
        `Row ${line}: this shareholder reference does not match an existing member. Download the current template and keep its holder_reference values. Add new shareholders manually after the CSV import.`,
      );
    if (
      encoded &&
      !known &&
      !companyMember &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.holder_reference)
    )
      throw createUserFriendlyError(
        `Row ${line}: this member UUID is not in this company. Choose an existing company shareholder or add a new one manually.`,
      );
    if (
      companyMember &&
      ((companyMember.name && row.name !== companyMember.name) ||
        (companyMember.residentialAddress && row.address !== companyMember.residentialAddress))
    )
      throw createUserFriendlyError(
        `Row ${line}: keep this existing company shareholder’s name and address. Correct company particulars from Register separately.`,
      );
    if (!row.name || row.name.length > 255 || !row.address || row.address.length > 1000)
      throw createUserFriendlyError(`Row ${line}: give a name and address within the field limits.`);
    if (row.share_reference.length > 255 || row.certificate_reference.length > 255)
      throw createUserFriendlyError(
        `Row ${line}: share and certificate references can contain at most 255 characters.`,
      );
    const shares = wholeShares(row.holding_shares);
    const allotted = wholeShares(row.allotment_shares);
    if (
      shares === null ||
      shares <= 0n ||
      shares >= 2n ** 256n ||
      allotted === null ||
      allotted <= 0n ||
      allotted >= 2n ** 256n
    )
      throw createUserFriendlyError(
        `Row ${line}: share quantities must be positive whole numbers within the supported limit.`,
      );
    const paid = registerImportMoney(row.amount_paid);
    const unpaid = registerImportMoney(row.amount_unpaid);
    if (paid === null || unpaid === null)
      throw createUserFriendlyError(
        `Row ${line}: enter paid and unpaid amounts explicitly, using 0 when none is recorded.`,
      );
    const fullyPaid = flag(row.fully_paid, 'fully_paid', line);
    if (fullyPaid !== (unpaid === '0.00'))
      throw createUserFriendlyError(`Row ${line}: fully_paid must agree with amount_unpaid.`);
    let member = members.get(row.holder_reference);
    if (member) {
      if (
        member.name !== row.name ||
        member.residentialAddress !== row.address ||
        member.enteredOn !== row.entered_on ||
        member.shares !== shares.toString()
      )
        throw createUserFriendlyError(
          `Row ${line}: repeated shareholder references must have the same name, address, membership date and holding.`,
        );
    } else {
      member = {
        member: known?.member ?? companyMember?.member ?? crypto.randomUUID(),
        identityChoice: companyMember ? 'existing' : known?.identityChoice,
        name: row.name,
        residentialAddress: row.address,
        enteredOn: row.entered_on,
        shares: shares.toString(),
        allotments: [],
      };
      members.set(row.holder_reference, member);
    }
    member.allotments.push({
      ...blankAllotment(),
      allottedOn: row.allotted_on,
      shares: allotted.toString(),
      amountPaid: paid,
      amountUnpaid: unpaid,
      fullyPaid,
      beneficiallyHeld: flag(row.beneficially_held, 'beneficially_held', line),
      shareReference: row.share_reference,
      certificateReference: row.certificate_reference,
    });
  }
  return [...members.values()];
}

export function registerCsvTemplate(members: MemberDraft[] = []) {
  const rows = members.length
    ? members.flatMap((member) =>
        member.allotments.map((allotment) => [
          member.member,
          member.name,
          member.residentialAddress,
          member.enteredOn,
          member.shares,
          allotment.allottedOn,
          allotment.shares,
          allotment.amountPaid,
          allotment.amountUnpaid,
          allotment.fullyPaid ? 'yes' : 'no',
          allotment.beneficiallyHeld === null ? '' : allotment.beneficiallyHeld ? 'yes' : 'no',
          allotment.shareReference,
          allotment.certificateReference,
        ]),
      )
    : [
        [
          'H001',
          'Example Shareholder',
          '1 Example Street, Sydney NSW 2000',
          '2020-01-01',
          '600',
          '2020-01-01',
          '600',
          '600.00',
          '0',
          'yes',
          'yes',
          '1-600',
          'CERT-001',
        ],
      ];
  const escaped = (value: string) => `"${(/^[=+\-@']/.test(value) ? "'" : '') + value.replace(/"/g, '""')}"`;
  return (
    [
      [...REGISTER_CSV_COLUMNS, ENCODING_COLUMN].join(','),
      ...rows.map((row) => [...row.map(escaped), TEMPLATE_ENCODING].join(',')),
    ].join('\r\n') + '\r\n'
  );
}
