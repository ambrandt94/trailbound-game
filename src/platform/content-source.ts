import { parseContentIndex, type ContentIndex, type ContentSource } from '../core/content/parse';

export type { ContentSource };

/**
 * Loads JSON from `<base>/content/`. The Vite dev server and the production
 * build both expose the repo `content/` directory at that relative URL.
 */
export function createFetchContentSource(
  baseUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): ContentSource {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  let index: ContentIndex | null = null;

  return {
    async loadIndex() {
      const response = await fetchImpl(`${base}content/index.json`);
      if (!response.ok) throw new Error(`content index failed (${response.status})`);
      index = parseContentIndex(await response.json());
      return index;
    },

    async load(id: string) {
      if (!index) index = await this.loadIndex();
      const entry = index.entries.find((item) => item.id === id);
      if (!entry) throw new Error(`unknown content id ${id}`);
      const response = await fetchImpl(`${base}content/${entry.path}`);
      if (!response.ok) throw new Error(`content ${id} failed (${response.status})`);
      return response.json() as Promise<unknown>;
    },
  };
}
