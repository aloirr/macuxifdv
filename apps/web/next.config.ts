import path from 'node:path';

import type { NextConfig } from 'next';

// API real (padrão, porta 8100) ou mock-api da demonstração (NEXT_PUBLIC_API_MODO=demo, porta 8000): ver @macuxi/platform-sdk/web
const DEMO = process.env.NEXT_PUBLIC_API_MODO?.trim().toLowerCase() === 'demo';
const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? (DEMO ? 'http://localhost:8000/v1' : 'http://localhost:8100/v1')).replace(/\/$/, '');

/** Origem da API sem o `/v1` (rotas públicas de módulo ficam em `/<modulo>/v1/...`, fora do `/v1`; T-0092). */
export function origemDaApi(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

/**
 * Documento público do Hub (T-0092, ADR 0030): `GET /integracao/v1/openapi.json`, sem token. O portal baixa por este caminho
 * same-origin (dentro de `/api-proxy`, que o `proxy.ts` não reescreve); só este arquivo, não o espaço `/<modulo>/v1` inteiro.
 */
export const PROXY_OPENAPI_HUB = '/api-proxy/_publico/integracao/v1/openapi.json';

/**
 * Hosts em que o BKO roda atrás de proxy/túnel (T-0038; doc 04, "Domínio e endereços"). O BKO da demo fica em
 * `bko-demo.macuxifdv.com.br` (túnel nomeado `macuxi-demo` → `next start` na 127.0.0.1:3100, scripts/demo).
 * `MACUXI_BKO_ORIGEM` (definida pelo scripts/demo no build e no start) acrescenta a origem em uso, ex.: o
 * `https://<nome>.trycloudflare.com` do modo de reserva. Vale para o `next dev` (allowedDevOrigins) e para a checagem
 * de origem das Server Actions (hoje o BKO não tem nenhuma; fica pronto). Endereço da API: o rewrite `/api-proxy`
 * abaixo (no v1 o navegador só fala com a própria origem; a API não precisa de CORS para o BKO).
 * Produção (T-0086, ADR 0028): `bko.macuxifdv.com.br` e `config.macuxifdv.com.br` (portal da T-0087, mesmo serviço
 * `bko:3100` atrás do túnel `macuxi-prod`) entram fixos, então a imagem de produção aceita os dois hosts qualquer que
 * seja o `MACUXI_BKO_ORIGEM` do build. O roteamento do `config.` para o portal fica no `proxy.ts`.
 * Demo (T-0091 §9): o portal da demo fica em `config-demo.macuxifdv.com.br` (mesmo serviço `bko:3100`, túnel `macuxi-demo-nuvem`).
 * Só hosts explícitos, sem curinga.
 */
export const HOSTS_DO_BKO_PADRAO = ['bko-demo.macuxifdv.com.br', 'bko.macuxifdv.com.br', 'config.macuxifdv.com.br', 'config-demo.macuxifdv.com.br'] as const;

/** Host (sem esquema, caminho nem porta padrão) de uma origem como `https://bko-demo.macuxifdv.com.br/`; vazio/inválido = null. */
export function hostDaOrigem(origem: string | undefined | null): string | null {
  const o = origem?.trim();
  if (!o) return null;
  const m = /^(?:https?:\/\/)?([a-z0-9.-]+)(?::(\d+))?(?:[/?#].*)?$/i.exec(o);
  if (!m || !m[1]) return null;
  const host = m[1].toLowerCase();
  return m[2] && m[2] !== '443' && m[2] !== '80' ? `${host}:${m[2]}` : host;
}

/**
 * Hosts permitidos: os fixos (demo e produção) + os de `MACUXI_BKO_ORIGEM`, sem repetir. A variável aceita uma origem
 * ou uma lista separada por vírgula (T-0086); item inválido da lista é ignorado.
 */
export function hostsDoBko(origem: string | undefined | null): string[] {
  const extras = (origem ?? '').split(',').map(hostDaOrigem).filter((h): h is string => h !== null);
  return [...new Set<string>([...HOSTS_DO_BKO_PADRAO, ...extras])];
}

const HOSTS = hostsDoBko(process.env.MACUXI_BKO_ORIGEM);

/**
 * Imagem Docker do BKO (T-0074, apps/web/Dockerfile): `MACUXI_NEXT_STANDALONE=1` no build gera `.next/standalone`
 * (server.js + só os node_modules rastreados), com a raiz do monorepo como raiz do rastreio. No PC (pnpm dev e o
 * `next start` do scripts/demo) a variável não existe e nada muda.
 */
export function opcoesStandalone(valor: string | undefined, raizDoWeb: string = process.cwd()): Partial<NextConfig> {
  return valor?.trim() === '1' ? { output: 'standalone', outputFileTracingRoot: path.resolve(raizDoWeb, '..', '..') } : {};
}

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
  ...opcoesStandalone(process.env.MACUXI_NEXT_STANDALONE),
  // BKO atrás do túnel (T-0038): origem permitida no `next dev` e nas Server Actions
  allowedDevOrigins: HOSTS,
  experimental: { serverActions: { allowedOrigins: HOSTS } },
  // não gerar AGENTS.md no `next dev`
  agentRules: false,
  devIndicators: false,
  /** Proxy same-origin: todas as chamadas da API real e os métodos que o CORS da demo não libere (baseDaChamada). */
  async rewrites() {
    return [
      // o específico antes do geral: a 1ª regra que casa vale
      { source: PROXY_OPENAPI_HUB, destination: `${origemDaApi(API_URL)}/integracao/v1/openapi.json` },
      { source: '/api-proxy/:path*', destination: `${API_URL}/:path*` },
    ];
  },
};

export default nextConfig;
