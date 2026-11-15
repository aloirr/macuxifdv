/**
 * Fonte do sistema (R-20261115-110600; manual da marca §5.1): a pilha mora só aqui (RD-0943).
 * TS, PDF e e-mail importam daqui; o `globals.css` repete a pilha uma vez só em `--font-sans`/`--font-mono`.
 */
const SISTEMA = ['system-ui', '"Segoe UI"', 'Roboto', '-apple-system'];
const MONO = ['ui-monospace', '"Cascadia Mono"', '"Roboto Mono"'];

/** Texto: a fonte do aparelho (Segoe UI no Windows, Roboto no Android, San Francisco na Apple). */
export const PILHA_SISTEMA = [...SISTEMA, 'sans-serif'].join(', ');
/** Mono: só em código (SKU, código de empresa/cliente, chave, senha provisória). */
export const PILHA_MONO = [...MONO, 'monospace'].join(', ');

/** No e-mail o nome vai em aspas simples, porque a pilha fica dentro de `style="..."`. */
const paraEmail = (familias: readonly string[]): string => familias.join(',').replace(/"/g, "'");

/** E-mail (manual §5.1): Arial/Helvetica antes do genérico, para leitores sem `system-ui`. */
export const PILHA_SISTEMA_EMAIL = paraEmail([...SISTEMA, 'Arial', 'Helvetica', 'sans-serif']);
/** E-mail: Consolas/'Courier New' antes do genérico. */
export const PILHA_MONO_EMAIL = paraEmail([...MONO, 'Consolas', '"Courier New"', 'monospace']);
