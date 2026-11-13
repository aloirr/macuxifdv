/**
 * T-0165 (pedido-v4.md §5.6; T-0166 §6.1): parte PURA do `CampoEscolha` — o campo de 48 dp que abre uma folha com busca, a
 * lista e uma opção final fixa ("Outra (digitar)"). Busca no rótulo sem acento e sem caixa; a ordem é a que o módulo mandou.
 * Sem regra de negócio (quais opções valem é do domain). Sem react-native: roda em Node (Vitest).
 */

export interface OpcaoEscolha {
  /** estável (chave da linha e testID) */
  id: string;
  rotulo: string;
}

/** "Água Sanitária" → "agua sanitaria": sem acento, minúsculas e espaços simples. */
export function semAcento(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** As opções cujo rótulo contém cada palavra da busca (em qualquer ordem). Busca vazia: todas, na ordem recebida. */
export function filtrarOpcoes<T extends OpcaoEscolha>(opcoes: ReadonlyArray<T>, busca: string): T[] {
  const palavras = semAcento(busca).split(' ').filter(Boolean);
  if (palavras.length === 0) return [...opcoes];
  return opcoes.filter((o) => {
    const r = semAcento(o.rotulo);
    return palavras.every((p) => r.includes(p));
  });
}

/**
 * Texto do campo fechado: o rótulo da escolhida, o `rotuloLivre` quando a escolha é a opção final ("Outra") ou o
 * `placeholder` ("Escolher", em `ink3`). `vazio` diz se é o placeholder.
 */
export function textoDoCampoEscolha(
  opcoes: ReadonlyArray<OpcaoEscolha>,
  valor: string | null | undefined,
  placeholder: string,
  rotuloLivre?: string | null,
): { texto: string; vazio: boolean } {
  if (rotuloLivre) return { texto: rotuloLivre, vazio: false };
  const o = valor ? opcoes.find((x) => x.id === valor) : undefined;
  return o ? { texto: o.rotulo, vazio: false } : { texto: placeholder, vazio: true };
}

/** Medidas: campo 48 dp (borda `lineStrong` 1, raio 12), linhas da folha 52 dp, texto 15. */
export const CAMPO_ESCOLHA = { altura: 48, raio: 12, linha: 52, fonte: 15, seta: 18 } as const;
