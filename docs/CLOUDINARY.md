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

## HTTP 403 ("Server returned unexpected status code - 403")
The Cloudinary **Node SDK** only reads the response body for HTTP 200/400/401/404/420/500. For a 403 it threw away
Cloudinary's message and the `X-Cld-Error` header, so the ERP could only say "unexpected status code - 403".
Uploads and the connection check now send the SDK-signed request directly and keep the real reason. A failure is
logged on the Next.js server as:

```
[Cloudinary] upload failed | HTTP status=403 | X-Cld-Error=<Cloudinary's reason> | Error message=… | File type=… | File size=… | Resource type=image|raw | Cloud name=… | API key=…1234 | hint=…
```

and the same reason is shown to the user. Typical 403 reasons and fixes:

| X-Cld-Error says… | Fix |
| --- | --- |
| request not allowed from IP / allowed IP addresses | The API key is IP-restricted. Vercel/Render use changing IPs: remove the restriction (Settings → API Keys / Security) or use another key. |
| account disabled / blocked / suspended | Check account status, billing and usage limits in the Cloudinary console. |
| not permitted / permission / role | Use an API key with upload permission (Admin/Master key). |
| restricted media type | Settings → Security → Restricted media types. |

## Checking from the OCR service (Render)
The OCR service does not store files, but it can verify credentials independently with the official Python SDK:

`GET https://<ocr-service>/cloudinary/health` with header `X-API-Key: <OCR_API_KEY>` → configuration + connection.
Add `?upload=1` to upload, verify (public_id, secure_url, resource_type, present in the Media Library) and delete a JPG,
PNG and PDF (PDF as `raw`) under `arib-global/ocr-test/`. Set the three `CLOUDINARY_*` variables on Render only if you
want to run this check, then redeploy. The ERP equivalent is `/cloudinary/health` (alias of `/api/cloudinary/health`, Super Admin).
