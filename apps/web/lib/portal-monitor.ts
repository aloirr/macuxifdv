/**
 * Seção "Monitor" da aba Integração da empresa no portal `config.` (desenho docs/desenho/empresa-zerar.md §6.4; só o time da Macuxi):
 * o cliente HTTP que o painel do módulo (`MonitorPainel` de `@macuxi/integracao/web`) usa no portal e o texto das células do detalhe
 * por Conector e por entidade (`MonitorDetalhes`). Funções puras; a regra (reprocessável, saúde, classe do erro) vem pronta da API.
 */
import type { ClienteIntegracao } from '@macuxi/integracao/web';
import type { ConectorDetalhe, EntidadeDetalhe } from '@macuxi/integracao/contracts';
import { ENTIDADES_ZERAR, type EntidadeZerar } from '@macuxi/platform-sdk';
import { formatDateTime, formatInt, type BadgeTone } from '@macuxi/ui/web';

import { chamarPortal, type OpcoesChamada } from './portal-api';

/** O portal atualiza o monitor a cada 15 min (o mesmo piso do `sync_auto_min`); depois de reprocessar ou zerar, na hora. */
export const INTERVALO_MONITOR_PORTAL_MS = 15 * 60_000;

/** Escopo do cache do painel no portal: um por empresa, para não misturar tenants. */
export const escopoDoPortal = (tenant: string) => `portal:${tenant}`;

type Chamar = <T>(caminho: string, o: OpcoesChamada<T>) => Promise<T>;

/** Cliente do painel no portal: `chamarPortal` com a sessão do super-admin e o tenant no `x-macuxi-tenant` (ADR 0029 §5). */
export function clienteDoPortal(tenant: string, ativo: boolean, chamar: Chamar = chamarPortal): ClienteIntegracao {
  return {
    chamar: <T>(caminho: string, o?: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown; query?: Record<string, string | number | undefined> }) =>
      chamar<T>(caminho, { metodo: o?.method, corpo: o?.body, query: o?.query, tenant }),
    escopo: escopoDoPortal(tenant),
    ativo,
    intervaloMs: INTERVALO_MONITOR_PORTAL_MS,
  };
}

/** Entidade que o "Zerar dados" aceita (as 16 do Hub). */
export const ehEntidadeZerar = (e: string): e is EntidadeZerar => (ENTIDADES_ZERAR as readonly string[]).includes(e);

/** A entidade tem algo no Hub para zerar: registro, lote ou cursor. */
export const temDadosNoHub = (d: EntidadeDetalhe): boolean => d.registros.ativos + d.registros.inativos > 0 || d.ultimo_lote !== null || d.cursores.length > 0;

/** "1.180 ativos · 60 inativos"; sem registro, "—". */
export function textoRegistros(r: EntidadeDetalhe['registros']): string {
  if (r.ativos + r.inativos === 0) return '—';
  return r.inativos > 0 ? `${formatInt(r.ativos)} ativos · ${formatInt(r.inativos)} inativos` : `${formatInt(r.ativos)} ativos`;
}

/** Cursor do delta: a alteração mais recente que algum Conector já mandou, no fuso da empresa; sem cursor, "—". */
export function textoCursor(cursores: EntidadeDetalhe['cursores'], tz: string): string {
  const datas = cursores.map((c) => c.alterado_em).filter((x): x is string => !!x).sort();
  return datas.length ? formatDateTime(datas[datas.length - 1], tz) : '—';
}

/**
 * Coluna "Corrigir no ERP": só a classe `corrigir_no_erp`, "3 · campo_obrigatorio"; sem erro dessa classe, "—". Os erros a
 * reprocessar ficam só no painel (selo "Com falha" e Reprocessar), revisão v1.0.31 R2-4.
 */
export function textoCorrigirNoErp(erros: EntidadeDetalhe['erros']): string {
  const daClasse = erros.filter((e) => e.classe === 'corrigir_no_erp');
  const linhas = daClasse.reduce((a, e) => a + e.linhas, 0);
  if (linhas === 0) return '—';
  return `${formatInt(linhas)} · ${[...new Set(daClasse.map((e) => e.codigo))].join(', ')}`;
}

/** Estado vazio da linha de "Dados no Hub" (RD-2678): uma célula só diz que não há dados. */
export const TEXTO_SEM_DADOS = 'Sem dados';

/**
 * Células de uma linha de "Dados no Hub": Registros, Última alteração e Corrigir no ERP. Sem nada no Hub (`temDadosNoHub`),
 * "Sem dados" em Registros e as outras duas vazias; com dados, o "—" fica para "sem registro", "sem cursor" e "sem erro".
 */
export function celulasDaEntidade(d: EntidadeDetalhe, tz: string): { registros: string; cursor: string; corrigir: string } {
  if (!temDadosNoHub(d)) return { registros: TEXTO_SEM_DADOS, cursor: '', corrigir: '' };
  return { registros: textoRegistros(d.registros), cursor: textoCursor(d.cursores, tz), corrigir: textoCorrigirNoErp(d.erros) };
}

/** Saúde do Conector (`avaliarSaudeConector` da API): rótulo e tom do selo. */
export const SAUDE_DO_CONECTOR: Readonly<Record<ConectorDetalhe['saude'], { rotulo: string; tom: BadgeTone }>> = Object.freeze({
  ok: { rotulo: 'Em dia', tom: 'success' },
  atrasado: { rotulo: 'Atrasado', tom: 'warning' },
  sem_sinal: { rotulo: 'Sem sinal', tom: 'danger' },
  parado_por_versao: { rotulo: 'Parado pela versão', tom: 'danger' },
  nunca_conectou: { rotulo: 'Nunca conectou', tom: 'neutral' },
  desativado: { rotulo: 'Desativado', tom: 'neutral' },
});

/** Fila do Conector no último sinal: "2 lotes · 380 linhas", "Vazia" ou "—" (sem sinal). */
export function textoFila(sinal: ConectorDetalhe['sinal']): string {
  if (!sinal) return '—';
  const lotes = sinal.fila.reduce((a, f) => a + f.lotes, 0);
  const linhas = sinal.fila.reduce((a, f) => a + f.linhas, 0);
  if (lotes === 0) return 'Vazia';
  return `${formatInt(lotes)} ${lotes === 1 ? 'lote' : 'lotes'} · ${formatInt(linhas)} ${linhas === 1 ? 'linha' : 'linhas'}`;
}
