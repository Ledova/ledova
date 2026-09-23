import type { AxiosInstance } from 'axios';
import { PUBLICATION_ENDPOINTS, PUBLICATION_KIND_LABELS, PUBLICATION_NOTICE } from '../../src/constants';
import { downloadPublication, getPublications, openPublication } from '../../src/services/publications';

describe('publication services', () => {
  const get = jest.fn();
  const apiClient = { get } as unknown as AxiosInstance;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists the publications addressed to the caller without naming anyone', () => {
    getPublications(apiClient);

    expect(get).toHaveBeenCalledWith('/api/v1/publications/');
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
