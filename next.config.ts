import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // These packages do native/WASM work (OCR, PDF rendering) and should run
  // as plain require()s at runtime rather than being bundled by webpack.
  serverExternalPackages: ['tesseract.js', '@napi-rs/canvas', 'pdfjs-dist'],
  // proxy.ts runs on /api/*, so Next buffers every request body and by default
  // truncates it at 10 MB. Uploads go up as base64 JSON (~1.34x the file), so a
  // 9.5 MB PDF is already past that and request.json() fails with a 500. The
  // largest allowed upload is 25 MB (~34 MB encoded) — leave headroom.
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
    proxyClientMaxBodySize: '50mb',
  },
  // iOS Safari heuristically caches GET responses that carry no explicit
  // cache headers, which left phones showing week-old API data (passes,
  // contacts, edited pages) while desktop looked fine. Every dynamic API
  // response must be revalidated; only uploaded files (/api/files, which are
  // immutable and set their own caching) are exempt.
  async headers() {
    return [
      {
        source: '/api/:path((?!files).*)',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }],
      },
    ];
  },
  allowedDevOrigins: [
    'localhost:3000',
    '127.0.0.1:3000',
    '192.168.1.3:3000',
    'localhost:3030',
    '127.0.0.1:3030',
    '192.168.1.3:3030',
    '192.168.1.3',
    '*.local',
  ],
};

export default nextConfig;
