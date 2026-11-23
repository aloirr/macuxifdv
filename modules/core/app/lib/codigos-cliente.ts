/**
 * Os dois códigos do cliente (v1.0.30; ADR 0069 item 10 e seção H; docs/design/telas/codigos-do-cliente.md): Código ERP
 * (`external_id`) e Código FDV (`codigo_fdv`). Regra única de exibição e de busca do app e do BKO (o BKO importa daqui). Pura.
 * - Forma: sigla + valor (`ERP C5007`, `FDV 00012`), ERP primeiro; código vazio não aparece (sem sigla, traço ou texto).
 */
export interface CodigosDoClienteEntrada {
  external_id?: string | null;
  codigo_fdv?: string | null;
}

export type SiglaCodigo = 'ERP' | 'FDV';

export interface CodigoDoCliente {
  sigla: SiglaCodigo;
  valor: string;
}

const limpo = (v: string | null | undefined): string => (v ?? '').trim();

/** Códigos existentes, na ordem fixa ERP, FDV. */
export function codigosDoCliente(c: CodigosDoClienteEntrada): CodigoDoCliente[] {
  const r: CodigoDoCliente[] = [];
  for (const [sigla, valor] of [
    ['ERP', limpo(c.external_id)],
    ['FDV', limpo(c.codigo_fdv)],
  ] as const) {
    if (valor !== '') r.push({ sigla, valor });
  }
  return r;
}

/** "ERP C5007 · FDV 00012"; vazio quando o cliente não tem código. */
export const textoDosCodigos = (c: CodigosDoClienteEntrada): string =>
  codigosDoCliente(c)
    .map((x) => `${x.sigla} ${x.valor}`)
    .join(' · ');

/**
 * Valor para o campo de código da `clienteCasaBusca` (contracts): os dois códigos separados por espaço. Como a busca compara
 * palavra por palavra e uma palavra nunca tem espaço, "contém" num dos códigos é o mesmo que "contém" no texto unido.
 */
export const codigosParaBusca = (c: CodigosDoClienteEntrada): string => codigosDoCliente(c).map((x) => x.valor).join(' ');
