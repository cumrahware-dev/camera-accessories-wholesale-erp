export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  import('@/lib/ocr/health-monitor').then((m) => m.startOcrHealthMonitor()).catch(() => {});
  const { getCloudinaryDiagnostics, ensureCloudinaryConfigured } = await import('@/lib/cloudinary');
  const d = getCloudinaryDiagnostics();
  ensureCloudinaryConfigured();
  for (const p of d.problems) console.warn(`[Cloudinary] config problem: ${p}`);
  if (!d.configured) {
    console.log('[Cloudinary] Cloudinary configured: false');
    console.warn('[Cloudinary] NOT configured on this server. Uploads happen in the Next.js server, so set the variables there (Vercel → Settings → Environment Variables) and redeploy.');
    return;
  }
  // logs: configured / cloud name / key+secret present / configuration loaded / connection result (no secrets)
  import('@/lib/cloudinary-health').then(({ runCloudinaryHealth }) => runCloudinaryHealth()).catch(() => {});
}
