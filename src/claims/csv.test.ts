import { describe, expect, it } from 'vitest';
import { claimFixture } from '../../tests/fixtures/claims';
import { claimsToCsv } from './csv';

function withName(name: string) {
  const claim = claimFixture();
  return { ...claim, prizeName: name, participation: { ...claim.participation, outcome: { ...claim.participation.outcome,
    segment: { ...claim.participation.outcome.segment, label: { ...claim.participation.outcome.segment.label, fr: name } } } } };
}
describe('CSV export', () => {
  it('includes UTF-8 BOM, stable headers, CRLF rows and ISO timestamps', () => {
    const csv = claimsToCsv([claimFixture()]);
    expect(csv).toBe('\uFEFF"claim_id","visitor_id","prize_id","prize_name","language","email","won_at","claimed_at"\r\n'
      + '"00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000001","dessert","Un dessert offert","fr","winner@example.com","2026-10-23T12:00:00.000Z","2026-10-23T12:01:00.000Z"\r\n');
    expect(new TextDecoder().decode(new TextEncoder().encode(csv))).toContain('Un dessert offert');
  });
  it('exports headers when this browser contains no claims', () => { expect(claimsToCsv([]).split('\r\n')).toHaveLength(2); });
  it('quotes commas, quotes, CR/LF and preserves accented text', () => {
    expect(claimsToCsv([withName('Café, "offert"\r\nÀ déguster')])).toContain('"Café, ""offert""\r\nÀ déguster"');
  });
  it.each(['=1+1', '+SUM(A1)', '-2+3', '@SUM(A1)', '  =1+1', '\t=1+1', '\r=1+1', '\n=1+1', '\uFEFF=1+1', '\u0000=1+1', '＝1+1', '\ttext'])('neutralizes spreadsheet formulas: %j', (name) => {
    const escaped = name.replaceAll('"', '""');
    expect(claimsToCsv([withName(name)])).toContain(`"'${escaped}"`);
  });
  it('protects valid email addresses beginning with formula operators', () => {
    expect(claimsToCsv([claimFixture('=gift@example.com')])).toContain('"\'=gift@example.com"');
    expect(claimsToCsv([claimFixture('+gift@example.com')])).toContain('"\'+gift@example.com"');
  });
  it('protects generated control/whitespace prefixes combined with every supported formula operator', () => {
    const prefixes = ['', ' ', '\u00a0', '\uFEFF', ...Array.from({ length: 32 }, (_, code) => String.fromCharCode(code)), '\u007f', '\u0085'];
    for (const prefix of prefixes) {
      for (const operator of ['=', '+', '-', '@', '＝', '＋', '－', '＠']) {
        const name = `${prefix}${operator}SUM(1,2)\r\n"Café"`;
        const claim = withName(name);
        expect(claimsToCsv([claim])).toContain(`"'${name.replaceAll('"', '""')}"`);
        expect(claim.prizeName).toBe(name);
      }
    }
  });
  it('never changes the stored records when escaping cells', () => {
    const claim = withName('=1+1');
    claimsToCsv([claim]);
    expect(claim.prizeName).toBe('=1+1');
  });
  it('sorts export rows deterministically by claim time and stable id', () => {
    const early = claimFixture(); const late = { ...early, claimedAt: '2026-10-23T13:00:00.000Z' };
    const csv = claimsToCsv([late, early]);
    expect(csv.indexOf(early.claimedAt)).toBeLessThan(csv.indexOf(late.claimedAt));
  });
});
