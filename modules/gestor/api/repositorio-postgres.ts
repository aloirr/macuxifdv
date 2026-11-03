/**
 * Repositório do Gestor no Postgres (T-0055; roteiro em docs/banco/gestor.md §3). SQL só no schema `gestor`, sempre na
 * transação do tenant (`AcessoTenant.db`, papel macuxi_app, RLS): o worker grava (consumidor) e a API lê, em processos
 * diferentes, pelo banco. O `tenant_id` vem do token ou do envelope (nunca do corpo); as consultas também o filtram
 * explicitamente (defesa em profundidade além da RLS).
 */
import { achatarEstado, montarEstado } from '../db/projecao';
import type { AjusteRegraAlerta, AjustesRegras, Alerta } from '../contracts';
import { aplicarEventos, type EstadoProjecao, type OperacoesAlerta, type SituacaoAplicacao } from '../domain';
import type { AcessoTenant, RepositorioGestor } from './repositorio';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const RETENCAO_DIAS = 120;

interface LinhaAlerta {
  id: string;
  chave: string;
  tipo: Alerta['tipo'];
  alvo_tipo: Alerta['alvo_tipo'];
  alvo_id: string;
  responsavel_id: string | null;
  valor: number | null;
  limiar: number | null;
  severidade: Alerta['severidade'];
  mensagem: string;
  status: Alerta['status'];
  aberto_em: string;
  encerrado_em: string | null;
  motivo_encerramento: Alerta['motivo_encerramento'];
}

const COLUNAS_ALERTA = `id, chave, tipo, alvo_tipo, alvo_id, responsavel_id, valor, limiar, severidade, mensagem, status,
  to_char(aberto_em at time zone 'UTC', ${UTC}) as aberto_em,
  to_char(encerrado_em at time zone 'UTC', ${UTC}) as encerrado_em, motivo_encerramento`;

const lock = (a: AcessoTenant, ambito: string) => a.db.query(`select pg_advisory_xact_lock(hashtext($1))`, [`gestor:${ambito}:${a.tenant_id}`]);

async function lerEstado(a: AcessoTenant): Promise<EstadoProjecao> {
  const fatos = await a.db.query<{ tabela: never; chave: string; dados: unknown }>(
    `select tabela, chave, dados from gestor.projecao_fato where tenant_id = $1 and deleted_at is null`,
    [a.tenant_id],
  );
  const ids = await a.db.query<{ evento_id: string }>(`select evento_id from gestor.evento_aplicado where tenant_id = $1 and deleted_at is null`, [a.tenant_id]);
  return montarEstado(fatos.rows, ids.rows.map((r) => r.evento_id));
}

export function criarRepositorioPostgres(): RepositorioGestor {
  return {
    estado: lerEstado,

    async aplicar(a, eventos) {
      await lock(a, 'projecao');
      const antes = await lerEstado(a);
      const r = aplicarEventos(antes, eventos);

      // idempotência por evento_id (o domain decide; aqui só gravamos o que ficou novo em `processados`)
      for (const e of eventos) {
        if (!r.estado.processados[e.evento_id] || antes.processados[e.evento_id]) continue;
        await a.db.query(
          `insert into gestor.evento_aplicado (tenant_id, evento_id, nome, ocorrido_em) values ($1, $2, $3, $4)
           on conflict (tenant_id, evento_id) do nothing`,
          [a.tenant_id, e.evento_id, e.nome, e.ocorrido_em],
        );
      }

      // fatos que mudaram (por tabela|chave)
      const anteriores = new Map(achatarEstado(antes).map((f) => [`${f.tabela}|${f.chave}`, JSON.stringify(f.dados)]));
      for (const f of achatarEstado(r.estado)) {
        const json = JSON.stringify(f.dados);
        if (anteriores.get(`${f.tabela}|${f.chave}`) === json) continue;
        await a.db.query(
          `insert into gestor.projecao_fato (tenant_id, tabela, chave, carimbo, dados, ocorrido_em, usuario_id)
           values ($1, $2, $3, $4, $5::jsonb, $6, $7)
           on conflict (tenant_id, tabela, chave) do update set carimbo = excluded.carimbo, dados = excluded.dados,
             ocorrido_em = excluded.ocorrido_em, usuario_id = excluded.usuario_id, deleted_at = null`,
          [a.tenant_id, f.tabela, f.chave, f.carimbo, json, f.ocorrido_em, f.usuario_id],
        );
      }

      // retenção de 120 dias da idempotência (R-20261102-194357-banco-dados): pela API sob RLS, sem função do banco
      await a.db.query(`delete from gestor.evento_aplicado where tenant_id = $1 and created_at < now() - ($2::int * interval '1 day')`, [a.tenant_id, RETENCAO_DIAS]);

      return { contagem: r.contagem as Record<SituacaoAplicacao, number>, avisos: r.avisos };
    },

    async alertas(a) {
      const r = await a.db.query<LinhaAlerta>(`select ${COLUNAS_ALERTA} from gestor.alerta where tenant_id = $1 and deleted_at is null order by aberto_em, id`, [a.tenant_id]);
      return r.rows.map((x) => ({ ...x, valor: x.valor === null ? null : Number(x.valor), limiar: x.limiar === null ? null : Number(x.limiar) }));
    },

    async aplicarOperacoesAlerta(a, ops: OperacoesAlerta, o) {
      if (ops.abrir.length + ops.atualizar.length + ops.encerrar.length === 0) return;
      await lock(a, 'alerta');
      for (const x of ops.encerrar) {
        await a.db.query(
          `update gestor.alerta set status = 'encerrado', encerrado_em = $3, motivo_encerramento = $4 where tenant_id = $1 and id = $2`,
          [a.tenant_id, x.id, x.encerrado_em, x.motivo],
        );
      }
      for (const x of ops.atualizar) {
        await a.db.query(`update gestor.alerta set valor = $3, mensagem = $4, severidade = $5 where tenant_id = $1 and id = $2`, [a.tenant_id, x.id, x.valor, x.mensagem, x.severidade]);
      }
      for (const c of ops.abrir) {
        await a.db.query(
          `insert into gestor.alerta (id, tenant_id, chave, tipo, alvo_tipo, alvo_id, responsavel_id, valor, limiar, severidade, mensagem, status, aberto_em)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'aberto', $12)`,
          [o.novoId(), a.tenant_id, c.chave, c.tipo, c.alvo_tipo, c.alvo_id, c.responsavel_id, c.valor, c.limiar, c.severidade, c.mensagem, o.agora],
        );
      }
    },

    async gravarAlerta(a, alerta) {
      await a.db.query(
        `update gestor.alerta set status = $3, encerrado_em = $4, motivo_encerramento = $5, valor = $6, mensagem = $7, severidade = $8
         where tenant_id = $1 and id = $2`,
        [a.tenant_id, alerta.id, alerta.status, alerta.encerrado_em, alerta.motivo_encerramento, alerta.valor, alerta.mensagem, alerta.severidade],
      );
    },

    async ajustesRegras(a) {
      const r = await a.db.query<{ tipo: string; ajuste: AjusteRegraAlerta }>(`select tipo, ajuste from gestor.alerta_regra where tenant_id = $1 and deleted_at is null`, [a.tenant_id]);
      const saida: Record<string, AjusteRegraAlerta> = {};
      for (const x of r.rows) saida[x.tipo] = x.ajuste;
      return saida as AjustesRegras;
    },

    async gravarAjustesRegras(a, ajustes) {
      await lock(a, 'regras');
      const tipos = Object.keys(ajustes);
      for (const tipo of tipos) {
        await a.db.query(
          `insert into gestor.alerta_regra (tenant_id, tipo, ajuste) values ($1, $2, $3::jsonb)
           on conflict (tenant_id, tipo) do update set ajuste = excluded.ajuste, deleted_at = null`,
          [a.tenant_id, tipo, JSON.stringify((ajustes as Record<string, unknown>)[tipo])],
        );
      }
      await a.db.query(`delete from gestor.alerta_regra where tenant_id = $1 and not (tipo = any($2::text[]))`, [a.tenant_id, tipos]);
    },
  };
}
