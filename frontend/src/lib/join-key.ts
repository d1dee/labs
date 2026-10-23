export const JOIN_KEY_LENGTH = 8;

// I and O are omitted so a shared key can be read out loud without 1/0 confusion.
const JOIN_KEY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const JOIN_KEY_SEPARATOR = '-';

/**
 * Cryptographically random join key: eight uppercase letters.
 */
export function generateJoinKey(): string {
    const limit = 256 - (256 % JOIN_KEY_ALPHABET.length);
    const bytes = new Uint8Array(JOIN_KEY_LENGTH);
    let key = '';
    while (key.length < JOIN_KEY_LENGTH) {
        crypto.getRandomValues(bytes);
        for (const byte of bytes) {
            // Reject out-of-range bytes so every letter stays equally likely.
            if (byte >= limit) continue;
            key += JOIN_KEY_ALPHABET.charAt(byte % JOIN_KEY_ALPHABET.length);
            if (key.length === JOIN_KEY_LENGTH) break;
        }
    }
    return key;
}

/**
 * Strips separators and casing so a key typed as `abcd-efgh`, `ABCD EFGH`
 * or `ABCDEFGH` always resolves to the same stored value.
 */
export function normalizeJoinKey(input: string): string {
    return input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * Display form of a join key: `ABCD-EFGH`. Values that are not eight
 * characters long (legacy keys) are returned normalized and without a dash.
 */
export function formatJoinKey(key: string): string {
    const normalized = normalizeJoinKey(key);
    if (normalized.length !== JOIN_KEY_LENGTH) return normalized;
    const half = JOIN_KEY_LENGTH / 2;
    return `${normalized.slice(0, half)}${JOIN_KEY_SEPARATOR}${normalized.slice(half)}`;
}

/**
 * True when the key matches the eight letter format issued for new institutions.
 */
export function isJoinKeyFormat(key: string): boolean {
    return /^[A-Z]{8}$/.test(normalizeJoinKey(key));
}
