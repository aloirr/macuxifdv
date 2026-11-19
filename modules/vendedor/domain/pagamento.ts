/**
 * Forma de pagamento e prazo do pedido (T-0089; RN-VEN-24 e RN-VEN-25), título vencido (RN-VEN-13) e crédito do cliente
 * (RN-VEN-12). Funções puras: o app e a API usam as mesmas, e a API sempre revalida.
 */

export interface FormaDePagamento {
  id: string;
  codigo: string;
  nome: string;
  ativo: boolean;
  ordem: number;
}

export interface PrazoDePagamento {
  id: string;
  forma_pagamento_id: string;
  codigo: string;
  descricao: string;
  /** dias de cada parcela, sem decrescer; `[0]` = à vista */
  parcelas_dias: readonly number[];
  prazo_medio_dias: number;
  /** RN-VEN-43: "Desc./Acrésc. (%)" do prazo, vindo do ERP (-99,99 a +99,99); ausente = 0 */
  percentual_ajuste?: number;
  ordem: number;
  ativo: boolean;
}

/** O que o cadastro do cliente (Core) limita (RN-VEN-25). Nulo = sem restrição (premissa P1). */
export interface LimitePagamentoDoCliente {
  formas_pagamento: readonly string[] | null | undefined;
}

/** RN-VEN-24: média das parcelas, arredondada PARA CIMA (28/56 = 42; 30/45 = 38; premissa P2). Lista vazia é erro de programação. */
export function prazoMedioDias(parcelas: readonly number[]): number {
  if (parcelas.length === 0) throw new Error('RN-VEN-24: o prazo precisa de ao menos uma parcela.');
  const soma = parcelas.reduce((a, b) => a + b, 0);
  return Math.ceil(soma / parcelas.length);
}

/** RN-VEN-24: o texto da lista mostra só o prazo ("28/56 dias"), nunca o prazo médio; `[0]` = "À vista". */
export function descricaoPrazo(parcelas: readonly number[]): string {
  if (parcelas.length === 1 && parcelas[0] === 0) return 'À vista';
  return `${parcelas.join('/')} dias`;
}

function porOrdem<T extends { ordem: number; codigo: string }>(a: T, b: T): number {
  return a.ordem - b.ordem || a.codigo.localeCompare(b.codigo);
}

/** RN-VEN-25: as formas ativas que o cliente aceita, por ordem. Lista do cliente nula ou vazia = todas as ativas; código sem forma é ignorado. */
export function formasDoCliente(formas: readonly FormaDePagamento[], codigosDoCliente: readonly string[] | null | undefined): FormaDePagamento[] {
  const todas = formas.filter((f) => f.ativo).sort(porOrdem);
  if (!codigosDoCliente || codigosDoCliente.length === 0) return todas;
  const permitidos = new Set(codigosDoCliente);
  return todas.filter((f) => permitidos.has(f.codigo));
}

/** RN-VEN-24/25: os prazos ativos da forma, por ordem (o prazo médio do cliente não limita; R-20261118-2250). */
export function prazosDaForma(prazos: readonly PrazoDePagamento[], formaId: string): PrazoDePagamento[] {
  return prazos.filter((p) => p.ativo && p.forma_pagamento_id === formaId).sort(porOrdem);
}

/** RN-VEN-24: a primeira forma permitida que tenha prazo ativo, com o primeiro prazo dela; ou `null`. */
export function pagamentoPadrao(
  formasPermitidas: readonly FormaDePagamento[],
  prazos: readonly PrazoDePagamento[],
): { forma: FormaDePagamento; prazo: PrazoDePagamento } | null {
  for (const forma of formasPermitidas) {
    const prazo = prazosDaForma(prazos, forma.id)[0];
    if (prazo) return { forma, prazo };
  }
  return null;
}

export type CodigoRecusaPagamento = 'RN-VEN-24' | 'RN-VEN-25';
/** `motivo` (RD-0037): código estável da recusa; a tela decide a pendência por ele, nunca pela mensagem. */
export type MotivoRecusaPagamento = 'forma_indisponivel' | 'prazo_indisponivel' | 'forma_nao_aceita';
export type ResultadoPagamento = { ok: true } | { ok: false; codigo: CodigoRecusaPagamento; motivo: MotivoRecusaPagamento; mensagem: string };

/** RN-VEN-24 (forma/prazo existem, ativos, prazo da forma) e RN-VEN-25 (forma aceita pelo cliente). */
export function validarPagamento(i: {
  forma: FormaDePagamento | undefined | null;
  prazo: PrazoDePagamento | undefined | null;
  cliente: LimitePagamentoDoCliente;
}): ResultadoPagamento {
  const { forma, prazo, cliente } = i;
  if (!forma || !forma.ativo) return { ok: false, codigo: 'RN-VEN-24', motivo: 'forma_indisponivel', mensagem: 'Forma de pagamento indisponível. Escolha outra forma na lista.' };
  if (!prazo || !prazo.ativo || prazo.forma_pagamento_id !== forma.id) {
    return { ok: false, codigo: 'RN-VEN-24', motivo: 'prazo_indisponivel', mensagem: 'Prazo indisponível para esta forma. Escolha outro prazo na lista.' };
  }
  const lista = cliente.formas_pagamento;
  if (lista && lista.length > 0 && !lista.includes(forma.codigo)) {
    return { ok: false, codigo: 'RN-VEN-25', motivo: 'forma_nao_aceita', mensagem: 'Este cliente não aceita esta forma de pagamento. Escolha outra forma.' };
  }
  return { ok: true };
}

export const MSG_PERCENTUAL_DO_PRAZO_MUDOU = 'Este prazo de pagamento mudou. Atualize o app e refaça o pedido.';

/**
 * RN-VEN-45: o percentual do pedido é congelado e revalidado no envio. `push` = o do aparelho (ausente = 0); `vigente` = o do
 * cadastro agora. Igual: aceita. Diferente e o cadastro do prazo mudou DEPOIS do `criado_em` do pedido: aceita o do push
 * (`mudou_depois`); o chamador registra o aviso na linha do tempo, fora da alçada. Diferente sem mudança posterior: recusa (RN-VEN-40). Devolve o percentual a usar no cálculo.
 */
export type ResultadoPercentualDoPrazo = { ok: true; percentual: number; mudou_depois: boolean } | { ok: false; codigo: 'RN-VEN-45'; mensagem: string };
export function revalidarPercentualDoPrazo(i: { push: number | null | undefined; vigente: number | null | undefined; cadastro_atualizado_em: string | null | undefined; criado_em: string }): ResultadoPercentualDoPrazo {
  const push = i.push ?? 0;
  const vigente = i.vigente ?? 0;
  if (Math.round(push * 100) === Math.round(vigente * 100)) return { ok: true, percentual: push, mudou_depois: false };
  const mudouDepois = !!i.cadastro_atualizado_em && Date.parse(i.cadastro_atualizado_em) > Date.parse(i.criado_em);
  if (mudouDepois) return { ok: true, percentual: push, mudou_depois: true };
  return { ok: false, codigo: 'RN-VEN-45', mensagem: MSG_PERCENTUAL_DO_PRAZO_MUDOU };
}

export const MOTIVO_FORMA_NAO_ACEITA = 'Este cliente não aceita esta forma';

/**
 * RN-VEN-25 (T-0129): todas as formas ativas, por ordem; a que o cadastro do cliente não aceita vem desabilitada, com o motivo
 * (nunca some nem é trocada em silêncio). Lista do cliente nula ou vazia = todas habilitadas.
 */
export function formasDaLista(formas: readonly FormaDePagamento[], codigosDoCliente: readonly string[] | null | undefined): { forma: FormaDePagamento; habilitada: boolean; motivo?: string }[] {
  const permitidos = codigosDoCliente && codigosDoCliente.length > 0 ? new Set(codigosDoCliente) : null;
  return formas
    .filter((f) => f.ativo)
    .sort(porOrdem)
    .map((forma) => (permitidos && !permitidos.has(forma.codigo) ? { forma, habilitada: false, motivo: MOTIVO_FORMA_NAO_ACEITA } : { forma, habilitada: true }));
}

/** Parâmetro `titulo_vencido_dias` do Vendedor (padrão 5; nenhum parâmetro do Vendedor é semeado por migração). */
export const TITULO_VENCIDO_DIAS_PADRAO = 5;

/** `titulo_vencido_dias` do tenant (inteiro 0..365; ausente ou inválido = 5). */
export function tituloVencidoDias(parametros: Readonly<Record<string, unknown>>): number {
  const bruto = parametros['titulo_vencido_dias'];
  const n = typeof bruto === 'number' ? bruto : typeof bruto === 'string' && bruto.trim() !== '' ? Number(bruto) : NaN;
  return Number.isInteger(n) && n >= 0 && n <= 365 ? n : TITULO_VENCIDO_DIAS_PADRAO;
}

/** Retrato do pagamento no evento `vendedor.pedido.aprovado@1` (T-0089). */
export interface PagamentoEvento {
  forma_codigo: string;
  forma_external_id?: string | null;
  prazo_codigo: string;
  prazo_external_id?: string | null;
  parcelas_dias: number[];
  prazo_medio_dias: number;
}
