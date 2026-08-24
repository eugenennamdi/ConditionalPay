import { normalizeFelt } from './hashing.js';
import { validateFelt } from './encoding.js';

/**
 * Standard PBKDF2 iteration count recommended by OWASP for PBKDF2-HMAC-SHA256 password derivation.
 */
export const DEFAULT_PBKDF2_ITERATIONS = 600_000;

/**
 * Generates a cryptographically secure random felt252 suitable for preimages and secrets.
 * Each bearer credential contains 248 bits of CSPRNG entropy (0 <= credential < 2^248 < PRIME)
 * and is sampled without modulo bias. Security additionally relies on the Poseidon hash
 * assumptions used by the frozen Cairo contract.
 *
 * @param customEntropy Optional function returning a 31-byte Uint8Array (for deterministic testing).
 * @returns Hex-encoded felt252 string (e.g. '0x...')
 */
export function generateSecurePreimage(customEntropy?: () => Uint8Array): string {
  const bytes = customEntropy ? customEntropy() : new Uint8Array(31);
  if (!customEntropy) {
    if (typeof globalThis.crypto?.getRandomValues !== 'function') {
      throw new Error(
        'Cryptographically secure random generator (crypto.getRandomValues) is unavailable',
      );
    }
    globalThis.crypto.getRandomValues(bytes);
  }
  if (bytes.length !== 31) {
    throw new RangeError(`Expected 31 bytes of entropy, received ${bytes.length}`);
  }

  let hex = '0x';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return normalizeFelt(hex);
}

/**
 * Generates a unique client nonce using 16 bytes (128 bits) of cryptographic entropy.
 *
 * @param customEntropy Optional function returning a 16-byte Uint8Array (for deterministic testing).
 * @returns Hex-encoded felt252 nonce string.
 */
export function generateSecureNonce(customEntropy?: () => Uint8Array): string {
  const bytes = customEntropy ? customEntropy() : new Uint8Array(16);
  if (!customEntropy) {
    if (typeof globalThis.crypto?.getRandomValues !== 'function') {
      throw new Error(
        'Cryptographically secure random generator (crypto.getRandomValues) is unavailable',
      );
    }
    globalThis.crypto.getRandomValues(bytes);
  }
  if (bytes.length !== 16) {
    throw new RangeError(`Expected 16 bytes of entropy, received ${bytes.length}`);
  }

  let hex = '0x';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return normalizeFelt(hex);
}

/**
 * Bearer credential bundle for an active execution flow (historical dual-payment bundle).
 */
export interface BearerCredentialBundle {
  paymentA: {
    paymentId: string;
    claimPreimage: string;
    refundPreimage: string;
    nonce: string;
  };
  paymentB: {
    paymentId: string;
    claimPreimage: string;
    refundPreimage: string;
    nonce: string;
  };
}

/**
 * Bearer credentials for a single ConditionalPay payment.
 * Console-oriented: one payment at a time.
 */
export interface SinglePaymentCredentials {
  paymentId: string;
  claimPreimage: string;
  refundPreimage: string;
  nonce: string;
}

/**
 * User-controlled password-encrypted envelope for safe credential backup & recovery (historical v1.0).
 */
export interface EncryptedCredentialEnvelope {
  version: '1.0';
  cipher: 'AES-GCM-256';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltHex: string; // 16 bytes
  ivHex: string; // 12 bytes
  ciphertextHex: string;
}

/**
 * Bearer credentials for claiming a single ConditionalPay payment.
 * Contains only the payment ID and claim secret.
 * Strictly excludes refund secrets, nonces, and creator recovery credentials.
 */
export interface ClaimAccessCredentials {
  paymentId: string;
  claimPreimage: string;
}

/**
 * User-controlled password-encrypted envelope for safe single-payment credential backup & recovery (v1.1).
 */
export interface SinglePaymentEncryptedEnvelope {
  version: '1.1';
  cipher: 'AES-GCM-256';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltHex: string; // 16 bytes
  ivHex: string; // 12 bytes
  ciphertextHex: string;
}

/**
 * User-controlled password-encrypted envelope for claimant capability handoff (v1.2).
 */
export interface ClaimAccessEncryptedEnvelope {
  version: '1.2';
  cipher: 'AES-GCM-256';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltHex: string; // 16 bytes
  ivHex: string; // 12 bytes
  ciphertextHex: string;
}

function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array<ArrayBuffer> {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('Invalid hex string length');
  }
  const buffer = new ArrayBuffer(clean.length / 2);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < clean.length; i += 2) {
    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
  }
  return bytes;
}

function isValidFeltString(val: unknown): boolean {
  if (typeof val !== 'string') return false;
  try {
    validateFelt(val, 'felt');
    return true;
  } catch {
    return false;
  }
}

function isBearerCredentialBundle(data: unknown): data is BearerCredentialBundle {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  return Boolean(
    d.paymentA &&
      typeof d.paymentA === 'object' &&
      d.paymentB &&
      typeof d.paymentB === 'object',
  );
}

function isSinglePaymentCredentials(data: unknown): data is SinglePaymentCredentials {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  const keys = Object.keys(d);
  if (keys.length !== 4) return false;
  if (
    !keys.includes('paymentId') ||
    !keys.includes('claimPreimage') ||
    !keys.includes('refundPreimage') ||
    !keys.includes('nonce')
  ) {
    return false;
  }
  return (
    isValidFeltString(d.paymentId) &&
    isValidFeltString(d.claimPreimage) &&
    isValidFeltString(d.refundPreimage) &&
    isValidFeltString(d.nonce)
  );
}

function isClaimAccessCredentials(data: unknown): data is ClaimAccessCredentials {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
  const d = data as Record<string, unknown>;
  const keys = Object.keys(d);
  if (keys.length !== 2) return false;
  if (!keys.includes('paymentId') || !keys.includes('claimPreimage')) return false;
  return isValidFeltString(d.paymentId) && isValidFeltString(d.claimPreimage);
}

async function encryptEnvelopePayload<V extends '1.0' | '1.1' | '1.2'>(
  payload: unknown,
  version: V,
  passphrase: string,
  iterations: number,
): Promise<{
  version: V;
  cipher: 'AES-GCM-256';
  kdf: 'PBKDF2-SHA256';
  iterations: number;
  saltHex: string;
  ivHex: string;
  ciphertextHex: string;
}> {
  if (!passphrase || passphrase.length < 8) {
    throw new Error('Passphrase must be at least 8 characters long');
  }
  if (typeof iterations !== 'number' || iterations < 1000 || !Number.isInteger(iterations)) {
    throw new RangeError(`Invalid PBKDF2 iteration count: ${iterations}`);
  }

  const saltBuffer = new ArrayBuffer(16);
  const salt = new Uint8Array(saltBuffer);
  const ivBuffer = new ArrayBuffer(12);
  const iv = new Uint8Array(ivBuffer);
  globalThis.crypto.getRandomValues(salt);
  globalThis.crypto.getRandomValues(iv);

  const encoder = new TextEncoder();
  const passwordKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  const aesKey = await globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );

  const plaintext = encoder.encode(JSON.stringify(payload));
  const encrypted = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    plaintext,
  );

  return {
    version,
    cipher: 'AES-GCM-256',
    kdf: 'PBKDF2-SHA256',
    iterations,
    saltHex: bytesToHex(salt),
    ivHex: bytesToHex(iv),
    ciphertextHex: bytesToHex(new Uint8Array(encrypted)),
  };
}

async function decryptEnvelopePayload<T>(
  envelope: {
    version: string;
    cipher: string;
    iterations: number;
    saltHex: string;
    ivHex: string;
    ciphertextHex: string;
  },
  expectedVersion: '1.0' | '1.1' | '1.2',
  passphrase: string,
  validator: (data: unknown) => data is T,
): Promise<T> {
  if (envelope.version !== expectedVersion || envelope.cipher !== 'AES-GCM-256') {
    throw new Error(`Unsupported envelope format: ${envelope.cipher} v${envelope.version}`);
  }
  if (typeof envelope.iterations !== 'number' || envelope.iterations < 1000) {
    throw new RangeError(`Invalid PBKDF2 iteration count in envelope: ${envelope.iterations}`);
  }

  const salt = hexToBytes(envelope.saltHex);
  const iv = hexToBytes(envelope.ivHex);
  const ciphertext = hexToBytes(envelope.ciphertextHex);

  const encoder = new TextEncoder();
  const passwordKey = await globalThis.crypto.subtle.importKey(
    'raw',
    encoder.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  const aesKey = await globalThis.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations: envelope.iterations,
      hash: 'SHA-256',
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );

  try {
    const decrypted = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      aesKey,
      ciphertext,
    );

    const decoder = new TextDecoder();
    const parsed = JSON.parse(decoder.decode(decrypted));
    if (!validator(parsed)) {
      throw new Error('Failed to decrypt credentials: corrupted or unexpected payload schema');
    }
    return parsed;
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('corrupted or unexpected payload schema')) {
      throw err;
    }
    throw new Error('Failed to decrypt credentials: invalid passphrase or corrupted envelope');
  }
}

/**
 * Exports bearer credentials to a secure password-encrypted envelope (AES-GCM-256 + PBKDF2-SHA256).
 *
 * @param bundle Bearer credential bundle to encrypt.
 * @param passphrase User passphrase used to derive the 256-bit AES-GCM encryption key.
 * @param iterations Optional iteration count (defaults to OWASP-recommended 600,000).
 * @returns Encrypted envelope safe for user-controlled offline backup.
 */
export async function exportEncryptedCredentials(
  bundle: BearerCredentialBundle,
  passphrase: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<EncryptedCredentialEnvelope> {
  return encryptEnvelopePayload(bundle, '1.0', passphrase, iterations);
}

/**
 * Imports and restores bearer credentials from a password-encrypted envelope.
 *
 * @param envelope The encrypted envelope to decrypt.
 * @param passphrase User passphrase used during export.
 * @returns Restored BearerCredentialBundle.
 */
export async function importEncryptedCredentials(
  envelope: EncryptedCredentialEnvelope,
  passphrase: string,
): Promise<BearerCredentialBundle> {
  return decryptEnvelopePayload(envelope, '1.0', passphrase, isBearerCredentialBundle);
}

/**
 * Exports single payment credentials to a password-encrypted envelope (v1.1 AES-GCM-256 + PBKDF2-SHA256).
 *
 * @param credentials Single payment credentials to encrypt.
 * @param passphrase User passphrase used to derive the 256-bit AES-GCM encryption key.
 * @param iterations Optional iteration count (defaults to OWASP-recommended 600,000).
 * @returns Encrypted envelope safe for user-controlled single payment backup.
 */
export async function exportSinglePaymentCredentials(
  credentials: SinglePaymentCredentials,
  passphrase: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<SinglePaymentEncryptedEnvelope> {
  return encryptEnvelopePayload(credentials, '1.1', passphrase, iterations);
}

/**
 * Imports and restores single payment credentials from a password-encrypted envelope (v1.1).
 *
 * @param envelope The encrypted envelope to decrypt.
 * @param passphrase User passphrase used during export.
 * @returns Restored SinglePaymentCredentials.
 */
export async function importSinglePaymentCredentials(
  envelope: SinglePaymentEncryptedEnvelope,
  passphrase: string,
): Promise<SinglePaymentCredentials> {
  return decryptEnvelopePayload(envelope, '1.1', passphrase, isSinglePaymentCredentials);
}

/**
 * Exports claim access credentials to a password-encrypted envelope (v1.2 AES-GCM-256 + PBKDF2-SHA256).
 *
 * @param credentials Claim access credentials containing only paymentId and claimPreimage.
 * @param passphrase User passphrase used to derive the 256-bit AES-GCM encryption key.
 * @param iterations Optional iteration count (defaults to OWASP-recommended 600,000).
 * @returns Encrypted envelope safe for claimant capability handoff.
 */
export async function exportClaimAccessCredentials(
  credentials: ClaimAccessCredentials,
  passphrase: string,
  iterations: number = DEFAULT_PBKDF2_ITERATIONS,
): Promise<ClaimAccessEncryptedEnvelope> {
  return encryptEnvelopePayload(credentials, '1.2', passphrase, iterations);
}

/**
 * Imports and restores claim access credentials from a password-encrypted envelope (v1.2).
 *
 * @param envelope The encrypted envelope to decrypt.
 * @param passphrase User passphrase used during export.
 * @returns Restored ClaimAccessCredentials.
 */
export async function importClaimAccessCredentials(
  envelope: ClaimAccessEncryptedEnvelope,
  passphrase: string,
): Promise<ClaimAccessCredentials> {
  return decryptEnvelopePayload(envelope, '1.2', passphrase, isClaimAccessCredentials);
}
