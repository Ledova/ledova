import { formatDate } from '../../src/utils/date';

describe('a calendar date, read west of UTC', () => {
  beforeEach(() => {
    const format = Date.prototype.toLocaleDateString;
    jest.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (this: Date, locale, options) {
      return format.call(this, locale, { timeZone: 'America/Los_Angeles', ...options });
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('keeps the day it names', () => {
    expect(formatDate('2026-09-23')).toBe('23 September 2026');
  });

  it("still shows a moment on the reader's own day", () => {
    expect(formatDate('2026-09-23T01:00:00Z')).toBe('22 September 2026');
  });
});
