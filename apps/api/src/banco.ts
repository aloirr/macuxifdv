/**
 * Banco da API (desenho T-0002 §4 e T-0004 §4): a API conecta SÓ com o papel `macuxi_app` e toca dado de
 * tenant SÓ dentro de `comTenant` (@macuxi/db: `set_config('app.tenant_id', $1, true)` por transação).
 * Falha fechada: na subida, recusa conexão com outro papel, superusuário ou papel com BYPASSRLS.
 * O horizonte do pull (§5) também mora aqui, porque olha as transações abertas no Postgres.
 */
import { comTenant, PAPEL_APP } from '@macuxi/db';
import type { AcessoBanco, ClienteBanco } from '@macuxi/platform-sdk';
import type pg from 'pg';

export interface BancoApp extends AcessoBanco {
  /** Confere o papel da conexão; erro = a API não sobe. */
  verificar(): Promise<void>;
  /**
   * Horizonte seguro do pull (§5): `least(now() - margem, início da transação aberta mais antiga)`.
   * Nenhuma transação ainda aberta consegue gravar `updated_at` (= now() do início dela) abaixo dele.
   */
  horizonteSync(): Promise<Date>;
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
}

export const MARGEM_HORIZONTE_PADRAO_MS = 2_000;

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
    comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c as ClienteBanco)),
    async semTenant(fn) {
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
    },
    async horizonteSync() {
      const r = await pool.query<{ horizonte: Date }>(SQL_HORIZONTE, [margem]);
      return r.rows[0]!.horizonte;
    },
  };
}
