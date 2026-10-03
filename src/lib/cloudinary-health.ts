/** Diagnostics for the Cloudinary integration. Never returns or logs secrets. */
import {
  cloudinary, deleteAsset, pingCloudinary, downloadAsset, ensureCloudinaryConfigured, toCloudinaryError, uploadBuffer,
  type CloudinaryError,
} from '@/lib/cloudinary';

const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF_MIN = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n');
const TEST_FOLDER = 'arib-global/ocr-test';

const errInfo = (e: CloudinaryError) => ({ message: e.message, http_status: e.httpCode || null, x_cld_error: e.cldError || undefined, error_type: e.errorType, stage: e.stage, hint: e.hint || undefined });
const log = (m: string) => console.log(`[Cloudinary] ${m}`);

async function publicFetchStatus(url: string): Promise<number> {
  try { return (await fetch(url, { cache: 'no-store' })).status; } catch { return 0; }
}

export async function runCloudinaryHealth(opts: { upload?: boolean } = {}) {
  const diag = ensureCloudinaryConfigured();
  const out: Record<string, any> = {
    configured: diag.configured,
    cloud_name: diag.cloudName || null,
    api_key_present: diag.apiKeyPresent,
    api_secret_present: diag.apiSecretPresent,
    credential_source: diag.source,
    problems: diag.problems,
    connection: 'not_configured',
  };
  log(`Cloudinary configured: ${diag.configured}`);
  log(`Cloud name: ${diag.cloudName || '(none)'}`);
  log(`API key present: ${diag.apiKeyPresent}`);
  log(`API secret present: ${diag.apiSecretPresent}`);
  if (!diag.configured) { out.ok = false; return out; }
  log('Cloudinary configuration loaded');

  try {
    await pingCloudinary();
    out.connection = 'ok';
    log('Cloudinary connection successful');
  } catch (e) {
    const err = toCloudinaryError(e, 'ping');
    out.connection = 'failed';
    out.error = errInfo(err);
    log(`Cloudinary connection FAILED | HTTP status=${err.httpCode || 'n/a'} | X-Cld-Error=${err.cldError || 'n/a'} | Error type=${err.errorType} | Error message=${err.message}`);
    out.ok = false;
    return out;
  }
  if (!opts.upload) { out.ok = true; return out; }

  const test: Record<string, any> = {};
  out.test_upload = test;
  const cleanup: Array<() => Promise<unknown>> = [];
  try {
    // 1) image, public
    const img = await uploadBuffer(PNG_1x1, { mime: 'image/png', folder: TEST_FOLDER, type: 'upload' });
    cleanup.push(() => deleteAsset({ id: img.public_id, rt: 'image', type: 'upload' }));
    const imgStatus = await publicFetchStatus(img.secure_url);
    let exists = false;
    try { await cloudinary.api.resource(img.public_id, { resource_type: 'image' }); exists = true; } catch { /* reported below */ }
    test.image = { ok: true, public_id: img.public_id, secure_url: img.secure_url, resource_type: img.resource_type, asset_exists: exists, url_http_status: imgStatus, url_accessible: imgStatus === 200 };
    // 2) pdf, authenticated (what the OCR module uses) – must round-trip through the signed download
    const pdf = await uploadBuffer(PDF_MIN, { mime: 'application/pdf', folder: TEST_FOLDER, type: 'authenticated' });
    cleanup.push(() => deleteAsset({ id: pdf.public_id, rt: 'raw', type: 'authenticated' }));
    const back = await downloadAsset({ id: pdf.public_id, rt: 'raw', type: 'authenticated' });
    test.pdf_authenticated = { ok: back.equals(PDF_MIN), public_id: pdf.public_id, resource_type: pdf.resource_type, signed_download_matches_original: back.equals(PDF_MIN) };
    // 3) pdf, public delivery – informational (some accounts block it)
    const pub = await uploadBuffer(PDF_MIN, { mime: 'application/pdf', folder: TEST_FOLDER, type: 'upload' });
    cleanup.push(() => deleteAsset({ id: pub.public_id, rt: 'raw', type: 'upload' }));
    const pubStatus = await publicFetchStatus(pub.secure_url);
    out.pdf_delivery = pubStatus === 200 ? 'public delivery ok'
      : `public PDF URLs return HTTP ${pubStatus}: enable "Allow delivery of PDF and ZIP files" in Cloudinary Settings → Security if PDFs in Documents must open by link (OCR is unaffected: it uses signed downloads)`;
    log(`Test upload successful | public_id=${img.public_id} | secure_url=${img.secure_url}`);
  } catch (e) {
    const err = toCloudinaryError(e, 'test-upload');
    test.error = errInfo(err);
    out.ok = false;
    log(`Test upload FAILED | HTTP status=${err.httpCode || 'n/a'} | X-Cld-Error=${err.cldError || 'n/a'} | Error type=${err.errorType} | Error message=${err.message}`);
  }
  const deleted: string[] = [];
  for (const c of cleanup) { try { deleted.push(String(await c())); } catch (e) { deleted.push('error: ' + toCloudinaryError(e, 'delete').message); } }
  test.deleted = deleted;
  test.cleanup_ok = deleted.length > 0 && deleted.every((d) => d === 'ok');
  if (test.cleanup_ok) log('Test assets deleted');
  if (out.ok === undefined) out.ok = !test.error && test.image?.ok && test.pdf_authenticated?.ok && test.cleanup_ok;
  return out;
}
