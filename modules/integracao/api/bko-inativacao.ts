/**
 * `POST /v1/integracao/inativacoes/:id/decidir` — confirmar ou recusar a inativação em massa de uma carga completa (RN-INT-06, P-3).
 * Admin ou analista (ação `inativacao.decidir`); o AUTOR é sempre o usuário da sessão, nunca o do corpo. Tudo numa transação:
 * pendência travada (`for update`) → `decidirPendencia` (domain) → `update … where estado = 'aguardando'` → reavaliação dos ativos
 * DE AGORA ao confirmar (inválidos da sessão continuam fora) → `inativacao_auditoria` + auditoria da plataforma. Sem auditoria não
 * há decisão: qualquer falha desfaz tudo.
 */
import { ErroHttpModulo, ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type ContextoRota, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { DecidirInativacaoEntrada, type AuditoriaInativacao, type DecidirInativacaoResposta, type Entidade, type PendenciaInativacao } from '../contracts';
import { decidirPendencia, type Pendencia } from '../domain';
import { iso } from './bko-comum';
import { eventoAtualizado } from './eventos';

const Params = z.object({ id: z.string().uuid('UUID inválido') });

interface LinhaPendencia {
  id: string;
  sessao_id: string;
  entidade: Entidade;
  conector_uuid: string;
  conector_identificador: string;
  lote_id: string;
  estado: Pendencia['estado'];
  candidatos: number;
  total_ativos: number;
  percentual: string;
  limite_pct: string;
  amostra: string[];
  created_at: Date;
  expira_em: Date;
  decidida_em: Date | null;
  decidida_por: string | null;
  decidida_por_perfil: Pendencia['decidida_por_perfil'];
  motivo_decisao: string | null;
}

const BLOCO_INATIVACAO = 500;

/** Inativa (deleted_at, hash esquecido) os ativos elegíveis da sessão que NÃO vieram inválidos, em blocos; publica o evento de cada um. */
export async function inativarElegiveis(db: ClienteBanco, tx: Pick<TransacaoTenant, 'publicar'>, p: { tenantId: string; sessaoId: string; entidade: Entidade; conectorId: string; loteId: string; agora: string }): Promise<number> {
  const { rows: s } = await db.query<{ iniciada_em: Date }>('select iniciada_em from integracao.sessao_carga where tenant_id = $1 and id = $2', [p.tenantId, p.sessaoId]);
  if (!s[0]) return 0;
  let total = 0;
  for (;;) {
    // elegível = ativo, visto ANTES do início da sessão (o que chegou pelo delta durante a carga fica) e que não veio inválido nela
    const { rows } = await db.query<{ external_id: string; hash: string }>(
      `with alvo as (
         select r.id, r.external_id, r.hash from integracao.registro_atual r
          where r.tenant_id = $1 and r.entidade = $2 and r.conector_id = $3 and r.ativo and r.deleted_at is null
            and r.visto_em < $4::timestamptz
            and not exists (select 1 from integracao.sessao_carga_recebido x where x.tenant_id = $1 and x.sessao_id = $5 and x.external_id = r.external_id)
          order by r.id limit $6
          for update of r)
       update integracao.registro_atual r set deleted_at = $7::timestamptz, hash = null
         from alvo where r.id = alvo.id
       returning alvo.external_id, alvo.hash`,
      [p.tenantId, p.entidade, p.conectorId, s[0].iniciada_em.toISOString(), p.sessaoId, BLOCO_INATIVACAO, p.agora],
    );
    for (const r of rows) {
      await tx.publicar(eventoAtualizado(p.entidade), { lote_id: p.loteId, entidade: p.entidade, external_id: r.external_id, acao: 'inativado', hash: r.hash, ocorrido_em: p.agora });
    }
    total += rows.length;
    if (rows.length < BLOCO_INATIVACAO) return total;
  }
}

export const rotaDecidirInativacao: RotaModulo = {
  metodo: 'POST',
  caminho: 'inativacoes/:id/decidir',
  acao: 'inativacao.decidir',
  carteira: 'nao_se_aplica',
  params: Params,
  corpo: DecidirInativacaoEntrada,
  executar: async (ctx: ContextoRota<DecidirInativacaoEntrada, unknown, z.infer<typeof Params>>): Promise<DecidirInativacaoResposta> => {
    const tenantId = ctx.usuario.tenant_id;
    const agora = ctx.agora().toISOString();
    return ctx.comTenant(async (db, tx) => {
      const { rows } = await db.query<LinhaPendencia>(
        `select p.id, p.sessao_id, p.entidade, p.conector_id as conector_uuid, c.identificador as conector_identificador, p.lote_id, p.estado,
                p.candidatos, p.total_ativos, p.percentual::text, p.limite_pct::text, p.amostra, p.created_at, p.expira_em,
                p.decidida_em, p.decidida_por, p.decidida_por_perfil, p.motivo_decisao
           from integracao.pendencia_inativacao p
           join integracao.conector c on c.tenant_id = p.tenant_id and c.id = p.conector_id
          where p.tenant_id = $1 and p.id = $2 and p.deleted_at is null
          for update of p`,
        [tenantId, ctx.params.id],
      );
      const l = rows[0];
      if (!l) throw new ErroNaoEncontrado('PENDENCIA_NAO_ENCONTRADA', 'Inativação pendente não encontrada. Atualize a lista em Integração ERP > Inativações.');

      const pendencia: Pendencia = {
        id: l.id,
        sessao_id: l.sessao_id,
        entidade: l.entidade,
        conector_id: l.conector_identificador,
        lote_id: l.lote_id,
        estado: l.estado,
        candidatos: l.candidatos,
        total_ativos: l.total_ativos,
        percentual: Number(l.percentual),
        limite_pct: Number(l.limite_pct),
        amostra: l.amostra,
        criada_em: iso(l.created_at) as string,
        expira_em: iso(l.expira_em) as string,
        decidida_em: iso(l.decidida_em),
        decidida_por: l.decidida_por,
        decidida_por_perfil: l.decidida_por_perfil,
        motivo_decisao: l.motivo_decisao,
      };

      // o autor é SEMPRE o da sessão; o corpo só traz a ação e o motivo
      const d = decidirPendencia(pendencia, ctx.corpo.acao, agora, { usuario_id: ctx.usuario.id, perfil: ctx.usuario.perfil }, ctx.corpo.motivo);
      if (!d.ok) {
        if (d.status === 403) throw new ErroHttpModulo(403, 'PERFIL_SEM_ACESSO', d.mensagem);
        throw new ErroRegraNegocio('RN-INT-06', d.mensagem, { motivo: d.codigo });
      }

      const { rows: gravada } = await db.query<{ id: string }>(
        `update integracao.pendencia_inativacao
            set estado = $3, decidida_em = $4, decidida_por = $5, decidida_por_perfil = $6, motivo_decisao = $7
          where tenant_id = $1 and id = $2 and estado = 'aguardando'
          returning id`,
        [tenantId, l.id, d.pendencia.estado, agora, ctx.usuario.id, ctx.usuario.perfil, d.pendencia.motivo_decisao],
      );
      if (!gravada[0]) throw new ErroRegraNegocio('RN-INT-06', 'Esta inativação já foi decidida por outra pessoa. Atualize a lista.', { motivo: 'pendencia_ja_decidida' });

      let inativadas = 0;
      if (d.reavaliarComConfirmacao) {
        inativadas = await inativarElegiveis(db, tx, { tenantId, sessaoId: l.sessao_id, entidade: l.entidade, conectorId: l.conector_uuid, loteId: l.lote_id, agora });
        if (inativadas > 0) {
          await db.query('update integracao.sessao_carga set inativadas = inativadas + $3 where tenant_id = $1 and id = $2', [tenantId, l.sessao_id, inativadas]);
          await db.query('update integracao.lote set inativadas = inativadas + $3 where tenant_id = $1 and id = $2', [tenantId, l.lote_id, inativadas]);
        }
      }

      const a = d.auditoria;
      const efetivas = d.reavaliarComConfirmacao ? inativadas : null;
      await db.query(
        `insert into integracao.inativacao_auditoria
           (tenant_id, pendencia_id, sessao_id, lote_id, entidade, conector_id, acao, decidida_por, perfil, decidida_em, quantidade, total_ativos, percentual, motivo, inativadas)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
        [tenantId, a.pendencia_id, a.sessao_id, a.lote_id, a.entidade, l.conector_uuid, a.acao, a.decidida_por, a.perfil, a.decidida_em, a.quantidade, a.total_ativos, a.percentual, a.motivo, efetivas],
      );
      await tx.auditar({ acao: 'inativacao.decidir', entidade: 'pendencia_inativacao', entidade_id: l.id, depois: { acao: a.acao, quantidade: a.quantidade, inativadas: efetivas } });

      const auditoria: AuditoriaInativacao = { ...a, entidade: a.entidade as Entidade, perfil: a.perfil as 'admin' | 'analista', inativadas: efetivas };
      const resposta: PendenciaInativacao = { ...d.pendencia, entidade: l.entidade, decidida_por_perfil: d.pendencia.decidida_por_perfil as 'admin' | 'analista' | null };
      return { pendencia: resposta, inativadas, auditoria };
    });
  },
};
