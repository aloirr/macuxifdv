/**
 * Payload de `vendedor.pedido.aprovado@1` montado a partir do pedido gravado (T-0061, ADR 0016): usado no aceite
 * automático (receber) e na aprovação por decisão (pedidos.ts), para os dois caminhos levarem a mesma coisa à fila do ERP.
 * `quantidade` do item = unidade BASE; a medida vendida, os descontos/acréscimos, o frete (sem valor, RN-VEN-16) e o endereço
 * de entrega vão em campos aditivos. Lê só `vendedor.*` (e o cadastro do Core pela consulta).
 */
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import type { ClienteBanco, TransacaoTenant } from '@macuxi/platform-sdk';
import { montarPedidoAprovado, type EnderecoEvento, type FreteEvento, type PedidoAprovadoPayload } from '../domain';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

interface LinhaAprovado {
  cliente_id: string;
  vendedor_id: string;
  observacao: string | null;
  desconto_pct: number;
  acrescimo_pct: number | null;
  frete_modalidade: 'CIF' | 'FOB' | null;
  transportadora_id: string | null;
  transportadora_digitada: boolean | null;
  transportadora_nome: string | null;
  transportadora_documento: string | null;
  transportadora_telefone: string | null;
  endereco_entrega: Record<string, unknown> | null;
  codigo: string | null;
  criado_em: string;
  forma_pagamento_codigo: string | null;
  prazo_codigo: string | null;
  prazo_parcelas_dias: number[] | null;
  prazo_medio_dias: number | null;
  forma_external_id: string | null;
  prazo_external_id: string | null;
}

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

export async function payloadAprovado(db: ClienteBanco, tx: TransacaoTenant, pedidoId: string, aprovadoEm: string): Promise<PedidoAprovadoPayload> {
  const p = (
    await db.query<LinhaAprovado>(
      `select p.cliente_id, p.vendedor_id, p.observacao, p.desconto_pct::float8 as desconto_pct, p.acrescimo_pct::float8 as acrescimo_pct,
              p.frete_modalidade, p.transportadora_id, p.transportadora_digitada, p.transportadora_nome, p.transportadora_documento,
              p.transportadora_telefone, p.endereco_entrega,
              (select codigo from vendedor.condicao_pagamento c where c.id = p.condicao_pagamento_id) as codigo,
              p.forma_pagamento_codigo, p.prazo_codigo, p.prazo_parcelas_dias, p.prazo_medio_dias,
              (select external_id from vendedor.forma_pagamento f where f.id = p.forma_pagamento_id) as forma_external_id,
              (select external_id from vendedor.prazo_pagamento z where z.id = p.prazo_pagamento_id) as prazo_external_id,
              coalesce(to_char(p.criado_no_aparelho_em at time zone 'UTC', ${UTC}), to_char(p.recebido_em at time zone 'UTC', ${UTC})) as criado_em
         from vendedor.pedido p where p.id = $1`,
      [pedidoId],
    )
  ).rows[0]!;
  const itens = (
    await db.query<{ produto_id: string; quantidade: number; quantidade_base: number; fator: number; unidade: string | null; preco_tabela_cents: number; desconto_pct: number; acrescimo_pct: number; total_cents: number; aplicacao: string | null }>(
      `select produto_id, quantidade, quantidade_base, fator, unidade, preco_tabela_cents::float8 as preco_tabela_cents, desconto_pct::float8 as desconto_pct,
              acrescimo_pct::float8 as acrescimo_pct, total_cents::float8 as total_cents, aplicacao
         from vendedor.pedido_item where pedido_id = $1 and deleted_at is null order by sequencia`,
      [pedidoId],
    )
  ).rows;
  const cad = await tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [p.cliente_id], produto_ids: itens.map((i) => i.produto_id), usuario_ids: [p.vendedor_id] });

  let frete: FreteEvento | null = null;
  if (p.frete_modalidade === 'CIF') frete = { modalidade: 'CIF' };
  else if (p.frete_modalidade === 'FOB') {
    if (p.transportadora_digitada) {
      frete = { modalidade: 'FOB', transportadora: { tipo: 'digitada', nome: p.transportadora_nome ?? '', cnpj: p.transportadora_documento ?? '', telefone: p.transportadora_telefone } };
    } else if (p.transportadora_id) {
      const ext = (await db.query<{ external_id: string | null }>('select external_id from vendedor.transportadora where id = $1', [p.transportadora_id])).rows[0]?.external_id ?? null;
      frete = { modalidade: 'FOB', transportadora: { tipo: 'cadastrada', id: p.transportadora_id, external_id: ext, nome: p.transportadora_nome ?? '', cnpj: p.transportadora_documento, telefone: p.transportadora_telefone } };
    }
  }
  const e = p.endereco_entrega;
  const endereco: EnderecoEvento | null = e
    ? {
        external_id: texto(e.external_id),
        logradouro: String(e.logradouro ?? ''),
        numero: texto(e.numero),
        complemento: texto(e.complemento),
        bairro: texto(e.bairro),
        cidade: String(e.cidade ?? ''),
        uf: String(e.uf ?? '').toUpperCase().slice(0, 2),
        cep: texto(e.cep),
        principal: e.principal === true,
      }
    : null;

  return montarPedidoAprovado({
    pedido_uuid: pedidoId,
    cliente_external_id: cad.clientes[0]?.external_id ?? null,
    vendedor_external_id: cad.usuarios.find((u) => u.id === p.vendedor_id)?.external_id ?? null,
    // T-0089: pedido novo leva o código do PRAZO (o de-para do Hub continua valendo); o antigo, o da condição
    condicao_pagamento_codigo: p.prazo_codigo ?? p.codigo,
    pagamento:
      p.forma_pagamento_codigo && p.prazo_codigo && p.prazo_parcelas_dias && p.prazo_medio_dias !== null
        ? {
            forma_codigo: p.forma_pagamento_codigo,
            forma_external_id: p.forma_external_id,
            prazo_codigo: p.prazo_codigo,
            prazo_external_id: p.prazo_external_id,
            parcelas_dias: p.prazo_parcelas_dias.map(Number),
            prazo_medio_dias: Number(p.prazo_medio_dias),
          }
        : null,
    criado_em: p.criado_em,
    aprovado_em: aprovadoEm,
    observacao: p.observacao,
    desconto_pct: Number(p.desconto_pct),
    acrescimo_pct: Number(p.acrescimo_pct ?? 0),
    frete,
    endereco_entrega: endereco,
    itens: itens.map((i) => ({
      produto_external_id: cad.produtos.find((x) => x.id === i.produto_id)?.external_id ?? null,
      quantidade: Number(i.quantidade_base),
      preco_tabela_cents: Number(i.preco_tabela_cents),
      total_cents: Number(i.total_cents),
      unidade: i.unidade,
      fator: Number(i.fator),
      quantidade_venda: Number(i.quantidade),
      desconto_pct: Number(i.desconto_pct),
      acrescimo_pct: Number(i.acrescimo_pct),
      aplicacao: i.aplicacao,
    })),
  });
}
