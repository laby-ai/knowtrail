import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  turbopack: {},
  // outputFileTracingRoot: path.resolve(__dirname, '../../'),  // Uncomment and add 'import path from "path"' if needed
  /* config options here */
  serverExternalPackages: ['@zvec/zvec', 'pg'],
  webpack(config, { isServer, webpack }) {
    if (!isServer) {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(/^node:(fs|https)$/, (resource: { context: string; request: string }) => {
        // Let PptxGenJS's browser mappings exclude its Node-only dependencies.
        if (/[/\\]pptxgenjs[/\\]/.test(resource.context)) resource.request = resource.request.slice(5);
      }));
    }
    return config;
  },
  async rewrites() {
    return [
      { source: '/lingbi', destination: '/' },
      { source: '/lingbi/:path*', destination: '/:path*' },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
