import type { NextConfig } from 'next';

// API real (padrão, porta 8100) ou mock-api da demonstração (NEXT_PUBLIC_API_MODO=demo, porta 8000): ver @macuxi/platform-sdk/web
const DEMO = process.env.NEXT_PUBLIC_API_MODO?.trim().toLowerCase() === 'demo';
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? (DEMO ? 'http://localhost:8000/v1' : 'http://localhost:8100/v1')).replace(/\/$/, '');

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
  /** Proxy same-origin: todas as chamadas da API real e os métodos que o CORS da demo não libere (baseDaChamada). */
  async rewrites() {
    return [{ source: '/api-proxy/:path*', destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
