/**
 * Cloudinary (Node SDK, server side only).
 *
 * All uploads in this app happen in the Next.js server – the browser never sees the API secret
 * and the Python OCR service never talks to Cloudinary (it receives the bytes over HTTP).
 * Therefore the Cloudinary variables must exist on the service that runs Next.js (Vercel /
 * Node host) – NOT on the Render OCR service.
 *
 * Credentials come from either
 *   CLOUDINARY_CLOUD_NAME + CLOUDINARY_API_KEY + CLOUDINARY_API_SECRET, or
 *   CLOUDINARY_URL=cloudinary://API_KEY:API_SECRET@CLOUD_NAME
 * Values are read at runtime (not at import), trimmed and unquoted.
 * The secret is never logged, returned or thrown.
 */
import { RAW_CLOUDINARY_URL } from '@/lib/cloudinary-env'; // keep first: sanitises CLOUDINARY_URL before the SDK loads
import { v2 as cloudinary } from 'cloudinary';

export { cloudinary };

// ── configuration ───────────────────────────────────────────────────────────
const clean = (v: string | undefined | null): string => {
  let s = String(v ?? '').trim();
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) s = s.slice(1, -1).trim();
  return s;
};

export interface CloudinaryDiagnostics {
  configured: boolean;
  cloudName: string;
  apiKeyPresent: boolean;
  apiSecretPresent: boolean;
  source: 'individual-vars' | 'cloudinary-url' | 'mixed' | 'none';
  problems: string[];
}

interface Resolved { cloudName: string; apiKey: string; apiSecret: string; uploadPrefix: string; diag: CloudinaryDiagnostics }

function resolveConfig(): Resolved {
  const env = process.env;
  const problems: string[] = [];
  const raw = { cloud: env.CLOUDINARY_CLOUD_NAME, key: env.CLOUDINARY_API_KEY, secret: env.CLOUDINARY_API_SECRET };
  for (const [name, v] of Object.entries({ CLOUDINARY_CLOUD_NAME: raw.cloud, CLOUDINARY_API_KEY: raw.key, CLOUDINARY_API_SECRET: raw.secret, CLOUDINARY_URL: RAW_CLOUDINARY_URL })) {
    if (v && v !== v.trim()) problems.push(`${name} has leading/trailing whitespace (trimmed automatically – fix it in the dashboard)`);
    if (v && /^(["']).*\1$/.test(v.trim())) problems.push(`${name} is wrapped in quotes (removed automatically – do not quote values in the dashboard)`);
  }

  let url = { cloud: '', key: '', secret: '' };
  const rawUrl = clean(RAW_CLOUDINARY_URL);
  if (rawUrl) {
    const m = /^cloudinary:\/\/([^:@\s]+):([^@\s]+)@([^/?#\s]+)/i.exec(rawUrl);
    if (m) url = { key: decodeURIComponent(m[1]), secret: decodeURIComponent(m[2]), cloud: m[3] };
    else problems.push('CLOUDINARY_URL is set but is not in the form cloudinary://API_KEY:API_SECRET@CLOUD_NAME');
  }

  const ind = { cloud: clean(raw.cloud), key: clean(raw.key), secret: clean(raw.secret) };
  const cloudName = ind.cloud || url.cloud || clean(env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME);
  const apiKey = ind.key || url.key;
  const apiSecret = ind.secret || url.secret;

  if (!ind.cloud && !url.cloud && cloudName) problems.push('CLOUDINARY_CLOUD_NAME is missing; using NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME instead');
  if (!cloudName) problems.push('Cloud name is missing (set CLOUDINARY_CLOUD_NAME or CLOUDINARY_URL on the server that runs Next.js)');
  if (!apiKey) problems.push('API key is missing (set CLOUDINARY_API_KEY or CLOUDINARY_URL on the server that runs Next.js)');
  if (!apiSecret) problems.push('API secret is missing (set CLOUDINARY_API_SECRET or CLOUDINARY_URL on the server that runs Next.js)');
  if (apiKey && !/^\d+$/.test(apiKey)) problems.push('API key should be numeric – it may be the wrong value (e.g. the cloud name or the secret was pasted here)');
  if (cloudName && /[\s/:@]/.test(cloudName)) problems.push('Cloud name contains invalid characters');
  if (cloudName && apiSecret && cloudName === apiSecret) problems.push('Cloud name and API secret are identical');
  if (ind.cloud && url.cloud && ind.cloud !== url.cloud) problems.push('CLOUDINARY_CLOUD_NAME and CLOUDINARY_URL name different clouds; CLOUDINARY_CLOUD_NAME wins');
  if (ind.key && url.key && ind.key !== url.key) problems.push('CLOUDINARY_API_KEY and CLOUDINARY_URL contain different API keys; CLOUDINARY_API_KEY wins');

  const usedInd = Boolean(ind.cloud || ind.key || ind.secret);
  const usedUrl = Boolean(url.cloud || url.key || url.secret);
  return {
    cloudName, apiKey, apiSecret,
    uploadPrefix: clean(env.CLOUDINARY_UPLOAD_PREFIX), // test hook / private CDN only
    diag: {
      configured: Boolean(cloudName && apiKey && apiSecret),
      cloudName,
      apiKeyPresent: Boolean(apiKey),
      apiSecretPresent: Boolean(apiSecret),
      source: usedInd && usedUrl ? 'mixed' : usedInd ? 'individual-vars' : usedUrl ? 'cloudinary-url' : 'none',
      problems,
    },
  };
}

let appliedSig = '';
/** Resolves the env and (re)configures the SDK with explicit, defined values only. */
export function ensureCloudinaryConfigured(): CloudinaryDiagnostics {
  const r = resolveConfig();
  if (r.diag.configured) {
    const sig = [r.cloudName, r.apiKey, r.apiSecret.length, r.uploadPrefix].join('|');
    if (sig !== appliedSig) {
      const cfg: Record<string, unknown> = { cloud_name: r.cloudName, api_key: r.apiKey, api_secret: r.apiSecret, secure: true };
      if (r.uploadPrefix) cfg.upload_prefix = r.uploadPrefix;
      cloudinary.config(cfg);
      appliedSig = sig;
    }
  }
  return r.diag;
}

/** True when a full set of credentials is present. */
export const isCloudinaryConfigured = () => resolveConfig().diag.configured;
/** True when some – but not all – credentials are present (a deployment mistake, never silently ignored). */
export function isCloudinaryPartial() {
  const d = resolveConfig().diag;
  return !d.configured && (d.apiKeyPresent || d.apiSecretPresent || Boolean(clean(process.env.CLOUDINARY_CLOUD_NAME)));
}
export const getCloudinaryDiagnostics = () => resolveConfig().diag;

// ── errors ──────────────────────────────────────────────────────────────────
export class CloudinaryError extends Error {
  readonly httpCode: number;
  readonly errorType: string;
  readonly stage: string;
  readonly hint: string;
  /** value of Cloudinary's X-Cld-Error response header (the server-side reason), when present */
  readonly cldError: string;
  constructor(stage: string, message: string, httpCode: number, errorType: string, hint = '', cldError = '') {
    super(message);
    this.name = 'CloudinaryError';
    this.stage = stage;
    this.httpCode = httpCode;
    this.errorType = errorType;
    this.hint = hint;
    this.cldError = cldError;
  }
}

function scrub(s: string): string {
  let out = String(s || '');
  const secret = resolveConfig().apiSecret;
  if (secret) out = out.split(secret).join('***');
  return out.replace(/cloudinary:\/\/[^\s"']+/gi, 'cloudinary://***').slice(0, 500);
}

function hintFor(message: string, http: number, type: string): string {
  const m = message.toLowerCase();
  if (http === 403 && /\bip\b|ip address|allowed ip|not allowed from/.test(m)) return 'This API key only accepts requests from allowed IP addresses (Cloudinary Settings → API Keys / Security). Serverless hosts such as Vercel use changing IPs: remove the IP restriction or use a key without it.';
  if (http === 403 && /(disabled|suspended|blocked|deactivated|account)/.test(m)) return 'The Cloudinary account / product environment is disabled or blocked. Check the Cloudinary console (billing, usage limits, account status) or contact Cloudinary support.';
  if (http === 403 && /(permission|not permitted|not authorized|role|scope|unauthorized)/.test(m)) return 'This API key lacks permission to upload. Use a key with full (Admin/Master) access or grant upload permission in Cloudinary Settings → API Keys.';
  if (http === 403 && /(restricted|media type|file type|format)/.test(m)) return 'The file type is restricted for this account (Settings → Security → Restricted media types).';
  if (http === 403 && /(limit|quota|exceeded|usage)/.test(m)) return 'A Cloudinary plan limit (storage, credits or bandwidth) has been reached.';
  if (http === 403) return 'Cloudinary refused the request (403). The exact reason is in the X-Cld-Error value above; typical causes are an IP restriction on the API key, an API key without upload permission, or a disabled account.';
  if (m.includes('invalid signature') || m.includes('string to sign')) return 'The API secret does not match the API key (wrong or rotated secret, or extra characters in it).';
  if (m.includes('invalid api_key') || m.includes('unknown api key') || m.includes('api key')) return 'The API key does not belong to this cloud name, or was deleted/disabled. Check that key, secret and cloud name come from the same Cloudinary product environment.';
  if (m.includes('cloud_name mismatch') || m.includes('invalid cloud_name') || (http === 404 && m.includes('cloud'))) return 'The cloud name is wrong – copy it from the Cloudinary dashboard (it is case-sensitive).';
  if (m.includes('must supply api_key') || m.includes('must supply api_secret') || m.includes('must supply cloud_name')) return 'A credential was empty at runtime – the variable is not set on the server that performs the upload.';
  if (m.includes('file size too large') || http === 413) return 'The file exceeds the Cloudinary plan limit for this resource type (free plans: about 10 MB per file). Compress it or upgrade the plan.';
  if (m.includes('pdf') && (http === 401 || http === 403)) return 'PDF delivery is blocked for this account: enable "Allow delivery of PDF and ZIP files" in Cloudinary Settings → Security.';
  if (m.includes('untrusted customer')) return 'Cloudinary flagged the account as untrusted – contact Cloudinary support.';

  if (http === 401 || http === 403) return 'Cloudinary rejected the credentials or the permission for this operation.';
  if (type === 'ENOTFOUND' || type === 'EAI_AGAIN') return 'The server cannot resolve api.cloudinary.com (DNS / network egress).';
  if (type === 'ECONNREFUSED' || type === 'ETIMEDOUT' || type === 'ECONNRESET') return 'The server cannot reach Cloudinary (network egress, firewall or proxy).';
  if (http === 420 || http === 429) return 'Cloudinary rate limit reached.';
  return '';
}

/** Works across bundles (instanceof can fail when the module is bundled into several server chunks). */
export function isCloudinaryError(e: unknown): e is CloudinaryError {
  return e instanceof CloudinaryError || (!!e && typeof e === 'object' && (e as any).name === 'CloudinaryError' && 'stage' in (e as any));
}

/** Turns whatever the SDK threw into a CloudinaryError carrying the exact (secret-free) message. */
export function toCloudinaryError(e: any, stage: string): CloudinaryError {
  if (isCloudinaryError(e)) return e;
  const inner = e?.error && typeof e.error === 'object' ? e.error : e;
  const message = scrub(inner?.message || e?.message || String(e) || 'Unknown Cloudinary error');
  const http = Number(inner?.http_code || e?.http_code || 0);
  const type = String(inner?.code || e?.code || inner?.name || e?.name || 'Error');
  return new CloudinaryError(stage, message, http, type, hintFor(message, http, type));
}

/** One safe line: no secret, no CLOUDINARY_URL, no authorization headers. */
export function logCloudinaryFailure(err: CloudinaryError, ctx: { fileType?: string; fileSize?: number; resourceType?: string } = {}) {
  const d = resolveConfig();
  console.error(
    `[Cloudinary] ${err.stage} failed | HTTP status=${err.httpCode || 'n/a'} | X-Cld-Error=${err.cldError || 'n/a'} | Error type=${err.errorType} | ` +
      `Error message=${err.message} | File type=${ctx.fileType ?? 'n/a'} | File size=${ctx.fileSize ?? 'n/a'} | Resource type=${ctx.resourceType ?? 'n/a'} | ` +
      `Cloud name=${d.cloudName || 'n/a'} | API key=…${d.apiKey.slice(-4) || 'n/a'}` +
      (err.hint ? ` | hint=${err.hint}` : '')
  );
}

/** Message safe to show to a signed-in user: exact SDK text plus the hint. */
export function userFacingCloudinaryMessage(err: CloudinaryError): string {
  const reason = err.cldError && err.cldError !== err.message ? ` [X-Cld-Error: ${err.cldError}]` : '';
  return `Cloudinary rejected the upload: ${err.message}${reason}${err.httpCode ? ` (HTTP ${err.httpCode})` : ''}${err.hint ? ` – ${err.hint}` : ''}`;
}

/** Explains missing configuration as a CloudinaryError. */
function notConfigured(): CloudinaryError {
  const d = resolveConfig().diag;
  return new CloudinaryError('config', `Cloudinary is not configured on this server. ${d.problems.filter((p) => /missing/i.test(p)).join('; ')}`, 0, 'NotConfigured',
    'Set the variables on the service that runs Next.js (e.g. Vercel Project → Settings → Environment Variables) and redeploy; variables on the Render OCR service are not visible to it.');
}


// ── direct HTTP calls ───────────────────────────────────────────────────────
// The Node SDK only reads the response body for HTTP 200/400/401/404/420/500. For any other status (notably 403)
// it discards Cloudinary's JSON error and the X-Cld-Error header and reports only "Server returned unexpected
// status code". We therefore send the (SDK-signed) requests ourselves and keep the real reason.
function apiBase(): string {
  const r = resolveConfig();
  return `${(r.uploadPrefix || 'https://api.cloudinary.com').replace(/\/+$/, '')}/v1_1/${encodeURIComponent(r.cloudName)}`;
}

async function readCloudinaryResponse(res: Response, stage: string): Promise<any> {
  const text = await res.text().catch(() => '');
  let body: any = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* HTML / empty body */ }
  if (res.ok && body && !body.error) return body;
  const cldError = scrub(res.headers.get('x-cld-error') || '');
  const message = scrub(body?.error?.message || cldError || (text ? text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) : '') || `HTTP ${res.status} ${res.statusText}`);
  throw new CloudinaryError(stage, message, res.status, res.status === 403 ? 'Forbidden' : 'HttpError', hintFor(`${message} ${cldError}`, res.status, 'HttpError'), cldError);
}

async function cldFetch(url: string, init: RequestInit, stage: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, cache: 'no-store' });
  } catch (e: any) {
    const code = e?.cause?.code || e?.code || 'NetworkError';
    throw new CloudinaryError(stage, scrub(e?.cause?.message || e?.message || 'Network error'), 0, code, hintFor('', 0, code));
  }
  return readCloudinaryResponse(res, stage);
}

/** Admin API ping with Basic auth – the cheapest real credential check. */
export async function pingCloudinary(): Promise<{ status: string }> {
  if (!ensureCloudinaryConfigured().configured) throw notConfigured();
  const r = resolveConfig();
  const auth = Buffer.from(`${r.apiKey}:${r.apiSecret}`).toString('base64');
  return cldFetch(`${apiBase()}/ping`, { headers: { Authorization: `Basic ${auth}` } }, 'ping');
}

/** Signed multipart upload (one request; the buffer is sent once). */
async function signedUpload(buffer: Buffer, mime: string, resourceType: 'image' | 'raw', params: Record<string, string>) {
  const r = resolveConfig();
  const signed = cloudinary.utils.sign_request({ ...params, timestamp: String(Math.floor(Date.now() / 1000)) }, { api_key: r.apiKey, api_secret: r.apiSecret }) as Record<string, string>;
  const form = new FormData();
  for (const [k, v] of Object.entries(signed)) form.append(k, String(v));
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), params.public_id.split('/').pop() || 'file');
  return cldFetch(`${apiBase()}/${resourceType}/upload`, { method: 'POST', body: form }, 'upload');
}

// ── uploads ─────────────────────────────────────────────────────────────────
export type StorageType = 'upload' | 'authenticated';
export interface CloudinaryUploadResult {
  url: string;
  secure_url: string;
  public_id: string;
  format: string;
  width?: number;
  height?: number;
  bytes: number;
  resource_type: string;
  type: string;
}

/** PDFs (and anything that is not an image) must be `raw`; JPG/PNG/WEBP are `image`. */
export function resourceTypeFor(mime: string): 'image' | 'raw' {
  return /^image\/(jpeg|jpg|png|webp|gif)$/i.test(mime) ? 'image' : 'raw';
}
const extFor = (mime: string) => ({ 'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[mime.toLowerCase()] || 'bin';

/**
 * Streams a buffer to Cloudinary (one request, no base64 copy, no temp file).
 * `folder` is e.g. "arib-global/ocr". The upload happens exactly once per call.
 */
export async function uploadBuffer(
  buffer: Buffer,
  opts: { mime: string; folder: string; type?: StorageType; publicName?: string }
): Promise<CloudinaryUploadResult> {
  const stage = 'upload';
  const resourceType = resourceTypeFor(opts.mime);
  const ctx = { fileType: opts.mime, fileSize: buffer.length, resourceType };
  if (!ensureCloudinaryConfigured().configured) {
    const err = notConfigured();
    logCloudinaryFailure(err, ctx);
    throw err;
  }
  const name = opts.publicName || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  // raw assets keep their extension inside the public_id; images get it as `format`
  const publicId = `${opts.folder.replace(/^\/+|\/+$/g, '')}/${name}${resourceType === 'raw' ? '.' + extFor(opts.mime) : ''}`;
  try {
    const res = await signedUpload(buffer, opts.mime, resourceType, {
      public_id: publicId, type: opts.type || 'upload', overwrite: 'false', unique_filename: 'false',
    });
    if (!res?.public_id || !res?.secure_url || !res?.resource_type) {
      throw new CloudinaryError('upload', 'Cloudinary answered without public_id / secure_url / resource_type', 502, 'BadResponse');
    }
    return {
      url: res.url, secure_url: res.secure_url, public_id: res.public_id, format: res.format || extFor(opts.mime),
      width: res.width, height: res.height, bytes: res.bytes ?? buffer.length, resource_type: res.resource_type, type: res.type || opts.type || 'upload',
    };
  } catch (e) {
    const err = toCloudinaryError(e, stage);
    logCloudinaryFailure(err, ctx);
    throw err;
  }
}

/** Legacy helper used by the Documents module: takes a base64 data URI, stores a public asset. */
export async function uploadToCloudinary(
  fileDataUri: string,
  folder: string = 'arib-global/documents',
  resourceType: 'auto' | 'image' | 'raw' | 'video' = 'auto'
): Promise<CloudinaryUploadResult> {
  const marker = ';base64,';
  const at = fileDataUri.startsWith('data:') ? fileDataUri.indexOf(marker) : -1;
  if (at < 0) throw new CloudinaryError('input', 'Expected a base64 data URI', 400, 'BadInput');
  const mime = fileDataUri.slice(5, at).toLowerCase();
  const buffer = Buffer.from(fileDataUri.slice(at + marker.length), 'base64');
  void resourceType; // the resource type is always derived from the real content type
  return uploadBuffer(buffer, { mime, folder, type: 'upload' });
}

// ── reading back / deleting ─────────────────────────────────────────────────
export interface AssetRef { id: string; rt: 'image' | 'raw'; type: StorageType; fmt?: string; url?: string }

/** Downloads an asset through a signed API URL (works for authenticated assets and blocked public PDF delivery). */
export async function downloadAsset(ref: AssetRef): Promise<Buffer> {
  if (!ensureCloudinaryConfigured().configured) throw notConfigured();
  const fetchOk = async (url: string) => {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) {
      const body = (await r.text().catch(() => '')).slice(0, 200);
      const cld = scrub(r.headers.get('x-cld-error') || '');
      const reason = scrub(cld || body);
      throw new CloudinaryError('download', reason || `HTTP ${r.status}`, r.status, 'HttpError', hintFor(reason, r.status, 'HttpError'), cld);
    }
    return Buffer.from(await r.arrayBuffer());
  };
  try {
    const signed = cloudinary.utils.private_download_url(ref.id, ref.rt === 'raw' ? '' : ref.fmt || '', {
      resource_type: ref.rt, type: ref.type, expires_at: Math.floor(Date.now() / 1000) + 300,
    } as any);
    return await fetchOk(signed);
  } catch (e) {
    const err = toCloudinaryError(e, 'download');
    // legacy public assets: fall back to the delivery URL
    if (ref.type === 'upload' && ref.url && err.httpCode !== 0) {
      try { return await fetchOk(ref.url); } catch { /* report the first error */ }
    }
    console.error(`[Cloudinary] download failed | HTTP status=${err.httpCode || 'n/a'} | X-Cld-Error=${err.cldError || 'n/a'} | Error type=${err.errorType} | Error message=${err.message} | Resource type=${ref.rt}`);
    throw err;
  }
}

/** Deletes an asset; tolerant to "not found". Returns Cloudinary's result string. */
export async function deleteAsset(ref: Pick<AssetRef, 'id'> & Partial<AssetRef>): Promise<string> {
  if (!ensureCloudinaryConfigured().configured) throw notConfigured();
  const types: Array<'image' | 'raw'> = ref.rt ? [ref.rt] : ['image', 'raw'];
  let last = 'not found';
  try {
    for (const rt of types) {
      const r = await cloudinary.uploader.destroy(ref.id, { resource_type: rt, type: ref.type || 'upload', invalidate: true });
      last = r?.result || 'unknown';
      if (last === 'ok') return last;
    }
    return last;
  } catch (e) {
    throw toCloudinaryError(e, 'delete');
  }
}

/** Generate an optimized preview URL */
export function getOptimizedImageUrl(publicIdOrUrl: string, width = 600, height = 600): string {
  if (!publicIdOrUrl) return '/placeholder-camera.png';
  if (publicIdOrUrl.startsWith('http://') || publicIdOrUrl.startsWith('https://')) return publicIdOrUrl;
  ensureCloudinaryConfigured();
  return cloudinary.url(publicIdOrUrl, { width, height, crop: 'limit', quality: 'auto', fetch_format: 'auto' });
}
