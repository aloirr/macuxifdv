/**
 * Rotas do orçamento já recebido (T-0071 §2.1, RF-VEN-03, RN-VEN-18/32):
 *  - `PUT /v1/vendedor/orcamentos/:id` — edita (precisa de sinal), ação `pedido.criar`; concorrência otimista por `atualizado_em`
 *    (409 `ORCAMENTO_ALTERADO`); vencido, convertido ou cancelado = 422 `RN-VEN-18`; o preço é refeito pela tabela do momento da
 *    edição; a validade e o número não mudam.
 *  - `POST /v1/vendedor/orcamentos/:id/cancelar` — ação `pedido.cancelar`.
 * Promotor nunca (RN-PRO-01, 403 pela ação do manifesto); só o dono do orçamento edita/cancela (404 para os demais, sem revelar);
 * cliente fora da carteira = 403 (só no PUT; o cancelar não confere a carteira, como o cancelar de pedido). Orçamento NUNCA publica `vendedor.pedido.*` nem entra na fila do ERP (RN-VEN-32).
 */
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import { ErroHttpModulo, ErroNaoEncontrado, type ClienteBanco, type RotaModulo } from '@macuxi/platform-sdk';
import { CancelarOrcamentoRequest, EditarOrcamentoRequest, PedidoPush } from '../contracts';
import { acoesDoOrcamento, conteudoDoEnvio, precoDoOrcamentoVale, situacaoDoOrcamento, validadeDoPreco, validadeOrcamentoDias } from '../domain';
import { calcularDocumento } from './receber';
import { valoresPagamento, valorPercentualPrazo } from './pagamento';
import { preVenda } from './pre-venda';
import { precosCongeladosDoDocumento } from './preco-congelado';

const ParamsOrcamento = z.object({ id: z.string().uuid() });
const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
const NAO_ENCONTRADO = ['ORCAMENTO_NAO_ENCONTRADO', 'Orçamento não encontrado. Atualize os dados e tente de novo.'] as const;

interface LinhaOrcamento {
  id: string;
  vendedor_id: string;
  cliente_id: string;
  status: string;
  atualizado_em: string;
  hash_envio: string | null;
  total_cents: string;
  itens: number;
  /** RN-VEN-45: retrato do % do prazo (null = sem prazo) */
  prazo_percentual_ajuste: number | null;
  prazo_pagamento_id: string | null;
}

/** Orçamento do usuário, com trava de linha. `null` = inexistente, de outro vendedor/tenant ou não é orçamento. */
async function orcamentoDoDono(db: ClienteBanco, id: string, eu: string): Promise<LinhaOrcamento | null> {
  await db.query('select pg_advisory_xact_lock(hashtext($1))', [`pedido:${id}`]);
  const r = (
    await db.query<LinhaOrcamento>(
      `select id, vendedor_id, cliente_id, status, to_char(updated_at at time zone 'UTC', ${UTC}) as atualizado_em, hash_envio, total_cents::text as total_cents, prazo_percentual_ajuste::float8 as prazo_percentual_ajuste, prazo_pagamento_id,
            (select count(*)::int from vendedor.pedido_item i where i.pedido_id = pedido.id and i.deleted_at is null) as itens
         from vendedor.pedido where id = $1 and tipo = 'orcamento' and deleted_at is null for update`,
      [id],
    )
  ).rows[0];
  return r && r.vendedor_id === eu ? r : null;
}

/** RN-VEN-18: só o orçamento aberto edita e cancela. */
function exigirAberto(situacao: ReturnType<typeof situacaoDoOrcamento>): void {
  if (situacao === 'aberto') return;
  const texto = acoesDoOrcamento(situacao).texto;
  throw new ErroHttpModulo(422, 'RN-VEN-18', `${texto} (RN-VEN-18)`);
}

export const rotaEditarOrcamento: RotaModulo = {
  metodo: 'PUT',
  caminho: 'orcamentos/:id',
  acao: 'pedido.criar',
  carteira: 'filtrar_no_dominio',
  params: ParamsOrcamento,
  corpo: EditarOrcamentoRequest,
  async executar(ctx) {
    const { id } = ctx.params as z.infer<typeof ParamsOrcamento>;
    const { atualizado_em, ...resto } = ctx.corpo as EditarOrcamentoRequest;
    const eu = ctx.usuario.id;
    const agora = ctx.agora();
    // mesmo corpo do push, para a mesma revalidação do servidor (cadastro, preço, medida, frete, endereço, condição, alçada)
    const p = PedidoPush.parse({ ...resto, id, tipo: 'orcamento' });
    return ctx.comTenant(async (db, tx) => {
      const atual = await orcamentoDoDono(db, id, eu);
      if (!atual) throw new ErroNaoEncontrado(...NAO_ENCONTRADO);
      const carteira = await ctx.carteira();
      if (carteira !== 'tenant' && !carteira.has(p.customer_id)) {
        throw new ErroHttpModulo(403, 'FORA_DA_CARTEIRA', 'Este cliente não está na sua carteira. Atualize os dados e tente de novo.');
      }
      if (p.customer_id !== atual.cliente_id) throw new ErroHttpModulo(422, 'PAYLOAD_INVALIDO', 'O orçamento não troca de cliente: duplique para fazer um novo.');
      const doc = (await preVenda().lerDocumentos(db, [id], ctx.fuso())).get(id);
      if (!doc || !doc.validade_ate || !doc.validade_data) throw new ErroNaoEncontrado(...NAO_ENCONTRADO);
      exigirAberto(situacaoDoOrcamento({ status: atual.status, validade_ate: doc.validade_ate, convertido_pedido_id: doc.convertido_pedido_id }, agora));
      // RN-VEN-33: hash do corpo aceito (mesma base do push), para o PUT repetido ser idempotente e o push atrasado conflitar
      const hash = createHash('sha256').update(conteudoDoEnvio(p as unknown as Record<string, unknown>)).digest('hex');
      if (atual.atualizado_em !== atualizado_em) {
        // resposta perdida: o mesmo corpo do mesmo autor devolve o que já foi gravado
        if (atual.hash_envio === hash) {
          return { id, tipo: 'orcamento', status: atual.status, total_cents: Number(atual.total_cents), validade_data: doc.validade_data, atualizado_em: atual.atualizado_em };
        }
        throw new ErroHttpModulo(409, 'ORCAMENTO_ALTERADO', 'Este orçamento foi alterado em outro aparelho. Abra de novo para ver a versão atual.');
      }

      // T-0141 (RN-VEN-18): dentro dos 7 dias o item salvo mantém o preço e a validade do preço segue a original; depois, a edição
      // reprecifica pela tabela do dia e renova a data do preço (o orçamento em si nunca vence)
      const precoVale = precoDoOrcamentoVale(doc.validade_ate, ctx.agora());
      const calc = await calcularDocumento(ctx, db, tx, p, 'orcamento', id, precoVale ? { data: doc.validade_data, ate: doc.validade_ate } : undefined, precoVale ? await precosCongeladosDoDocumento(db, id, atual.prazo_percentual_ajuste) : undefined, { prazo_id: atual.prazo_pagamento_id, percentual: atual.prazo_percentual_ajuste });
      if ('status' in calc) {
        const codigo = calc.status === 'rejeitado' ? calc.codigo : 'PAYLOAD_INVALIDO';
        const mensagem = calc.status === 'rejeitado' ? calc.mensagem : 'Orçamento recusado.';
        throw new ErroHttpModulo(codigo === 'FORA_DA_CARTEIRA' || codigo === 'RN-PRO-01' ? 403 : 422, codigo, mensagem);
      }
      const { cliente, produtos, frete, transportadora, alvo, enderecoRetrato, precos, condicao, pagamento, v } = calc;
      const resumo = {
        razao_social: cliente.razao_social,
        nome_fantasia: cliente.nome_fantasia ?? '',
        documento: cliente.documento ?? '',
        endereco: [cliente.logradouro, cliente.numero].filter((x: string | null) => x && x.trim() !== '').join(', '),
        bairro: cliente.bairro ?? '',
        cidade: cliente.cidade ?? '',
        uf: cliente.uf ?? '',
        codigo_erp: cliente.external_id ?? '',
      };
      await db.query(
        `update vendedor.pedido set condicao_pagamento = $2, desconto_pct = $3, total_tabela_cents = $4, total_cents = $5, observacao = $6, visita_id = $7,
            cliente_resumo = $8::jsonb, cliente_nome = $9, tabela_preco_id = $10, condicao_pagamento_id = $11, condicao_pagamento_descricao = $12,
            acrescimo_pct = $13, desconto_efetivo_pct = $14, frete_modalidade = $15, transportadora_id = $16, transportadora_digitada = $17,
            transportadora_nome = $18, transportadora_documento = $19, transportadora_telefone = $20, endereco_entrega_id = $21, endereco_entrega = $22::jsonb,
            desconto_valor_cents = $23, acrescimo_valor_cents = $24, ajuste_em = $25, hash_envio = $26,
            forma_pagamento_id = $27, prazo_pagamento_id = $28, forma_pagamento_codigo = $29, forma_pagamento_nome = $30, prazo_codigo = $31,
            prazo_descricao = $32, prazo_parcelas_dias = $33::int[], prazo_medio_dias = $34, prazo_percentual_ajuste = $35
          where id = $1`,
        [
          id, pagamento?.texto ?? condicao?.descricao ?? null, v.desconto_pct, v.total_tabela_cents, v.total_cents, p.observacao ?? null, p.visita_id ?? null,
          JSON.stringify(resumo), cliente.nome_fantasia || cliente.razao_social, precos.tabela_preco_id, condicao?.id ?? null, pagamento?.texto ?? condicao?.descricao ?? null,
          v.acrescimo_pct, v.desconto_efetivo_pct, frete.modalidade, transportadora.id, transportadora.digitada,
          transportadora.nome, transportadora.documento, transportadora.telefone, alvo.endereco_id,
          enderecoRetrato ? JSON.stringify(enderecoRetrato) : null,
          v.desconto_valor_cents, v.acrescimo_valor_cents, v.ajuste_em, hash,
          ...valoresPagamento(pagamento),
          valorPercentualPrazo(calc.pagamento, calc.percentualAjustePrazo),
        ],
      );
      // reprecificou (preço vencido): a nova validade = dia da edição + validade_orcamento_dias, pela função única; preco_data vira o dia da edição
      if (!precoVale) {
        const nova = validadeDoPreco(ctx.agora().toISOString(), validadeOrcamentoDias(ctx.parametros()), ctx.fuso());
        await preVenda().marcarDocumento(db, id, { tipo: 'orcamento', validade_data: nova.data, orcamento_origem_id: doc.orcamento_origem_id });
      }
      // itens: os antigos saem por exclusão lógica (o pull leva a remoção) e os novos entram com sequência depois da última
      const ultima = Number((await db.query<{ n: number }>('select coalesce(max(sequencia), 0)::int as n from vendedor.pedido_item where pedido_id = $1', [id])).rows[0]!.n);
      await db.query('update vendedor.pedido_item set deleted_at = now() where pedido_id = $1 and deleted_at is null', [id]);
      for (const [idx, it] of v.itens.entries()) {
        const prod = produtos.get(it.product_id)!;
        await db.query(
          `insert into vendedor.pedido_item (tenant_id, pedido_id, sequencia, produto_id, quantidade, preco_tabela_cents, preco_unitario_cents, desconto_pct, total_cents,
              produto_sku, produto_nome, unidade, fator, acrescimo_pct, preco_minimo_cents, desconto_unitario_cents, acrescimo_unitario_cents, ajuste_em, aplicacao)
           values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          [id, ultima + idx + 1, it.product_id, it.quantity, it.preco_tabela_cents, it.preco_unitario_cents, it.desconto_pct, it.total_cents, prod.sku, prod.nome, it.unidade ?? prod.unidade, it.fator, it.acrescimo_pct, it.preco_minimo_cents, it.desconto_unitario_cents, it.acrescimo_unitario_cents, it.ajuste_em, it.aplicacao],
        );
      }
      await tx.auditar({
        acao: 'orcamento.editar',
        entidade: 'pedido',
        entidade_id: id,
        antes: { tipo: 'orcamento', total_cents: Number(atual.total_cents), itens: atual.itens },
        depois: { tipo: 'orcamento', total_cents: v.total_cents, itens: v.itens.length },
      });
      // RN-VEN-32: nenhum evento de pedido
      const novo = (await db.query<{ atualizado_em: string }>(`select to_char(updated_at at time zone 'UTC', ${UTC}) as atualizado_em from vendedor.pedido where id = $1`, [id])).rows[0]!;
      return { id, tipo: 'orcamento', status: atual.status, total_cents: v.total_cents, validade_data: precoVale ? doc.validade_data : validadeDoPreco(ctx.agora().toISOString(), validadeOrcamentoDias(ctx.parametros()), ctx.fuso()).data, atualizado_em: novo.atualizado_em };
    });
  },
};

export const rotaCancelarOrcamento: RotaModulo = {
  metodo: 'POST',
  caminho: 'orcamentos/:id/cancelar',
  acao: 'pedido.cancelar',
  carteira: 'filtrar_no_dominio',
  params: ParamsOrcamento,
  corpo: CancelarOrcamentoRequest,
  async executar(ctx) {
    const { id } = ctx.params as z.infer<typeof ParamsOrcamento>;
    const motivo = ((ctx.corpo as CancelarOrcamentoRequest).motivo ?? '').trim() || null;
    const eu = ctx.usuario.id;
    const agora = ctx.agora();
    return ctx.comTenant(async (db, tx) => {
      const atual = await orcamentoDoDono(db, id, eu);
      if (!atual) throw new ErroNaoEncontrado(...NAO_ENCONTRADO);
      if (atual.status === 'cancelled') return { id, status: 'cancelled' }; // repetição idempotente
      const doc = (await preVenda().lerDocumentos(db, [id], ctx.fuso())).get(id);
      exigirAberto(situacaoDoOrcamento({ status: atual.status, validade_ate: doc?.validade_ate ?? null, convertido_pedido_id: doc?.convertido_pedido_id ?? null }, agora));
      await db.query("update vendedor.pedido set status = 'cancelled', motivo_cancelamento = $2 where id = $1", [id, motivo]);
      const cad = await tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [], produto_ids: [], usuario_ids: [eu] });
      await db.query(
        `insert into vendedor.pedido_evento (tenant_id, pedido_id, de, para, autor_id, autor_nome, autor_perfil, motivo, nivel, acima_do_nivel, ocorrido_em)
         values (plataforma.tenant_atual(), $1, $2, 'cancelled', $3, $4, $5, $6, null, false, $7)`,
        [id, atual.status, eu, cad.usuarios[0]?.nome ?? null, ctx.usuario.perfil, motivo ?? 'Cancelado', agora.toISOString()],
      );
      await tx.auditar({ acao: 'orcamento.cancelar', entidade: 'pedido', entidade_id: id, antes: { status: atual.status }, depois: { status: 'cancelled', tipo: 'orcamento' } });
      // RN-VEN-32: orçamento não publica evento de pedido
      return { id, status: 'cancelled' };
    });
  },
};
