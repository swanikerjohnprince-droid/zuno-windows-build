/**
 * Base64 helpers for binary payloads crossing the Tauri IPC boundary.
 *
 * Lifted verbatim out of tauriFetch, which used to define them privately; they moved here
 * once a second caller needed them. Deliberately byte-oriented rather than string-oriented:
 * `btoa` only accepts Latin-1, so audio and image bytes have to be walked into a binary
 * string first — passing a UTF-8 decoded string instead silently corrupts anything above
 * 0x7F.
 */

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
