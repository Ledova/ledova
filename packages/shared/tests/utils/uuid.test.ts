import { isUuid } from '../../src/utils/validation';

describe('the UUID check the stored records and settlement responses share', () => {
  it.each([
    '7f1c2a9e-4b3d-4c5e-8f6a-0b1c2d3e4f5a',
    '7F1C2A9E-4B3D-4C5E-8F6A-0B1C2D3E4F5A',
    '7f1C2a9E-4b3D-4c5E-8f6A-0b1C2d3E4f5A',
  ])('accepts %s', (value) => {
    expect(isUuid(value)).toBe(true);
  });
  it.each([
    ['nothing', ''],
    ['one character short', '7f1c2a9e-4b3d-4c5e-8f6a-0b1c2d3e4f5'],
    ['one character long', '7f1c2a9e-4b3d-4c5e-8f6a-0b1c2d3e4f5a0'],
    ['a character that is not hexadecimal', '7f1c2a9e-4b3d-4c5e-8f6a-0b1c2d3e4f5g'],
    ['a leading space', ' 7f1c2a9e-4b3d-4c5e-8f6a-0b1c2d3e4f5a'],
    ['a trailing newline', '7f1c2a9e-4b3d-4c5e-8f6a-0b1c2d3e4f5a\n'],
    ['braces', '{7f1c2a9e-4b3d-4c5e-8f6a-0b1c2d3e4f5a}'],
    ['no separators', '7f1c2a9e4b3d4c5e8f6a0b1c2d3e4f5a'],
    ['a missing separator', '7f1c2a9e4b3d-4c5e-8f6a-0b1c2d3e4f5a'],
    ['underscores for separators', '7f1c2a9e_4b3d_4c5e_8f6a_0b1c2d3e4f5a'],
    ['a separator out of place', '7f1c2a9-e4b3d-4c5e-8f6a-0b1c2d3e4f5a'],
  ])('refuses %s', (_label, value) => {
    expect(isUuid(value)).toBe(false);
  });
});
