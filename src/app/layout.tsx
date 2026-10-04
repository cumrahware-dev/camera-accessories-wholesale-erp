import type { Metadata, Viewport } from 'next';
import './globals.css';
import AppShell from '@/components/layout/AppShell';
import { ToastProvider } from '@/components/ui/Toast';
import { ExtractionProvider } from '@/context/ExtractionContext';

export const metadata: Metadata = {
  title: 'ARIB GLOBAL | Camera & Cine Wholesale ERP',
  description: 'Enterprise Cloud-Based Wholesale ERP for Cameras, Cinema Optics & Accessories. Multi-Depot, Proforma-to-Invoice Automation, Serial Tracking & Cloud Documents.',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'ARIB GLOBAL',
  },
  other: {
    'mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  themeColor: '#f6f7fb',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover', // lets env(safe-area-inset-*) work in standalone/PWA mode
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        {/* Plain inline script (not next/script): next/script in a hand-written <head> made React throw error #418 and
            throw away the server-rendered page on EVERY navigation, so each page was rendered twice. */}
        <script
          id="pwa-cache-cleaner"
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined') {
                // 1. Purge stale PWA Service Workers
                if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.getRegistrations().then(function(registrations) {
                    for (let registration of registrations) {
                      registration.unregister();
                    }
                  }).catch(function() {});
                }

                // 2. Clear browser CacheStorage to prevent outdated chunk caching
                if ('caches' in window) {
                  caches.keys().then(function(keys) {
                    for (let key of keys) {
                      caches.delete(key);
                    }
                  }).catch(function() {});
                }

                // 3. Auto-recover from Next.js ChunkLoadErrors / outdated bundle references
                window.addEventListener('error', function(e) {
                  var isChunkError = e && e.message && (
                    /Loading chunk .* failed/i.test(e.message) ||
                    /Failed to fetch dynamically imported module/i.test(e.message) ||
                    /ChunkLoadError/i.test(e.message)
                  );
                  if (isChunkError) {
                    var lastReload = sessionStorage.getItem('erp_last_chunk_reload');
                    var now = Date.now();
                    if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
                      sessionStorage.setItem('erp_last_chunk_reload', String(now));
                      window.location.reload();
                    }
                  }
                });

                window.addEventListener('unhandledrejection', function(e) {
                  var reason = e && (e.reason && e.reason.message || String(e.reason));
                  if (reason && (/Loading chunk .* failed/i.test(reason) || /ChunkLoadError/i.test(reason))) {
                    var lastReload = sessionStorage.getItem('erp_last_chunk_reload');
                    var now = Date.now();
                    if (!lastReload || now - parseInt(lastReload, 10) > 10000) {
                      sessionStorage.setItem('erp_last_chunk_reload', String(now));
                      window.location.reload();
                    }
                  }
                });
              }
            `,
          }}
        />
      </head>
      <body className="bg-workspace text-ink min-h-screen antialiased">
        <ToastProvider>
          <ExtractionProvider>
            <AppShell>
              {children}
            </AppShell>
          </ExtractionProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
