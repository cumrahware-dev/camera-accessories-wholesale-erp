/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
    // Uploads are sent as base64 (~1.34x). The default 10MB proxy buffer silently truncated
    // larger bodies, which surfaced as a 500 instead of a clear "file too large" error.
    proxyClientMaxBodySize: '25mb',
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'res.cloudinary.com',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
      },
    ],
  },
  async rewrites() {
    // Internal diagnostic alias; the API route itself requires an administrator session.
    return [{ source: '/cloudinary/health', destination: '/api/cloudinary/health' }];
  },
  async headers() {
    return [
      {
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Logos, seals and icons never change under the same URL: let the browser keep them (they used to be re-fetched
        // on every page because the catch-all rule below marked everything no-store).
        source: '/:file(.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|woff2?))',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' }],
      },
      {
        source: '/((?!_next/static|_next/image|favicon.ico|placeholder-product.svg|.*\\.(?:png|jpg|jpeg|gif|webp|avif|svg|ico|woff2?)$).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ];
  },
};

export default nextConfig;
