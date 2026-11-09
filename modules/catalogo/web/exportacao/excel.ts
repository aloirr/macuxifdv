/** Excel do catálogo (RF-CAT-09): CSV com BOM, `;` e CRLF, que o Excel abre direto. */
import { BOM_CSV, celulaCsv as celula } from '@macuxi/comum/csv';
import type { Catalogo } from './layout';

export const CABECALHO_CSV = ['Sistema', 'Grupo', 'Linha', 'Código', 'Aplicação', 'Oferece junto', 'Equivale a'] as const;

export function csvDoCatalogo(catalogo: Catalogo): string {
  const linhas: string[] = [CABECALHO_CSV.map(celula).join(';')];
  for (const s of catalogo)
    for (const i of s.itens) linhas.push([s.sistema, s.grupo, s.linha, i.codigo, i.aplicacao, i.oferece_junto.join(', '), i.equivale_a.join(', ')].map(celula).join(';'));
  return `${BOM_CSV}${linhas.join('\r\n')}\r\n`;
}
