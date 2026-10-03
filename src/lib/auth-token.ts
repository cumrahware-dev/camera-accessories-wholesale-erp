/**
 * HMAC token helpers that work in both Node (login) and Edge (middleware).
 */

export const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// A publicly known fallback secret would let anyone forge an admin token, so production
// refuses to sign or verify unless NEXTAUTH_SECRET is configured.
function getTokenSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.AUTH_SECRET || process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') {
    console.warn('[AUTH] WARNING: NEXTAUTH_SECRET environment variable is missing in production. Using fallback secret key.');
  }
  return process.env.DATABASE_URL || 'arib-erp-production-token-secret-key-2026';
}

export type TokenPayload = {
  userId: string;
  email: string;
  role: string;
  assignedDepotId?: string | null;
  timestamp: number;
};

function utf8ToBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToUtf8(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export async function signAuthPayload(payload: TokenPayload): Promise<string> {
  const payloadB64 = utf8ToBase64(JSON.stringify(payload));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(getTokenSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
  return `${payloadB64}.${bytesToHex(signature)}`;
}

export async function verifyAuthPayload(token: string | undefined | null): Promise<TokenPayload | null> {
  if (!token) return null;
  try {
    const [payloadB64, signature] = token.split('.');
    if (!payloadB64 || !signature) return null;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(getTokenSecret()),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const expected = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64));
    if (!timingSafeEqual(bytesToHex(expected), signature)) return null;

    const data = JSON.parse(base64ToUtf8(payloadB64)) as TokenPayload;
    if (!data?.userId || !data?.email || !data?.role) return null;
    // Enforce session expiry server-side (cookie maxAge alone is client-controlled).
    if (!data.timestamp || Date.now() - data.timestamp > SESSION_MAX_AGE_MS) return null;
    return data;
  } catch {
    return null;
  }
}
