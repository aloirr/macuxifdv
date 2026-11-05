/**
 * Apoio da T-0078 (agente `testes`): a API REAL (`createApp` de apps/api: hooks, request id, métricas, `/v1/saude`,
 * `preparar` com licença/perfil/carteira e o motor de sync `/v1/sync/novidades|pull|push`) sobre provedores de sync EM
 * MEMÓRIA, sem Postgres. Serve para:
 *  - L1 (log sem dado pessoal): exercitar pull, push e novidades com linhas cheias de dado pessoal fictício e conferir
 *    que nada disso aparece no log com o logger em `trace` (`opcoesLogger` real de apps/api/src/config.ts);
 *  - C1 (carga básica): medir o motor de sync (HTTP real + plataforma) com `scripts/carga/sync-basico.mjs`, quando o
 *    Docker não está ligado. Não mede o Postgres: a medida com banco é a variante `semBanco()` do teste de carga (CI).
 *
 * As entidades são as REAIS dos 8 módulos (`MODULOS_API`, com `escopo` e direção), só o `puxar`/`receber` é trocado.
 * Os módulos de fixture não têm rotas, rotas públicas, serviços nem Conector: login, autenticação, licença e carteira
 * vêm das opções do `createApp` (como em apps/api/test/apoio.ts).
 */
import { randomUUID } from 'node:crypto';
import { compararCursor, definirModuloApi, type CursorSync, type LinhaSync, type ModuloApi, type ModuloId, type ProvedorSync, type ResultadoItemPush, type UsuarioAutenticado } from '@macuxi/platform-sdk';
import type { FastifyInstance, FastifyServerOptions } from 'fastify';
import { z } from 'zod';
import { createApp } from '../../../apps/api/src/app';
import type { BancoApp } from '../../../apps/api/src/banco';
import { MODULOS_API } from '../../../apps/api/src/modulos';

export const TENANT_MEMORIA = '0a000000-0000-4000-8000-0000000000f8';
export const VENDEDOR_MEMORIA: UsuarioAutenticado = { id: '0b000000-0000-4000-8000-0000000000f8', tenant_id: TENANT_MEMORIA, perfil: 'vendedor' };

/** Dado pessoal fictício que vai nas linhas do pull e nos itens do push (o teste L1 procura cada um no log). */
export const DADO_PESSOAL = Object.freeze({
  email: 'maria.cliente.t0078@exemplo-pessoal.com.br',
  nome: 'Mercadinho Maria Aparecida dos Santos',
  cnpj: '12.345.678/0001-95',
  cnpjDigitos: '12345678000195',
  cpf: '123.456.789-09',
  cpfDigitos: '12345678909',
  telefone: '(92) 99123-4567',
  telefoneDigitos: '92991234567',
  senha: 'SenhaPessoal#T0078',
});

/** Volume padrão por entidade (o seed da demo tem 30 clientes e 36 produtos; aqui há folga e mais de uma página no produto). */
export const VOLUME_PADRAO: Readonly<Record<string, number>> = Object.freeze({ cliente: 300, produto: 1200, pedido: 500 });
export const VOLUME_OUTRAS = 40;

const BASE_MS = Date.parse('2026-10-01T12:00:00.000Z');

export interface ApiSyncMemoria {
  app: FastifyInstance;
  /** Token de acesso aceito pela autenticação de teste (Bearer). */
  token: string;
  /** Entidades com `puxar` (as mesmas que as novidades sem cursor devolvem para o vendedor). */
  entidades: string[];
  /** Linha nova no `pedido` logo abaixo do horizonte (as novidades seguintes passam a listar `pedido`). */
  mudar(): void;
  /** Itens recebidos pelo push (id → payload). */
  recebidos: Map<string, unknown>;
  /** Provedor que lança um erro qualquer (não `ErroHttpModulo`) no próximo push: vira 500 "erro não tratado". */
  falharProximoPush(erro: Error): void;
}

function linhasFicticias(entidade: string, n: number, comDadoPessoal: boolean): LinhaSync[] {
  const linhas: LinhaSync[] = [];
  for (let i = 0; i < n; i++) {
    const id = `${entidade.length.toString(16).padStart(8, '0')}-0000-4000-8000-${i.toString(16).padStart(12, '0')}`;
    linhas.push({
      id,
      updated_at: new Date(BASE_MS + i * 1000).toISOString(),
      deleted_at: null,
      ...(comDadoPessoal
        ? { nome: DADO_PESSOAL.nome, email: DADO_PESSOAL.email, cnpj: DADO_PESSOAL.cnpj, cpf: DADO_PESSOAL.cpf, telefone: DADO_PESSOAL.telefone }
        : { codigo: `${entidade}-${i}`, valor_centavos: i * 100 }),
    } as LinhaSync);
  }
  return linhas;
}

/** Igual ao SQL dos provedores: `(updated_at, id) > desde`, `updated_at < ate`, ordem e limite. */
function fatiar(linhas: readonly LinhaSync[], p: { desde: CursorSync | null; ate: string; limite: number }): LinhaSync[] {
  const ate = Date.parse(p.ate);
  const out: LinhaSync[] = [];
  for (const l of linhas) {
    if (Date.parse(l.updated_at) >= ate) continue;
    if (p.desde && compararCursor(l, p.desde) <= 0) continue;
    out.push(l);
  }
  return out.sort(compararCursor).slice(0, p.limite);
}

export function montarApiSyncMemoria(
  op: {
    logger?: FastifyServerOptions['logger'];
    volume?: Record<string, number>;
    comDadoPessoal?: boolean;
    /** Payload do push do `pedido` sem o schema real (o teste L1 manda texto livre com dado pessoal até o provedor). */
    pedidoLivre?: boolean;
  } = {},
): ApiSyncMemoria {
  const token = `carga-${randomUUID()}`;
  const volume = { ...VOLUME_PADRAO, ...(op.volume ?? {}) };
  const dados = new Map<string, LinhaSync[]>();
  const recebidos = new Map<string, unknown>();
  let falha: Error | null = null;
  const entidades: string[] = [];

  const modulos: ModuloApi[] = MODULOS_API.map((m) => {
    const sync: ProvedorSync[] = (m.sync ?? []).map((p) => {
        const nome = p.entidade.nome;
        if (p.puxar) {
          entidades.push(nome);
          dados.set(nome, linhasFicticias(nome, volume[nome] ?? VOLUME_OUTRAS, op.comDadoPessoal ?? false));
        }
        const entidade = op.pedidoLivre && nome === 'pedido' ? { ...p.entidade, schema: z.record(z.unknown()) } : p.entidade;
        return {
          entidade,
          ...(p.escopo ? { escopo: p.escopo } : {}),
          ...(p.puxar ? { puxar: async (_ctx: unknown, pedido: Parameters<NonNullable<ProvedorSync['puxar']>>[1]) => fatiar(dados.get(nome)!, pedido) } : {}),
          ...(p.receber
            ? {
                receber: async (_ctx, itens): Promise<ResultadoItemPush[]> => {
                  if (falha) {
                    const e = falha;
                    falha = null;
                    throw e;
                  }
                  return itens.map((i) => {
                    recebidos.set(i.id, i.payload);
                    return { id: i.id, status: 'aceito' as const };
                  });
                },
              }
            : {}),
        };
      });
    return definirModuloApi({ manifesto: m.manifesto, sync });
  });

  const todos = MODULOS_API.map((m) => m.manifesto.id) as ModuloId[];
  const carteira = new Set(dados.get('cliente')?.map((l) => l.id) ?? []);
  const banco: BancoApp = {
    verificar: async () => undefined,
    comTenant: async (_t, fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as never),
    semTenant: async (fn) => fn({ query: async () => ({ rows: [], rowCount: 0 }) } as never),
    horizonteSync: async () => new Date(Date.now() - 2_000), // hora-fixa-ok: a carga roda por HTTP real em outro processo; BASE_MS só data as linhas fixas, sempre no passado
    instanteSync: async () => new Date(), // hora-fixa-ok: idem
    resumoOutbox: async () => ({ pendentes: 0, parados: 0, mais_antigo_s: null }),
  };

  const app = createApp({
    modulos,
    banco,
    logger: op.logger ?? false,
    autenticar: async (h) => (h.authorization === `Bearer ${token}` ? VENDEDOR_MEMORIA : null),
    licencas: async () => ({ ativosNoTenant: todos, doPerfil: todos, removidosDoUsuario: [], parametros: {} }),
    carteira: async () => carteira,
    usuariosVisiveis: async (u) => new Set([u.id]),
  });

  // login de teste só no caminho real do Core (modules/core/api/index.ts, rota pública `auth/login` → `/v1/auth/login`);
  // o caminho legado `/v1/core/auth/login` saiu com a correção do D-C1a (T-0078).
  app.post('/v1/auth/login', async () => ({ access_token: token, token_type: 'Bearer', expires_in: 900, refresh_token: `${TENANT_MEMORIA}.x` }));

  return {
    app,
    token,
    entidades,
    recebidos,
    mudar() {
      const lista = dados.get('pedido');
      if (!lista) return;
      lista.push({ id: randomUUID(), updated_at: new Date(Date.now() - 2_100).toISOString(), deleted_at: null } as LinhaSync); // hora-fixa-ok: linha nova logo abaixo do horizonte real
    },
    falharProximoPush(erro) {
      falha = erro;
    },
  };
}
