// Only public data and Web Crypto verification. No credential or wallet APIs here.
export const RP_ID = 'trustwallet.com';
export const OWNER = null;
export const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export const b64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes)))
  .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
export function concat(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a); out.set(b, a.length); return out;
}
export const sha256 = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
function check(ok, message) { if (!ok) throw new Error(message); }

// ES256 WebAuthn signatures are DER; Web Crypto expects fixed-width r || s.
// Strict short-form DER only: a P-256 signature cannot exceed 72 bytes.
export function derToRaw(input) {
  const d = new Uint8Array(input);
  check(d.length >= 8 && d.length <= 72 && d[0] === 0x30 && d[1] === d.length - 2, 'Invalid DER sequence');
  let p = 2;
  function integer() {
    check(d[p++] === 2, 'Invalid DER INTEGER');
    const n = d[p++];
    check(n >= 1 && n <= 33 && p + n <= d.length, 'Invalid DER integer length');
    let v = d.slice(p, p + n); p += n;
    check(!(v[0] & 0x80), 'Negative DER integer');
    if (v.length > 1 && v[0] === 0) {
      check(Boolean(v[1] & 0x80), 'Nonminimal DER integer');
      v = v.slice(1);
    }
    check(v.length <= 32 && v.some(b => b !== 0), 'Invalid P-256 scalar');
    const out = new Uint8Array(32); out.set(v, 32 - v.length); return out;
  }
  const r = integer(), s = integer();
  check(p === d.length, 'Trailing DER data');
  return concat(r, s);
}
export async function importOwner(owner = OWNER) {
  if (!owner || !/^[0-9a-f]{64}$/i.test(owner.x) || !/^[0-9a-f]{64}$/i.test(owner.y)) throw new Error('A validated on-chain P-256 public key is required.');
  const decode = h => Uint8Array.from(h.match(/../g), b => parseInt(b, 16));
  return crypto.subtle.importKey('jwk', {
    kty: 'EC', crv: 'P-256', x: b64url(decode(owner.x)), y: b64url(decode(owner.y)), ext: true
  }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
}
export async function verifyAssertion(response, challenge, expectedOrigin, publicKey) {
  const clientBytes = new Uint8Array(response.clientDataJSON);
  const auth = new Uint8Array(response.authenticatorData);
  check(clientBytes.length <= 16384 && auth.length <= 16384, 'Oversized response');
  const client = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(clientBytes));
  check(client.type === 'webauthn.get', 'Wrong client data type');
  check(client.challenge === b64url(challenge), 'Challenge mismatch');
  check(client.origin === expectedOrigin, 'Origin mismatch');
  check(client.crossOrigin === false, 'Cross-origin assertion rejected');
  check(!Object.hasOwn(client, 'topOrigin'), 'Unexpected top origin');
  check(auth.length >= 37, 'Truncated authenticator data');
  check(hex(auth.slice(0, 32)) === hex(await sha256(new TextEncoder().encode(RP_ID))), 'RP ID hash mismatch');
  const flags = auth[32];
  check(Boolean(flags & 1), 'User presence missing');
  check(Boolean(flags & 4), 'User verification missing');
  check(!(flags & 0x22), 'Reserved authenticator flags');
  check(!(flags & 0x40), 'Unexpected attested credential data');
  check(!(flags & 0x10) || Boolean(flags & 8), 'Invalid backup flags');
  // This tool requests no WebAuthn extensions; do not silently ignore CBOR data.
  check(!(flags & 0x80) && auth.length === 37, 'Unexpected authenticator extension data');
  const message = concat(auth, await sha256(clientBytes));
  const rawSignature = derToRaw(response.signature);
  // SHA-256 is applied ONCE here by Web Crypto to message (not to an already hashed message).
  const signatureMatches = await crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' }, publicKey, rawSignature, message);
  return {
    signatureMatches, origin: client.origin, challenge: client.challenge,
    rpId: RP_ID, userPresent: true, userVerified: true,
    backupEligible: Boolean(flags & 8), backedUp: Boolean(flags & 16),
    signCount: new DataView(auth.buffer, auth.byteOffset, auth.byteLength).getUint32(33, false),
    signedMessageHash: hex(await sha256(message))
  };
}
