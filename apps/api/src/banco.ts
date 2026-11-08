/**
 * Banco da API (desenho T-0002 §4 e T-0004 §4): a API conecta SÓ com o papel `macuxi_app` e toca dado de
 * tenant SÓ dentro de `comTenant` (@macuxi/db: `set_config('app.tenant_id', $1, true)` por transação).
 * Falha fechada: na subida, recusa conexão com outro papel, superusuário ou papel com BYPASSRLS.
 * T-0091: a sessão do super-admin (funções `plataforma.sa_*`) vai por um 2º pool, do papel `macuxi_portal` (`criarBancoPortal`).
 * O horizonte do pull (§5) também mora aqui, porque olha as transações abertas no Postgres.
 * T-0118 (D-T0107a): toda transação aberta aqui fica marcada na cadeia assíncrona (`dentroDaTransacao`) e todo pedido de
 * conexão passa pela guarda: outra conexão do MESMO pool com uma transação dele aberta é acusada (erro em teste e
 * desenvolvimento, aviso em produção; `transacao-corrente.ts`).
 */
import { comTenant, PAPEL_APP, PAPEL_PORTAL } from '@macuxi/db';
import type { AcessoBanco, ClienteBanco } from '@macuxi/platform-sdk';
import type pg from 'pg';
import { resumoDaLinha, type ResumoOutbox } from './observabilidade';
import { criarGuardaConexao, dentroDaTransacao, type OpcoesGuardaConexao } from './transacao-corrente';

export interface BancoApp extends AcessoBanco {
  /** Confere o papel da conexão; erro = a API não sobe. */
  verificar(): Promise<void>;
  /**
   * Horizonte seguro do pull (§5): `least(now() - margem, início da transação aberta mais antiga)`.
   * Nenhuma transação ainda aberta consegue gravar `updated_at` (= now() do início dela) abaixo dele.
   */
  horizonteSync(): Promise<Date>;
  /** Relógio do banco agora (`clock_timestamp()`): instante do aceite no push, comparável ao horizonte (D-3). */
  instanteSync(): Promise<Date>;
  /**
   * ADR 0021: `plataforma.tenant.geracao_base` do tenant (pela RLS do `macuxi_app`). `undefined` = banco sem a coluna (antes
   * da 0022) ou tenant sem linha: o pull e as novidades seguem sem o campo. Opcional para os bancos falsos dos testes.
   */
  geracaoBase?(tenantId: string): Promise<string | undefined>;
  /**
   * T-0078: contagens da outbox de todos os tenants (`plataforma.resumo_outbox`, SECURITY DEFINER, só números) para
   * `GET /v1/saude`. `undefined` = banco sem a função. Opcional para os bancos falsos dos testes.
   */
  resumoOutbox?(nomes: readonly string[], maxTentativas: number): Promise<ResumoOutbox | undefined>;
}

export class ErroPapelBanco extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroPapelBanco';
  }
}

export interface OpcoesBanco {
  /** Margem mínima do horizonte (padrão 2 s): cobre o atraso entre o início da transação e o registro em pg_stat_activity. */
  margemHorizonteMs?: number;
  /** T-0118: guarda de conexão pedida dentro de transação do mesmo pool (padrão: `MACUXI_GUARDA_CONEXAO` / `NODE_ENV`). */
  guardaConexao?: OpcoesGuardaConexao;
}

export const MARGEM_HORIZONTE_PADRAO_MS = 2_000;

/** Coluna ausente (banco antes da 0022): a API tenta de novo depois deste intervalo, sem repetir o erro a cada página. */
const ESPERA_SEM_COLUNA_MS = 60_000;
const COLUNA_INEXISTENTE = '42703';
const FUNCAO_INEXISTENTE = '42883';

/**
 * Transações de OUTROS backends do mesmo banco. O `macuxi_app` só enxerga `xact_start` de sessões do próprio
 * papel — e é ele quem grava as tabelas sincronizadas (a API e o Hub escrevem pela API). Migrações e seeds
 * (administrador) não entram no cálculo: rodam com a API parada ou fora do horário de sync.
 */
const SQL_HORIZONTE = `
  select least(
           now() - make_interval(secs => $1::double precision / 1000),
           coalesce((select min(a.xact_start)
                       from pg_stat_activity a
                      where a.datname = current_database()
                        and a.pid <> pg_backend_pid()
                        and a.xact_start is not null), 'infinity'::timestamptz)
         ) as horizonte`;

export function criarBancoApp(pool: pg.Pool, op: OpcoesBanco = {}): BancoApp {
  const margem = op.margemHorizonteMs ?? MARGEM_HORIZONTE_PADRAO_MS;
  const guardar = criarGuardaConexao(pool, op.guardaConexao);
  let semColunaAte = 0;
  let semResumoAte = 0;
  return {
    async verificar() {
      const r = await pool.query<{ usuario: string; superusuario: boolean; ignora_rls: boolean }>(
        'select current_user as usuario, r.rolsuper as superusuario, r.rolbypassrls as ignora_rls from pg_roles r where r.rolname = current_user',
      );
      const papel = r.rows[0];
      if (!papel) throw new ErroPapelBanco('Não foi possível ler o papel da conexão.');
      if (papel.usuario !== PAPEL_APP) throw new ErroPapelBanco(`A API só conecta como ${PAPEL_APP} (conectou como ${papel.usuario}).`);
      if (papel.superusuario || papel.ignora_rls) throw new ErroPapelBanco(`${PAPEL_APP} não pode ser superusuário nem ter BYPASSRLS.`);
    },
    async comTenant(tenantId, fn) {
      guardar('comTenant');
      return comTenant(pool, tenantId, (c) => dentroDaTransacao(pool, c as ClienteBanco, tenantId, () => fn(c as ClienteBanco)));
    },
    async semTenant(fn) {
      guardar('semTenant');
      return transacaoSemTenant(pool, (c) => dentroDaTransacao(pool, c, null, () => fn(c)));
    },
    async horizonteSync() {
      guardar('horizonteSync');
      const r = await pool.query<{ horizonte: Date }>(SQL_HORIZONTE, [margem]);
      return r.rows[0]!.horizonte;
    },
    async instanteSync() {
      guardar('instanteSync');
      const r = await pool.query<{ agora: Date }>('select clock_timestamp() as agora');
      return r.rows[0]!.agora;
    },
    async geracaoBase(tenantId) {
      if (Date.now() < semColunaAte) return undefined;
      guardar('geracaoBase');
      try {
        return await comTenant(pool, tenantId, async (c) => {
          const r = await c.query<{ geracao: string | null }>(
            'select geracao_base::text as geracao from plataforma.tenant where id = $1',
            [tenantId],
          );
          return r.rows[0]?.geracao ?? undefined;
        });
      } catch (e) {
        if ((e as { code?: unknown }).code !== COLUNA_INEXISTENTE) throw e;
        semColunaAte = Date.now() + ESPERA_SEM_COLUNA_MS;
        return undefined;
      }
    },
    async resumoOutbox(nomes, maxTentativas) {
      if (Date.now() < semResumoAte) return undefined;
      guardar('resumoOutbox');
      try {
        const r = await pool.query<{ pendentes: number; parados: number; mais_antigo_s: number | null }>(
          'select pendentes, parados, mais_antigo_s from plataforma.resumo_outbox($1::text[], $2::int)',
          [[...nomes], maxTentativas],
        );
        return resumoDaLinha(r.rows[0]);
      } catch (e) {
        if ((e as { code?: unknown }).code !== FUNCAO_INEXISTENTE) throw e;
        semResumoAte = Date.now() + ESPERA_SEM_COLUNA_MS;
        return undefined;
      }
    },
  };
}

// ---------- T-0091: conexão do portal (papel macuxi_portal; condição da ADR 0029) ----------

/** Papel do portal (T-0091; @macuxi/db): o único com EXECUTE nas `plataforma.sa_*`, sem grant em tabela nenhuma (0038). */
export { PAPEL_PORTAL };

/** Conexões do pool do portal (`MACUXI_API_POOL_PORTAL`; desenho T-0091 §3 item 3: API 10 + portal 2 + worker 2 + 4 = 18). */
export const POOL_PORTAL_PADRAO = 2;

/**
 * Prazo da `sa_provisionar_tenant` no pool do portal (desenho T-0091 §3 item 5). Ela grava `plataforma.parametro` (entidade de
 * sync do Core) noutro papel, invisível ao `SQL_HORIZONTE` do `macuxi_app`; abaixo da margem do horizonte, a linha nunca fica
 * atrás do cursor do pull. Teste amarra as duas constantes.
 */
export const PRAZO_PROVISIONAR_PORTAL_MS = 1_500;

/** Conexão do super-admin: só `semTenant` (funções `sa_*`); `comTenant` é erro de programação (o portal não lê tenant). */
export interface BancoPortal extends AcessoBanco {
  /** Confere o papel da conexão (`macuxi_portal`, sem superusuário/BYPASSRLS); erro = a API não sobe. */
  verificar(): Promise<void>;
}

export function criarBancoPortal(pool: pg.Pool): BancoPortal {
  return {
    async verificar() {
      const r = await pool.query<{ usuario: string; superusuario: boolean; ignora_rls: boolean }>(
        'select current_user as usuario, r.rolsuper as superusuario, r.rolbypassrls as ignora_rls from pg_roles r where r.rolname = current_user',
      );
      const papel = r.rows[0];
      if (!papel) throw new ErroPapelBanco('Não foi possível ler o papel da conexão do portal.');
      if (papel.usuario !== PAPEL_PORTAL) throw new ErroPapelBanco(`O portal só conecta como ${PAPEL_PORTAL} (conectou como ${papel.usuario}).`);
      if (papel.superusuario || papel.ignora_rls) throw new ErroPapelBanco(`${PAPEL_PORTAL} não pode ser superusuário nem ter BYPASSRLS.`);
    },
    comTenant: async () => {
      throw new Error('A conexão do portal (macuxi_portal) nunca abre tenant: dado de tenant vai pelo macuxi_app (T-0091).');
    },
    semTenant: (fn) => transacaoSemTenant(pool, fn),
  };
}

async function transacaoSemTenant<T>(pool: pg.Pool, fn: (c: ClienteBanco) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const r = await fn(c as ClienteBanco);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally {
    c.release();
  }
}
