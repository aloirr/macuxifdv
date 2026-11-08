/**
 * T-0126 (RN-CORE-36, RN-VEN-38): parte PURA do padrão de formulário com abas — pendências de preenchimento, folha de saída
 * de formulário alterado e retomada do rascunho depois que o sistema fecha o app. Spec: docs/design/formulario-pendencias.md.
 * Sem react-native: roda em Node (Vitest) e é reexportada por `@macuxi/ui/mobile/puro`. Os componentes (`BlocoPendencias`,
 * `FolhaSairDoFormulario`, `FolhaRetomarRascunho`) só desenham o que estas funções devolvem.
 * Sem regra de negócio: QUAIS pendências existem é decisão do `domain` do módulo (ex.: Vendedor, RN-VEN-16 e RN-VEN-24);
 * aqui só a ordem, os textos, a leitura do TalkBack e as bolinhas das abas.
 */

/** Aba do formulário, na ordem em que aparece ("Venda", "Itens", "Entrega", "Resumo"). A última é a que tem o bloco e o salvar. */
export interface AbaDoFormulario {
  id: string;
  rotulo: string;
}

/**
 * Uma pendência de preenchimento, montada pelo `domain` do módulo.
 * `texto` diz o que falta, como substantivo e com inicial maiúscula: "Transportadora do frete FOB", "Prazo de pagamento",
 * "Pelo menos 1 item". Sem verbo de ordem ("Informe…") e sem ponto final.
 */
export interface PendenciaPreenchimento {
  /** estável entre renders (chave da linha e testID) */
  id: string;
  texto: string;
  /** id da aba onde se corrige */
  aba: string;
  /** id do campo na aba, para a tela rolar até ele ao abrir a aba (opcional) */
  campo?: string;
}

export const TITULO_FALTA_PARA_SALVAR = 'Falta para salvar';
/** Lido pelo TalkBack junto do nome da aba que tem bolinha (prop `rotuloPendencia` do `Abas`). */
export const LEITURA_ABA_COM_PENDENCIA = 'com pendência';

/** Posição da aba na ordem do formulário (aba desconhecida vai para o fim, sem quebrar). */
function posicao(abas: ReadonlyArray<AbaDoFormulario>, id: string): number {
  const i = abas.findIndex((a) => a.id === id);
  return i < 0 ? abas.length : i;
}

/**
 * Ordem do bloco: a ordem das abas (a mesma em que a pessoa preenche) e, dentro da aba, a ordem que o `domain` mandou
 * (a ordem dos campos na tela). Pendência repetida (mesmo id) aparece uma vez só.
 */
export function ordenarPendencias(pendencias: ReadonlyArray<PendenciaPreenchimento>, abas: ReadonlyArray<AbaDoFormulario>): PendenciaPreenchimento[] {
  const vistas = new Set<string>();
  const unicas = pendencias.filter((p) => (vistas.has(p.id) ? false : (vistas.add(p.id), true)));
  return unicas
    .map((p, i) => ({ p, i }))
    .sort((a, b) => posicao(abas, a.p.aba) - posicao(abas, b.p.aba) || a.i - b.i)
    .map((x) => x.p);
}

/**
 * Abas que ganham a bolinha: as que têm pendência, menos a última (lá já está o bloco "Falta para salvar").
 * Nenhuma outra marca nas abas: sem alerta, sem botão de correção, sem borda vermelha no campo (RN-CORE-36).
 */
export function abasComPendencia(pendencias: ReadonlyArray<PendenciaPreenchimento>, abas: ReadonlyArray<AbaDoFormulario>): Set<string> {
  const ultima = abas[abas.length - 1]?.id;
  const ids = new Set<string>();
  for (const p of pendencias) if (p.aba !== ultima && abas.some((a) => a.id === p.aba)) ids.add(p.aba);
  return ids;
}

/** "aba Entrega" — ou null quando a pendência é da própria aba do bloco (aí não se diz a aba, só se rola até o campo). */
export function ondeCorrigir(p: PendenciaPreenchimento, abas: ReadonlyArray<AbaDoFormulario>, abaDoBloco?: string): string | null {
  const doBloco = abaDoBloco ?? abas[abas.length - 1]?.id;
  if (p.aba === doBloco) return null;
  const aba = abas.find((a) => a.id === p.aba);
  return aba ? `aba ${aba.rotulo}` : null;
}

/** Linha do bloco, como no texto da regra: "Transportadora do frete FOB — aba Entrega". */
export function linhaDaPendencia(p: PendenciaPreenchimento, abas: ReadonlyArray<AbaDoFormulario>, abaDoBloco?: string): string {
  const onde = ondeCorrigir(p, abas, abaDoBloco);
  return onde ? `${p.texto} — ${onde}` : p.texto;
}

/** TalkBack da linha: "Falta: Transportadora do frete FOB, na aba Entrega" (o travessão não é lido). */
export function leituraDaPendencia(p: PendenciaPreenchimento, abas: ReadonlyArray<AbaDoFormulario>, abaDoBloco?: string): string {
  const onde = ondeCorrigir(p, abas, abaDoBloco);
  return onde ? `Falta: ${p.texto}, na ${onde}` : `Falta: ${p.texto}, nesta aba`;
}

/** Dica do TalkBack da linha (o que o toque faz): "Abre a aba Entrega" / "Vai até o campo". */
export function dicaDaPendencia(p: PendenciaPreenchimento, abas: ReadonlyArray<AbaDoFormulario>, abaDoBloco?: string): string {
  const onde = ondeCorrigir(p, abas, abaDoBloco);
  return onde ? `Abre a ${onde}` : 'Vai até o campo';
}

function contagem(n: number): string {
  return n === 1 ? '1 pendência' : `${n} pendências`;
}

/** Cabeçalho do bloco para o TalkBack: "Falta para salvar: 2 pendências". */
export function leituraDoBloco(n: number, titulo = TITULO_FALTA_PARA_SALVAR): string {
  return `${titulo}: ${contagem(n)}`;
}

/**
 * Rótulo do botão de salvar para o TalkBack. Sem pendência, o próprio rótulo. Com pendência, o motivo de estar desabilitado
 * (o "desativado" o próprio TalkBack fala pelo `accessibilityState`): "Salvar. Falta para salvar: 2 pendências, na lista acima".
 */
export function leituraDoSalvar(rotulo: string, n: number, titulo = TITULO_FALTA_PARA_SALVAR): string {
  return n > 0 ? `${rotulo}. ${leituraDoBloco(n, titulo)}, na lista acima` : rotulo;
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
 * devolve às opções (não fecha tudo). Salvar e salvar alternativo fecham a folha e a tela valida: com pendência, abre a
 * última aba com o bloco "Falta para salvar"; sem, segue o salvar normal.
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
