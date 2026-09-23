import type { AxiosInstance } from 'axios';
import type { AxiosResponse } from 'axios';
import {
  PUBLICATION_ENDPOINTS,
  PUBLICATION_KIND_LABELS,
  PUBLICATION_NOTICE,
  publicationFilename,
} from '../../src/constants';
import {
  downloadPublication,
  getPublications,
  getPublicationsNextPage,
  openPublication,
} from '../../src/services/publications';

describe('publication services', () => {
  const get = jest.fn();
  const apiClient = { get } as unknown as AxiosInstance;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists the publications addressed to the caller without naming anyone, a page at a time', () => {
    getPublications(apiClient);
    getPublications(apiClient, 3);

    expect(get).toHaveBeenNthCalledWith(1, '/api/v1/publications/', { params: { page: 1 } });
    expect(get).toHaveBeenNthCalledWith(2, '/api/v1/publications/', { params: { page: 3 } });
  });

  it('reads the next page from the listing, and stops when there is none', () => {
    const page = (next: string | null) => ({ data: { count: 30, next, previous: null, results: [] } }) as AxiosResponse;

    expect(getPublicationsNextPage(page('https://api.example/api/v1/publications/?page=2'))).toBe(2);
    expect(getPublicationsNextPage(page(null))).toBeUndefined();
  });

  it('names a downloaded copy from the type served, since the stored object is not named for it', () => {
    expect(publicationFilename('publication-a', 'application/pdf')).toBe('publication-a.pdf');
    expect(publicationFilename('publication-a', 'image/jpeg; charset=binary')).toBe('publication-a.jpg');
    expect(publicationFilename('publication-a', 'application/octet-stream')).toBe('publication-a');
  });

  it('opens a document as a blob through the route that audits the read', () => {
    openPublication(apiClient, 'publication-a');

    expect(get).toHaveBeenCalledWith('/api/v1/publications/publication-a/file/', { responseType: 'blob' });
  });

  it('downloads the same document as bytes, carrying the caller config but never its response type', () => {
    downloadPublication(apiClient, 'publication-a', { timeout: 1000, responseType: 'json' });

    expect(get).toHaveBeenCalledWith('/api/v1/publications/publication-a/file/', {
      timeout: 1000,
      responseType: 'arraybuffer',
    });
  });

  it('builds the file route from the listing route, so one prefix moves both', () => {
    expect(PUBLICATION_ENDPOINTS.FILE('publication-a')).toBe(`${PUBLICATION_ENDPOINTS.BASE}publication-a/file/`);
  });

  it('labels every kind the backend can publish', () => {
    expect(Object.keys(PUBLICATION_KIND_LABELS).sort()).toEqual(['holding_statement', 'meeting_notice']);
  });

  it('names the notice type the backend sends, so a deep link can be recognised', () => {
    expect(PUBLICATION_NOTICE).toBe('publication');
  });
});
