const UNIT = 10 * 1024 ** 2;
type Ref = { projectId?: string | null; datasetId?: string | null; tableId?: string | null };
type CatalogTable = { id: string; type: string };
export type Catalog = (project: string, dataset: string) => Promise<CatalogTable[]>;

/** A conservative upper bound for the on-demand per-table billing minimum. */
export async function conservativeBillingBound(processed: number, refs: Ref[], catalog: Catalog): Promise<number> {
  if (!Number.isSafeInteger(processed) || processed < 0 || !Array.isArray(refs) || refs.length > 1000) throw new Error('Unverified dry-run billing bound.');
  if (processed > 0 && refs.length === 0) throw new Error('Missing referenced tables.');
  const datasets = new Map<string, CatalogTable[]>(), matched = new Set<string>();
  for (const ref of refs) {
    const { projectId, datasetId, tableId } = ref;
    if (!projectId || !datasetId || !tableId || !/^[A-Za-z0-9_.:*\-]+$/.test(tableId)) throw new Error('Unverified referenced table.');
    const key = `${projectId}:${datasetId}`;
    // INFORMATION_SCHEMA.TABLES is a single non-cached metadata view with a
    // 10 MiB query minimum, not a physical wildcard over its returned rows.
    if (tableId === 'INFORMATION_SCHEMA.TABLES') { matched.add(`${key}:${tableId}`); continue; }
    if (!datasets.has(key)) datasets.set(key, await catalog(projectId, datasetId));
    const tables = datasets.get(key)!;
    const parts = tableId.split('*');
    if (parts.length > 2) throw new Error('Unverified table wildcard.');
    const matches = parts.length === 1 ? tables.filter(t => t.id === tableId)
      : tables.filter(t => t.id.startsWith(parts[0]) && t.id.endsWith(parts[1]));
    if (!matches.length || matches.some(t => !['TABLE', 'SNAPSHOT', 'CLONE'].includes(t.type))) throw new Error('Unverified table coverage.');
    for (const table of matches) matched.add(`${key}:${table.id}`);
    if (matched.size > 10_000) throw new Error('Referenced table bound exceeded.');
  }
  const bound = Math.max(UNIT, Math.ceil(processed / UNIT) * UNIT + matched.size * UNIT);
  if (!Number.isSafeInteger(bound)) throw new Error('Invalid billing bound.');
  return bound;
}
