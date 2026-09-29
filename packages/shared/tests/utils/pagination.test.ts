import { assertNextPageAdvances, getNextPageParam, readEveryPage } from '../../src/utils/pagination';

const page = (next: string | null) => ({ count: 30, next, previous: null, results: [] });
const link = (number: string) => `https://api.example.com/api/wallets/?page=${number}`;

describe('getNextPageParam', () => {
  it('reads the page number from the next URL', () => {
    expect(getNextPageParam(page('https://api.example.com/api/assets/?page=2&page_size=10'))).toBe(2);
  });

  it('returns undefined when there is no next page', () => {
    expect(getNextPageParam(page(null))).toBeUndefined();
    expect(getNextPageParam(undefined)).toBeUndefined();
  });

  it('returns undefined when the next URL carries no page parameter', () => {
    expect(getNextPageParam(page('https://api.example.com/api/assets/?page_size=10'))).toBeUndefined();
  });
});

describe('assertNextPageAdvances', () => {
  it('accepts the last page and a next link to a later page', () => {
    expect(() => assertNextPageAdvances(2, page(null))).not.toThrow();
    expect(() => assertNextPageAdvances(2, page(link('3')))).not.toThrow();
  });

  it.each([
    ['the same page', link('2')],
    ['an earlier page', link('1')],
    ['page zero', link('0')],
    ['a negative page', link('-1')],
    ['a fraction of a page', link('2.5')],
    ['something that is not a number', link('next')],
    ['no page at all', 'https://api.example.com/api/wallets/?cursor=next'],
  ])('refuses a next link to %s', (_, next) => {
    expect(() => assertNextPageAdvances(2, page(next))).toThrow('Pagination did not advance');
  });
});

describe('readEveryPage', () => {
  const pages = [
    { results: ['first', 'second'], next: link('2') },
    { results: ['third'], next: link('3') },
    { results: ['fourth', 'fifth'], next: null },
  ];
  const read = (number: number) => Promise.resolve({ data: { count: 5, previous: null, ...pages[number - 1]! } });

  it('reads one page when there is no next link', async () => {
    const only = jest.fn(async () => ({ data: { count: 1, next: null, previous: null, results: ['only'] } }));
    await expect(readEveryPage(only)).resolves.toEqual(['only']);
    expect(only.mock.calls).toEqual([[1]]);
  });

  it('follows each next link from page 1 and returns every item in page order', async () => {
    const reader = jest.fn(read);
    await expect(readEveryPage(reader)).resolves.toEqual(['first', 'second', 'third', 'fourth', 'fifth']);
    expect(reader.mock.calls).toEqual([[1], [2], [3]]);
  });

  it('fails the read at a next link that does not advance, and reads no further', async () => {
    let calls = 0;
    const reader = jest.fn(async (number: number) => {
      calls += 1;
      return { data: { count: 3, previous: null, results: [`row ${number}`], next: calls < 3 ? link('2') : null } };
    });
    await expect(readEveryPage(reader)).rejects.toThrow('Pagination did not advance');
    expect(reader.mock.calls).toEqual([[1], [2]]);
  });

  it('fails the read when a page cannot be read, and reads no further', async () => {
    const reader = jest.fn((number: number) =>
      number === 2 ? Promise.reject(new Error('Page unavailable')) : read(number),
    );
    await expect(readEveryPage(reader)).rejects.toThrow('Page unavailable');
    expect(reader.mock.calls).toEqual([[1], [2]]);
  });
});
