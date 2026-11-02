/**
 * Exportar CSV no padrão brasileiro do Excel (separador `;`, vírgula decimal, CRLF e BOM), gerado no navegador com o
 * filtro da tela. Nada de regra aqui: os números vêm prontos da API (domain `painelDeAdesao`).
 */
import type { BkoTrilhaResumo, PessoaDoPainelContrato } from '../../contracts';
import { DEFAULT_TZ, formatDateTimeFull } from '@macuxi/ui/web';

/** BOM para o Excel abrir em UTF-8 sem perguntar. */
export const CSV_BOM = '﻿';

/** Escapa uma célula: aspas quando houver ; " ou quebra de linha. */
export function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return CSV_BOM + rows.map((r) => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

/** Percentual com vírgula e 2 casas; vazio quando não há dado (`null`, ex.: público vazio). */
export function csvPct(n: number | null): string {
  return n === null ? '' : n.toFixed(2).replace('.', ',');
}

export const ROTULO_PERFIL: Readonly<Record<string, string>> = {
  vendedor: 'Vendedor',
  promotor: 'Promotor',
  supervisor: 'Supervisor',
  gerente: 'Gerente',
  analista: 'Analista',
  assistente: 'Assistente',
  admin: 'Administrador',
};

export const ROTULO_STATUS: Readonly<Record<string, string>> = { rascunho: 'Rascunho', publicada: 'Publicada', arquivada: 'Arquivada' };

export const PESSOAS_CSV_CABECALHO = ['Pessoa', 'Perfil', 'Lições no mês', 'Trilhas concluídas', 'Obrigatórias pendentes', 'Nota média (%)', 'Última atividade'];

/** RF-TRE-05: notas e adesão por pessoa. */
export function pessoasParaCsv(pessoas: readonly PessoaDoPainelContrato[], tz = DEFAULT_TZ): string {
  return toCsv([
    PESSOAS_CSV_CABECALHO,
    ...pessoas.map((p) => [
      p.nome,
      ROTULO_PERFIL[p.perfil] ?? p.perfil,
      p.licoes_no_mes,
      p.trilhas_concluidas,
      p.obrigatorias_pendentes,
      csvPct(p.nota_media_pct),
      p.ultima_atividade_em ? formatDateTimeFull(p.ultima_atividade_em, tz) : '',
    ]),
  ]);
}

export const TRILHAS_CSV_CABECALHO = ['Trilha', 'Status', 'Obrigatória', 'Prazo', 'Módulos', 'Lições', 'Quizzes', 'Perfis do público', 'Equipes do público'];

/** RF-TRE-01: lista do cadastro de trilhas. */
export function trilhasParaCsv(trilhas: readonly BkoTrilhaResumo[]): string {
  return toCsv([
    TRILHAS_CSV_CABECALHO,
    ...trilhas.map((t) => [
      t.titulo,
      ROTULO_STATUS[t.status] ?? t.status,
      t.obrigatoria ? 'Sim' : 'Não',
      t.prazo ?? '',
      t.modulos,
      t.licoes,
      t.quizzes,
      t.publico_perfis.length === 0 ? 'Todos' : t.publico_perfis.map((p) => ROTULO_PERFIL[p] ?? p).join(', '),
      t.publico_equipes === 0 ? 'Todas' : t.publico_equipes,
    ]),
  ]);
}
