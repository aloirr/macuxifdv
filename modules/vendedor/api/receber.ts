/**
 * Push do pedido (`receber`; T-0029 §4, ADR 0011). Uma transação por item (como `visita-push.ts` do Core); regra violada
 * vira `rejeitado` só daquele item, erro de banco ou consulta indisponível (503) derruba o lote para o aparelho reenviar.
 * Ordem: remover → id do payload → perfil → idempotência (RN-VEN-33) → carteira (RN-CORE-04) → cadastro
 * (`core.cadastro_resumo@1`) → preço (`catalogo.precos_cliente@1`, RN-CAT-06) → condição (RN-VEN-14) → alçada (RN-VEN-10).
 * O total do servidor vale (RN-VEN-02). Sem dado pessoal em log.
 * T-0053 (pré-venda): `tipo = orcamento` não passa pela alçada, não publica evento e não vai para o ERP (RN-VEN-32); cliente
 * inativo só aceita orçamento (RN-VEN-13); pedido com `orcamento_origem_id` converte o orçamento uma vez (RF-VEN-03). As
 * colunas da pré-venda vão pelo repositório (`pre-venda.ts`) até a migração 0013.
 */
import { createHash } from 'node:crypto';
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { CONSULTA_CADASTRO_RESUMO } from '@macuxi/core/contracts';
import { ErroHttpModulo, type ClienteBanco, type ContextoBase, type ItemPush, type ResultadoItemPush, type TransacaoTenant } from '@macuxi/platform-sdk';
import {
  EVENTO_PEDIDO_APROVACAO_SOLICITADA,
  EVENTO_PEDIDO_APROVADO,
  EVENTO_PEDIDO_CRIADO,
  EVENTO_PEDIDO_STATUS_ALTERADO,
  PedidoPush,
} from '../contracts';
import {
  conteudoDoEnvio,
  dataDoPreco,
  historicoDoOrcamento,
  momentoDaConversao,
  montarPedidoAprovado,
  politicaDosParametros,
  recusaDePerfil,
  revalidarPedido,
  statusDoContrato,
  validadeDoOrcamento,
  validadeOrcamentoDias,
  verificarConversao,
  verificarTipoParaCliente,
  type Recusa,
} from '../domain';
import { preVenda } from './pre-venda';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const aceito = (id: string, em?: string): ResultadoItemPush => (em ? { id, status: 'aceito', em } : { id, status: 'aceito' });
const rejeitado = (id: string, codigo: string, mensagem: string): ResultadoItemPush => ({ id, status: 'rejeitado', codigo, mensagem });
const recusa = (id: string, r: Recusa): ResultadoItemPush => rejeitado(id, r.codigo, r.mensagem);

const FORMATO_UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;

/** Relógio do banco depois de gravar: o aparelho mantém o item sobreposto até um pull com horizonte posterior (ADR 0009 §3). */
async function relogioDoBanco(db: ClienteBanco): Promise<string> {
  const r = await db.query<{ em: string }>(`select to_char(clock_timestamp() at time zone 'UTC', ${FORMATO_UTC}) as em`);
  return r.rows[0]!.em;
}

interface CondicaoLinha {
  id: string;
  descricao: string;
  codigo: string;
  padrao: boolean;
}

/** RN-VEN-14: condições do cliente; sem lista própria (nenhuma linha viva) vale só a padrão do tenant. */
export async function condicoesPermitidas(db: ClienteBanco, clienteId: string): Promise<{ permitidas: CondicaoLinha[]; padrao: CondicaoLinha | null }> {
  const todas = (
    await db.query<CondicaoLinha>(
      'select id, descricao, codigo, padrao from vendedor.condicao_pagamento where ativo and deleted_at is null order by padrao desc, descricao',
    )
  ).rows;
  const doCliente = (
    await db.query<{ condicao_pagamento_id: string }>('select condicao_pagamento_id from vendedor.cliente_condicao where cliente_id = $1 and deleted_at is null', [clienteId])
  ).rows.map((r) => r.condicao_pagamento_id);
  const padrao = todas.find((c) => c.padrao) ?? null;
  const permitidas = doCliente.length > 0 ? todas.filter((c) => doCliente.includes(c.id)) : padrao ? [padrao] : [];
  return { permitidas, padrao };
}

const nomeDoEndereco = (logradouro: string | null, numero: string | null) => [logradouro, numero].filter((x) => x && x.trim() !== '').join(', ');

async function receberUm(ctx: ContextoBase, db: ClienteBanco, tx: TransacaoTenant, item: ItemPush): Promise<ResultadoItemPush> {
  const p = item.payload as PedidoPush;
  const eu = ctx.usuario.id;
  const agora = ctx.agora();

  // 1) perfil (a plataforma já barrou o promotor; revalida) e carteira (RN-CORE-04)
  const perfil = recusaDePerfil(ctx.usuario.perfil);
  if (perfil) return recusa(item.id, perfil);

  // serializa envios simultâneos do mesmo pedido (timeout + retentativa): o segundo espera e cai na idempotência
  await db.query('select pg_advisory_xact_lock(hashtext($1))', [`pedido:${p.id}`]);

  // 2) idempotência (RN-VEN-33)
  const hash = createHash('sha256').update(conteudoDoEnvio(p as unknown as Record<string, unknown>)).digest('hex');
  const ja = (await db.query<{ vendedor_id: string; hash_envio: string | null; status: string; numero: string | null }>('select vendedor_id, hash_envio, status, numero from vendedor.pedido where id = $1', [p.id])).rows[0];
  if (ja) {
    if (ja.vendedor_id !== eu) return rejeitado(item.id, 'ID_EM_USO', 'Este identificador de pedido já pertence a outro registro.');
    if (ja.hash_envio === null || ja.hash_envio === hash) return aceito(item.id, await relogioDoBanco(db));
    return { id: item.id, status: 'conflito', mensagem: 'Este pedido já foi recebido com outro conteúdo. Duplique-o para fazer um novo.', atual: { id: p.id, status: ja.status, numero: ja.numero } };
  }

  // 3) carteira
  const carteira = await ctx.carteira();
  if (carteira !== 'tenant' && !carteira.has(p.customer_id)) {
    return rejeitado(item.id, 'FORA_DA_CARTEIRA', 'Este cliente não está na sua carteira. Atualize os dados e tente de novo.');
  }
  if (!UUID.test(p.customer_id) || p.items.some((i) => !UUID.test(i.product_id))) {
    return rejeitado(item.id, 'PAYLOAD_INVALIDO', 'Cliente ou produto com identificador inválido.');
  }
  const produtoIds = [...new Set(p.items.map((i) => i.product_id))];

  // 3b) pré-venda (T-0053): orçamento e conversão só com o repositório da 0013
  const tipo = p.tipo ?? 'pedido';
  const origem = p.orcamento_origem_id ?? null;
  const repo = preVenda();
  if ((tipo === 'orcamento' || origem) && !repo.disponivel) {
    return rejeitado(item.id, 'PRE_VENDA_INDISPONIVEL', 'Orçamento ainda não está liberado para a sua empresa. Envie como pedido ou fale com o administrador.');
  }
  if (tipo === 'orcamento' && origem) return rejeitado(item.id, 'PAYLOAD_INVALIDO', 'Orçamento não nasce de outro orçamento.');
  if (origem) {
    const r = verificarConversao({ orcamento: await repo.buscarOrcamento(db, origem), vendedor_id: eu, cliente_id: p.customer_id, pedido_id: p.id, momento: momentoDaConversao(p.created_offline_at, agora) });
    if (r) return recusa(item.id, r);
  }

  // 4) cadastro (core.cadastro_resumo@1): cliente e produtos existem e estão ativos
  const cad = await tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [p.customer_id], produto_ids: produtoIds, usuario_ids: [eu] });
  const cliente = cad.clientes.find((c) => c.id === p.customer_id);
  if (!cliente) return rejeitado(item.id, 'RN-VEN-13', 'Cliente inativo ou inexistente: não é possível vender (RN-VEN-13).');
  const soOrcamento = verificarTipoParaCliente(tipo, cliente.ativo);
  if (soOrcamento) return recusa(item.id, soOrcamento);
  const produtos = new Map(cad.produtos.map((x) => [x.id, x]));
  const invalido = produtoIds.filter((id) => !produtos.get(id)?.ativo);
  if (invalido.length > 0) return rejeitado(item.id, 'RN-VEN-01', 'Há produto inativo ou inexistente no pedido. Atualize o catálogo e remova o item.');
  const vendedor = cad.usuarios.find((u) => u.id === eu);

  // 5) preço na tabela do cliente, na data do pedido (RN-VEN-01, P-4; RN-CAT-06)
  const em = dataDoPreco(p.created_offline_at, agora);
  const precos = await tx.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: p.customer_id, produto_ids: produtoIds, em });
  const mapaPreco: Record<string, number | null> = {};
  for (const i of precos.itens) mapaPreco[i.produto_id] = i.preco_cents;

  // 6) condição de pagamento (RN-VEN-14)
  const { permitidas, padrao } = await condicoesPermitidas(db, p.customer_id);
  let condicao: CondicaoLinha | null = padrao;
  if (p.condicao_pagamento_id) {
    condicao = permitidas.find((c) => c.id === p.condicao_pagamento_id) ?? null;
    if (!condicao) return rejeitado(item.id, 'RN-VEN-14', 'Condição de pagamento não permitida para este cliente. Escolha outra.');
  }

  // 7) alçada de desconto (RN-VEN-10), preço e totais do servidor (RN-VEN-02)
  const rv = revalidarPedido({
    perfil: ctx.usuario.perfil,
    vendedor_id: eu,
    cliente_id: p.customer_id,
    carteira: [p.customer_id],
    desconto_pct: p.discount_pct,
    itens: p.items.map((i) => ({ product_id: i.product_id, sku: produtos.get(i.product_id)?.sku ?? i.product_id, quantity: i.quantity })),
    precos: mapaPreco,
    policy: politicaDosParametros(ctx.parametros()),
    total_aparelho_cents: p.total_cents,
  });
  if (!rv.ok) return recusa(item.id, rv);
  // RN-VEN-32: orçamento não vai para aprovação nem para o ERP; fica `received` com a validade
  const recebidoEm = agora.toISOString();
  const validade = tipo === 'orcamento' ? validadeDoOrcamento(recebidoEm, validadeOrcamentoDias(ctx.parametros())) : null;
  const v = validade
    ? { ...rv, status: 'received' as const, nivel: null, motivos: [], aprovacao_automatica: false, pending_reason: '', historico: historicoDoOrcamento(validade, ctx.fuso()) }
    : rv;

  // 8) grava (pedido, itens, histórico, auditoria, eventos) na mesma transação
  const numero = (await db.query<{ n: string }>('select vendedor.proximo_numero_pedido() as n')).rows[0]!.n;
  const resumo = {
    razao_social: cliente.razao_social,
    nome_fantasia: cliente.nome_fantasia ?? '',
    documento: cliente.documento ?? '',
    endereco: nomeDoEndereco(cliente.logradouro, cliente.numero),
    bairro: cliente.bairro ?? '',
    cidade: cliente.cidade ?? '',
    uf: cliente.uf ?? '',
    codigo_erp: cliente.external_id ?? '',
  };
  const ins = await db.query(
    `insert into vendedor.pedido (id, tenant_id, cliente_id, vendedor_id, autor_id, status, condicao_pagamento, desconto_pct, total_tabela_cents, total_cents,
        observacao, visita_id, rota_parada_id, criado_no_aparelho_em, recebido_em, numero, hash_envio, cliente_resumo, cliente_nome, vendedor_nome,
        tabela_preco_id, condicao_pagamento_id, condicao_pagamento_descricao, nivel_aprovacao, motivos_aprovacao, aprovacao_automatica)
     values ($1, plataforma.tenant_atual(), $2, $3, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19, $20, $21, $22, $23::text[], $24)
     on conflict (id) do nothing returning id`,
    [
      p.id, p.customer_id, eu, v.status, condicao?.descricao ?? null, v.desconto_pct, v.total_tabela_cents, v.total_cents,
      p.observacao ?? null, p.visita_id ?? null, p.route_stop_id ?? null, p.created_offline_at ?? null, recebidoEm, numero, hash,
      JSON.stringify(resumo), cliente.nome_fantasia || cliente.razao_social, vendedor?.nome ?? null,
      precos.tabela_preco_id, condicao?.id ?? null, condicao?.descricao ?? null, v.nivel, v.motivos, v.aprovacao_automatica,
    ],
  );
  // outro tenant com o mesmo id (chave primária global): não revela, só recusa
  if (ins.rows.length === 0) return rejeitado(item.id, 'ID_EM_USO', 'Este identificador de pedido já pertence a outro registro.');

  for (const [idx, it] of v.itens.entries()) {
    const prod = produtos.get(it.product_id)!;
    await db.query(
      `insert into vendedor.pedido_item (tenant_id, pedido_id, sequencia, produto_id, quantidade, preco_tabela_cents, preco_unitario_cents, desconto_pct, total_cents,
          produto_sku, produto_nome, unidade)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [p.id, idx + 1, it.product_id, it.quantity, it.preco_tabela_cents, it.preco_unitario_cents, it.desconto_pct, it.total_cents, prod.sku, prod.nome, prod.unidade],
    );
  }
  for (const h of v.historico) {
    await db.query(
      `insert into vendedor.pedido_evento (tenant_id, pedido_id, de, para, autor_id, autor_nome, autor_perfil, motivo, nivel, acima_do_nivel, ocorrido_em)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, false, $9)`,
      [p.id, h.de, h.para, eu, vendedor?.nome ?? null, ctx.usuario.perfil, h.motivo, h.para === 'pending_approval' ? v.nivel : null, recebidoEm],
    );
  }

  if (tipo === 'orcamento' || origem) await repo.marcarDocumento(db, p.id, { tipo, validade_ate: validade, orcamento_origem_id: origem });
  if (origem) await repo.marcarConvertido(db, origem, p.id);

  await tx.auditar({
    acao: 'pedido.criar',
    entidade: 'pedido',
    entidade_id: p.id,
    antes: null,
    depois: { status: v.status, numero, total_cents: v.total_cents, desconto_pct: v.desconto_pct, nivel: v.nivel, itens: v.itens.length, tipo, ...(origem ? { orcamento_origem_id: origem } : {}) },
  });
  // RN-VEN-32: orçamento não publica evento de pedido (metas, Gestor e fila do ERP só veem pedido)
  if (tipo === 'orcamento') return aceito(item.id, await relogioDoBanco(db));

  // eventos (status no vocabulário RN-VEN-30; nenhum nome/documento/endereço)
  await tx.publicar(
    EVENTO_PEDIDO_CRIADO,
    {
      pedido_id: p.id,
      vendedor_id: eu,
      autor_id: eu,
      cliente_id: p.customer_id,
      visita_id: p.visita_id ?? null,
      tipo: 'pedido',
      total_cents: v.total_cents,
      total_tabela_cents: v.total_tabela_cents,
      criado_em: recebidoEm,
      itens: v.itens.map((i) => ({ produto_id: i.product_id, quantidade: i.quantity, total_cents: i.total_cents })),
      status: statusDoContrato(v.status),
    },
    p.id,
  );
  for (const h of v.historico) {
    await tx.publicar(
      EVENTO_PEDIDO_STATUS_ALTERADO,
      {
        pedido_id: p.id,
        vendedor_id: eu,
        de: h.de ? statusDoContrato(h.de) : null,
        para: statusDoContrato(h.para),
        alterado_em: recebidoEm,
        autor_id: eu,
        motivo: h.motivo,
      },
      p.id,
    );
  }
  if (v.status === 'pending_approval' && v.nivel) {
    await tx.publicar(
      EVENTO_PEDIDO_APROVACAO_SOLICITADA,
      {
        pedido_id: p.id,
        vendedor_id: eu,
        cliente_id: p.customer_id,
        solicitada_em: recebidoEm,
        nivel: v.nivel,
        motivos: v.motivos,
        desconto_efetivo_pct: v.desconto_pct,
        total_cents: v.total_cents,
        credito: null,
        historico: null,
      },
      p.id,
    );
  } else {
    await tx.publicar(
      EVENTO_PEDIDO_APROVADO,
      montarPedidoAprovado({
        pedido_uuid: p.id,
        cliente_external_id: cliente.external_id,
        vendedor_external_id: vendedor?.external_id ?? null,
        condicao_pagamento_codigo: condicao?.codigo ?? null,
        criado_em: p.created_offline_at ?? recebidoEm,
        aprovado_em: recebidoEm,
        observacao: p.observacao ?? null,
        itens: v.itens.map((i) => ({ produto_external_id: produtos.get(i.product_id)?.external_id ?? null, quantidade: i.quantity, preco_tabela_cents: i.preco_tabela_cents, total_cents: i.total_cents })),
      }),
      p.id,
    );
  }
  return aceito(item.id, await relogioDoBanco(db));
}

export async function receberPedidos(ctx: ContextoBase, itens: readonly ItemPush[]): Promise<ResultadoItemPush[]> {
  const saida: ResultadoItemPush[] = [];
  for (const item of itens) {
    if (item.operacao === 'remover') {
      saida.push(rejeitado(item.id, 'RN-VEN-31', 'Pedido não se remove pelo aparelho: use cancelar.'));
      continue;
    }
    if ((item.payload as { id?: unknown } | null)?.id !== item.id) {
      saida.push(rejeitado(item.id, 'PAYLOAD_INVALIDO', 'O id do item da fila não confere com o id do pedido.'));
      continue;
    }
    try {
      saida.push(await ctx.comTenant((db, tx) => receberUm(ctx, db, tx, item)));
    } catch (e) {
      // 4xx de módulo rejeita só o item; 5xx (inclui consulta indisponível, 503) derruba o lote: o motor reenvia
      if (!(e instanceof ErroHttpModulo) || e.status >= 500) throw e;
      saida.push(rejeitado(item.id, e.codigo, e.message));
    }
  }
  return saida;
}
