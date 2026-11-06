/** Excel do catálogo (RF-CAT-09): CSV com BOM, `;` e CRLF, que o Excel abre direto. */
import type { Catalogo } from './layout';

/** Evita injeção de fórmula em planilha (mesma regra do BKO do core, copiada por causa da fronteira de módulos). */
export const protegerFormula = (v: string): string => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
const celula = (v: string) => `"${protegerFormula(v).replace(/"/g, '""')}"`;

export const CABECALHO_CSV = ['Sistema', 'Grupo', 'Linha', 'Código', 'Aplicação', 'Oferece junto', 'Equivale a'] as const;

const BOM = String.fromCharCode(0xfeff);

export function csvDoCatalogo(catalogo: Catalogo): string {
  const linhas: string[] = [CABECALHO_CSV.map(celula).join(';')];
  for (const s of catalogo)
    for (const i of s.itens) linhas.push([s.sistema, s.grupo, s.linha, i.codigo, i.aplicacao, i.oferece_junto.join(', '), i.equivale_a.join(', ')].map(celula).join(';'));
  return `${BOM}${linhas.join('\r\n')}\r\n`;
}
