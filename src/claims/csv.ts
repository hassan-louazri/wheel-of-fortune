import { parseClaim } from './claim';
import type { Claim } from './claim';

const HEADERS = ['claim_id', 'visitor_id', 'prize_id', 'prize_name', 'language', 'email', 'won_at', 'claimed_at'];
function cell(value: string): string {
  // Quoting alone does not stop spreadsheet formula evaluation, including after leading whitespace/control characters.
  const safe = /^[\s\u0000-\u001f\u007f-\u009f]*[=+\-@＝＋－＠]/u.test(value) || /^[\t\r\n]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function claimsToCsv(values: readonly Claim[]): string {
  const rows = [...values].map(parseClaim).sort((a, b) => a.claimedAt.localeCompare(b.claimedAt) || a.id.localeCompare(b.id)).map((claim) => [
    claim.id, claim.visitorId, claim.prizeId, claim.prizeName, claim.language, claim.email, claim.wonAt, claim.claimedAt,
  ]);
  return '\uFEFF' + [HEADERS, ...rows].map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n';
}
