export interface BuildSearchItem {
  id: number;
  category: number;
  name: string;
  outputs?: readonly string[];
  keywords?: readonly string[];
  description?: string;
}

const normalize = (text: string) => text.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/['’]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = (text: string) => normalize(text).split(' ');

/** Direct names come first, then aliases and outputs, then description and category terms. */
export function buildSearch(items: readonly BuildSearchItem[]) {
  const index = items.map(({ id, category, name, outputs = [], keywords = [], description = '' }) => {
    const title = normalize(name), compact = title.replaceAll(' ', '');
    const primary = [...title.split(' '), ...keywords.flatMap(words)];
    return { id, category, title, compact, outputs: outputs.map(normalize), primary, secondary: [...primary, ...words(description)] };
  });
  return (query: string, category: number) => {
    const text = normalize(query), compact = text.replaceAll(' ', ''), terms = text.split(' ');
    const matches = (haystack: string[]) => terms.every(term => haystack.some(word => word.startsWith(term)));
    const score = (item: typeof index[number]) => {
      if (!text || item.title === text || item.compact === compact) return 0;
      if (item.outputs.some(out => out.replaceAll(' ', '') === compact)) return 1;
      if (item.title.startsWith(text) || item.compact.startsWith(compact)) return 2;
      if (item.outputs.some(out => matches(out.split(' ')))) return 3;
      if (terms.every(term => item.title.includes(term))) return 4;
      if (matches(item.primary)) return 5;
      return matches(item.secondary) ? 6 : -1;
    };
    return index.filter(item => category < 0 || item.category === category)
      .map(item => ({ id: item.id, score: score(item) })).filter(item => item.score >= 0)
      .sort((a, b) => a.score - b.score).map(item => item.id);
  };
}
