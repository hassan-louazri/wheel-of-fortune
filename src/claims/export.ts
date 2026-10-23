import { claimsToCsv } from './csv';
import { listClaims } from './database';

export async function exportClaimsCsv(): Promise<string> {
  return claimsToCsv(await listClaims());
}
export async function downloadClaimsCsv(): Promise<void> {
  const csv = await exportClaimsCsv();
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `wheel-claims-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.append(link);
  try { link.click(); }
  finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
}
