import { PAGE_SIZE } from '../constants/api';

export function pageOf(count: number, requested: number) {
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));
  const page = Math.min(Math.max(1, requested), pages);
  const start = (page - 1) * PAGE_SIZE;
  const end = Math.min(page * PAGE_SIZE, count);
  return { pages, page, start, end, first: count === 0 ? 0 : start + 1, last: end };
}

export function pageWith(index: number) {
  return Math.max(1, Math.floor(index / PAGE_SIZE) + 1);
}
