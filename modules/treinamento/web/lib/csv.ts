/**
 * Exportar CSV no padrão brasileiro do Excel (separador `;`, vírgula decimal, CRLF e BOM), gerado no navegador com o
 * filtro da tela. Nada de regra aqui: os números vêm prontos da API (domain `painelDeAdesao`).
 */
import type { BkoTrilhaResumo, PessoaDoPainelContrato } from '../../contracts';
import { BOM_CSV, celulaCsvCompacta } from '@macuxi/comum/csv';
import { DEFAULT_TZ, formatDateTimeFull, rotuloDoPerfil } from '@macuxi/ui/web';

/** Texto passa por `celulaCsvCompacta` (fórmula protegida, CWE-1236); número sai como está (negativo não é fórmula). */
export function toCsv(rows: Array<Array<string | number | null | undefined>>): string {
  const celula = (v: string | number | null | undefined): string =>
    typeof v === 'number' ? String(v) : celulaCsvCompacta(v ?? '');
  return BOM_CSV + rows.map((r) => r.map(celula).join(';')).join('\r\n') + '\r\n';
}

/** Percentual com vírgula e 2 casas; vazio quando não há dado (`null`, ex.: público vazio). */
export function csvPct(n: number | null): string {
  return n === null ? '' : n.toFixed(2).replace('.', ',');
}

export const ROTULO_STATUS: Readonly<Record<string, string>> = { rascunho: 'Rascunho', publicada: 'Publicada', arquivada: 'Arquivada' };

export const PESSOAS_CSV_CABECALHO = ['Pessoa', 'Perfil', 'Lições no mês', 'Trilhas concluídas', 'Obrigatórias pendentes', 'Nota média (%)', 'Última atividade'];

/** RF-TRE-05: notas e adesão por pessoa. */
export function pessoasParaCsv(pessoas: readonly PessoaDoPainelContrato[], tz = DEFAULT_TZ): string {
  return toCsv([
    PESSOAS_CSV_CABECALHO,
    ...pessoas.map((p) => [
      p.nome,
      rotuloDoPerfil(p.perfil),
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
      t.publico_perfis.length === 0 ? 'Todos' : t.publico_perfis.map((p) => rotuloDoPerfil(p)).join(', '),
      t.publico_equipes === 0 ? 'Todas' : t.publico_equipes,
    ]),
  ]);
}
