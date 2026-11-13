/**
 * T-0126 (RN-VEN-38): parte PURA da folha de saída de formulário alterado e da retomada do rascunho depois que o sistema
 * fecha o app. Spec: docs/design/formulario-pendencias.md §2. A falta de preenchimento (RN-CORE-36) é a "falta no campo, só na
 * tentativa" (`falta.ts`, T-0166); o bloco "Falta para salvar" e a bolinha por pendência saíram (RD-0179).
 * Sem react-native: roda em Node (Vitest) e é reexportada por `@macuxi/ui/mobile/puro`. Os componentes
 * (`FolhaSairDoFormulario`, `FolhaRetomarRascunho`) só desenham o que estas funções devolvem.
 */

/**
 * @deprecated T-0166 (RD-0179): o salvar com falta passa a ser tocável (`formulario-pendencias.md` §0.0) e esta leitura sai
 * quando o Novo pedido ligar o modo "tentou". Leitura do botão desligado: "Salvar. Falta para salvar: 2 pendências, na lista acima".
 */
export function leituraDoSalvar(rotulo: string, n: number): string {
  if (n <= 0) return rotulo;
  return `${rotulo}. Falta para salvar: ${n === 1 ? '1 pendência' : `${n} pendências`}, na lista acima`;
}

// ---------- Folha de saída de formulário alterado (RN-VEN-38) ----------

/** Passo da folha: as opções, a confirmação do descarte (diálogo) ou fechada. */
export type PassoDaSaida = 'opcoes' | 'confirmar_descarte' | 'fechada';
/** Toques possíveis. `continuar` = "Continuar editando", toque fora ou Voltar do Android com a folha aberta. */
export type EventoDaSaida = 'salvar' | 'apenas_salvar' | 'salvar_alternativo' | 'descartar' | 'confirmar_descarte' | 'voltar_do_descarte' | 'continuar';
/**
 * O que a tela faz depois do toque (null = nada ainda, só muda o passo). `apenas_salvar` (T-0133, RN-VEN-38): grava o rascunho
 * sem enviar e aceita pendências.
 */
export type AcaoDaSaida = 'salvar' | 'apenas_salvar' | 'salvar_alternativo' | 'descartar' | 'continuar' | null;

/**
 * Máquina da folha "Sair do pedido?". Descartar nunca apaga no 1º toque: abre a confirmação; "Voltar" da confirmação
 * devolve às opções (não fecha tudo). Salvar e salvar alternativo fecham a folha e a tela valida: com falta, liga o modo
 * "tentou" e leva à 1ª aba com falta (T-0166); sem, segue o salvar normal.
 */
export function eventoDaSaida(passo: PassoDaSaida, evento: EventoDaSaida): { passo: PassoDaSaida; acao: AcaoDaSaida } {
  if (passo === 'fechada') return { passo, acao: null };
  if (passo === 'confirmar_descarte') {
    if (evento === 'confirmar_descarte') return { passo: 'fechada', acao: 'descartar' };
    // Voltar do diálogo, Voltar do Android ou qualquer outro toque: volta às opções
    return { passo: 'opcoes', acao: null };
  }
  switch (evento) {
    case 'salvar':
      return { passo: 'fechada', acao: 'salvar' };
    case 'apenas_salvar':
      return { passo: 'fechada', acao: 'apenas_salvar' };
    case 'salvar_alternativo':
      return { passo: 'fechada', acao: 'salvar_alternativo' };
    case 'descartar':
      return { passo: 'confirmar_descarte', acao: null };
    case 'continuar':
      return { passo: 'fechada', acao: 'continuar' };
    default:
      return { passo, acao: null };
  }
}

/** Retomada (app fechado pelo sistema): "Continuar pedido de Mercadinho São Jorge". */
export function tituloDaRetomada(objeto: string, nome: string): string {
  return `Continuar ${objeto} de ${nome.trim()}`;
}

/** Linha de apoio da retomada: as partes já formatadas pelo módulo, unidas por " · " ("2 itens · R$ 55,53 · alterado às 10h34"). */
export function apoioDaRetomada(partes: ReadonlyArray<string | null | undefined>): string {
  return partes.filter((p): p is string => typeof p === 'string' && p.trim() !== '').join(' · ');
}
