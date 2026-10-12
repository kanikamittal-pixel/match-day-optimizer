/** @type {import('next').NextConfig} */
// NEXT_DIST lets a production build use its own folder so it never overwrites a running dev server's cache.
export default {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST || '.next',
  async redirects() { return [{ source: '/proof', destination: '/report', permanent: true }]; },
};
