/**
 * Apoio dos testes de API do agente `testes` (T-0006; validação final de T-0003/T-0004).
 *
 * Sobe o `createApp` REAL (apps/api) com os 8 módulos de `MODULOS_API`, o Core com o JWT de verdade e o banco
 * pelo papel `macuxi_app` (RLS), num banco efêmero PRÓPRIO do arquivo (dois-tenants), para que ligar e desligar
 * licenças não interfira nos testes de vazamento que leem o banco compartilhado do globalSetup.
 * Nada aqui é simulado: login (argon2id), licenças lidas a cada requisição, outbox e auditoria no Postgres.
 * T-0091 (condição da ADR 0029): a API sobe com o 2º pool, do papel `macuxi_portal` (`criarBancoPortal`), como em produção;
 * `semPortal: true` sobe sem ele (o portal responde 503 e os tenants seguem). `sqlApp`/`sqlPortal` guardam o texto de cada
 * comando de cada pool (só o SQL, nunca os parâmetros), para provar qual conexão cada rota usou.
 */
import { MeusModulosRespostaSchema, SessaoRespostaSchema, type MeusModulosResposta, type SessaoResposta } from '@macuxi/core/contracts';
import { criarModuloApiCore } from '@macuxi/core/api';
import { carregarDoisTenants, criarBancoDeTeste, DOIS_TENANTS, type BancoDeTeste } from '@macuxi/db/teste';
import { ErroApiSchema, type ErroApi, type ModuloApi } from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyServerOptions, InjectOptions, LightMyRequestResponse } from 'fastify';
import pg from 'pg';
import { createApp } from '../../../apps/api/src/app';
import type { ArmazenamentoArquivos } from '../../../apps/api/src/arquivos';
import { criarBancoApp, criarBancoPortal } from '../../../apps/api/src/banco';
import { MODULOS_API } from '../../../apps/api/src/modulos';
import { comEmail, type criarEspiaoEmail } from './email';

export const A = DOIS_TENANTS.A;
export const B = DOIS_TENANTS.B;
export const SENHA = process.env.MACUXI_SENHA_TESTE ?? 'Teste@1234';
/** Segredo só de teste (o real fica no .env). */
export const SEGREDO_JWT = 'segredo-do-agente-testes-com-mais-de-32-caracteres';

export type Tenant = typeof A | typeof B;

export interface ApiDeTeste {
  app: FastifyInstance;
  pool: pg.Pool;
  admin: pg.Pool;
  /** Pool do macuxi_portal (T-0091) ou null com `semPortal` / sem a senha do papel no ambiente. */
  poolPortal: pg.Pool | null;
  /** SQL de cada comando do pool do macuxi_app / do macuxi_portal, na ordem (sem parâmetros); só com `espiarSql`. */
  sqlApp: string[];
  sqlPortal: string[];
  banco: BancoDeTeste;
  modulos: readonly ModuloApi[];
  /** POST /v1/auth/login (cada chamada vem de um IP próprio, para não esbarrar no limite de 5/5 min). */
  /** `app` (T-0094, RN-CORE-33): o app que pede o login; ausente = não confere (APK antigo). */
  entrar(email: string, opcoes?: { senha?: string; tenant?: Tenant; ip?: string; dispositivo_id?: string; app?: 'campo' | 'gestao' | 'web' }): Promise<LightMyRequestResponse>;
  /** Login que precisa dar certo: devolve a sessão validada pelo contrato do Core. */
  sessao(email: string, tenant?: Tenant): Promise<SessaoResposta>;
  chamar(token: string | null, op: InjectOptions): Promise<LightMyRequestResponse>;
  meusModulos(token: string): Promise<MeusModulosResposta>;
  fechar(): Promise<void>;
}

let ipSeq = 0;
/** IP único por login (o limite é por IP + código da empresa). */
export const novoIp = () => {
  ipSeq += 1;
  return `10.${(ipSeq >> 16) & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
};

export const comToken = (token: string | null): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});

export function erroDe(r: { json(): unknown }): ErroApi {
  return ErroApiSchema.parse(r.json());
}

/**
 * Encerramento de pool sem corrida com o `drop database ... with (force)` do `banco.apagar()` (R-20261103-054924,
 * 57P01 "terminating connection due to administrator command" solto no CI da carga). O `pool.end()` do pg-pool resolve
 * assim que tira os clientes da lista, ANTES de cada socket fechar; se o drop chega nesse intervalo, o Postgres manda
 * FATAL 57P01 a um cliente ainda ocioso e o pool o emite como 'error' sem ouvinte (erro não tratado → Vitest sai 1).
 * Aqui: (1) conta os clientes vivos (connect/remove) e o `encerrar()` só volta quando todos fecharam de fato (teto de
 * 10 s); (2) ouvinte de 'error' no pool que, DURANTE o encerramento, ignora só a queda de conexão do teardown; fora dele
 * o erro continua subindo como antes (nada é engolido enquanto os casos rodam).
 */
const QUEDA_DO_TEARDOWN = new Set(['57P01', '57P02', '57P03']);

/**
 * Registra o texto de cada comando dos clientes do pool (T-0091: qual conexão a rota usou). Só o SQL, nunca os parâmetros
 * (não leva dado pessoal nem segredo para a memória do teste). Cada cliente é embrulhado uma vez, no 1º `acquire`.
 */
const ESPIADO = Symbol('espiado');
export function espiarPool(pool: pg.Pool, destino: string[]): void {
  pool.on('acquire', (cliente) => {
    const c = cliente as unknown as { query: (...a: unknown[]) => unknown; [ESPIADO]?: true };
    if (c[ESPIADO]) return;
    c[ESPIADO] = true;
    const original = c.query.bind(c);
    c.query = (...a: unknown[]) => {
      const x = a[0];
      destino.push(typeof x === 'string' ? x : typeof (x as { text?: unknown } | null)?.text === 'string' ? (x as { text: string }).text : '');
      return original(...a);
    };
  });
}
export function poolComEncerramento(pool: pg.Pool): { pool: pg.Pool; encerrar(ms?: number): Promise<void> } {
  let encerrando = false;
  let vivos = 0;
  let aoZerar: (() => void) | null = null;
  pool.on('connect', () => {
    vivos += 1;
  });
  pool.on('remove', () => {
    vivos -= 1;
    if (vivos <= 0) aoZerar?.();
  });
  pool.on('error', (err: Error & { code?: string }) => {
    if (encerrando && (QUEDA_DO_TEARDOWN.has(err.code ?? '') || /Connection terminated/i.test(err.message))) return;
    throw err;
  });
  return {
    pool,
    async encerrar(ms = 10_000) {
      encerrando = true;
      const fechados = new Promise<void>((r) => {
        aoZerar = r;
      });
      await pool.end().catch(() => undefined);
      if (vivos > 0) await Promise.race([fechados, new Promise((r) => setTimeout(r, ms))]);
    },
  };
}

export async function subirApi(
  opcoes: {
    logger?: FastifyServerOptions['logger'];
    poolMax?: number;
    /** Bytes das fotos (ADR 0010); sem ele o upload responde 503. */
    arquivos?: ArmazenamentoArquivos;
    /** Relógio das rotas (`ctx.agora()`; T-0080). A verificação do JWT segue o relógio real: faça o login com ele no real. */
    relogio?: () => Date;
    /** Segredos do portal do super-admin (T-0087; ADR 0029). Sem ele, os do ambiente (no teste: ausentes = 503). */
    plataforma?: Parameters<typeof criarModuloApiCore>[1];
    /** T-0091: sobe SEM o pool do macuxi_portal (como o servidor sem MACUXI_PG_PORTAL_SENHA): portal = 503. */
    semPortal?: boolean;
    /** T-0091: guarda o SQL de cada pool em `sqlApp`/`sqlPortal` (desligado por padrão: a carga não acumula memória). */
    espiarSql?: boolean;
    /** T-0094: espião da porta de e-mail (desenho §10) no `ctx.email` das rotas do Core (apoio/email.ts). */
    email?: ReturnType<typeof criarEspiaoEmail>;
  } = {},
): Promise<ApiDeTeste> {
  const banco = await criarBancoDeTeste({ preparar: (c) => carregarDoisTenants(c, { senha: SENHA }).then(() => undefined) });
  const app_ = poolComEncerramento(new pg.Pool({ connectionString: banco.urlApp, max: opcoes.poolMax ?? 6 }));
  const admin_ = poolComEncerramento(new pg.Pool({ connectionString: banco.urlAdmin, max: 2 }));
  // T-0091: o 2º pool, do macuxi_portal (o único com EXECUTE nas plataforma.sa_*); max 2, como o padrão do servidor
  const portal_ = !opcoes.semPortal && banco.urlPortal ? poolComEncerramento(new pg.Pool({ connectionString: banco.urlPortal, max: 2 })) : null;
  const pool = app_.pool;
  const admin = admin_.pool;
  const sqlApp: string[] = [];
  const sqlPortal: string[] = [];
  if (opcoes.espiarSql) {
    espiarPool(pool, sqlApp);
    if (portal_) espiarPool(portal_.pool, sqlPortal);
  }
  const coreApi = opcoes.plataforma ? criarModuloApiCore({ segredo: () => SEGREDO_JWT }, opcoes.plataforma) : criarModuloApiCore({ segredo: () => SEGREDO_JWT });
  const coreComEmail = opcoes.email ? comEmail(coreApi, opcoes.email) : coreApi;
  const modulos = MODULOS_API.map((m) => (m.manifesto.id === 'core' ? coreComEmail : m));
  const app = createApp({
    banco: criarBancoApp(pool),
    bancoPortal: portal_ ? criarBancoPortal(portal_.pool) : null,
    modulos,
    logger: opcoes.logger ?? false,
    arquivos: opcoes.arquivos ?? null,
    ...(opcoes.relogio ? { relogio: opcoes.relogio } : {}),
  });
  await app.ready();

  const entrar: ApiDeTeste['entrar'] = (email, o = {}) =>
    app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress: o.ip ?? novoIp(),
      payload: { codigo_empresa: (o.tenant ?? A).codigo, email, senha: o.senha ?? SENHA, ...(o.dispositivo_id ? { dispositivo_id: o.dispositivo_id } : {}), ...(o.app ? { app: o.app } : {}) },
    });

  const api: ApiDeTeste = {
    app,
    pool,
    admin,
    poolPortal: portal_?.pool ?? null,
    sqlApp,
    sqlPortal,
    banco,
    modulos,
    entrar,
    async sessao(email, tenant = A) {
      const r = await entrar(email, { tenant });
      if (r.statusCode !== 200) throw new Error(`login de ${email} em ${tenant.codigo} falhou: ${r.statusCode} ${r.body}`);
      return SessaoRespostaSchema.parse(r.json());
    },
    chamar: (token, op) => app.inject({ ...op, headers: { ...comToken(token), ...(op.headers ?? {}) } }),
    async meusModulos(token) {
      const r = await app.inject({ method: 'GET', url: '/v1/me/modulos', headers: comToken(token) });
      if (r.statusCode !== 200) throw new Error(`/v1/me/modulos: ${r.statusCode} ${r.body}`);
      return MeusModulosRespostaSchema.parse(r.json());
    },
    async fechar() {
      await app.close().catch(() => undefined);
      // os dois pools fecham de fato (sockets encerrados) antes do drop com force
      await app_.encerrar();
      await portal_?.encerrar();
      await admin_.encerrar();
      await banco.apagar().catch(() => undefined);
    },
  };
  return api;
}

/** Liga/desliga licença pela rota real do Core (admin). `nivel`: tenant, perfil (`alvo` = perfil) ou usuário (`alvo` = id). */
export function licenca(
  api: ApiDeTeste,
  tokenAdmin: string,
  nivel: 'tenant' | 'perfil' | 'usuario',
  modulo: string,
  ativo: boolean,
  alvo?: string,
): Promise<LightMyRequestResponse> {
  const url =
    nivel === 'tenant' ? `/v1/core/licencas/tenant/${modulo}` : nivel === 'perfil' ? `/v1/core/licencas/perfis/${alvo}/${modulo}` : `/v1/core/licencas/usuarios/${alvo}/${modulo}`;
  return api.chamar(tokenAdmin, { method: 'PUT', url, payload: { ativo } });
}

export const ids = (r: MeusModulosResposta) => r.modulos.map((m) => m.id);
