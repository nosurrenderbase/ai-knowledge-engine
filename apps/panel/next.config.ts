import type {NextConfig} from 'next';

const config: NextConfig = {
  // The shared packages are TypeScript run directly by Node (type stripping);
  // keep them, and the drivers they use, out of the bundle.
  serverExternalPackages: [
    '@ai-knowledge-engine/accounts',
    '@ai-knowledge-engine/search',
    '@ai-knowledge-engine/kb',
    'pg',
    'redis',
    'ts-morph',
  ],
  poweredByHeader: false,
};

export default config;
