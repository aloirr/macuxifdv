/**
 * T-0078 — C1 do checklist de segurança (docs/seguranca/checklist.md): carga básica do sync com a ferramenta do roteiro
 * (scripts/carga/sync-basico.mjs, docs/desenho/T-0078.md §2), 20 e 50 aparelhos virtuais, 3 rodadas (sincronização
 * completa + 2 atualizações leves). A ferramenta roda como processo filho, por HTTP de verdade, contra:
 *
 *  A) SEM banco (roda em qualquer máquina): a API real (`createApp`: autenticação, licença, carteira, request id,
 *     métricas e o motor `/v1/sync/novidades|pull`) com provedores EM MEMÓRIA (tests/integracao/apoio/sync-memoria.ts;
 *     entidades reais dos 8 módulos, 300 clientes, 1.200 produtos em 2 páginas, 500 pedidos, 40 linhas nas outras). Mede
 *     o custo do motor e do HTTP, NÃO o do Postgres. Uma linha nova de pedido a cada 200 ms faz as novidades listarem algo.
 *  B) COM Postgres (CI; `semBanco()` pula aqui): a API real como `macuxi_app` (RLS), os provedores reais e a fixture
 *     dois-tenants, login do vendedor de A pelo Core de verdade (argon2id, JWT).
 *
 * O que REPROVA na suíte comum: qualquer erro (status >= 400 ou falha de rede), sincronização incompleta e `/v1/saude`
 * com alerta depois da carga. Tempo só reprova em job próprio (`MACUXI_CARGA_MEDIR=1`, teto `MACUXI_CARGA_P95_MS`,
 * padrão 2000 ms do roteiro), como no S0-110 (tests/plano/sprint-1.md, "Testes de tempo"). As linhas JSON da ferramenta
 * saem no console com o prefixo `[carga T-0078]` e vão para o checklist (item C1).
 *
 * Proibido: rodar contra a demo da VM (api-demo); a URL aqui é sempre a do servidor local que o próprio teste sobe.
 * Convenção: `it.fails` = defeito aberto (fica vermelho quando corrigir e vira `it`).
 */
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { criarModuloApiCore } from '@macuxi/core/api';
import { carregarDoisTenants, criarBancoDeTeste } from '@macuxi/db/teste';
import { semBanco } from '@macuxi/db/teste/estado';
import type { FastifyInstance } from 'fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../apps/api/src/app';
import { criarBancoApp } from '../../apps/api/src/banco';
import { MODULOS_API } from '../../apps/api/src/modulos';
import { A, poolComEncerramento, SEGREDO_JWT, SENHA } from '../integracao/apoio/api';
import { montarApiSyncMemoria, VOLUME_OUTRAS, VOLUME_PADRAO, type ApiSyncMemoria } from '../integracao/apoio/sync-memoria';

const FERRAMENTA = fileURLToPath(new URL('../../scripts/carga/sync-basico.mjs', import.meta.url));
const RAIZ = fileURLToPath(new URL('../..', import.meta.url));
const MEDIR = process.env.MACUXI_CARGA_MEDIR === '1';
const P95_MS = Number(process.env.MACUXI_CARGA_P95_MS ?? 2000);
const RODADAS = 3;
const APARELHOS = [20, 50] as const;
/** Folga de execução (não é medida): máquina dividida com outros arquivos e agentes. */
const TETO_CASO_MS = 300_000;

export interface ResultadoCarga {
  tipo: 'carga_sync';
  url: string;
  aparelhos: number;
  rodadas: number;
  requisicoes: number;
  erros: Record<string, number>;
  latencia_ms: { p50: number; p95: number; max: number };
  duracao_ms: number;
  vazao_req_s: number;
  linhas_recebidas: number;
}

/** Roda a ferramenta como processo filho; credenciais só pelo ambiente do filho (nunca impressas). */
function rodarFerramenta(op: { url: string; empresa: string; email: string; senha: string; aparelhos: number }): Promise<{ codigo: number | null; resultado: ResultadoCarga | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const filho = spawn(process.execPath, [FERRAMENTA], {
      cwd: RAIZ,
      env: {
        ...process.env,
        MACUXI_CARGA_URL: op.url,
        MACUXI_CARGA_EMPRESA: op.empresa,
        MACUXI_CARGA_EMAIL: op.email,
        MACUXI_CARGA_SENHA: op.senha,
        MACUXI_CARGA_APARELHOS: String(op.aparelhos),
        MACUXI_CARGA_RODADAS: String(RODADAS),
        // fora do job de medição o tempo não reprova (o código de saída 1 fica só para erro)
        MACUXI_CARGA_P95_MS: String(MEDIR ? P95_MS : Number.MAX_SAFE_INTEGER),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    filho.stdout.on('data', (d) => (out += String(d)));
    filho.stderr.on('data', (d) => (err += String(d)));
    filho.on('error', reject);
    filho.on('close', (codigo) => {
      const ultima = out.trim().split('\n').at(-1) ?? '';
      let resultado: ResultadoCarga | null = null;
      try {
        resultado = ultima ? (JSON.parse(ultima) as ResultadoCarga) : null;
      } catch {
        resultado = null;
      }
      resolve({ codigo, resultado, stderr: err.trim() });
    });
  });
}

async function escutar(app: FastifyInstance): Promise<string> {
  await app.listen({ port: 0, host: '127.0.0.1' });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/v1`;
}

function registrar(rotulo: string, r: ResultadoCarga) {
  const { url: _u, ...semUrl } = r;
  console.log(`[carga T-0078] ${rotulo} ${JSON.stringify(semUrl)}`);
}

describe('T-0078 C1 — carga básica do sync SEM banco (API real, provedores em memória; mede o motor, não o Postgres)', () => {
  let api: ApiSyncMemoria;
  let url: string;
  let timer: ReturnType<typeof setInterval> | undefined;
  /** Linhas que uma sincronização completa traz (todas as entidades com pull). */
  let linhasPorAparelho = 0;

  beforeAll(async () => {
    api = montarApiSyncMemoria();
    url = await escutar(api.app);
    linhasPorAparelho = api.entidades.reduce((s, e) => s + (VOLUME_PADRAO[e] ?? VOLUME_OUTRAS), 0);
    timer = setInterval(() => api.mudar(), 200);
  });
  afterAll(async () => {
    if (timer) clearInterval(timer);
    await api?.app.close();
  });

  for (const n of APARELHOS) {
    it(
      `${n} aparelhos × ${RODADAS} rodadas: nenhum erro, sincronização completa em todos e /v1/saude sem alerta${MEDIR ? `; p95 ≤ ${P95_MS} ms` : ''}`,
      async () => {
        const r = await rodarFerramenta({ url, empresa: 'demo', email: 'vendedor.carga@exemplo.com.br', senha: 'senha-so-de-teste', aparelhos: n });
        expect(r.resultado, `saída ${r.codigo}: ${r.stderr}`).not.toBeNull();
        registrar(`sem banco, ${n} aparelhos`, r.resultado!);
        expect(r.resultado!.erros).toEqual({});
        expect(r.codigo).toBe(0);
        expect(r.resultado!.aparelhos).toBe(n);
        // cada aparelho: novidades + pull de cada entidade (produto em 2 páginas) + 2 rodadas leves
        expect(r.resultado!.requisicoes).toBeGreaterThanOrEqual(n * (1 + api.entidades.length + 1 + 2));
        expect(r.resultado!.linhas_recebidas).toBeGreaterThanOrEqual(n * linhasPorAparelho);
        if (MEDIR) expect(r.resultado!.latencia_ms.p95).toBeLessThanOrEqual(P95_MS);
        const saude = (await api.app.inject({ method: 'GET', url: '/v1/saude' })).json() as { alertas: string[]; metricas: { erros_5xx: number } };
        expect(saude.alertas).toEqual([]);
        expect(saude.metricas.erros_5xx).toBe(0);
      },
      TETO_CASO_MS,
    );
  }

  /**
   * DEFEITO T-0078-C1a (aberto em 05/11): scripts/carga/sync-basico.mjs faz o login em `${URL}/core/auth/login`
   * (= `/v1/core/auth/login`), mas a rota pública do Core é `/v1/auth/login` (modules/core/api/index.ts, `auth/login`;
   * montada em `/v1/<caminho>` por `montarRotaPublica` em apps/api/src/app.ts). Contra a API real (local ou demo) a
   * ferramenta sai com "login falhou (status 404)". Os casos acima só rodam porque o apoio em memória também responde no
   * caminho errado. Correção (engenheiro-software): `chamar('/auth/login', …)` e o filtro da latência por `'/auth/'`.
   */
  it.fails('D-C1a: a ferramenta entra pelo caminho real do login (/v1/auth/login) e roda contra uma API sem o caminho legado', async () => {
    const real = montarApiSyncMemoria({ caminhosLogin: ['/v1/auth/login'] });
    try {
      const u = await escutar(real.app);
      const r = await rodarFerramenta({ url: u, empresa: 'demo', email: 'vendedor.carga@exemplo.com.br', senha: 'senha-so-de-teste', aparelhos: 1 });
      expect(r.stderr).not.toMatch(/login falhou/);
      expect(r.codigo).toBe(0);
    } finally {
      await real.app.close();
    }
  }, TETO_CASO_MS);
});

describe.skipIf(semBanco())('T-0078 C1 — carga básica do sync COM Postgres (API real como macuxi_app, provedores reais; CI)', () => {
  let app: FastifyInstance;
  let url: string;
  let fechar: () => Promise<void>;

  beforeAll(async () => {
    const banco = await criarBancoDeTeste({ preparar: (c) => carregarDoisTenants(c, { senha: SENHA }).then(() => undefined) });
    const p = poolComEncerramento(new pg.Pool({ connectionString: banco.urlApp, max: 10 }));
    const coreApi = criarModuloApiCore({ segredo: () => SEGREDO_JWT });
    app = createApp({ banco: criarBancoApp(p.pool), modulos: MODULOS_API.map((m) => (m.manifesto.id === 'core' ? coreApi : m)), logger: false });
    // compatibilidade com o D-C1a enquanto a ferramenta chama /v1/core/auth/login: repassa ao login REAL do Core
    app.post('/v1/core/auth/login', async (req, reply) => {
      const r = await app.inject({ method: 'POST', url: '/v1/auth/login', payload: req.body as object, remoteAddress: req.ip });
      return reply.code(r.statusCode).header('content-type', 'application/json').send(r.body);
    });
    url = await escutar(app);
    await new Promise((r) => setTimeout(r, 2_500)); // horizonte do pull
    fechar = async () => {
      await app.close();
      await p.encerrar();
      await banco.apagar();
    };
  }, 300_000);
  afterAll(async () => {
    await fechar?.();
  });

  for (const n of APARELHOS) {
    it(
      `${n} aparelhos × ${RODADAS} rodadas (vendedor de A): nenhum erro e /v1/saude sem BANCO_FALHA nem ERROS_5XX${MEDIR ? `; p95 ≤ ${P95_MS} ms` : ''}`,
      async () => {
        const r = await rodarFerramenta({ url, empresa: A.codigo, email: 'vendedor@exemplo.com.br', senha: SENHA, aparelhos: n });
        expect(r.resultado, `saída ${r.codigo}: ${r.stderr}`).not.toBeNull();
        registrar(`com Postgres, ${n} aparelhos`, r.resultado!);
        expect(r.resultado!.erros).toEqual({});
        expect(r.codigo).toBe(0);
        expect(r.resultado!.requisicoes).toBeGreaterThanOrEqual(n * 2);
        if (MEDIR) expect(r.resultado!.latencia_ms.p95).toBeLessThanOrEqual(P95_MS);
        const saude = (await app.inject({ method: 'GET', url: '/v1/saude' })).json() as { alertas: string[]; dependencias: { banco: string } };
        expect(saude.dependencias.banco).toBe('ok');
        expect(saude.alertas).not.toContain('BANCO_FALHA');
        expect(saude.alertas).not.toContain('ERROS_5XX');
      },
      TETO_CASO_MS,
    );
  }
});
