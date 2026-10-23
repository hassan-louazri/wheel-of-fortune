import { describe, expect, it } from 'vitest';
import { claimFixture } from '../../tests/fixtures/claims';
import { participationFixture, testNow } from '../../tests/fixtures/participation';
import { assertSameAward, createClaim, parseClaim } from './claim';

describe('claim snapshots', () => {
  it('uses the winning UUID as the stable claim id and captures localized names and ISO timestamps', () => {
    const state = participationFixture('pending_claim');
    const claim = createClaim(state, ' Winner@EXAMPLE.COM ', 'en', testNow + 60000);
    expect(claim).toMatchObject({ version: 1, id: '00000000-0000-4000-8000-000000000002', visitorId: state.visitorId,
      prizeId: 'dessert', prizeName: 'A free dessert', language: 'en', email: 'Winner@example.com',
      wonAt: '2026-10-23T12:00:00.000Z', claimedAt: '2026-10-23T12:01:00.000Z', participation: { status: 'completed' } });
    expect(state.status).toBe('pending_claim');
    expect(JSON.stringify(claim.participation)).not.toContain('Winner@example.com');
  });
  it('rejects invalid email and states without an awarded prize', () => {
    expect(() => createClaim(participationFixture('pending_claim'), 'invalid', 'fr', testNow)).toThrow('emailInvalid');
    expect(() => createClaim(participationFixture('ready'), 'a@example.com', 'fr', testNow)).toThrow('claimRecordError');
  });
  it.each([null, [], {}, { ...claimFixture(), version: 2 }, { ...claimFixture(), email: 'invalid' },
    { ...claimFixture(), id: 'wrong' }, { ...claimFixture(), visitorId: 'wrong' }, { ...claimFixture(), prizeId: 'wrong' },
    { ...claimFixture(), prizeName: 'Changed award' }, { ...claimFixture(), language: 'es' },
    { ...claimFixture(), claimedAt: 'invalid' }, { ...claimFixture(), wonAt: '2026-10-23T12:00:01.000Z' },
  ])('rejects corrupted or unsupported records', (row) => { expect(() => parseClaim(row)).toThrow('claimRecordError'); });
  it('rejects a different winning outcome for an existing visitor', () => {
    const state = participationFixture('pending_claim');
    if (state.status !== 'pending_claim') throw new Error('fixture');
    expect(() => assertSameAward({ ...state, outcome: { ...state.outcome, id: state.visitorId } }, claimFixture())).toThrow('claimRecordError');
  });
});
