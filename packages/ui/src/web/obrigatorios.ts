/** Regra: docs/design/componentes.md §5.6 (R-20261124-092046) */
export const TEXTO_AVISO_OBRIGATORIO = 'Campos obrigatórios não preenchido. Preencha e salve novamente';

/** O que a gaveta lê de cada campo (`input`, `select`, `textarea`) para decidir o aviso. Sem DOM: testável. */
export interface CampoDaGaveta {
  /** Valor atual; caixa de marcar: `'on'` marcada, `''` desmarcada. */
  valor: string;
  /** `type` do input (`text`, `checkbox`, `radio`, `hidden`...); `select` e `textarea` mandam o nome da tag. */
  tipo: string;
  /** `required` nativo ou `aria-required="true"`: obrigatório declarado pelo módulo. */
  declarado: boolean;
  /** Dentro de `CampoFormulario` sem `opcional` (no BKO, "(opcional)" marca o que não é obrigatório). */
  rotuloObrigatorio: boolean;
  /** A validação do módulo marcou o campo: `aria-invalid="true"` ou o erro embaixo do `CampoFormulario`. */
  marcadoComErro: boolean;
  /** Desabilitado, só leitura ou fora da tela: não conta. */
  ignorado: boolean;
}

const TIPOS_SEM_VALOR = new Set(['hidden', 'button', 'submit', 'reset', 'image', 'radio', 'range', 'color']);

/** Campo vazio para efeito do aviso: texto só com espaços conta como vazio. */
export function campoVazio(c: Pick<CampoDaGaveta, 'valor'>): boolean {
  return c.valor.trim() === '';
}

/**
 * Campos obrigatórios vazios que justificam o aviso:
 * - declarado (`required`/`aria-required`) e vazio: conta direto;
 * - só pelo rótulo (sem "(opcional)") e vazio: conta quando a validação do módulo também o marcou, para não avisar
 *   de campo que o módulo aceita vazio. Caixa de marcar só conta se declarada.
 */
export function camposObrigatoriosVazios<T extends CampoDaGaveta>(campos: readonly T[]): T[] {
  return campos.filter((c) => {
    if (c.ignorado || TIPOS_SEM_VALOR.has(c.tipo) || !campoVazio(c)) return false;
    if (c.declarado) return true;
    if (c.tipo === 'checkbox') return false;
    return c.rotuloObrigatorio && c.marcadoComErro;
  });
}

/** Decide o aviso: aparece se houver obrigatório vazio. */
export function mostraAvisoObrigatorio(campos: readonly CampoDaGaveta[]): boolean {
  return camposObrigatoriosVazios(campos).length > 0;
}

/** Marca do `CampoFormulario` obrigatório e do erro embaixo dele (lidas pela gaveta). */
export const ATRIBUTO_CAMPO_OBRIGATORIO = 'data-campo-obrigatorio';
export const ATRIBUTO_ERRO_DO_CAMPO = 'data-erro-do-campo';

/** Por quanto tempo, depois de tentar salvar, a gaveta espera a validação assíncrona do módulo marcar os campos. */
export const ESPERA_VALIDACAO_MS = 2000;

/** O mínimo de um registro do `MutationObserver` (testável sem DOM). */
export interface MudancaNaGaveta {
  type: string;
  attributeName?: string | null;
  addedNodes: ArrayLike<unknown>;
  removedNodes: ArrayLike<unknown>;
}

function temErroDoCampo(no: unknown): boolean {
  const el = no as { matches?: (s: string) => boolean; querySelector?: (s: string) => unknown };
  const seletor = `[${ATRIBUTO_ERRO_DO_CAMPO}]`;
  return !!el.matches?.(seletor) || !!el.querySelector?.(seletor);
}

/** A validação do módulo marcou ou desmarcou um campo: `aria-invalid` mudou, ou o erro embaixo do campo entrou ou saiu. */
export function validacaoMudou(mudancas: readonly MudancaNaGaveta[]): boolean {
  return mudancas.some((m) =>
    m.type === 'attributes'
      ? m.attributeName === 'aria-invalid'
      : m.type === 'childList' && (Array.from(m.addedNodes).some(temErroDoCampo) || Array.from(m.removedNodes).some(temErroDoCampo)),
  );
}

/** Lê os campos de dentro da gaveta (DOM). */
export function lerCamposDaGaveta(caixa: HTMLElement): CampoDaGaveta[] {
  const els = Array.from(caixa.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('input, select, textarea'));
  return els.map((el) => {
    const tipo = el instanceof HTMLInputElement ? el.type : el.tagName.toLowerCase();
    const valor = el instanceof HTMLInputElement && el.type === 'checkbox' ? (el.checked ? 'on' : '') : el instanceof HTMLInputElement && el.type === 'file' ? (el.files?.length ? 'on' : '') : el.value;
    const rotulo = el.closest(`[${ATRIBUTO_CAMPO_OBRIGATORIO}]`);
    const somenteLeitura = 'readOnly' in el && el.readOnly;
    return {
      valor,
      tipo,
      declarado: el.required || el.getAttribute('aria-required') === 'true',
      rotuloObrigatorio: !!rotulo,
      marcadoComErro: el.getAttribute('aria-invalid') === 'true' || !!rotulo?.querySelector(`[${ATRIBUTO_ERRO_DO_CAMPO}]`),
      ignorado: el.disabled || somenteLeitura || el.getClientRects().length === 0,
    };
  });
}
