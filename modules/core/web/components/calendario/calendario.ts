/**
 * Regras de tela de Parâmetros › Calendário (desenho `docs/desenho/performance-produtividade.md` §1.3, §3.2 e §6.5), puras:
 * a lista do ano com os feriados nacionais (só leitura, `@macuxi/comum`) e os do tenant, a inclusão e a remoção de um
 * feriado do tenant (o almoço padrão é de `almoco-padrao.ts`). A conta dos dias úteis é do domain e da API.
 */
import { ehDataCivil, ehFeriadoNacional, feriadosNacionaisDoAno } from '@macuxi/comum/calendar';
import type { FeriadoDoTenant } from './api';

/** Até 60 feriados do tenant por ano (§1.3). */
export const FERIADOS_POR_ANO_MAX = 60;
export const FERIADO_NOME_MAX = 60;

export interface LinhaFeriado {
  data: string;
  nome: string;
  nacional: boolean;
}

/** Feriados do ano em ordem de data: os nacionais (que contam sempre) e os do tenant. */
export function feriadosDoAno(ano: number, doTenant: readonly FeriadoDoTenant[]): LinhaFeriado[] {
  const nacionais = feriadosNacionaisDoAno(ano).map((f) => ({ data: f.data, nome: f.nome, nacional: true }));
  const proprios = doTenant.filter((f) => f.data.startsWith(`${ano}-`)).map((f) => ({ ...f, nacional: false }));
  return [...nacionais, ...proprios].sort((a, b) => (a.data < b.data ? -1 : a.data > b.data ? 1 : 0));
}

export type ErroFeriado = { campo: 'data' | 'nome'; erro: string };

/** Inclui um feriado do tenant; o erro vem com o campo. */
export function incluirFeriado(lista: readonly FeriadoDoTenant[], novo: FeriadoDoTenant): { ok: true; lista: FeriadoDoTenant[] } | ({ ok: false } & ErroFeriado) {
  const nome = novo.nome.trim();
  if (!ehDataCivil(novo.data)) return { ok: false, campo: 'data', erro: 'Escolha a data.' };
  if (ehFeriadoNacional(novo.data)) return { ok: false, campo: 'data', erro: 'Esta data já é feriado nacional.' };
  if (lista.some((f) => f.data === novo.data)) return { ok: false, campo: 'data', erro: 'Esta data já está na lista.' };
  if (lista.filter((f) => f.data.slice(0, 4) === novo.data.slice(0, 4)).length >= FERIADOS_POR_ANO_MAX)
    return { ok: false, campo: 'data', erro: `O ano já tem ${FERIADOS_POR_ANO_MAX} feriados.` };
  if (!nome) return { ok: false, campo: 'nome', erro: 'Escreva o nome.' };
  if (nome.length > FERIADO_NOME_MAX) return { ok: false, campo: 'nome', erro: `Use até ${FERIADO_NOME_MAX} caracteres.` };
  return { ok: true, lista: [...lista, { data: novo.data, nome }].sort((a, b) => (a.data < b.data ? -1 : 1)) };
}
