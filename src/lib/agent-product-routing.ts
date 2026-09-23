/** Pure product routing shared by the analyst's tools and deterministic path. */
export type ProductKey = 'hushh.ai' | 'one.hushh.ai' | 'uat.one.hushh.ai' | 'hushhtech.com';

export function productFromValue(value: unknown): ProductKey | 'all' {
  const raw = String(value ?? 'all').toLowerCase().trim();
  if (raw === 'all') return 'all';
  // One hosts must win before the generic hushh.ai suffix.
  if (raw.includes('uat.one.hushh.ai') || raw.includes('one uat')) return 'uat.one.hushh.ai';
  if (raw.includes('one.hushh.ai') || raw.includes('one production') || raw === 'one') return 'one.hushh.ai';
  // Retain historical aliases only for old analyst messages/tool results.
  if (raw.includes('uat.kai') || (raw.includes('kai') && raw.includes('uat'))) return 'uat.one.hushh.ai';
  if (raw.includes('hushhtech')) return 'hushhtech.com';
  if (raw.includes('kai')) return 'one.hushh.ai';
  if (raw.includes('hushh.ai') || raw.includes('hushhai') || raw.includes('hushh ai')) return 'hushh.ai';
  return 'all';
}

export function inferProductFromQuestion(text: string): ProductKey | 'all' {
  const lower = text.toLowerCase();
  if (lower.includes('hushhtech')) return 'hushhtech.com';
  if (lower.includes('uat.one.hushh.ai') || /\bone\s+uat\b/.test(lower)) return 'uat.one.hushh.ai';
  if (lower.includes('one.hushh.ai') || /\bone\s+(?:app|production)\b/.test(lower)) return 'one.hushh.ai';
  if (lower.includes('kai')) return 'one.hushh.ai';
  if (lower.includes('hushh.ai') || lower.includes('hushh ai')) return 'hushh.ai';
  return 'all';
}

export function isOneEnvironmentSplitQuestion(text: string): boolean {
  const lower = text.toLowerCase();
  if (!/\b(?:one|kai)\b/.test(lower)
    || !/\buat\b/.test(lower)
    || !/\b(?:production|prod|public\s+(?:build|app))\b/.test(lower)) return false;
  // Merely selecting either environment is not a split request. The
  // comparison word and both sides must be explicit (or present in the
  // conversation context); word boundaries avoid matching "product".
  return /\b(?:compare|compares|compared|comparing|comparison|contrast|contrasts|contrasted|contrasting|versus|vs|split|separate|separately|difference|differences|different|differently|differ|differs|differed|differing)\b/.test(lower);
}
