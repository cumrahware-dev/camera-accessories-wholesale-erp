# Cloudinary in ARIB GLOBAL ERP

**Where uploads happen:** the Next.js server (`src/lib/cloudinary.ts`, Node SDK). The browser never gets the API
secret and the Python OCR service never talks to Cloudinary (it receives the file bytes over HTTP).

| Service | Needs `CLOUDINARY_*`? |
| --- | --- |
| Next.js (Vercel / Node host) | **Yes** – `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (or `CLOUDINARY_URL=cloudinary://KEY:SECRET@CLOUD`) |
| Python OCR service (Render) | No |

Vercel and Render do not share environment variables. After changing variables, **redeploy** (Vercel bakes env into a deployment).
Do not quote values and do not use `NEXT_PUBLIC_` for the secret.

## Checking it
- Startup log lines: `Cloudinary configured`, `Cloud name`, `API key present`, `API secret present`, `configuration loaded`, `connection successful`.
- `GET /api/cloudinary/health` (Super Admin) – configuration + ping. `?upload=1` also uploads/verifies/deletes test assets in `arib-global/ocr-test/`
  (PNG public, PDF authenticated with signed download, PDF public delivery check).
- Failures return the exact Cloudinary message, HTTP status and a hint; secrets are never logged or returned.

## How files are stored
- OCR originals: `arib-global/ocr/…`, streamed once, `type=authenticated`; PDFs are `raw`, JPG/PNG are `image`. Read back via signed download,
  so OCR/reprocess/preview do not depend on public PDF delivery.
- Documents module: `arib-global/<category>/…`, public. If PDF links return 401, enable *Allow delivery of PDF and ZIP files* (Cloudinary Settings → Security).
- Limits: ERP cap 15 MB (OCR) / 10 MB (Documents); Cloudinary free plans allow about 10 MB per file; Vercel functions accept ~4.5 MB request bodies, so large scans need a self-hosted Node server or a direct-upload flow.
