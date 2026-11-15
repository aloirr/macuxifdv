/**
 * Push do pedido (`receber`; T-0029 §4, ADR 0011). Uma transação por item (como `visita-push.ts` do Core); regra violada
 * vira `rejeitado` só daquele item, erro de banco ou consulta indisponível (503) derruba o lote para o aparelho reenviar.
 * Ordem: remover → id do payload → perfil → idempotência (RN-VEN-33) → carteira (RN-CORE-04) → cadastro
 * (`core.cadastro_resumo@1`) → preço (`catalogo.precos_cliente@1`, RN-CAT-06) → condição (RN-VEN-14) → alçada (RN-VEN-10).
 * O total do servidor vale (RN-VEN-02). Sem dado pessoal em log.
 * T-0053 (pré-venda): `tipo = orcamento` não passa pela alçada, não publica evento e não vai para o ERP (RN-VEN-32); cliente
 * inativo só aceita orçamento (RN-VEN-13); pedido com `orcamento_origem_id` converte o orçamento uma vez (RF-VEN-03). As
 * colunas da pré-venda vão pelo repositório (`pre-venda.ts`) até a migração 0013.
 * Pedido em nome (RN-VEN-35, RF-GES-05): `vendedor_id` do payload ≠ usuário do token. O dono é o vendedor (conta na meta e no
 * ranking), o autor é SEMPRE o token (`autor_id`); a API confere perfil (supervisor/gerente), equipe/área e a alçada do gestor.
 */
import { createHash } from 'node:crypto';
import { CONSULTA_PRECOS_CLIENTE } from '@macuxi/catalogo/contracts';
import { CONSULTA_CADASTRO_RESUMO, CONSULTA_FILIAIS, type LimiteDesconto } from '@macuxi/core/contracts';
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
  retratoFilialDoPedido,
  dataDoPreco,
  emitidoEm,
  faixasDaConsulta,
  historicoDoOrcamento,
  precoDoOrcamentoVale,
  ehPedidoEmNome,
  momentoDaConversao,
  aplicacaoMaxOrcamento,
  marcaDoRetrato,
  modalidadePadraoDosParametros,
  MSG_RECUSA_FRETE,
  politicaDoAutor,
  politicaDosParametros,
  precoMinimoBaseCents,
  recusaDePerfil,
  enderecoDoPedido,
  enderecoHerdadoDoOrcamento,
  resolverUnidadeDoItem,
  revalidarPedido,
  statusDoContrato,
  validadeDoOrcamento,
  validadeOrcamentoDias,
  precoDoItemNaEdicao,
  validarFrete,
  verificarPedidoEmNome,
  verificarConversao,
  verificarTipoParaCliente,
  type FaixaEscalonada,
  type FretePedido,
  type Recusa,
} from '../domain';
import { payloadAprovado } from './aprovado-erp';
import { resolverPagamento, valoresPagamento, valorPercentualPrazo } from './pagamento';
import { preVenda } from './pre-venda';
import { precosCongeladosDoDocumento } from './preco-congelado';
import { faltaDeEstoqueNaFilial, provedorSaldoDaFilial } from './estoque-filial';

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

/** RN-VEN-17: texto da recusa do endereço (nada do conteúdo digitado). */
export const MSG_ENDERECO_INVALIDO = 'Endereço de entrega incompleto. Confira CEP, rua, número, bairro, cidade e UF.';

const nomeDoEndereco = (logradouro: string | null, numero: string | null) => [logradouro, numero].filter((x) => x && x.trim() !== '').join(', ');

/**
 * Passos 4 a 7 do recebimento (cadastro, medida, frete, endereço, preço, condição, alçada), compartilhados com a edição do
 * orçamento (`orcamentos.ts`). Recusa devolve o `ResultadoItemPush` pronto; o chamador decide se vira 422 ou item rejeitado.
 */
export async function calcularDocumento(
  ctx: ContextoBase,
  db: ClienteBanco,
  tx: TransacaoTenant,
  p: PedidoPush,
  tipo: 'pedido' | 'orcamento',
  itemId: string,
  validadeFixa?: { data: string; ate: string },
  /** T-0134 (RN-VEN-18): produto → preço de tabela por unidade já gravado no orçamento (edição ou Transformar) */
  congelados?: Record<string, number>,
) {
  const eu = ctx.usuario.id;
  const agora = ctx.agora();
  // RN-VEN-35: dono do pedido (o vendedor) × autor (o token). Orçamento nunca é em nome.
  const donoId = tipo === 'pedido' && ehPedidoEmNome(eu, p.vendedor_id) ? p.vendedor_id! : eu;
  const emNome = donoId !== eu;
  const produtoIds = [...new Set(p.items.map((i) => i.product_id))];
  // 4) cadastro (core.cadastro_resumo@1): cliente e produtos existem e estão ativos
  const cad = await tx.consultar(CONSULTA_CADASTRO_RESUMO, { cliente_ids: [p.customer_id], produto_ids: produtoIds, usuario_ids: emNome ? [eu, donoId] : [eu], endereco_ids: p.endereco_entrega_id ? [p.endereco_entrega_id] : [] });
  const cliente = cad.clientes.find((c) => c.id === p.customer_id);
  if (!cliente) return rejeitado(itemId, 'RN-VEN-13', 'Cliente inativo ou inexistente: não é possível vender.');
  // RN-VEN-13 (T-0071 §1.4 e): inativo, bloqueado ou cadastro incompleto só faz orçamento (422 com os campos que faltam)
  const soOrcamento = verificarTipoParaCliente(tipo, { ativo: cliente.ativo, bloqueado: cliente.bloqueado === true, cadastro_incompleto: cliente.cadastro_incompleto ?? false, campos_faltantes: cliente.cadastro_campos_faltantes ?? [] });
  if (soOrcamento) return recusa(itemId, soOrcamento);
  // RN-CORE-39 (T-0149): o pedido não escolhe filial; o servidor grava a filial EFETIVA do cliente (core.filiais@1), ignorando `branch_id` do aparelho
  const fil = await tx.consultar(CONSULTA_FILIAIS, { cliente_ids: [p.customer_id], external_ids: [], escopo: 'tenant' });
  // sem o dado de filiais (consulta antiga/ausente) o comportamento é o anterior: sem filial no retrato
  const filialId = fil?.clientes?.find((c) => c.cliente_id === p.customer_id)?.filial_id ?? fil?.padrao_id;
  const filialDoCliente = fil?.filiais?.find((f) => f.id === filialId);
  const retratoFilial = filialDoCliente ? retratoFilialDoPedido(filialDoCliente) : null;
  const produtos = new Map(cad.produtos.map((x) => [x.id, x]));
  const invalido = produtoIds.filter((id) => !produtos.get(id)?.ativo);
  if (invalido.length > 0) return rejeitado(itemId, 'RN-VEN-01', 'Há produto inativo ou inexistente no pedido. Atualize o catálogo e remova o item.');
  const vendedor = cad.usuarios.find((u) => u.id === donoId);
  const autor = cad.usuarios.find((u) => u.id === eu);
  if (emNome) {
    // RN-VEN-35: equipe do supervisor / área do gerente; dono precisa ser vendedor; o promotor nunca (RN-PRO-01)
    const nao = verificarPedidoEmNome({ autor: { id: eu, perfil: ctx.usuario.perfil }, vendedor_id: donoId, vendedor: vendedor ? { id: vendedor.id, perfil: vendedor.perfil } : null, visiveis: await ctx.usuariosVisiveis() });
    if (nao) return recusa(itemId, nao);
  }

  // 4b) medida vendida (RN-VEN-15; o fator vem do Core), frete (RN-VEN-16) e endereço de entrega (RN-VEN-17)
  const medidas = new Map<number, { unidade: string; fator: number }>();
  for (const [idx, it] of p.items.entries()) {
    const u = resolverUnidadeDoItem(it.unidade, produtos.get(it.product_id)!);
    if (!u.ok) return rejeitado(itemId, u.codigo, 'Medida inválida para um dos produtos. Atualize o catálogo e escolha a medida de novo.');
    medidas.set(idx, { unidade: u.unidade, fator: u.fator });
  }
  const frete: FretePedido = p.frete ?? { modalidade: modalidadePadraoDosParametros(ctx.parametros()) };
  const recusaFrete = validarFrete(frete);
  if (recusaFrete) return rejeitado(itemId, recusaFrete, MSG_RECUSA_FRETE[recusaFrete]);
  let transportadora: { id: string | null; digitada: boolean; nome: string | null; documento: string | null; telefone: string | null } = { id: null, digitada: false, nome: null, documento: null, telefone: null };
  if (frete.modalidade === 'FOB') {
    if (frete.transportadora_id) {
      const t = (
        await db.query<{ id: string; nome: string; documento: string | null; telefone: string | null }>(
          'select id, nome, documento, telefone from vendedor.transportadora where id = $1 and ativo and deleted_at is null',
          [frete.transportadora_id],
        )
      ).rows[0];
      if (!t) return rejeitado(itemId, 'transportadora_invalida', 'Transportadora não encontrada ou inativa. Atualize a lista e escolha de novo.');
      transportadora = { id: t.id, digitada: false, nome: t.nome, documento: t.documento, telefone: t.telefone };
    } else if (frete.transportadora_digitada) {
      const d = frete.transportadora_digitada;
      transportadora = { id: null, digitada: true, nome: d.nome.trim(), documento: d.cnpj.replace(/\D/g, ''), telefone: d.telefone?.trim() || null };
    }
  }
  const enderecos = (cad.enderecos ?? []).filter((x) => x.cliente_id === p.customer_id);
  // RN-VEN-17 (T-0141): endereço do ERP ou o digitado só para este pedido; a API revalida (limites da NF-e) e nunca loga o conteúdo
  const alvo = enderecoDoPedido({ editado: p.endereco_entrega_editado, escolhido_id: p.endereco_entrega_id, enderecos });
  if (!alvo.ok) return rejeitado(itemId, alvo.codigo, MSG_ENDERECO_INVALIDO);
  const enderecoRetrato = alvo.retrato;

  // 5) preço na tabela do cliente, na data do pedido (RN-VEN-01, P-4; RN-CAT-06)
  const em = dataDoPreco(p.created_offline_at, agora);
  const precos = await tx.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: p.customer_id, produto_ids: produtoIds, em });
  const mapaPreco: Record<string, number | null> = {};
  const mapaFaixas: Record<string, FaixaEscalonada[]> = {};
  for (const i of precos.itens) {
    mapaPreco[i.produto_id] = i.preco_cents;
    // RN-VEN-15 (nova, T-0089): a embalagem é sempre UN × fator; `embalagens[]` do Catálogo é ignorado.
    // RN-VEN-23: faixas vigentes da tabela escalonada (o Catálogo publica `faixas?`; ausente = sem faixa)
    const faixas = faixasDaConsulta(i);
    if (faixas.length > 0) mapaFaixas[i.produto_id] = faixas;
  }

  // T-0134 (RN-VEN-18): item que já estava no orçamento mantém o preço salvo; só o item novo usa a tabela de hoje
  for (const pid of produtoIds) {
    if (congelados?.[pid] === undefined) continue;
    const e = precoDoItemNaEdicao({ congelado_cents: congelados[pid], hoje_cents: mapaPreco[pid] ?? null, faixas_hoje: mapaFaixas[pid] });
    mapaPreco[pid] = e.preco_unidade_cents;
    delete mapaFaixas[pid];
  }

  // 6) pagamento: forma + prazo (RN-VEN-24/25, T-0089) ou, no APK anterior, a condição de pagamento (RN-VEN-14 legado)
  const pg = await resolverPagamento(ctx, db, tx, p, cliente, tipo);
  if (!pg.ok) return rejeitado(itemId, pg.codigo, pg.mensagem);
  const pagamento = pg.pagamento;
  let condicao: CondicaoLinha | null = null;
  if (!pagamento) {
    const { permitidas, padrao } = await condicoesPermitidas(db, p.customer_id);
    condicao = padrao;
    if (p.condicao_pagamento_id) {
      condicao = permitidas.find((c) => c.id === p.condicao_pagamento_id) ?? null;
      if (!condicao) return rejeitado(itemId, 'RN-VEN-14', 'Condição de pagamento não permitida para este cliente. Escolha outra.');
    }
  }

  // 7) alçada de desconto (RN-VEN-10), preço e totais do servidor (RN-VEN-02)
  const rv = revalidarPedido({
    perfil: ctx.usuario.perfil,
    em_nome: emNome,
    tipo,
    // RN-VEN-11a (T-0168): o limite é o do AUTOR (o gestor, em nome); emissor antigo sem os campos = padrão
    limite: autor as Partial<LimiteDesconto> | undefined,
    vendedor_id: donoId,
    cliente_id: p.customer_id,
    carteira: [p.customer_id],
    desconto_pct: p.discount_pct,
    acrescimo_pct: p.acrescimo_pct ?? 0,
    desconto_valor_cents: p.desconto_valor_cents ?? 0,
    acrescimo_valor_cents: p.acrescimo_valor_cents ?? 0,
    itens: p.items.map((i, idx) => {
      const bpDoItem = congelados?.[i.product_id] !== undefined ? 0 : pg.percentual_ajuste_bp;
      return {
      product_id: i.product_id,
      sku: produtos.get(i.product_id)?.sku ?? i.product_id,
      quantity: i.quantity,
      unidade: medidas.get(idx)!.unidade,
      fator: medidas.get(idx)!.fator,
      desconto_pct: i.desconto_pct ?? 0,
      acrescimo_pct: i.acrescimo_pct ?? 0,
      desconto_unitario_cents: i.desconto_unitario_cents ?? 0,
      acrescimo_unitario_cents: i.acrescimo_unitario_cents ?? 0,
      // RN-VEN-11: mínimo por unidade base = preço de venda × (1 − desconto máximo efetivo), do Core (null = sem preço de venda, sem mínimo)
      // T-0084 (RN-VEN-19): retrato do aparelho; nulo/ausente = sem aplicação
      aplicacao: i.aplicacao ?? null,
      // RN-VEN-43: o mínimo parte da tabela ajustada pelo prazo; o preço congelado do orçamento (RN-VEN-18) já está gravado ajustado
      percentual_ajuste_bp: bpDoItem,
      preco_minimo_base_cents: precoMinimoBaseCents({ preco_venda_cents: produtos.get(i.product_id)?.preco_venda_cents ?? null, desconto_maximo_pct: produtos.get(i.product_id)?.desconto_maximo_pct ?? 100, percentual_ajuste_bp: bpDoItem }),
      };
    }),
    percentual_ajuste_bp: pg.percentual_ajuste_bp,
    precos: mapaPreco,
    faixas: mapaFaixas,
    titulo_vencido: pg.titulo_vencido,
    // RN-VEN-45: percentual divergente aceito = aviso na linha do tempo, fora da alçada
    percentual_mudou: pg.percentual_mudou,
    aplicacao_max: aplicacaoMaxOrcamento(ctx.parametros()),
    // RN-VEN-10: o pedido do gestor usa a alçada do gestor
    policy: emNome ? politicaDoAutor(politicaDosParametros(ctx.parametros()), ctx.usuario.perfil) : politicaDosParametros(ctx.parametros()),
    total_aparelho_cents: p.total_cents,
  });
  if (!rv.ok) return recusa(itemId, rv);
  // RN-VEN-20 (T-0149): sem estoque na FILIAL do cliente (saldo da filial − reservas da mesma filial) o pedido só sai como orçamento
  if (tipo === 'pedido') {
    const falta = await faltaDeEstoqueNaFilial(db, provedorSaldoDaFilial(tx), p.items.map((i, idx) => ({ produto_id: i.product_id, quantidade_base: i.quantity * medidas.get(idx)!.fator })), retratoFilial?.filial_id ?? null, p.id);
    if (falta.length > 0) return rejeitado(itemId, 'RN-VEN-20', 'Sem estoque na filial para um dos itens. Envie como orçamento ou reduza a quantidade.');
  }
  // RN-VEN-32: orçamento não vai para aprovação nem para o ERP; fica `received` com a validade
  const recebidoEm = agora.toISOString();
  // RN-VEN-18: data civil no fuso do tenant, contada do momento do aparelho (mesma janela do preço, P-4)
  // edição do orçamento recebido NÃO renova a validade (desenho §1.3): `validadeFixa` traz a original
  const validadeCivil = tipo === 'orcamento' ? (validadeFixa ?? validadeDoOrcamento(momentoDaConversao(p.created_offline_at, agora).toISOString(), validadeOrcamentoDias(ctx.parametros()), ctx.fuso())) : null;
  const validade = validadeCivil?.ate ?? null;
  const v = validadeCivil
    ? { ...rv, status: 'received' as const, nivel: null, motivos: [], aprovacao_automatica: false, pending_reason: '', historico: historicoDoOrcamento(validadeCivil.data, validadeOrcamentoDias(ctx.parametros())) }
    : rv;
  return { cliente, produtos, vendedor, autor, donoId, emNome, frete, transportadora, alvo, enderecoRetrato, precos, condicao, pagamento, v, validade, validadeCivil, recebidoEm, retratoFilial, percentualAjustePrazo: pg.percentual_ajuste };
}

/** Tudo que o servidor decide sobre o documento antes de gravar (preço, alçada, medida, frete, endereço, condição). */
export type DocumentoCalculado = Exclude<Awaited<ReturnType<typeof calcularDocumento>>, ResultadoItemPush>;

async function receberUm(ctx: ContextoBase, db: ClienteBanco, tx: TransacaoTenant, item: ItemPush): Promise<ResultadoItemPush> {
  const p = item.payload as PedidoPush;
  const eu = ctx.usuario.id;
  const agora = ctx.agora();

  // 1) perfil (a plataforma já barrou o promotor; revalida) e carteira (RN-CORE-04)
  const perfil = recusaDePerfil(ctx.usuario.perfil, ehPedidoEmNome(eu, p.vendedor_id));
  if (perfil) return recusa(item.id, perfil);

  // serializa envios simultâneos do mesmo pedido (timeout + retentativa): o segundo espera e cai na idempotência
  await db.query('select pg_advisory_xact_lock(hashtext($1))', [`pedido:${p.id}`]);

  // 2) idempotência (RN-VEN-33)
  const hash = createHash('sha256').update(conteudoDoEnvio(p as unknown as Record<string, unknown>)).digest('hex');
  const ja = (await db.query<{ vendedor_id: string; autor_id: string | null; hash_envio: string | null; status: string; numero: string | null }>('select vendedor_id, autor_id, hash_envio, status, numero from vendedor.pedido where id = $1', [p.id])).rows[0];
  if (ja) {
    // em nome o pedido é do vendedor e quem enviou é o autor: o id só repete para quem o criou
    if ((ja.autor_id ?? ja.vendedor_id) !== eu) return rejeitado(item.id, 'ID_EM_USO', 'Este identificador de pedido já pertence a outro registro.');
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

  // 3b) pré-venda (T-0053): orçamento e conversão só com o repositório da 0013
  const tipo = p.tipo ?? 'pedido';
  const origem = p.orcamento_origem_id ?? null;
  if (ehPedidoEmNome(eu, p.vendedor_id) && (tipo === 'orcamento' || origem)) {
    return rejeitado(item.id, 'EM_NOME_SO_PEDIDO', 'Pedido em nome vale só para pedido. Faça o orçamento no nome do próprio vendedor.');
  }
  const repo = preVenda();
  if ((tipo === 'orcamento' || origem) && !repo.disponivel) {
    return rejeitado(item.id, 'PRE_VENDA_INDISPONIVEL', 'Orçamento ainda não está liberado para a sua empresa. Envie como pedido ou fale com o administrador.');
  }
  if (tipo === 'orcamento' && origem) return rejeitado(item.id, 'PAYLOAD_INVALIDO', 'Orçamento não nasce de outro orçamento.');
  let precoVale = false;
  if (origem) {
    const orcOrigem = await repo.buscarOrcamento(db, origem, ctx.fuso());
    const momento = momentoDaConversao(p.created_offline_at, agora);
    const r = verificarConversao({ orcamento: orcOrigem, vendedor_id: eu, cliente_id: p.customer_id, pedido_id: p.id, momento });
    if (r) return recusa(item.id, r);
    // T-0141 (RN-VEN-18): o preço congelado vale até D+7 23:59 (fuso do tenant); depois, o pedido nasce pela tabela do dia
    precoVale = precoDoOrcamentoVale(orcOrigem?.validade_ate, momento);
  }

  // T-0134: Transformar mantém os preços do orçamento enquanto valem (RN-VEN-18); estoque, mínimo (RN-VEN-11) e alçada são revalidados abaixo
  const congelados = origem && precoVale ? await precosCongeladosDoDocumento(db, origem) : undefined;
  // T-0141 (RN-VEN-17): Transformar sem endereço no corpo herda o retrato do orçamento (editado continua editado)
  let pDoc = p;
  if (origem && !p.endereco_entrega_id && !p.endereco_entrega_editado) {
    const o = (await db.query<{ endereco_entrega: Record<string, unknown> | null }>("select endereco_entrega from vendedor.pedido where id = $1 and tipo = 'orcamento'", [origem])).rows[0];
    pDoc = { ...p, ...enderecoHerdadoDoOrcamento(o?.endereco_entrega as never) } as typeof p;
  }
  const calc = await calcularDocumento(ctx, db, tx, pDoc, tipo, item.id, undefined, congelados);
  if ('status' in calc) return calc;
  const { cliente, produtos, vendedor, autor, donoId, emNome, frete, transportadora, alvo, enderecoRetrato, precos, condicao, pagamento, v, validade, validadeCivil, recebidoEm, retratoFilial, percentualAjustePrazo } = calc;

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
        tabela_preco_id, condicao_pagamento_id, condicao_pagamento_descricao, nivel_aprovacao, motivos_aprovacao, aprovacao_automatica,
        acrescimo_pct, desconto_efetivo_pct, frete_modalidade, transportadora_id, transportadora_digitada, transportadora_nome,
        transportadora_documento, transportadora_telefone, endereco_entrega_id, endereco_entrega,
        desconto_valor_cents, acrescimo_valor_cents, ajuste_em,
        forma_pagamento_id, prazo_pagamento_id, forma_pagamento_codigo, forma_pagamento_nome, prazo_codigo, prazo_descricao, prazo_parcelas_dias, prazo_medio_dias,
        filial_id, filial, prazo_percentual_ajuste)
     values ($1, plataforma.tenant_atual(), $2, $3, $38, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18, $19, $20, $21, $22, $23::text[], $24,
        $25, $26, $27, $28, $29, $30, $31, $32, $33, $34::jsonb, $35, $36, $37,
        $39, $40, $41, $42, $43, $44, $45::int[], $46, $47, $48::jsonb, $49)
     on conflict (id) do nothing returning id`,
    [
      p.id, p.customer_id, donoId, v.status, pagamento?.texto ?? condicao?.descricao ?? null, v.desconto_pct, v.total_tabela_cents, v.total_cents,
      p.observacao ?? null, p.visita_id ?? null, p.route_stop_id ?? null, p.created_offline_at ?? null, recebidoEm, numero, hash,
      JSON.stringify(resumo), cliente.nome_fantasia || cliente.razao_social, vendedor?.nome ?? null,
      precos.tabela_preco_id, condicao?.id ?? null, pagamento?.texto ?? condicao?.descricao ?? null, v.nivel, v.motivos, v.aprovacao_automatica,
      v.acrescimo_pct, v.desconto_efetivo_pct, frete.modalidade, transportadora.id, transportadora.digitada, transportadora.nome,
      transportadora.documento, transportadora.telefone, alvo.endereco_id, enderecoRetrato ? JSON.stringify(enderecoRetrato) : null,
      v.desconto_valor_cents, v.acrescimo_valor_cents, v.ajuste_em, eu,
      ...valoresPagamento(pagamento),
      retratoFilial?.filial_id ?? null, retratoFilial ? JSON.stringify(retratoFilial.filial) : null,
      valorPercentualPrazo(pagamento, percentualAjustePrazo),
    ],
  );
  // outro tenant com o mesmo id (chave primária global): não revela, só recusa
  if (ins.rows.length === 0) return rejeitado(item.id, 'ID_EM_USO', 'Este identificador de pedido já pertence a outro registro.');

  for (const [idx, it] of v.itens.entries()) {
    const prod = produtos.get(it.product_id)!;
    await db.query(
      `insert into vendedor.pedido_item (tenant_id, pedido_id, sequencia, produto_id, quantidade, preco_tabela_cents, preco_unitario_cents, desconto_pct, total_cents,
          produto_sku, produto_nome, unidade, fator, acrescimo_pct, preco_minimo_cents, desconto_unitario_cents, acrescimo_unitario_cents, ajuste_em, aplicacao, marca)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)`,
      [p.id, idx + 1, it.product_id, it.quantity, it.preco_tabela_cents, it.preco_unitario_cents, it.desconto_pct, it.total_cents, prod.sku, prod.nome, it.unidade ?? prod.unidade, it.fator, it.acrescimo_pct, it.preco_minimo_cents, it.desconto_unitario_cents, it.acrescimo_unitario_cents, it.ajuste_em, it.aplicacao, marcaDoRetrato(prod.marca)],
    );
  }
  for (const h of v.historico) {
    await db.query(
      `insert into vendedor.pedido_evento (tenant_id, pedido_id, de, para, autor_id, autor_nome, autor_perfil, motivo, nivel, acima_do_nivel, ocorrido_em)
       values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7, $8, false, $9)`,
      [p.id, h.de, h.para, eu, autor?.nome ?? null, ctx.usuario.perfil, h.motivo, h.para === 'pending_approval' ? v.nivel : null, recebidoEm],
    );
  }

  if (tipo === 'orcamento' || origem) await repo.marcarDocumento(db, p.id, { tipo, validade_ate: validade, validade_data: validadeCivil?.data ?? null, orcamento_origem_id: origem });
  if (origem) await repo.marcarConvertido(db, origem, p.id);

  await tx.auditar({
    acao: 'pedido.criar',
    entidade: 'pedido',
    entidade_id: p.id,
    antes: null,
    depois: { ...(emNome ? { em_nome: true, vendedor_id: donoId, autor_id: eu } : {}), status: v.status, numero, total_cents: v.total_cents, desconto_pct: v.desconto_pct, desconto_efetivo_pct: v.desconto_efetivo_pct, frete: frete.modalidade, nivel: v.nivel, itens: v.itens.length, tipo, ...(origem ? { orcamento_origem_id: origem } : {}) },
  });
  // RN-VEN-32: orçamento não publica evento de pedido (metas, Gestor e fila do ERP só veem pedido)
  if (tipo === 'orcamento') return aceito(item.id, await relogioDoBanco(db));

  // eventos (status no vocabulário RN-VEN-30; nenhum nome/documento/endereço)
  await tx.publicar(
    EVENTO_PEDIDO_CRIADO,
    {
      pedido_id: p.id,
      vendedor_id: donoId,
      autor_id: eu,
      cliente_id: p.customer_id,
      visita_id: p.visita_id ?? null,
      tipo: 'pedido',
      total_cents: v.total_cents,
      total_tabela_cents: v.total_tabela_cents,
      criado_em: recebidoEm,
      emitido_em: emitidoEm(p.created_offline_at, recebidoEm),
      itens: v.itens.map((i) => ({ produto_id: i.product_id, quantidade: i.quantidade_base, total_cents: i.total_cents })),
      status: statusDoContrato(v.status),
    },
    p.id,
  );
  for (const h of v.historico) {
    await tx.publicar(
      EVENTO_PEDIDO_STATUS_ALTERADO,
      {
        pedido_id: p.id,
        vendedor_id: donoId,
        de: h.de ? statusDoContrato(h.de) : null,
        para: statusDoContrato(h.para),
        alterado_em: recebidoEm,
        autor_id: eu,
        motivo: h.motivo,
        pedido_numero: numero,
      },
      p.id,
    );
  }
  if (v.status === 'pending_approval' && v.nivel) {
    await tx.publicar(
      EVENTO_PEDIDO_APROVACAO_SOLICITADA,
      {
        pedido_id: p.id,
        vendedor_id: donoId,
        cliente_id: p.customer_id,
        solicitada_em: recebidoEm,
        nivel: v.nivel,
        motivos: v.motivos,
        desconto_efetivo_pct: Math.max(0, v.desconto_efetivo_pct),
        total_cents: v.total_cents,
        credito: null,
        historico: null,
        pedido_numero: numero,
      },
      p.id,
    );
  } else {
    await tx.publicar(EVENTO_PEDIDO_APROVADO, await payloadAprovado(db, tx, p.id, recebidoEm), p.id);
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
