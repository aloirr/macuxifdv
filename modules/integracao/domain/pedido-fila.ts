/**
 * Fila de pedidos para o ERP e retorno do ERP (RN-INT-08; decisão do Alexandre sobre cancelamento: o Macuxi nunca escreve
 * cancelamento no ERP, só recebe `cancelado` pelo retorno). Tudo puro: a API grava/lê `pedido_fila_erp` e publica o evento.
 *
 *  Vendedor aprova ─► montarPedidoParaErp (de-para) ─► decidirEntradaNaFila ─► pendente
 *  Conector consulta ─► selecionarPendentes ─► enviado (reentrega após [10 min] sem confirmação)
 *  Conector retorna ─► aplicarRetornoPedido ─► integrado | rejeitado_erp | faturado_parcial/total | cancelado (+ evento)
 */
import {
  CODIGOS_ITEM_DESCARTADO,
  type EstadoPedidoErp,
  type ItemFaturado,
  type Mapeamento as MapeamentoContrato,
  PedidoAprovadoParaFila as PedidoAprovadoParaFilaSchema,
  type PedidoAprovadoParaFila,
  type PedidoParaErp,
  type PedidoRetornoErpEvento,
  type RetornoErp,
  VERSAO_CONTRATO,
} from '../contracts';
// T-0024: o tipo vem do dono do evento (só tipo: o domain não carrega o contracts do Vendedor em tempo de execução)
import type { PedidoAprovadoEvento as PedidoAprovadoConsumido } from '../../vendedor/contracts';
import { aplicarTimeoutEnvio, chaveNotaRetorno, podeEntrarNaFila, transicionarRetornoPedidoErp, type NotaChave } from './estados';
import { hashRegistro } from './idempotencia';
import { PARAMETROS_PADRAO } from './parametros';
import { conectorAtendePedido, exigeConector } from './pedido-versao';

export type Mapeamento = Pick<MapeamentoContrato, 'tipo' | 'codigo_erp' | 'codigo_macuxi' | 'ativo'>;

export interface ItemFaturadoAcumulado {
  quantidade: number;
  valor_cents: number;
}

/** Motivo de o pedido estar RETIDO na fila (sem payload, não sai no GET /pedidos/pendentes). Igual a `pedido_fila_erp.retencao_codigo`. */
export type CodigoRetencao = 'mapeamento_ausente' | 'mapeamento_ambiguo' | 'sequencia_repetida';

export interface PedidoNaFila {
  pedido_uuid: string;
  estado: EstadoPedidoErp;
  /** `null` enquanto RETIDO por de-para (T-0025 🟡 4: o banco grava payload nulo + `retencao_codigo`). */
  payload: PedidoParaErp | null;
  /** Retido por que (nulo = na fila normal). Retido nunca é entregue ao Conector. */
  retencao_codigo?: CodigoRetencao | null;
  /** Mensagem gravada com a retenção (`undefined` = não lida; aí só o código compara). */
  retencao_mensagem?: string | null;
  enviado_em: string | null;
  /** Quantas vezes foi entregue ao Conector. */
  tentativas: number;
  numero_erp: string | null;
  motivo: string | null;
  /** Notas fiscais já aplicadas (número + série): a 2ª nota parcial é fato novo, a mesma nota repetida não (RN-INT-08). */
  notas_aplicadas: NotaChave[];
  /** Por `sequencia` do pedido enviado: o que já foi faturado nos retornos aceitos. */
  itens_faturados_acumulados: Record<number, ItemFaturadoAcumulado>;
  /** Retirado da fila antes de ser entregue (cancelado/devolvido à aprovação no Macuxi) = `deleted_at` da linha. */
  removido_em: string | null;
}

// ---------------------------------------------------------------- montagem (de-para)

export type ResultadoMontagem =
  | { ok: true; pedido: PedidoParaErp }
  | { ok: false; codigo: CodigoRetencao; mensagem: string };

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
  // T-0089 (desenho §4.3): 1) a chave do prazo no ERP; 2) o de-para pelo código; 3) retido
  const prazoErp = origem.pagamento?.prazo_external_id?.trim();
  const codigo = origem.condicao_pagamento_codigo?.trim();
  if (prazoErp) {
    condicaoErp = prazoErp;
  } else if (codigo) {
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
      // ADR 0016: só entram no payload quando o Vendedor os enviou (pedido antigo segue idêntico, e o hash também)
      ...(origem.desconto_pct != null ? { desconto_pct: origem.desconto_pct } : {}),
      ...(origem.acrescimo_pct != null ? { acrescimo_pct: origem.acrescimo_pct } : {}),
      ...(origem.acrescimo_total_cents != null ? { acrescimo_total_cents: origem.acrescimo_total_cents } : {}),
      ...(origem.frete != null ? { frete: origem.frete } : {}),
      ...(origem.endereco_entrega != null ? { endereco_entrega: origem.endereco_entrega } : {}),
      // T-0089: forma, prazo e prazo médio só no pedido novo (o antigo segue com o mesmo payload e hash)
      ...(origem.pagamento != null ? { pagamento: origem.pagamento } : {}),
      // T-0149 (RN-CORE-39): filial do pedido só no pedido novo (o antigo segue com o mesmo payload e hash)
      ...(origem.filial != null ? { filial: origem.filial } : {}),
    },
  };
}

// ---------------------------------------------------------------- snapshot do evento (chaves do ERP)

/**
 * Início fixo das DUAS recusas de `montarSnapshotParaFila` (chave do ERP ausente; dados fora do contrato): são problema de CADASTRO, não de
 * de-para. O monitor separa esse motivo do Mapeamento sem coluna nova (ver `ehRetencaoPorCadastro`).
 */
export const PREFIXO_RETENCAO_CADASTRO = 'Pedido retido por cadastro';

/** `true` quando a mensagem de retenção é de cadastro (chave do ERP ausente ou dado fora do contrato); o código gravado é `mapeamento_ausente` (um código próprio depende de migração do banco). */
export const ehRetencaoPorCadastro = (mensagem: string | null | undefined): boolean => typeof mensagem === 'string' && mensagem.startsWith(PREFIXO_RETENCAO_CADASTRO);

export type ResultadoSnapshotFila = { ok: true; snapshot: PedidoAprovadoParaFila } | { ok: false; mensagem: string };

const vazia = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';
const MAX_SEQUENCIAS_NA_MENSAGEM = 10;
const MAX_CAMPOS_NA_MENSAGEM = 6;

const listarComE = (xs: readonly (string | number)[]): string => (xs.length <= 1 ? String(xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`);

/**
 * `vendedor.pedido.aprovado@1` → pedido pronto para a fila (contrato do ERP). O evento traz as chaves do ERP anuláveis: cliente,
 * vendedor ou produto sem `external_id` NÃO derruba o consumo (a outbox repetiria e desistiria; o pedido sumiria): devolve `ok: false`
 * com a mensagem que diz O QUE falta e o que fazer, para o pedido ficar RETIDO e visível no monitor. A mensagem leva só códigos e
 * sequências dos itens — nunca nome, documento nem valor do cadastro.
 */
export function montarSnapshotParaFila(p: PedidoAprovadoConsumido): ResultadoSnapshotFila {
  const faltando: string[] = [];
  if (vazia(p.cliente_external_id)) faltando.push('o cliente não tem código do ERP (external_id)');
  if (vazia(p.vendedor_external_id)) faltando.push('o vendedor não tem código do ERP (external_id)');
  const semProduto = p.itens.filter((i) => vazia(i.produto_external_id)).map((i) => i.sequencia);
  if (semProduto.length > 0) {
    const mostrar = semProduto.slice(0, MAX_SEQUENCIAS_NA_MENSAGEM);
    const resto = semProduto.length - mostrar.length;
    faltando.push(
      `${semProduto.length > 1 ? 'os produtos das sequências' : 'o produto da sequência'} ${listarComE(mostrar)}${resto > 0 ? ` e mais ${resto}` : ''} ${semProduto.length > 1 ? 'não têm' : 'não tem'} código do ERP (external_id)`,
    );
  }
  if (faltando.length > 0) {
    return {
      ok: false,
      mensagem: `${PREFIXO_RETENCAO_CADASTRO}: faltam as chaves do ERP: ${faltando.join('; ')}. Complete o cadastro (o código do ERP normalmente chega pela carga do ERP em Integração ERP > Lotes), cancele este pedido e refaça-o (duplique) depois; o pedido retido não segue sozinho.`,
    };
  }
  const r = PedidoAprovadoParaFilaSchema.safeParse({
    ...p,
    observacao: p.observacao === null || p.observacao.trim() === '' ? null : p.observacao.slice(0, 500),
    condicao_pagamento_codigo: p.condicao_pagamento_codigo === null || p.condicao_pagamento_codigo.trim() === '' ? null : p.condicao_pagamento_codigo,
  });
  if (r.success) return { ok: true, snapshot: r.data };
  // fora do contrato por outro motivo (ex.: external_id grande demais): cita os campos, nunca os valores
  const campos = [...new Set(r.error.issues.map((i) => i.path.map(String).join('.') || 'pedido'))];
  const mostrar = campos.slice(0, MAX_CAMPOS_NA_MENSAGEM);
  return {
    ok: false,
    mensagem: `${PREFIXO_RETENCAO_CADASTRO}: os dados não cabem no contrato do ERP (campo${campos.length > 1 ? 's' : ''}: ${mostrar.join(', ')}${campos.length > mostrar.length ? ` e mais ${campos.length - mostrar.length}` : ''}). Corrija o cadastro, cancele este pedido e refaça-o (duplique) depois; o pedido retido não segue sozinho.`,
  };
}

// ---------------------------------------------------------------- entrada na fila (idempotente pelo UUID)

export type DecisaoEntradaFila =
  /** Não há linha para o pedido: INSERT. */
  | { acao: 'criar'; pedido: PedidoParaErp }
  /** T-0025 🟡 4: a linha existe mas foi removida (`deleted_at`): UPDATE que limpa `deleted_at`/`removido_em`, volta a `pendente` com `tentativas = 0` e grava o payload. Nunca INSERT (o único total por pedido impede). */
  | { acao: 'reativar'; pedido: PedidoParaErp }
  | { acao: 'atualizar_payload'; pedido: PedidoParaErp }
  | { acao: 'remover_da_fila' }
  /**
   * Sem de-para: grava payload nulo + `retencao_codigo`. `persistencia`: `inserir` se não há linha; `atualizar` se há (viva ainda
   * não entregue — o payload velho deixa de sair no GET — ou removida: UPDATE que limpa `deleted_at`).
   */
  | { acao: 'reter'; codigo: CodigoRetencao; mensagem: string; persistencia: 'inserir' | 'atualizar' }
  | { acao: 'ignorar'; motivo: 'status_nao_aprovado' | 'ja_na_fila' | 'alterado_apos_envio' | 'ja_enviado_ao_erp' | 'sem_dados_do_pedido' };

/**
 * RN-INT-08: só `aprovado` entra na fila e o UUID do pedido é a chave (o mesmo evento duas vezes não duplica). Editado e
 * reaprovado antes da 1ª entrega: substitui o conteúdo. Depois de entregue, o ERP já tem o pedido: edição vira só aviso, e
 * cancelamento/devolução no Macuxi não chega ao ERP (quem avisa é o retorno `cancelado` do ERP).
 */
export function decidirEntradaNaFila(e: {
  existente: PedidoNaFila | null;
  statusPedido: string;
  snapshot: PedidoAprovadoParaFila | null;
  /** `montarSnapshotParaFila` recusou o evento (chave do ERP ausente etc.): o pedido é RETIDO com esta mensagem, não perdido. */
  invalido?: { mensagem: string } | null;
  mapeamentos: readonly Mapeamento[];
}): DecisaoEntradaFila {
  const { existente } = e;
  const vivo = existente !== null && existente.removido_em === null ? existente : null;
  const naoEntregue = vivo !== null && vivo.estado === 'pendente' && vivo.tentativas === 0;

  if (!podeEntrarNaFila(e.statusPedido)) {
    if (vivo === null) return { acao: 'ignorar', motivo: 'status_nao_aprovado' };
    return naoEntregue ? { acao: 'remover_da_fila' } : { acao: 'ignorar', motivo: 'ja_enviado_ao_erp' };
  }
  const reter = (codigo: CodigoRetencao, mensagem: string): DecisaoEntradaFila => {
    if (vivo !== null && !naoEntregue) return { acao: 'ignorar', motivo: 'alterado_apos_envio' };
    // o mesmo motivo (e a mesma mensagem, quando já lida) não regrava: o evento repetido é no-op
    if (vivo !== null && vivo.retencao_codigo === codigo && (vivo.retencao_mensagem === undefined || vivo.retencao_mensagem === mensagem)) return { acao: 'ignorar', motivo: 'ja_na_fila' };
    return { acao: 'reter', codigo, mensagem, persistencia: existente === null ? 'inserir' : 'atualizar' };
  };
  if (e.snapshot === null) {
    // sem chaves do ERP o banco só aceita um dos 3 códigos de retenção: `mapeamento_ausente` com mensagem própria (T-0032)
    return e.invalido ? reter('mapeamento_ausente', e.invalido.mensagem) : { acao: 'ignorar', motivo: 'sem_dados_do_pedido' };
  }
  const m = montarPedidoParaErp(e.snapshot, e.mapeamentos);
  if (!m.ok) return reter(m.codigo, m.mensagem);
  if (existente !== null && vivo === null) return { acao: 'reativar', pedido: m.pedido };
  if (vivo === null) return { acao: 'criar', pedido: m.pedido };
  const igual = vivo.payload !== null && (vivo.retencao_codigo ?? null) === null && hashRegistro(vivo.payload, { ignorar: [] }) === hashRegistro(m.pedido, { ignorar: [] });
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
export function selecionarPendentes(fila: readonly PedidoNaFila[], agora: string, opcoes: { limite?: number; timeoutMin?: number; versaoConector?: string | null } = {}): SelecaoPendentes {
  const limite = opcoes.limite ?? PARAMETROS_PADRAO.pedidosPorConsulta;
  const candidatos = fila
    .filter((p): p is PedidoNaFila & { payload: PedidoParaErp } => p.removido_em === null && p.payload !== null && (p.retencao_codigo ?? null) === null && (p.estado === 'pendente' || p.estado === 'enviado'))
    // ADR 0016: pedido com recurso novo só sai para Conector que o entende (os outros seguem; sem `versaoConector` não filtra)
    .filter((p) => opcoes.versaoConector === undefined || conectorAtendePedido(opcoes.versaoConector, exigeConector(p.payload)))
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

export type CodigoFalhaRetorno = 'pedido_desconhecido' | 'pedido_nao_entregue' | 'transicao_invalida' | 'numero_erp_divergente';

export type CodigoItemDescartado = (typeof CODIGOS_ITEM_DESCARTADO)[number];

/**
 * P-4 (T-0031): item de `itens_faturados` que não bate com o pedido enviado ao ERP. O retorno é ACEITO sem ele; cada item
 * descartado vira um erro registrado para o monitor (motivo + `external_id` do produto) e volta ao Conector em `RetornoAceito`.
 */
export interface ItemFaturadoDescartado {
  /** Posição do item no `itens_faturados` do retorno. */
  indice: number;
  sequencia: number;
  /** `external_id` do produto como o ERP informou (chave do ERP, nunca dado pessoal). */
  produto_external_id: string;
  quantidade: number;
  /** O primeiro problema do item (ordem: sequência → produto → saldo). */
  codigo: CodigoItemDescartado;
  /** Todos os problemas do item. */
  codigos: CodigoItemDescartado[];
  campo: string;
  /** Texto em português com a causa e a ação seguinte (todas as causas do item). */
  motivo: string;
}

/** Linha do erro para o monitor (tabela `integracao.pedido_retorno_erro`, pedido ao banco-dados). */
export interface ErroRetornoMonitor extends ItemFaturadoDescartado {
  pedido_uuid: string;
  status: RetornoErp['status'];
  numero_erp: string | null;
  nota_numero: string | null;
  nota_serie: string | null;
  ocorrido_em: string;
}

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
  | {
      ok: true;
      repetido: boolean;
      publicar: boolean;
      atualizacao: AtualizacaoRetorno;
      evento: PedidoRetornoErpEvento;
      /** P-4: itens do retorno que ficaram de fora (vazio quando todos valem). Vai em `RetornoAceito.itens_descartados`. */
      itens_descartados: ItemFaturadoDescartado[];
      /** P-4: um erro por item descartado, para gravar e mostrar no monitor (alerta `retorno_com_itens_descartados`). */
      erros_monitor: ErroRetornoMonitor[];
    }
  | { ok: false; status: 422; codigo: CodigoFalhaRetorno; mensagem: string; erros: ErroRetorno[] };

const falha = (codigo: CodigoFalhaRetorno, mensagem: string, campo: string | null = null, erros?: ErroRetorno[]): ResultadoRetorno => ({
  ok: false,
  status: 422,
  codigo,
  mensagem,
  erros: erros ?? [{ codigo, campo, mensagem }],
});

/**
 * Separa os itens faturados válidos dos que não batem com o pedido enviado (sequência existe, produto é o enviado naquela
 * sequência, acumulado ≤ quantidade enviada). Os válidos seguem; os outros são descartados com o motivo (P-4).
 */
function separarItensFaturados(item: PedidoNaFila, retorno: RetornoErp): { validos: ItemFaturado[]; descartados: ItemFaturadoDescartado[] } {
  const validos: ItemFaturado[] = [];
  const descartados: ItemFaturadoDescartado[] = [];
  const itensDoPedido = item.payload?.itens ?? [];
  const vezes = new Map<number, number>();
  for (const f of retorno.itens_faturados ?? []) vezes.set(f.sequencia, (vezes.get(f.sequencia) ?? 0) + 1);
  (retorno.itens_faturados ?? []).forEach((f, i) => {
    const problemas: { codigo: CodigoItemDescartado; campo: string; mensagem: string }[] = [];
    const doPedido = itensDoPedido.find((x) => x.sequencia === f.sequencia);
    if ((vezes.get(f.sequencia) ?? 0) > 1) {
      // P-4 (decisão do gerente): sequência repetida no retorno — TODAS as linhas da sequência são descartadas (não dá para saber qual vale)
      problemas.push({ codigo: 'sequencia_repetida', campo: `itens_faturados[${i}].sequencia`, mensagem: `A sequência ${f.sequencia} aparece mais de uma vez no retorno e não dá para saber qual linha vale; as ${vezes.get(f.sequencia)} linhas foram descartadas. Informe cada sequência uma vez só (some as quantidades) na consulta de itens da nota do Conector.` });
    } else if (!doPedido) {
      problemas.push({ codigo: 'sequencia_inexistente', campo: `itens_faturados[${i}].sequencia`, mensagem: `A sequência ${f.sequencia} não existe no pedido enviado ao ERP. Confira a consulta de itens da nota no Conector.` });
    } else {
      if (doPedido.produto_external_id.trim() !== f.produto_external_id.trim()) {
        problemas.push({ codigo: 'produto_divergente', campo: `itens_faturados[${i}].produto_external_id`, mensagem: `O produto "${f.produto_external_id.trim()}" da sequência ${f.sequencia} não é o que foi enviado ao ERP ("${doPedido.produto_external_id.trim()}"). Confira o código do produto na consulta de itens da nota.` });
      }
      const saldo = doPedido.quantidade - (item.itens_faturados_acumulados[f.sequencia]?.quantidade ?? 0);
      if (f.quantidade > saldo) {
        problemas.push({ codigo: 'quantidade_acima_do_saldo', campo: `itens_faturados[${i}].quantidade`, mensagem: `A sequência ${f.sequencia} tem saldo de ${saldo} para faturar e o retorno informa ${f.quantidade}. Confira a quantidade faturada na nota.` });
      }
    }
    const [primeiro] = problemas;
    if (!primeiro) {
      validos.push(f);
      return;
    }
    descartados.push({
      indice: i,
      sequencia: f.sequencia,
      produto_external_id: f.produto_external_id.trim(),
      quantidade: f.quantidade,
      codigo: primeiro.codigo,
      codigos: problemas.map((p) => p.codigo),
      campo: primeiro.campo,
      motivo: problemas.map((p) => p.mensagem).join(' '),
    });
  });
  return { validos, descartados };
}

/**
 * RN-INT-08: aplica o retorno do ERP. Idempotente: o mesmo estado (e, no parcial, a mesma nota) devolve `repetido` sem publicar.
 * Confirmação que chega depois do timeout (o pedido voltou a `pendente` mas já tinha sido entregue) vale. O ERP não pode dar dois
 * números ao mesmo pedido. `itens_faturados` é conferido contra o pedido enviado (sequência, produto e saldo) e acumulado.
 * P-4 (T-0031): item faturado inválido NÃO recusa o retorno — o status vale, o item é descartado (não acumula, não vai no evento)
 * e vira erro para o monitor. Mesmo com todos os itens inválidos o status é aplicado (o evento sai com `itens_faturados: null`).
 */
export function aplicarRetornoPedido(item: PedidoNaFila | null, retorno: RetornoErp): ResultadoRetorno {
  if (item === null || item.removido_em !== null) {
    return falha('pedido_desconhecido', 'O Hub não conhece este pedido. Só pedidos aprovados e entregues ao Conector recebem retorno.');
  }
  // T-0114: `cancelamento_recusado` não é estado do pedido (a rota usa `aplicarCancelamentoRecusado`); nunca chega aqui pela rota
  if (retorno.status === 'cancelamento_recusado') return falha('transicao_invalida', 'cancelamento_recusado não muda o estado do pedido; use o fluxo da recusa de cancelamento.', 'status');
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
  let validos: ItemFaturado[] | null = null;
  let descartados: ItemFaturadoDescartado[] = [];
  if (!tr.repetida) {
    // T-0023 🔴: a idempotência dos itens é por NOTA, seja qual for o status. Nota já aplicada não soma (nem revalida) os itens de
    // novo — ex.: o ERP fecha o pedido sem nota nova e a nota parcial volta como faturado_total com os mesmos itens.
    const notaJaAplicada = nota !== null && notas.some((n) => chaveNotaRetorno(n) === chaveNotaRetorno(nota));
    if (retorno.itens_faturados && !notaJaAplicada) {
      ({ validos, descartados } = separarItensFaturados(item, retorno));
      acumulado = { ...acumulado };
      for (const f of validos) {
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
      // repetido: o evento não é publicado; ecoa o que veio. Aplicado: só os itens válidos (P-4); nenhum válido ⇒ null.
      itens_faturados: tr.repetida ? (retorno.itens_faturados ?? null) : validos && validos.length > 0 ? validos : null,
      ocorrido_em: retorno.ocorrido_em,
    },
    itens_descartados: descartados,
    erros_monitor: descartados.map((d) => ({
      ...d,
      pedido_uuid: item.pedido_uuid,
      status: retorno.status,
      numero_erp: numeroErp,
      nota_numero: retorno.nota?.numero.trim() ?? null,
      nota_serie: retorno.nota?.serie?.trim() || null,
      ocorrido_em: retorno.ocorrido_em,
    })),
  };
}
