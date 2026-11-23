/**
 * `integracao.cliente.retorno_erp@1` -> `core.cliente` (RN-CORE-78, RN-INT-22; ADR 0012 §5: consulta é só leitura, quem grava é o Core).
 * O ERP aprova o pré-cadastro: o Hub devolve o código (`vinculado`) ou a recusa (`rejeitado_erp`). A decisão é do domínio
 * (`decidirVinculoErp`, `decidirRecusaErp`). v1.0.29 (ADR 0069 item 8): o retorno informa a `revisao` (ausente = a atual) e, na recusa,
 * os erros por campo (`[]` = sem erros); o id de um recusado substituído pelo APK v1.0.28 resolve para o vivo pelo alias.
 * - vinculado: o ERP manda. Grava `external_id`, `status_cadastro = 'aprovado'` e `aprovado_em`, também sobre o recusado e vindo de revisão
 *   anterior, e limpa motivo e erros; a tentativa da revisão do retorno (e a atual, se estiver aguardando) fica `aceito`. O mesmo código
 *   de novo (reentrega) não faz nada; código diferente (conflito) ou já usado por outro cliente não grava e fica na auditoria (ator Hub,
 *   só ids e regra).
 * - rejeitado_erp: grava `status_cadastro = 'recusado'`, `motivo_recusa` (até 500) e `erros_recusa` (`errosRecusaSeguros`) no cliente e na
 *   tentativa da revisão. Recusa de revisão anterior não vale sobre a nova; a mesma recusa de novo é repetição; outro motivo ou outros
 *   erros na mesma revisão é fato novo e grava. Motivo e erros nunca vão a log nem à auditoria.
 * Os dois publicam `core.cliente.atualizado@1` só quando gravam, para o app do vendedor receber.
 */
import { definirConsumidor, eventoTolerante, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { EVENTO_CLIENTE_ATUALIZADO, type ErroCampoCadastro } from '../contracts';
import { EVENTO_CLIENTE_RETORNO_ERP, type ClienteRetornoErpEvento } from '../../integracao/contracts';
import type { ClienteParaRecusa } from '../domain';
import { decidirRecusaErp, decidirVinculoErp, errosRecusaSeguros, motivoRecusaCortado } from '../domain';
import { auditar } from './auditoria';
import { resolverPreCadastro } from './pre-cadastro-alias';
import { carteiraDoEvento } from './rotas';

export const EventoIntegracaoClienteRetornoErp = eventoTolerante(EVENTO_CLIENTE_RETORNO_ERP);

/** Aditivos da @1 na v1.0.29 (ADR 0069 §9), lidos também enquanto o contrato do dono não os declara (leitura tolerante). */
type RetornoErp = ClienteRetornoErpEvento & { revisao?: number; erros?: unknown };

function auditarSistema(ctx: ContextoConsumo, acao: string, clienteId: string, depois: Record<string, unknown>): Promise<void> {
  return auditar(ctx.db, { usuario: { id: null }, requestId: ctx.envelope.evento_id }, { acao, entidade: 'cliente', entidadeId: clienteId, antes: null, depois: { ...depois, regra: 'RN-CORE-78', ator: 'hub' } });
}

async function lerCliente(ctx: ContextoConsumo, id: string): Promise<ClienteParaRecusa | null> {
  const r = await ctx.db.query<ClienteParaRecusa>(
    'select status_cadastro, external_id, revisao_cadastro, motivo_recusa, erros_recusa from core.cliente where id = $1 and deleted_at is null for update',
    [id],
  );
  return r.rows[0] ?? null;
}

const errosJson = (erros: readonly ErroCampoCadastro[]): string | null => (erros.length > 0 ? JSON.stringify(erros) : null);

export const consumidorClienteRetornoErp: ConsumidorEvento = definirConsumidor({
  evento: EventoIntegracaoClienteRetornoErp,
  async executar(evento, ctx: ContextoConsumo) {
    const p = evento as RetornoErp;
    const id = (await resolverPreCadastro(ctx.db, p.cliente_id)) ?? p.cliente_id;
    const cliente = await lerCliente(ctx, id);
    const revisao = p.revisao ?? cliente?.revisao_cadastro ?? 1;
    if (p.status === 'rejeitado_erp') {
      const erros = errosRecusaSeguros(p.erros ?? []);
      const motivo = motivoRecusaCortado(p.motivo);
      const r = decidirRecusaErp(cliente, { revisao: p.revisao, motivo, erros });
      if (r.acao === 'nada') return;
      await ctx.db.query("update core.cliente set status_cadastro = 'recusado', motivo_recusa = $2, erros_recusa = $3::jsonb where id = $1", [id, motivo, errosJson(erros)]);
      await ctx.db.query(
        "update core.cliente_pre_cadastro_tentativa set resultado = 'recusado', respondido_em = $3, motivo = $4, erros = $5::jsonb where cliente_id = $1 and revisao = $2 and deleted_at is null",
        [id, revisao, p.ocorrido_em, motivo, errosJson(erros)],
      );
      await auditarSistema(ctx, 'cliente.rejeitado_erp', id, { revisao });
      await ctx.publicar(EVENTO_CLIENTE_ATUALIZADO, { cliente_id: id, campos: ['status_cadastro'], origem: 'erp', ...(await carteiraDoEvento(ctx.db, id)) }, id);
      return;
    }
    const codigo = p.external_id?.trim();
    if (!codigo) return; // contrato exige o código em 'vinculado'; sem ele não há o que gravar
    const emUso = cliente?.external_id === null && (await ctx.db.query('select 1 from core.cliente where external_id = $1 and id <> $2 and deleted_at is null limit 1', [codigo, id])).rows.length > 0;
    const d = decidirVinculoErp(cliente, codigo, emUso, p.revisao);
    if (d.acao === 'nada') return;
    if (d.acao === 'recusar') {
      if (d.resultado === 'conflito' || d.resultado === 'codigo_em_uso') {
        await auditarSistema(ctx, 'cliente.vinculo_erp_recusado', id, { external_id: codigo, resultado: d.resultado });
      }
      ctx.log.warn({ cliente_id: id, resultado: d.resultado }, 'retorno do ERP do cliente não gravado');
      return;
    }
    await ctx.db.query("update core.cliente set external_id = $2, status_cadastro = 'aprovado', aprovado_em = $3, motivo_recusa = null, erros_recusa = null where id = $1", [
      id,
      codigo,
      ctx.agora().toISOString(),
    ]);
    // a tentativa da revisão do retorno fica aceita; a atual, se for outra e estiver aguardando, também (o cliente foi aceito no ERP)
    await ctx.db.query(
      `update core.cliente_pre_cadastro_tentativa set resultado = 'aceito', respondido_em = $4, motivo = null, erros = null
        where cliente_id = $1 and deleted_at is null and (revisao = $2 or (revisao = $3 and resultado = 'aguardando'))`,
      [id, revisao, cliente?.revisao_cadastro ?? revisao, p.ocorrido_em],
    );
    await auditarSistema(ctx, 'cliente.vincular_erp', id, { external_id: codigo, revisao });
    await ctx.publicar(EVENTO_CLIENTE_ATUALIZADO, { cliente_id: id, campos: ['external_id', 'status_cadastro'], origem: 'erp', ...(await carteiraDoEvento(ctx.db, id)) }, id);
  },
});
