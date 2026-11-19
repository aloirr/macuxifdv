/**
 * Aprovações do pedido, uma por motivo (T-0184, P3 B): leitura e gravação da `vendedor.pedido_aprovacao` (migração do banco-dados).
 * Só o ciclo atual do pedido (`vendedor.pedido.aprovacao_ciclo`); o reenvio depois de uma devolução abre o ciclo seguinte.
 * A regra de quem decide e do que muda mora no domínio (`decidirAprovacao`); aqui só se lê e se grava.
 */
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import type { ClienteBanco, TransacaoTenant } from '@macuxi/platform-sdk';
import type { AprovacaoMotivo } from '../contracts';
import { MOTIVOS_APROVACAO, type AprovacaoNova, type MudancaDeAprovacao } from '../domain/aprovacao';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

export interface LinhaAprovacao {
  pedido_id: string;
  ciclo: number;
  motivo: AprovacaoMotivo['motivo'];
  nivel: AprovacaoMotivo['nivel'];
  estado: AprovacaoMotivo['estado'];
  texto_pendencia: string;
  decidida_por: string | null;
  decidida_em: string | null;
  texto_decisao: string | null;
}

/** Linha do banco → `AprovacaoMotivo` do contrato. */
export const paraAprovacaoMotivo = (l: LinhaAprovacao): AprovacaoMotivo => ({
  motivo: l.motivo,
  nivel: l.nivel,
  estado: l.estado,
  texto_pendencia: l.texto_pendencia,
  decidida_por_id: l.decidida_por,
  decidida_em: l.decidida_em,
  texto_decisao: l.texto_decisao,
});

/** Nome de quem decidiu, por id (uma consulta `core.cadastro_resumo@1` só para os decisores; sem decisão, sem consulta). */
export async function nomesDosDecisores(tx: TransacaoTenant, linhas: readonly LinhaAprovacao[]): Promise<Map<string, string>> {
  const ids = [...new Set(linhas.map((l) => l.decidida_por).filter((x): x is string => !!x))];
  const nomes = new Map<string, string>();
  if (ids.length > 0) for (const u of (await tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [], produto_ids: [], usuario_ids: ids })).usuarios) nomes.set(u.id, u.nome);
  return nomes;
}

/** As aprovações do contrato com `decidida_por_nome` nas decididas. */
export const comNomesDosDecisores = (linhas: readonly LinhaAprovacao[], nomes: ReadonlyMap<string, string>): AprovacaoMotivo[] =>
  linhas.map((l) => ({ ...paraAprovacaoMotivo(l), ...(l.decidida_por ? { decidida_por_nome: nomes.get(l.decidida_por) ?? null } : {}) }));

export const aprovacoesComNomes = async (tx: TransacaoTenant, linhas: readonly LinhaAprovacao[]): Promise<AprovacaoMotivo[]> => comNomesDosDecisores(linhas, await nomesDosDecisores(tx, linhas));

/** As aprovações do ciclo atual de cada pedido (na ordem dos motivos). Pedido que nunca foi para aprovação não aparece no mapa. */
export async function lerAprovacoes(db: ClienteBanco, pedidoIds: readonly string[]): Promise<Map<string, LinhaAprovacao[]>> {
  const mapa = new Map<string, LinhaAprovacao[]>();
  if (pedidoIds.length === 0) return mapa;
  const { rows } = await db.query<LinhaAprovacao>(
    `select a.pedido_id, a.ciclo, a.motivo, a.nivel, a.estado, a.texto_pendencia, a.decidida_por,
            to_char(a.decidida_em at time zone 'UTC', ${UTC}) as decidida_em, a.texto_decisao
       from vendedor.pedido_aprovacao a
       join vendedor.pedido p on p.tenant_id = a.tenant_id and p.id = a.pedido_id and a.ciclo = p.aprovacao_ciclo
      where a.pedido_id = any($1::uuid[]) and a.deleted_at is null
      order by a.pedido_id, array_position($2::text[], a.motivo)`,
    [pedidoIds, [...MOTIVOS_APROVACAO]],
  );
  for (const r of rows) mapa.set(r.pedido_id, [...(mapa.get(r.pedido_id) ?? []), r]);
  return mapa;
}

/** Abre uma aprovação pendente por motivo no ciclo (RN-VEN-10, RN-VEN-12 e RN-VEN-13). */
export async function gravarAprovacoes(db: ClienteBanco, pedidoId: string, ciclo: number, novas: readonly AprovacaoNova[]): Promise<void> {
  for (const a of novas) {
    await db.query(
      `insert into vendedor.pedido_aprovacao (tenant_id, id, pedido_id, ciclo, motivo, nivel, estado, texto_pendencia)
       values (plataforma.tenant_atual(), gen_random_uuid(), $1, $2, $3, $4, 'pendente', $5)`,
      [pedidoId, ciclo, a.motivo, a.nivel, a.texto],
    );
  }
}

/**
 * Grava a decisão nas aprovações (aprovada, rejeitada, devolvida ou encerrada). O texto fica só nas decididas pelo aprovador;
 * as encerradas guardam quem rejeitou ou devolveu (`decidida_por`).
 */
export async function gravarDecisoes(db: ClienteBanco, pedidoId: string, ciclo: number, mudancas: readonly MudancaDeAprovacao[], autorId: string, em: string, texto: string | null): Promise<void> {
  for (const m of mudancas) {
    await db.query(
      `update vendedor.pedido_aprovacao set estado = $4, decidida_por = $5, decidida_em = $6, texto_decisao = $7
        where pedido_id = $1 and ciclo = $2 and motivo = $3 and estado = 'pendente' and deleted_at is null`,
      [pedidoId, ciclo, m.motivo, m.estado, autorId, em, m.estado === 'encerrada' ? null : texto],
    );
  }
}
