import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toSqlTime } from '../src/time.js';

describe('toSqlTime', () => {
  it('converts with client offset correctly', () => {
    // 2024-01-01 09:30 at UTC-5 should become 14:30 UTC
    const out = toSqlTime('2024-01-01 09:30', 300);
    assert.equal(out, '2024-01-01 14:30:00');
  });

  it('rejects invalid input', () => {
    assert.throws(() => toSqlTime('bad-date', 0));
  });

  it('defaults to server timezone when offset missing', () => {
    const out = toSqlTime('2024-01-01 00:00');
    assert.match(out, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});
