/**
 * Exportação CSV das páginas do Gestor (padrão do BKO: `;` como separador, vírgula decimal, dinheiro em reais).
 * Só dados que a API já devolveu no escopo de quem exporta (RN-CORE-04).
 */
import { BOM_CSV, protegerFormula } from '@macuxi/comum/csv';
import type { RankingEquipe, VisaoEquipe } from '../../contracts';

const celula = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? v.toLocaleString('pt-BR', { useGrouping: false, maximumFractionDigits: 2 }) : v;
  const t = typeof v === 'number' ? s : protegerFormula(s);
  return /[;"\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const reais = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : cents / 100);
const linhas = (rows: (string | number | null | undefined)[][]) => BOM_CSV + rows.map((r) => r.map(celula).join(';')).join('\n') + '\n';

export const CABECALHO_EQUIPE = ['Data', 'Nome', 'Perfil', 'Situação', 'Visitas realizadas', 'Visitas planejadas', 'Cobertura %', 'Vendas (R$)', 'Pedidos', 'A faturar (R$)', 'Lojas (promotor)'];

export function csvDaEquipe(v: VisaoEquipe): string {
  return linhas([
    CABECALHO_EQUIPE,
    ...v.membros.map(({ membro: m, painel: p }) => [
      v.data,
      m.nome,
      m.perfil,
      p.status_dia,
      p.visitas.realizadas,
      p.visitas.planejadas,
      p.visitas.cobertura_pct,
      reais(p.vendas?.vendas_cents),
      p.vendas?.pedidos ?? null,
      reais(p.faturamento?.a_faturar_cents),
      p.trade?.lojas_visitadas ?? null,
    ]),
  ]);
}

export function csvDoRanking(r: RankingEquipe): string {
  const dinheiro = r.indicador.endsWith('_cents');
  return linhas([
    ['Posição', 'Nome', 'Perfil', `Valor (${r.indicador})`, 'Início', 'Fim'],
    ...r.linhas.map((l) => [l.posicao, l.nome, l.perfil, dinheiro ? reais(l.valor) : l.valor, r.inicio, r.fim]),
  ]);
}
