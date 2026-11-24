/**
 * Exportação CSV das páginas do Gestor (padrão do BKO: `;` como separador, vírgula decimal, dinheiro em reais).
 * Só dados que a API já devolveu no escopo de quem exporta (RN-CORE-04).
 */
import { BOM_CSV, celulaCsvCompacta, type ValorCsv } from '@macuxi/comum/csv';
import type { RankingEquipe, VisaoEquipe } from '../../contracts';

const duasCasas = (v: ValorCsv): ValorCsv => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
const reais = (cents: number | null | undefined) => (cents === null || cents === undefined ? null : cents / 100);
const linhas = (rows: ValorCsv[][]) => BOM_CSV + rows.map((r) => r.map(duasCasas).map(celulaCsvCompacta).join(';')).join('\n') + '\n';

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
