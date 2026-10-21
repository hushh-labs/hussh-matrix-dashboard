// The legacy sync worker needs time to receive the server's final checkpoint.
export const PLG_SYNC_REQUEST_TIMEOUT_MS = 180_000;
export const PLG_SYNC_BUDGET_MS = PLG_SYNC_REQUEST_TIMEOUT_MS - 20_000;
