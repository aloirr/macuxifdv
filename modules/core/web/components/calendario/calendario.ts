/**
 * Regras de tela de Parâmetros › Calendário (desenho `docs/desenho/performance-produtividade.md` §1.3, §3.2 e §6.5), puras:
 * a lista do ano com os feriados nacionais (só leitura, `@macuxi/comum`) e os do tenant, a inclusão e a remoção de um
 * feriado do tenant e o almoço (corte dentro da janela). A conta dos dias úteis é do domain e da API.
 */
import { ehDataCivil, ehFeriadoNacional, feriadosNacionaisDoAno } from '@macuxi/comum/calendar';
import { lerHora } from '../metas-produtividade/formato';
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

export type ErrosAlmoco = Partial<Record<'corte' | 'janela', string>>;

/** Corte e janela do almoço (§3.2): horários válidos, janela com início antes do fim e o corte dentro dela. */
export function lerAlmoco(corte: string, inicio: string, fim: string): { ok: true; corte: number; janela: [number, number] } | { ok: false; erros: ErrosAlmoco } {
  const c = lerHora(corte);
  const i = lerHora(inicio);
  const f = lerHora(fim);
  const erros: ErrosAlmoco = {};
  if (c === null) erros.corte = 'Use o horário em hh:mm.';
  if (i === null || f === null) erros.janela = 'Use os horários em hh:mm.';
  else if (i >= f) erros.janela = 'O início vem antes do fim.';
  else if (c !== null && (c <= i || c >= f)) erros.corte = 'O corte fica dentro da janela.';
  return c !== null && i !== null && f !== null && Object.keys(erros).length === 0 ? { ok: true, corte: c, janela: [i, f] } : { ok: false, erros };
}
