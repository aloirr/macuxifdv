/**
 * v1.0.30 (docs/design/telas/codigos-do-cliente.md §2): os códigos do cliente na tela, `ERP C5007 · FDV 00012`.
 * Ordem fixa (ERP, depois FDV); sigla sempre antes do valor; código vazio não aparece (nem sigla, nem traço).
 * Leitor de tela: `Código ERP C5007, Código FDV 00012`. Puro: roda em Node e é reexportado por `@macuxi/ui/mobile/puro`.
 */

/** Os dois códigos como a tela recebe (o módulo traduz `external_id` e `codigo_fdv`). */
export interface CodigosDoCliente {
  erp?: string | null;
  fdv?: string | null;
}

export interface ParteDoCodigo {
  sigla: 'ERP' | 'FDV';
  /** O valor como está no banco (o FDV já vem com zeros à esquerda). Na tela, em `fonte.mono`. */
  valor: string;
}

/** Separador entre os códigos e entre eles e o resto da linha. */
export const SEPARADOR_CODIGOS = ' · ';

/** Os códigos que existem, na ordem fixa. Lista vazia = nada a mostrar. */
export function partesDosCodigos(codigos: CodigosDoCliente | null | undefined): ParteDoCodigo[] {
  const partes: ParteDoCodigo[] = [];
  const erp = codigos?.erp?.trim();
  const fdv = codigos?.fdv?.trim();
  if (erp) partes.push({ sigla: 'ERP', valor: erp });
  if (fdv) partes.push({ sigla: 'FDV', valor: fdv });
  return partes;
}

/** Texto visível, sem estilo (`ERP C5007 · FDV 00012`); '' quando não há código. */
export function textoDosCodigos(codigos: CodigosDoCliente | null | undefined): string {
  return partesDosCodigos(codigos)
    .map((p) => `${p.sigla} ${p.valor}`)
    .join(SEPARADOR_CODIGOS);
}

/**
 * Leitura do TalkBack: `Código ERP C5007, Código FDV 00012`, seguida do resto da linha quando houver
 * (`…, Centro · Boa Vista/RR`). '' quando não há nada.
 */
export function leituraDosCodigos(codigos: CodigosDoCliente | null | undefined, resto?: string | null): string {
  const itens = partesDosCodigos(codigos).map((p) => `Código ${p.sigla} ${p.valor}`);
  if (resto?.trim()) itens.push(resto.trim());
  return itens.join(', ');
}
