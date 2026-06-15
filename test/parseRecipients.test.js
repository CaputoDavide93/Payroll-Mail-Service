import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRecipients } from '../src/parseRecipients.js';

describe('parseRecipients', () => {
  it('parses valid rows and skips invalid/duplicate emails', () => {
    const csv = Buffer.from('name,email\nAlice,alice@example.com\nBad,bad-email\nDup,alice@example.com');
    const { recipients, errors } = parseRecipients(csv);
    assert.equal(recipients.length, 1);
    assert.equal(recipients[0].email, 'alice@example.com');
    assert.ok(errors.length >= 2);
  });

  it('errors when no email column', () => {
    const csv = Buffer.from('name,mailbox\nA,a@example.com');
    const result = parseRecipients(csv);
    assert.equal(result.recipients.length, 0);
    assert.match(result.errors[0], /No email column/);
  });
});
