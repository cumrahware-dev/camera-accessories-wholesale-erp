/**
 * Must be imported BEFORE the `cloudinary` package. The SDK parses process.env.CLOUDINARY_URL while it
 * loads and THROWS on a malformed value (e.g. wrapped in quotes or with a stray space) – which takes every
 * route that imports it down with an opaque error. We keep the raw value for diagnostics and give the
 * SDK a cleaned value (or none).
 */
export const RAW_CLOUDINARY_URL: string | undefined = process.env.CLOUDINARY_URL;

if (RAW_CLOUDINARY_URL !== undefined) {
  let v = RAW_CLOUDINARY_URL.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1).trim();
  if (/^cloudinary:\/\/[^:@\s]+:[^@\s]+@[^/?#\s]+/i.test(v)) process.env.CLOUDINARY_URL = v;
  else delete process.env.CLOUDINARY_URL;
}
