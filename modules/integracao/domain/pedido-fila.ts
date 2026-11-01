/**
 * Fila de pedidos para o ERP e retorno do ERP (RN-INT-08; decisão do Alexandre sobre cancelamento: o Macuxi nunca escreve
 * cancelamento no ERP, só recebe `cancelado` pelo retorno). Tudo puro: a API grava/lê `pedido_fila_erp` e publica o evento.
 *
 *  Vendedor aprova ─► montarPedidoParaErp (de-para) ─► decidirEntradaNaFila ─► pendente
 *  Conector consulta ─► selecionarPendentes ─► enviado (reentrega após [10 min] sem confirmação)
 *  Conector retorna ─► aplicarRetornoPedido ─► integrado | rejeitado_erp | faturado_parcial/total | cancelado (+ evento)
 */
import {
  type EstadoPedidoErp,
  type Mapeamento as MapeamentoContrato,
  type PedidoAprovadoParaFila,
  type PedidoParaErp,
  type PedidoRetornoErpEvento,
  type RetornoErp,
  VERSAO_CONTRATO,
} from '../contracts';
import { aplicarTimeoutEnvio, chaveNotaRetorno, podeEntrarNaFila, transicionarRetornoPedidoErp, type NotaChave } from './estados';
import { hashRegistro } from './idempotencia';
import { PARAMETROS_PADRAO } from './parametros';

export type Mapeamento = Pick<MapeamentoContrato, 'tipo' | 'codigo_erp' | 'codigo_macuxi' | 'ativo'>;

export interface ItemFaturadoAcumulado {
  quantidade: number;
  valor_cents: number;
}

export interface PedidoNaFila {
  pedido_uuid: string;
  estado: EstadoPedidoErp;
  payload: PedidoParaErp;
  enviado_em: string | null;
  /** Quantas vezes foi entregue ao Conector. */
  tentativas: number;
  numero_erp: string | null;
  motivo: string | null;
  /** Notas fiscais já aplicadas (número + série): a 2ª nota parcial é fato novo, a mesma nota repetida não (RN-INT-08). */
  notas_aplicadas: NotaChave[];
  /** Por `sequencia` do pedido enviado: o que já foi faturado nos retornos aceitos. */
  itens_faturados_acumulados: Record<number, ItemFaturadoAcumulado>;
  /** Retirado da fila antes de ser entregue (cancelado/devolvido à aprovação no Macuxi). */
  removido_em: string | null;
}

// ---------------------------------------------------------------- montagem (de-para)

export type ResultadoMontagem =
  | { ok: true; pedido: PedidoParaErp }
  | { ok: false; codigo: 'mapeamento_ausente' | 'mapeamento_ambiguo' | 'sequencia_repetida'; mensagem: string };

/**
 * Traduz a condição de pagamento (de-para ativo `condicao_pagamento`) e confere as sequências. Sem de-para o pedido fica RETIDO
 * (não perdido): o BKO mostra o que cadastrar e a fila é reprocessada quando o mapeamento existir.
 */
export function montarPedidoParaErp(origem: PedidoAprovadoParaFila, mapeamentos: readonly Mapeamento[]): ResultadoMontagem {
  const sequencias = origem.itens.map((i) => i.sequencia);
  if (new Set(sequencias).size !== sequencias.length) {
    return { ok: false, codigo: 'sequencia_repetida', mensagem: 'Há itens com a mesma sequência no pedido. A sequência identifica a linha no retorno do faturamento e precisa ser única.' };
  }
  let condicaoErp: string | null = null;
  const codigo = origem.condicao_pagamento_codigo?.trim();
  if (codigo) {
    const achados = mapeamentos.filter((m) => m.tipo === 'condicao_pagamento' && m.ativo && m.codigo_macuxi === codigo);
    const distintos = new Set(achados.map((m) => m.codigo_erp));
    if (distintos.size === 0) {
      return { ok: false, codigo: 'mapeamento_ausente', mensagem: `A condição de pagamento "${codigo}" não tem correspondente no ERP. Cadastre em Integração ERP > Mapeamento (tipo condição de pagamento); o pedido segue sozinho depois disso.` };
    }
    if (distintos.size > 1) {
      return { ok: false, codigo: 'mapeamento_ambiguo', mensagem: `A condição de pagamento "${codigo}" tem mais de um correspondente ativo no ERP. Deixe só um ativo em Integração ERP > Mapeamento.` };
    }
    condicaoErp = [...distintos][0] ?? null;
  }
  return {
    ok: true,
    pedido: {
      versao_contrato: VERSAO_CONTRATO,
      pedido_uuid: origem.pedido_uuid,
      cliente_external_id: origem.cliente_external_id,
      vendedor_external_id: origem.vendedor_external_id,
      condicao_pagamento_erp: condicaoErp,
      criado_em: origem.criado_em,
      aprovado_em: origem.aprovado_em,
      observacao: origem.observacao ?? null,
      itens: origem.itens,
      desconto_total_cents: origem.desconto_total_cents,
      total_cents: origem.total_cents,
      tentativa: 1,
    },
  };
}

// ---------------------------------------------------------------- entrada na fila (idempotente pelo UUID)

export type DecisaoEntradaFila =
  | { acao: 'criar'; pedido: PedidoParaErp }
  | { acao: 'atualizar_payload'; pedido: PedidoParaErp }
  | { acao: 'remover_da_fila' }
  | { acao: 'reter'; codigo: 'mapeamento_ausente' | 'mapeamento_ambiguo' | 'sequencia_repetida'; mensagem: string }
  | { acao: 'ignorar'; motivo: 'status_nao_aprovado' | 'ja_na_fila' | 'alterado_apos_envio' | 'ja_enviado_ao_erp' | 'sem_dados_do_pedido' };

/**
 * RN-INT-08: só `aprovado` entra na fila e o UUID do pedido é a chave (o mesmo evento duas vezes não duplica). Editado e
 * reaprovado antes da 1ª entrega: substitui o conteúdo. Depois de entregue, o ERP já tem o pedido: edição vira só aviso, e
 * cancelamento/devolução no Macuxi não chega ao ERP (quem avisa é o retorno `cancelado` do ERP).
 */
export function decidirEntradaNaFila(e: { existente: PedidoNaFila | null; statusPedido: string; snapshot: PedidoAprovadoParaFila | null; mapeamentos: readonly Mapeamento[] }): DecisaoEntradaFila {
  const { existente } = e;
  const vivo = existente !== null && existente.removido_em === null ? existente : null;
  const naoEntregue = vivo !== null && vivo.estado === 'pendente' && vivo.tentativas === 0;

  if (!podeEntrarNaFila(e.statusPedido)) {
    if (vivo === null) return { acao: 'ignorar', motivo: 'status_nao_aprovado' };
    return naoEntregue ? { acao: 'remover_da_fila' } : { acao: 'ignorar', motivo: 'ja_enviado_ao_erp' };
  }
  if (e.snapshot === null) return { acao: 'ignorar', motivo: 'sem_dados_do_pedido' };
  const m = montarPedidoParaErp(e.snapshot, e.mapeamentos);
  if (!m.ok) return { acao: 'reter', codigo: m.codigo, mensagem: m.mensagem };
  if (vivo === null) return { acao: 'criar', pedido: m.pedido };
  const igual = hashRegistro(vivo.payload, { ignorar: [] }) === hashRegistro(m.pedido, { ignorar: [] });
  if (igual) return { acao: 'ignorar', motivo: 'ja_na_fila' };
  return naoEntregue ? { acao: 'atualizar_payload', pedido: m.pedido } : { acao: 'ignorar', motivo: 'alterado_apos_envio' };
}

// ---------------------------------------------------------------- entrega ao Conector

export interface AtualizacaoEntrega {
  pedido_uuid: string;
  estado: 'enviado';
  enviado_em: string;
  tentativas: number;
}

export interface SelecaoPendentes {
  entregar: PedidoParaErp[];
  atualizacoes: AtualizacaoEntrega[];
  /** Entregues de novo por falta de confirmação no prazo. */
  reenviados: string[];
}

/** Pendentes (e `enviado` vencido) por ordem de aprovação, até o limite da consulta; cada entrega conta uma tentativa. */
export function selecionarPendentes(fila: readonly PedidoNaFila[], agora: string, opcoes: { limite?: number; timeoutMin?: number } = {}): SelecaoPendentes {
  const limite = opcoes.limite ?? PARAMETROS_PADRAO.pedidosPorConsulta;
  const candidatos = fila
    .filter((p) => p.removido_em === null && (p.estado === 'pendente' || p.estado === 'enviado'))
    .map((p) => ({ p, t: aplicarTimeoutEnvio({ estado: p.estado, enviado_em: p.enviado_em, tentativas: p.tentativas }, agora, { timeoutMin: opcoes.timeoutMin }) }))
    .filter((x) => x.t.estado === 'pendente')
    .sort((a, b) => Date.parse(a.p.payload.aprovado_em) - Date.parse(b.p.payload.aprovado_em) || (a.p.pedido_uuid < b.p.pedido_uuid ? -1 : a.p.pedido_uuid > b.p.pedido_uuid ? 1 : 0))
    .slice(0, limite);
  return {
    entregar: candidatos.map(({ p }) => ({ ...p.payload, tentativa: p.tentativas + 1 })),
    atualizacoes: candidatos.map(({ p }) => ({ pedido_uuid: p.pedido_uuid, estado: 'enviado' as const, enviado_em: agora, tentativas: p.tentativas + 1 })),
    reenviados: candidatos.filter(({ t }) => t.reenviado).map(({ p }) => p.pedido_uuid),
  };
}

// ---------------------------------------------------------------- retorno do ERP

export interface ErroRetorno {
  codigo: string;
  campo: string | null;
  mensagem: string;
}

export type CodigoFalhaRetorno = 'pedido_desconhecido' | 'pedido_nao_entregue' | 'transicao_invalida' | 'numero_erp_divergente' | 'itens_faturados_invalidos';

export interface AtualizacaoRetorno {
  estado: EstadoPedidoErp;
  numero_erp: string | null;
  motivo: string | null;
  notas_aplicadas: NotaChave[];
  itens_faturados_acumulados: Record<number, ItemFaturadoAcumulado>;
  /** Instante (do ERP) do último retorno aplicado. */
  ultimo_retorno_em: string;
}

export type ResultadoRetorno =
  | { ok: true; repetido: boolean; publicar: boolean; atualizacao: AtualizacaoRetorno; evento: PedidoRetornoErpEvento }
  | { ok: false; status: 422; codigo: CodigoFalhaRetorno; mensagem: string; erros: ErroRetorno[] };

const falha = (codigo: CodigoFalhaRetorno, mensagem: string, campo: string | null = null, erros?: ErroRetorno[]): ResultadoRetorno => ({
  ok: false,
  status: 422,
  codigo,
  mensagem,
  erros: erros ?? [{ codigo, campo, mensagem }],
});

function validarItensFaturados(item: PedidoNaFila, retorno: RetornoErp): ErroRetorno[] {
  const erros: ErroRetorno[] = [];
  (retorno.itens_faturados ?? []).forEach((f, i) => {
    const doPedido = item.payload.itens.find((x) => x.sequencia === f.sequencia);
    if (!doPedido) {
      erros.push({ codigo: 'sequencia_inexistente', campo: `itens_faturados[${i}].sequencia`, mensagem: `A sequência ${f.sequencia} não existe no pedido enviado ao ERP. Confira a consulta de itens da nota no Conector.` });
      return;
    }
    if (doPedido.produto_external_id.trim() !== f.produto_external_id.trim()) {
      erros.push({ codigo: 'produto_divergente', campo: `itens_faturados[${i}].produto_external_id`, mensagem: `O produto da sequência ${f.sequencia} não é o que foi enviado ao ERP. Confira o código do produto na consulta de itens da nota.` });
    }
    const saldo = doPedido.quantidade - (item.itens_faturados_acumulados[f.sequencia]?.quantidade ?? 0);
    if (f.quantidade > saldo) {
      erros.push({ codigo: 'quantidade_acima_do_saldo', campo: `itens_faturados[${i}].quantidade`, mensagem: `A sequência ${f.sequencia} tem saldo de ${saldo} para faturar e o retorno informa ${f.quantidade}. Confira a quantidade faturada na nota.` });
    }
  });
  return erros;
}

/**
 * RN-INT-08: aplica o retorno do ERP. Idempotente: o mesmo estado (e, no parcial, a mesma nota) devolve `repetido` sem publicar.
 * Confirmação que chega depois do timeout (o pedido voltou a `pendente` mas já tinha sido entregue) vale. O ERP não pode dar dois
 * números ao mesmo pedido. `itens_faturados` é conferido contra o pedido enviado (sequência, produto e saldo) e acumulado.
 */
export function aplicarRetornoPedido(item: PedidoNaFila | null, retorno: RetornoErp): ResultadoRetorno {
  if (item === null || item.removido_em !== null) {
    return falha('pedido_desconhecido', 'O Hub não conhece este pedido. Só pedidos aprovados e entregues ao Conector recebem retorno.');
  }
  let de: EstadoPedidoErp = item.estado;
  if (de === 'pendente') {
    if (item.tentativas === 0) return falha('pedido_nao_entregue', 'Este pedido ainda não foi entregue ao Conector (GET /pedidos/pendentes). Busque os pedidos pendentes antes de enviar o retorno.');
    de = 'enviado'; // voltou a pendente por timeout, mas o Conector já o tinha
  }
  if (retorno.numero_erp && item.numero_erp && retorno.numero_erp.trim() !== item.numero_erp.trim()) {
    return falha('numero_erp_divergente', `O pedido já tem o número ${item.numero_erp} no ERP e o retorno informa outro. Confira no ERP se o pedido foi gravado duas vezes.`, 'numero_erp');
  }
  const nota: NotaChave | null = retorno.nota ? { numero: retorno.nota.numero, serie: retorno.nota.serie ?? null } : null;
  const tr = transicionarRetornoPedidoErp(de, { status: retorno.status, nota }, item.notas_aplicadas);
  if (!tr.ok) return falha('transicao_invalida', tr.mensagem, 'status');

  let acumulado = item.itens_faturados_acumulados;
  let notas = item.notas_aplicadas;
  if (!tr.repetida) {
    if (retorno.itens_faturados) {
      const erros = validarItensFaturados(item, retorno);
      if (erros.length > 0) return falha('itens_faturados_invalidos', 'Os itens faturados do retorno não batem com o pedido enviado ao ERP. Corrija a consulta de itens da nota no Conector.', 'itens_faturados', erros);
      acumulado = { ...acumulado };
      for (const f of retorno.itens_faturados) {
        const antes = acumulado[f.sequencia];
        acumulado[f.sequencia] = { quantidade: (antes?.quantidade ?? 0) + f.quantidade, valor_cents: (antes?.valor_cents ?? 0) + f.valor_cents };
      }
    }
    if (nota && !notas.some((n) => chaveNotaRetorno(n) === chaveNotaRetorno(nota))) {
      notas = [...notas, { numero: nota.numero.trim(), serie: nota.serie?.trim() || null }];
    }
  }
  const numeroErp = retorno.numero_erp?.trim() || item.numero_erp;
  const motivo = retorno.motivo?.trim() || item.motivo;
  return {
    ok: true,
    repetido: tr.repetida,
    publicar: !tr.repetida,
    atualizacao: { estado: tr.estado, numero_erp: numeroErp, motivo, notas_aplicadas: notas, itens_faturados_acumulados: acumulado, ultimo_retorno_em: retorno.ocorrido_em },
    evento: {
      pedido_uuid: item.pedido_uuid,
      status: retorno.status,
      numero_erp: numeroErp,
      motivo: retorno.motivo ?? null,
      nota: retorno.nota ?? null,
      itens_faturados: retorno.itens_faturados ?? null,
      ocorrido_em: retorno.ocorrido_em,
    },
  };
}
