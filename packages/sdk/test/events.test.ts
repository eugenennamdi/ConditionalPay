import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { hash } from 'starknet';
import {
  EVENT_SELECTORS,
  parseConditionalPayEvent,
  parseConditionalPayEvents,
  RawStarknetEvent,
} from '../src/events.js';
import { normalizeFelt } from '../src/hashing.js';

describe('ConditionalPay Event Parsing', () => {
  const conditionalPay = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const unrelatedContract = '0x0999999999999999999999999999999999999999999999999999999999999999';
  const token = '0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d';
  const paymentId = '0x5f63ac970629bfb6539bb18df38d3a34cf8ff7e1ed9a2300d8315f38f5d166';

  it('proves event selectors match hash.getSelectorFromName canonical derivations', () => {
    assert.equal(EVENT_SELECTORS.PaymentCreated, hash.getSelectorFromName('PaymentCreated'));
    assert.equal(EVENT_SELECTORS.PaymentClaimed, hash.getSelectorFromName('PaymentClaimed'));
    assert.equal(EVENT_SELECTORS.PaymentRefunded, hash.getSelectorFromName('PaymentRefunded'));
    assert.equal(EVENT_SELECTORS.PaymentApproved, hash.getSelectorFromName('PaymentApproved'));
  });

  describe('parseConditionalPayEvent', () => {
    it('parses PaymentCreated event correctly', () => {
      const rawEvent: RawStarknetEvent = {
        from_address: conditionalPay,
        keys: [EVENT_SELECTORS.PaymentCreated, paymentId],
        data: [
          token, // 0: token
          '0xde0b6b3a7640000', // 1: amount (1 STRK)
          '0x7b52c408bddeaaf8cc36a4c6c3bfd24c7a0e7b241b9fcad83c2c8173cd01261', // 2: hashlock
          '0x30c804f6f6b24dd19f29ff4bc2b54f1f44cb336a90dca293b80b413c0599ac5', // 3: refund_hash
          '0x64', // 4: claim_after (100)
          '0x12c', // 5: expires_at (300)
          '0x0', // 6: approver (0x0)
          '0x1', // 7: nonce (1)
        ],
      };

      const parsed = parseConditionalPayEvent(rawEvent, conditionalPay);
      assert.ok(parsed);
      assert.equal(parsed.type, 'PaymentCreated');
      if (parsed.type === 'PaymentCreated') {
        assert.equal(parsed.payment_id, normalizeFelt(paymentId));
        assert.equal(parsed.token, normalizeFelt(token));
        assert.equal(parsed.amount, 1000000000000000000n);
        assert.equal(parsed.claim_after, 100n);
        assert.equal(parsed.expires_at, 300n);
        assert.equal(parsed.approver, '0x0');
        assert.equal(parsed.nonce, '0x1');
      }
    });

    it('parses PaymentClaimed event correctly', () => {
      const rawEvent: RawStarknetEvent = {
        from_address: conditionalPay,
        keys: [EVENT_SELECTORS.PaymentClaimed, paymentId],
        data: [],
      };

      const parsed = parseConditionalPayEvent(rawEvent, conditionalPay);
      assert.ok(parsed);
      assert.equal(parsed.type, 'PaymentClaimed');
      assert.equal(parsed.payment_id, normalizeFelt(paymentId));
    });

    it('parses PaymentRefunded event correctly', () => {
      const rawEvent: RawStarknetEvent = {
        from_address: conditionalPay,
        keys: [EVENT_SELECTORS.PaymentRefunded, paymentId],
        data: [],
      };

      const parsed = parseConditionalPayEvent(rawEvent, conditionalPay);
      assert.ok(parsed);
      assert.equal(parsed.type, 'PaymentRefunded');
      assert.equal(parsed.payment_id, normalizeFelt(paymentId));
    });

    it('parses PaymentApproved event correctly', () => {
      const rawEvent: RawStarknetEvent = {
        from_address: conditionalPay,
        keys: [EVENT_SELECTORS.PaymentApproved, paymentId],
        data: [],
      };

      const parsed = parseConditionalPayEvent(rawEvent, conditionalPay);
      assert.ok(parsed);
      assert.equal(parsed.type, 'PaymentApproved');
      assert.equal(parsed.payment_id, normalizeFelt(paymentId));
    });

    it('safely returns null for unrelated contract events or unknown selectors', () => {
      // 1. Unknown selector
      const unknownEvent: RawStarknetEvent = {
        from_address: conditionalPay,
        keys: ['0x123456789abcdef', paymentId],
        data: [],
      };
      assert.equal(parseConditionalPayEvent(unknownEvent, conditionalPay), null);

      // 2. Mismatching contract address
      const wrongAddressEvent: RawStarknetEvent = {
        from_address: unrelatedContract,
        keys: [EVENT_SELECTORS.PaymentClaimed, paymentId],
        data: [],
      };
      assert.equal(parseConditionalPayEvent(wrongAddressEvent, conditionalPay), null);

      // 3. Malformed keys array (< 2 keys)
      const shortKeysEvent: RawStarknetEvent = {
        from_address: conditionalPay,
        keys: [EVENT_SELECTORS.PaymentClaimed],
        data: [],
      };
      assert.equal(parseConditionalPayEvent(shortKeysEvent, conditionalPay), null);
    });

    it('throws on malformed data for PaymentCreated event (too few data felts)', () => {
      const malformedDataEvent: RawStarknetEvent = {
        from_address: conditionalPay,
        keys: [EVENT_SELECTORS.PaymentCreated, paymentId],
        data: [token, '0x100'], // Only 2 data felts instead of 8
      };

      assert.throws(
        () => parseConditionalPayEvent(malformedDataEvent, conditionalPay),
        /Malformed PaymentCreated event: expected 8 data felts/,
      );
    });
  });

  describe('parseConditionalPayEvents (batch parsing)', () => {
    it('filters and parses only matching ConditionalPay events from mixed raw events', () => {
      const rawEvents: RawStarknetEvent[] = [
        // 1. Valid PaymentCreated
        {
          from_address: conditionalPay,
          keys: [EVENT_SELECTORS.PaymentCreated, paymentId],
          data: [
            token,
            '0xde0b6b3a7640000',
            '0x7b52c408bddeaaf8cc36a4c6c3bfd24c7a0e7b241b9fcad83c2c8173cd01261',
            '0x30c804f6f6b24dd19f29ff4bc2b54f1f44cb336a90dca293b80b413c0599ac5',
            '0x64',
            '0x12c',
            '0x0',
            '0x1',
          ],
        },
        // 2. Unrelated contract event (ignored)
        {
          from_address: unrelatedContract,
          keys: [EVENT_SELECTORS.PaymentClaimed, paymentId],
          data: [],
        },
        // 3. Valid PaymentClaimed
        {
          from_address: conditionalPay,
          keys: [EVENT_SELECTORS.PaymentClaimed, paymentId],
          data: [],
        },
      ];

      const parsed = parseConditionalPayEvents(rawEvents, conditionalPay);
      assert.equal(parsed.length, 2);
      assert.equal(parsed[0].type, 'PaymentCreated');
      assert.equal(parsed[1].type, 'PaymentClaimed');
    });
  });
});
