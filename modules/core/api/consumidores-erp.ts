/**
 * Consumidor do cliente do ERP (`integracao.cliente.atualizado@1`; T-0060, RN-CORE-16/17). Aplica o plano puro de
 * `domain/cliente-erp.ts` em `core.cliente` (upsert por `external_id`, idempotente) e grava `cadastro_incompleto` e
 * `cadastro_campos_faltantes`; depois publica `core.cliente.atualizado@1` com os mesmos campos (só nomes, nunca valores).
 * O payload vem do `contracts` do Integracao (`EVENTO_ERP_CLIENTE_ATUALIZADO`), com leitura tolerante (T-0024).
 * T-0066: depois do cadastro, aplica carteira (`vendedor_external_id`), contatos e financeiro (limite, bloqueio) do mesmo
 * payload (`consumidores-erp-cliente-extras.ts`). Vendedor ainda ausente = `ReferenciaAusenteErp` (a outbox repete, RN-INT-04).
 */
import { definirConsumidor, eventoTolerante, type ConsumidorEvento, type ContextoConsumo } from '@macuxi/platform-sdk';
import { EVENTO_CLIENTE_ATUALIZADO, PARAMETRO_CAMPOS_OBRIGATORIOS } from '../contracts';
import { EVENTO_ERP_CLIENTE_ATUALIZADO } from '../../integracao/contracts';
import { camposExigidos, canalDoClienteDoErp, decidirOrdemErp, filialDoClienteDoErp, pagamentoDoClienteDoErp, planejarClienteDoErp, type EventoClienteAtualizado } from '../domain';
import { aplicarCarteiraDoErp, aplicarContatosDoErp, aplicarFinanceiroDoErp } from './consumidores-erp-cliente-extras';
import { consumidorClienteEnderecoDoErp } from './consumidores-erp-cliente-endereco';
import { ReferenciaAusenteErp } from './erp-apoio';
import { consumidorFilialDoErp } from './consumidores-erp-filial';
import { consumidorProdutoDoErp } from './consumidores-erp-produto';
import { consumidorProdutoUnidadeDoErp } from './consumidores-erp-produto-unidade';
import { consumidorRotaDoErp } from './consumidores-erp-rota';
import { consumidorNotaDoErp } from './consumidores-erp-nota';
import { consumidorTituloDoErp } from './consumidores-erp-titulo';
import { consumidorVendedorDoErp } from './consumidores-erp-vendedor';

import { carteiraDoEvento } from './rotas';

export const EventoIntegracaoClienteAtualizado = eventoTolerante(EVENTO_ERP_CLIENTE_ATUALIZADO);

const COLUNAS_GRAVADAS = [
  'razao_social', 'nome_fantasia', 'documento', 'inscricao_estadual', 'observacao', 'telefone', 'email',
  'logradouro', 'numero', 'bairro', 'cidade', 'uf', 'cep', 'latitude', 'longitude', 'ativo',
  'cadastro_incompleto', 'cadastro_campos_faltantes',
] as const;

export const consumidorClienteDoErp: ConsumidorEvento = definirConsumidor({
  evento: EventoIntegracaoClienteAtualizado,
  async executar(p, ctx: ContextoConsumo) {
    const exigidos = camposExigidos(ctx.parametros()[PARAMETRO_CAMPOS_OBRIGATORIOS]);
    let evento = p as EventoClienteAtualizado;
    // T-0095 (RN-INT-02): última versão do ERP já aplicada a este cliente; mais antiga que ela (reentrega fora de ordem) é ignorada
    const aplicado = (await ctx.db.query<{ erp_alterado_em: string | null }>('select erp_alterado_em::text from core.cliente where external_id = $1 and deleted_at is null', [evento.external_id])).rows[0]?.erp_alterado_em ?? null;
    let plano = planejarClienteDoErp(evento, exigidos, aplicado);

    if (plano.tipo === 'inativar') {
      // RN-INT-02: só o alterado_em do registro (relógio do ERP) entra na ordem; o ocorrido_em é do Hub. Sem registro, inativa sem avançar a ordem
      if (plano.alterado_em !== null && decidirOrdemErp(aplicado, plano.alterado_em) === 'ignorar_antigo') return;
      const r = await ctx.db.query<{ id: string }>(
        'update core.cliente set ativo = false, erp_alterado_em = coalesce($2::timestamptz, erp_alterado_em) where external_id = $1 and deleted_at is null and ativo returning id',
        [plano.external_id, plano.alterado_em],
      );
      if (r.rows[0]) await ctx.publicar(EVENTO_CLIENTE_ATUALIZADO, { cliente_id: r.rows[0].id, campos: ['ativo'], origem: 'erp', ...(await carteiraDoEvento(ctx.db, r.rows[0].id)) }, r.rows[0].id);
      return;
    }
    if (plano.tipo === 'ignorar') return;

    // Documento já usado por outro cliente do tenant (índice único): entra sem documento e cai no cadastro incompleto.
    if (plano.linha.documento !== null) {
      const dono = await ctx.db.query('select 1 from core.cliente where documento = $1 and deleted_at is null and external_id is distinct from $2', [plano.linha.documento, plano.linha.external_id]);
      if (dono.rows.length > 0 && evento.registro) {
        evento = { ...evento, registro: { ...evento.registro, documento: null } };
        plano = planejarClienteDoErp(evento, exigidos);
        if (plano.tipo !== 'upsert') return;
      }
    }

    const l = plano.linha;
    const todas = [...COLUNAS_GRAVADAS, 'erp_alterado_em'];
    const valores = [l.external_id, ...COLUNAS_GRAVADAS.map((c) => l[c]), l.alterado_em];
    const colunas = todas.join(', ');
    const marcas = todas.map((_, i) => `$${i + 2}`).join(', ');
    const atualizar = todas.map((c) => `${c} = excluded.${c}`).join(', ');
    const r = await ctx.db.query<{ id: string }>(
      `insert into core.cliente (tenant_id, external_id, ${colunas}) values (plataforma.tenant_atual(), $1, ${marcas})
         on conflict (tenant_id, external_id) where external_id is not null and deleted_at is null do update set ${atualizar}
       returning id`,
      valores,
    );
    const id = r.rows[0]?.id;
    if (!id) return;
    const bruto = p.registro;
    if (bruto) {
      await aplicarCarteiraDoErp(ctx.db, id, l.external_id, bruto.vendedor_external_id?.trim() || null, ctx.agora());
      await aplicarContatosDoErp(ctx.db, id, l.external_id, bruto.contatos ?? [], ctx.agora());
      await aplicarPagamentoDoErp(ctx.db, id, bruto as Parameters<typeof pagamentoDoClienteDoErp>[0]);
      await aplicarCanalDoErp(ctx.db, id, bruto as { canal?: string | null });
      await aplicarFilialDoErp(ctx.db, id, bruto as { filial_external_id?: string | null });
      await aplicarFinanceiroDoErp(ctx.db, id, l.external_id, bruto.limite_credito_cents, bruto.bloqueado, bruto.alterado_em);
    }
    await ctx.publicar(
      EVENTO_CLIENTE_ATUALIZADO,
      {
        cliente_id: id,
        campos: [...COLUNAS_GRAVADAS],
        origem: 'erp',
        ...(await carteiraDoEvento(ctx.db, id)),
        cadastro_incompleto: l.cadastro_incompleto,
        cadastro_campos_faltantes: l.cadastro_campos_faltantes,
      },
      id,
    );
  },
});

/** T-0089 / RN-VEN-25: grava só o que o Hub mandou (ausente = não altera; `null`/`[]` = limpa). Sem colunas novas no payload, não faz nada. */
async function aplicarPagamentoDoErp(db: ContextoConsumo['db'], clienteId: string, registro: Parameters<typeof pagamentoDoClienteDoErp>[0]): Promise<void> {
  const p = pagamentoDoClienteDoErp(registro);
  const sets: string[] = [];
  const valores: unknown[] = [clienteId];
  if ('prazo_medio_max_dias' in p) sets.push(`prazo_medio_max_dias = $${valores.push(p.prazo_medio_max_dias)}`);
  if ('formas_pagamento' in p) sets.push(`formas_pagamento = $${valores.push(p.formas_pagamento)}::text[]`);
  if (sets.length === 0) return;
  await db.query(`update core.cliente set ${sets.join(', ')} where id = $1`, valores);
}

/**
 * T-0149 / RN-CORE-39: ausente = não altera; `null` = filial padrão (o gatilho `cliente_filial_padrao` põe a padrão); texto = filial
 * com essa chave do ERP. Filial ainda não carregada = `ReferenciaAusenteErp` (a outbox repete, RN-INT-04).
 */
async function aplicarFilialDoErp(db: ContextoConsumo['db'], clienteId: string, registro: { filial_external_id?: string | null }): Promise<void> {
  const f = filialDoClienteDoErp(registro);
  if (!('filial_external_id' in f)) return;
  if (f.filial_external_id === null) {
    await db.query('update core.cliente set filial_id = core.filial_padrao_id(tenant_id) where id = $1 and filial_id is distinct from core.filial_padrao_id(tenant_id)', [clienteId]);
    return;
  }
  const filial = (await db.query<{ id: string }>('select id from core.filial where external_id = $1 and deleted_at is null', [f.filial_external_id])).rows[0];
  if (!filial) throw new ReferenciaAusenteErp('filial');
  await db.query('update core.cliente set filial_id = $2 where id = $1 and filial_id is distinct from $2', [clienteId, filial.id]);
}

/** T-0115 / RN-PES-05: grava o canal só se o Hub o mandou (ausente = não altera; `null` ou em branco = limpa). */
async function aplicarCanalDoErp(db: ContextoConsumo['db'], clienteId: string, registro: { canal?: string | null }): Promise<void> {
  const c = canalDoClienteDoErp(registro);
  if (!('canal' in c)) return;
  await db.query('update core.cliente set canal = $2 where id = $1', [clienteId, c.canal]);
}

/** Todos os consumidores do ERP no Core (T-0066), na ordem de dependência (RN-INT-04); o `index.ts` só repassa. */
export const consumidoresDoErp: ConsumidorEvento[] = [
  consumidorFilialDoErp, // antes do cliente: a filial do cliente aponta para ela (ordem de carga, desenho T-0149 §4.4)
  consumidorVendedorDoErp,
  consumidorClienteDoErp,
  consumidorProdutoDoErp,
  consumidorProdutoUnidadeDoErp,
  consumidorClienteEnderecoDoErp,
  consumidorTituloDoErp,
  consumidorNotaDoErp,
  consumidorRotaDoErp,
];
