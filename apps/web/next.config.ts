import type { NextConfig } from 'next';

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000/v1').replace(/\/$/, '');

const nextConfig: NextConfig = {
  // pacotes e módulos do monorepo são publicados como TypeScript puro (sem build)
  transpilePackages: [
    '@macuxi/comum',
    '@macuxi/platform-sdk',
    '@macuxi/ui',
    // os 8 módulos (T-0004)
    '@macuxi/core',
    '@macuxi/catalogo',
    '@macuxi/vendedor',
    '@macuxi/promotor',
    '@macuxi/gestor',
    '@macuxi/pesquisa',
    '@macuxi/treinamento',
    '@macuxi/integracao',
  ],
  reactStrictMode: true,
  // não gerar AGENTS.md no `next dev`
  agentRules: false,
  devIndicators: false,
  /** Proxy same-origin para métodos que o CORS da API não libere (ver PROXIED_METHODS em @macuxi/platform-sdk/web). */
  async rewrites() {
    return [{ source: '/api-proxy/:path*', destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
