/**
 * Visão das telas Carteira e Cliente 360 do BKO (T-0017/T-0018): funções puras sobre `GET /v1/core/usuarios/:id/clientes`
 * e `GET /v1/core/clientes/:id`. Sem React e sem rede.
 */
import type { ClienteDaCarteira } from './rotas-api';

const BOM = String.fromCharCode(0xfeff); // o Excel abre o CSV em UTF-8
const aspas = (v: string) => `"${v.replace(/"/g, '""')}"`;

/** Dia ISO da semana (1 = segunda … 7 = domingo), como `core.carteira.dia_semana`. */
export const DIAS_DA_SEMANA = [
  { valor: 1, rotulo: 'Segunda' },
  { valor: 2, rotulo: 'Terça' },
  { valor: 3, rotulo: 'Quarta' },
  { valor: 4, rotulo: 'Quinta' },
  { valor: 5, rotulo: 'Sexta' },
  { valor: 6, rotulo: 'Sábado' },
  { valor: 7, rotulo: 'Domingo' },
] as const;

export function rotuloFrequencia(semanas: number | null | undefined): string {
  if (!semanas) return 'Sem frequência';
  return semanas === 1 ? 'Toda semana' : `A cada ${semanas} semanas`;
}

export function rotuloDia(dia: number | null | undefined): string {
  return DIAS_DA_SEMANA.find((d) => d.valor === dia)?.rotulo ?? '';
}

/** CSV (ponto e vírgula, Excel pt-BR) da carteira do usuário na tela. */
export function csvDaCarteira(itens: readonly ClienteDaCarteira[], usuarioNome: string): string {
  const cab = ['Usuário', 'Cliente', 'Cidade', 'Bairro', 'Última compra', 'Frequência', 'Dia da visita', 'Coordenada'];
  const linhas = itens.map((c) =>
    [usuarioNome, c.nome, c.cidade ?? '', c.bairro ?? '', c.ultima_compra_em ?? '', rotuloFrequencia(c.frequencia_semanas), rotuloDia(c.dia_semana), c.lat === null ? 'sem coordenada' : 'ok'].map(aspas).join(';'),
  );
  return BOM + `${[cab.map(aspas).join(';'), ...linhas].join('\r\n')}\r\n`;
}
