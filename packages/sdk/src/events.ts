import { hash } from 'starknet';
import {
  validateContractAddress,
  validateFelt,
  validateU128,
  validateU64,
} from './encoding.js';
import { normalizeFelt } from './hashing.js';

/**
 * Canonically computed event selectors for ConditionalPay lifecycle events.
 * Computed via `hash.getSelectorFromName(eventName)`.
 */
export const EVENT_SELECTORS = {
  PaymentCreated: hash.getSelectorFromName('PaymentCreated'),
  PaymentClaimed: hash.getSelectorFromName('PaymentClaimed'),
  PaymentRefunded: hash.getSelectorFromName('PaymentRefunded'),
  PaymentApproved: hash.getSelectorFromName('PaymentApproved'),
} as const;

/**
 * Parsed PaymentCreated event data.
 * Emitted by ConditionalPay upon successful CREATE invocation.
 */
export interface PaymentCreatedEvent {
  type: 'PaymentCreated';
  payment_id: string; // felt252 (from keys[1])
  token: string; // ContractAddress (from data[0])
  amount: bigint; // u128 (from data[1])
  hashlock: string; // felt252 (from data[2])
  refund_hash: string; // felt252 (from data[3])
  claim_after: bigint; // u64 timestamp (from data[4])
  expires_at: bigint; // u64 timestamp (from data[5])
  approver: string; // ContractAddress (from data[6])
  nonce: string; // felt252 (from data[7])
}

/**
 * Parsed PaymentClaimed event data.
 * Emitted by ConditionalPay upon successful CLAIM invocation.
 */
export interface PaymentClaimedEvent {
  type: 'PaymentClaimed';
  payment_id: string; // felt252 (from keys[1])
}

/**
 * Parsed PaymentRefunded event data.
 * Emitted by ConditionalPay upon successful REFUND invocation.
 */
export interface PaymentRefundedEvent {
  type: 'PaymentRefunded';
  payment_id: string; // felt252 (from keys[1])
}

/**
 * Parsed PaymentApproved event data.
 * Emitted by ConditionalPay upon successful approver invocation.
 */
export interface PaymentApprovedEvent {
  type: 'PaymentApproved';
  payment_id: string; // felt252 (from keys[1])
}

/**
 * Discriminated union of all ConditionalPay lifecycle events.
 */
export type ConditionalPayEvent =
  | PaymentCreatedEvent
  | PaymentClaimedEvent
  | PaymentRefundedEvent
  | PaymentApprovedEvent;

/**
 * Generic Starknet event structure returned by RPC / Starknet.js queries.
 */
export interface RawStarknetEvent {
  from_address?: string;
  keys: string[];
  data: string[];
}

/**
 * Parses a single raw Starknet event into a typed ConditionalPay event.
 *
 * TRUST BOUNDARY NOTICE:
 * - Calling `parseConditionalPayEvent(event)` without `expectedConditionalPay` parses event structure
 *   and selectors ONLY, and does NOT verify the emitting contract provenance.
 * - Supplying `expectedConditionalPay` enforces origin authentication, ensuring the event was emitted
 *   by the specified ConditionalPay contract address (events from other addresses return `null`).
 *
 * @param rawEvent The raw event with keys and data.
 * @param expectedConditionalPay Optional contract address to filter against.
 *                                When provided, events from other addresses return `null`.
 * @returns Parsed `ConditionalPayEvent` or `null` if the event does not belong to ConditionalPay.
 */
export function parseConditionalPayEvent(
  rawEvent: RawStarknetEvent,
  expectedConditionalPay?: string,
): ConditionalPayEvent | null {
  if (!rawEvent || !rawEvent.keys || rawEvent.keys.length < 2) {
    return null;
  }

  // Contract address boundary check: ensure event originates from intended ConditionalPay contract
  if (expectedConditionalPay !== undefined && rawEvent.from_address !== undefined) {
    try {
      const eventAddr = normalizeFelt(rawEvent.from_address);
      const expectedAddr = normalizeFelt(expectedConditionalPay);
      if (eventAddr !== expectedAddr) {
        return null;
      }
    } catch {
      return null;
    }
  }

  let selector: string;
  let payment_id: string;
  try {
    selector = normalizeFelt(rawEvent.keys[0]);
    payment_id = normalizeFelt(rawEvent.keys[1]);
    validateFelt(payment_id, 'payment_id');
  } catch {
    return null;
  }

  // 1. PaymentCreated
  if (selector === normalizeFelt(EVENT_SELECTORS.PaymentCreated)) {
    if (!rawEvent.data || rawEvent.data.length < 8) {
      throw new Error(
        `Malformed PaymentCreated event: expected 8 data felts, received ${rawEvent.data ? rawEvent.data.length : 0}`,
      );
    }

    const token = normalizeFelt(rawEvent.data[0]);
    validateContractAddress(token, 'token');

    const amount = validateU128(rawEvent.data[1], 'amount');
    const hashlock = normalizeFelt(rawEvent.data[2]);
    const refund_hash = normalizeFelt(rawEvent.data[3]);
    const claim_after = validateU64(rawEvent.data[4], 'claim_after');
    const expires_at = validateU64(rawEvent.data[5], 'expires_at');
    const approver = normalizeFelt(rawEvent.data[6]);
    validateContractAddress(approver, 'approver');
    const nonce = normalizeFelt(rawEvent.data[7]);

    return {
      type: 'PaymentCreated',
      payment_id,
      token,
      amount,
      hashlock,
      refund_hash,
      claim_after,
      expires_at,
      approver,
      nonce,
    };
  }

  // 2. PaymentClaimed
  if (selector === normalizeFelt(EVENT_SELECTORS.PaymentClaimed)) {
    return {
      type: 'PaymentClaimed',
      payment_id,
    };
  }

  // 3. PaymentRefunded
  if (selector === normalizeFelt(EVENT_SELECTORS.PaymentRefunded)) {
    return {
      type: 'PaymentRefunded',
      payment_id,
    };
  }

  // 4. PaymentApproved
  if (selector === normalizeFelt(EVENT_SELECTORS.PaymentApproved)) {
    return {
      type: 'PaymentApproved',
      payment_id,
    };
  }

  // Not a known ConditionalPay event
  return null;
}

/**
 * Parses an array of raw Starknet events, filtering and returning only valid ConditionalPay events.
 *
 * @param events Array of raw Starknet events.
 * @param expectedConditionalPay Optional contract address to filter against for origin authentication.
 * @returns Array of parsed `ConditionalPayEvent`s.
 */
export function parseConditionalPayEvents(
  events: RawStarknetEvent[],
  expectedConditionalPay?: string,
): ConditionalPayEvent[] {
  if (!Array.isArray(events)) {
    return [];
  }

  const parsed: ConditionalPayEvent[] = [];
  for (const event of events) {
    const item = parseConditionalPayEvent(event, expectedConditionalPay);
    if (item !== null) {
      parsed.push(item);
    }
  }
  return parsed;
}
