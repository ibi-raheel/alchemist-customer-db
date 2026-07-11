/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep the client bundle tiny (slow-internet priority): fail the build if a
  // page ships more than a small JS budget so regressions are caught early.
  poweredByHeader: false,
  reactStrictMode: true,
};

export default nextConfig;
