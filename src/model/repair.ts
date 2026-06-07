/**
 * Browser-side facade for the silent source-repair endpoint.
 *
 * The store's `commitSource` calls this when a mutating action (Delete,
 * per-instance edit) produces source that throws at runtime. Network/
 * provider failures map to `unavailable` / `error` — the caller treats
 * any non-success the same way: fall back to the previous source.
 */

export interface RepairRequest {
  readonly previous: string;
  readonly proposed: string;
  readonly error: string;
}

export type RepairResult =
  | { readonly status: 'success'; readonly source: string; readonly message: string }
  | { readonly status: 'unavailable'; readonly message: string }
  | { readonly status: 'error'; readonly message: string };

export async function repairSource(req: RepairRequest): Promise<RepairResult> {
  let res: Response;
  try {
    res = await fetch('/api/repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req),
    });
  } catch (err) {
    return {
      status: 'error',
      message: err instanceof Error ? err.message : 'Network error',
    };
  }

  const json = (await res.json().catch(() => null)) as RepairResult | null;
  if (!json || typeof json !== 'object' || !('status' in json)) {
    return { status: 'error', message: `Bad response from /api/repair (HTTP ${res.status}).` };
  }
  return json;
}
