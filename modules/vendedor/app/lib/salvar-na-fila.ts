/**
 * Salvar pela fila (T-0130, Frente G; RN-VEN-30 acréscimo de 08/11, RF-VEN-04, RN-CORE-23 item 2, RN-VEN-33).
 * Funções puras, sem React: o que a tela mostra para o pedido `na_fila` e a recusa da API com o motivo em português.
 * (T-0141: o rascunho de "Apenas salvar" saiu da lista Pedidos; mora na tela Rascunhos, `rascunhos-lista.ts`.)
 * Spec: docs/design/formulario-pendencias.md §4.
 */
import { mensagemAcimaDoMaximo } from '../../domain/preco-pedido';

export const AVISO_SALVO_ENVIANDO = 'Pedido salvo · enviando';
export const AVISO_SALVO_SEM_SINAL = 'Pedido salvo · vai quando houver sinal';
export const ROTULO_CORRIGIR_PEDIDO = 'Corrigir pedido';

/**
 * RD-0038/RD-0057 (T-0151): a única montagem do texto da recusa (faixa do detalhe, linha da lista): só o problema, sem "Não foi aceito:"
 * (o selo "Não aceito" já diz) e sem a ordem "Corrija e salve de novo" (o botão "Corrigir pedido" é a ação). Ex.: "AGU-1500 acima do desconto máximo".
 */
export function textoDaRecusa(motivo: string): string {
  return motivo.charAt(0).toLocaleUpperCase('pt-BR') + motivo.slice(1);
}

/** Texto do aviso do rodapé depois do toque em "Salvar e enviar pedido" (sem ponto final, guia de UX). */
export function avisoDoSalvar(offline: boolean): string {
  return offline ? AVISO_SALVO_SEM_SINAL : AVISO_SALVO_ENVIANDO;
}

/** Códigos que a API devolve na recusa, traduzidos; o código cru nunca aparece na tela (spec §4.3). */
export function motivoDaRecusa(bruto: string): string {
  const t = (bruto ?? '').trim();
  const codigo = (/\b(preco_abaixo_minimo|cliente_bloqueado|item_inativo|estoque_insuficiente)\b/.exec(t) ?? [])[1];
  const item = /\b([A-Z]{2,}-\d+)\b/.exec(t)?.[1] ?? 'o item';
  switch (codigo) {
    case 'preco_abaixo_minimo':
      return mensagemAcimaDoMaximo([item]);
    case 'cliente_bloqueado':
      return 'cliente bloqueado no ERP';
    case 'item_inativo':
      return `${item} não está mais à venda`;
    case 'estoque_insuficiente':
      return `estoque de ${item} não atende a quantidade`;
    default:
      return motivoLegivel(t) ?? MOTIVO_GENERICO;
  }
}

const MOTIVO_GENERICO = 'o Macuxi recusou o pedido. Fale com seu supervisor';

/**
 * RN-VEN-40: a API devolve `mensagem` já em português (ex.: "VEL-150 acima do desconto máximo"). Mostra essa frase, sem o código de regra "(RN-...)" e sem o ponto final; texto técnico (código sem espaço, erro de
 * rede, HTTP) cai no genérico.
 */
function motivoLegivel(t: string): string | null {
  if (!t || !/\s/.test(t)) return null;
  if (/^(HTTP\s*\d|\w*Error\b|Network request failed|Failed to fetch)/i.test(t)) return null;
  const limpo = t
    .replace(/^RN-[A-Z]+-\d+:\s*/, '')
    .replace(/\s*\(RN-[A-Z]+-\d+\)/g, '')
    .replace(/[.\s]+$/, '')
    .trim();
  return limpo.length >= 4 ? limpo : null;
}

/** Aba do editor para onde "Corrigir pedido" leva, pelo motivo da recusa (código ou a frase da API). */
export function abaDaCorrecao(bruto: string): 'itens' | 'resumo' {
  return /preco_abaixo_minimo|item_inativo|estoque_insuficiente|acima do máximo|acima do desconto máximo|Sem preço para|produto inativo|Quantidade inválida|Medida inválida|Desconto em R\$ acima|^Item [^:]+:/i.test(bruto ?? '') ? 'itens' : 'resumo';
}

export interface EstadoNaFila {
  faixa: { texto: string; tom: 'warning' | 'danger'; icone: 'sync' | 'wifiOff' | 'alert' };
  /** pedido `na_fila` é só de leitura; só o recusado reabre para correção */
  somenteLeitura: boolean;
  podeCorrigir: boolean;
  podeEnviarAgora: boolean;
}

/** Nota da etapa "Na fila" do histórico: "Aguardando envio" só enquanto o pedido está de fato na fila; o recusado não leva nota (a faixa de recusa diz o motivo). */
export function notaDaEtapaNaFila(e: { recusado: boolean; criadoSemSinal: boolean }): string {
  if (e.recusado) return '';
  return e.criadoSemSinal ? 'Criado no aparelho sem sinal' : 'Aguardando envio';
}

export function estadoNaFila(e: { recusado: boolean; offline: boolean; motivoBruto?: string }): EstadoNaFila {
  if (e.recusado) {
    const motivo = motivoDaRecusa(e.motivoBruto ?? '');
    return {
      faixa: { texto: textoDaRecusa(motivo), tom: 'danger', icone: 'alert' },
      somenteLeitura: false,
      podeCorrigir: true,
      podeEnviarAgora: false,
    };
  }
  return {
    faixa: { texto: avisoDoSalvar(e.offline), tom: 'warning', icone: e.offline ? 'wifiOff' : 'sync' },
    somenteLeitura: true,
    podeCorrigir: false,
    podeEnviarAgora: !e.offline,
  };
}
