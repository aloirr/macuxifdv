'use client';

/**
 * BKO de trade (T-0056, RF-PRO-12): share × meta por loja/categoria e ruptura do mix por loja, no escopo de quem lê
 * (a API filtra equipe e carteira, RN-CORE-04). Filtros na URL e exportação CSV. Só leitura: a proteção real é na API;
 * a página só aparece para supervisor, gerente, analista e admin (shell). RN-PRO-01: nada de pedido.
 * Só entram coletas de visitas que contam (permanência mínima, RN-PRO-07).
 */
import { api, downloadBlob, errorMessage, useSession } from '@macuxi/platform-sdk/web';
import { Badge, Button, DEFAULT_TZ, ErrorBlock, formatDateTime, KpiCard, KpiGrid, LoadingBlock, Notice, PageHeader, Panel, td, tdNum, th, thNum } from '@macuxi/ui/web';
import { useCallback, useEffect, useState } from 'react';
import { RelatorioRupturaApi, RelatorioShareApi } from '../../contracts';
import { ROTULO_SITUACAO_SHARE, rupturaCsv, shareCsv } from '../lib/csv';
import { lerFiltrosTrade, paraBuscaTrade, paraQueryTrade, type FiltrosTrade } from '../lib/filtros';

type Estado<T> = { situacao: 'carregando' } | { situacao: 'erro'; mensagem: string } | { situacao: 'ok'; dados: T };

function useRelatorio<T>(caminho: string, parse: (x: unknown) => T, filtros: FiltrosTrade): [Estado<T>, () => void] {
  const autenticado = useSession().status === 'authenticated';
  const [estado, setEstado] = useState<Estado<T>>({ situacao: 'carregando' });
  const [versao, setVersao] = useState(0);
  useEffect(() => {
    if (!autenticado) return undefined;
    const ctrl = new AbortController();
    setEstado({ situacao: 'carregando' });
    api<unknown>(caminho, { query: paraQueryTrade(filtros), signal: ctrl.signal })
      .then((x) => setEstado({ situacao: 'ok', dados: parse(x) }))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setEstado({ situacao: 'erro', mensagem: errorMessage(e) });
      });
    return () => ctrl.abort();
  }, [autenticado, caminho, parse, filtros, versao]);
  return [estado, () => setVersao((v) => v + 1)];
}

const pct = (n: number | null) => (n === null ? '—' : `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`);
const parseShare = (x: unknown) => RelatorioShareApi.parse(x);
const parseRuptura = (x: unknown) => RelatorioRupturaApi.parse(x);

function useFiltrosNaUrl(): [FiltrosTrade, (f: FiltrosTrade) => void] {
  const [filtros, setFiltros] = useState<FiltrosTrade>(() => lerFiltrosTrade(typeof window === 'undefined' ? '' : window.location.search));
  useEffect(() => {
    const voltar = () => setFiltros(lerFiltrosTrade(window.location.search));
    window.addEventListener('popstate', voltar);
    return () => window.removeEventListener('popstate', voltar);
  }, []);
  const mudar = useCallback((f: FiltrosTrade) => {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${paraBuscaTrade(f)}`);
    setFiltros(f);
  }, []);
  return [filtros, mudar];
}

export function TradePage() {
  const fuso = useSession<{ fuso?: string }>().user?.fuso ?? DEFAULT_TZ;
  const [filtros, setFiltros] = useFiltrosNaUrl();
  const [share, recarregarShare] = useRelatorio('/promotor/relatorios/share', parseShare, filtros);
  const [ruptura, recarregarRuptura] = useRelatorio('/promotor/relatorios/ruptura', parseRuptura, filtros);
  const periodo = share.situacao === 'ok' ? `${share.dados.de.split('-').reverse().join('/')} a ${share.dados.ate.split('-').reverse().join('/')}` : '';

  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-5" data-testid="trade.tela">
      <PageHeader title="Trade marketing" subtitle={`Share de gôndola × meta e ruptura do mix por loja${periodo ? ` · ${periodo}` : ''}.`} />
      <Panel label="Filtros">
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => e.preventDefault()}>
          <label className="flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2">
            De
            <input type="date" data-testid="trade.filtro.de" className="h-[38px] rounded-[10px] border border-field bg-surface px-2.5 text-[14px]" value={filtros.de ?? ''} onChange={(e) => setFiltros({ ...filtros, de: e.target.value || undefined })} />
          </label>
          <label className="flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2">
            Até
            <input type="date" data-testid="trade.filtro.ate" className="h-[38px] rounded-[10px] border border-field bg-surface px-2.5 text-[14px]" value={filtros.ate ?? ''} onChange={(e) => setFiltros({ ...filtros, ate: e.target.value || undefined })} />
          </label>
          {(filtros.de || filtros.ate || filtros.cliente_id) && (
            <Button type="button" size="sm" onClick={() => setFiltros({})}>
              Últimos 30 dias
            </Button>
          )}
        </form>
        <span className="text-[12px] text-ink-2">Só entram as visitas com a permanência mínima na loja; visitas curtas e abertas ficam de fora.</span>
      </Panel>

      <Panel
        label="Share × meta"
        title="Share de gôndola × meta"
        aside={
          share.situacao === 'ok' && share.dados.linhas.length > 0 ? (
            <Button size="sm" data-testid="trade.share.csv" onClick={() => downloadBlob(new Blob([shareCsv(share.dados)], { type: 'text/csv;charset=utf-8' }), 'share-x-meta.csv')}>
              Exportar CSV
            </Button>
          ) : undefined
        }
      >
        {share.situacao === 'carregando' && <LoadingBlock label="Carregando o share…" />}
        {share.situacao === 'erro' && <ErrorBlock message={share.mensagem} onRetry={recarregarShare} />}
        {share.situacao === 'ok' && (
          <>
            <KpiGrid>
              <KpiCard label="Share médio" value={pct(share.dados.resumo.share_medio_pct)} sub={`${share.dados.resumo.categorias_medidas} categoria(s) medida(s)`} />
              <KpiCard label="Meta média" value={pct(share.dados.resumo.meta_media_pct)} />
              <KpiCard label="Atingimento" value={pct(share.dados.resumo.atingimento_pct)} dark />
            </KpiGrid>
            {share.dados.linhas.length === 0 ? (
              <Notice tone="info">Nenhuma medição de share no período.</Notice>
            ) : (
              <table className="w-full border-collapse text-[13px]" data-testid="trade.share.tabela">
                <thead>
                  <tr>
                    <th scope="col" className={th}>Loja</th>
                    <th scope="col" className={th}>Categoria</th>
                    <th scope="col" className={thNum}>Share</th>
                    <th scope="col" className={thNum}>Meta</th>
                    <th scope="col" className={thNum}>Atingimento</th>
                    <th scope="col" className={th}>Situação</th>
                    <th scope="col" className={th}>Medido em</th>
                  </tr>
                </thead>
                <tbody>
                  {share.dados.linhas.map((l) => (
                    <tr key={`${l.cliente_id}-${l.categoria_gondola_id}`}>
                      <td className={td}>
                        <button type="button" className="text-left font-semibold text-accent-ink underline-offset-2 hover:underline" onClick={() => setFiltros({ ...filtros, cliente_id: l.cliente_id })}>
                          {l.cliente_nome ?? 'Loja sem cadastro'}
                        </button>
                      </td>
                      <td className={td}>{l.categoria_nome ?? 'Categoria sem cadastro'}</td>
                      <td className={tdNum}>{pct(l.share_pct)}</td>
                      <td className={tdNum}>{pct(l.meta_pct)}</td>
                      <td className={tdNum}>{pct(l.atingimento_pct)}</td>
                      <td className={td}>
                        <Badge tone={l.situacao === 'atingiu' ? 'success' : l.situacao === 'abaixo' ? 'danger' : 'neutral'}>{ROTULO_SITUACAO_SHARE[l.situacao]}</Badge>
                      </td>
                      <td className={`${td} whitespace-nowrap text-ink-2`}>{formatDateTime(l.medido_em, fuso)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </Panel>

      <Panel
        label="Ruptura por loja"
        title="Ruptura do mix por loja"
        aside={
          ruptura.situacao === 'ok' && ruptura.dados.linhas.length > 0 ? (
            <Button size="sm" data-testid="trade.ruptura.csv" onClick={() => downloadBlob(new Blob([rupturaCsv(ruptura.dados)], { type: 'text/csv;charset=utf-8' }), 'ruptura-por-loja.csv')}>
              Exportar CSV
            </Button>
          ) : undefined
        }
      >
        {ruptura.situacao === 'carregando' && <LoadingBlock label="Carregando a ruptura…" />}
        {ruptura.situacao === 'erro' && <ErrorBlock message={ruptura.mensagem} onRetry={recarregarRuptura} />}
        {ruptura.situacao === 'ok' &&
          (ruptura.dados.linhas.length === 0 ? (
            <Notice tone="info">Nenhuma conferência do mix no período.</Notice>
          ) : (
            <table className="w-full border-collapse text-[13px]" data-testid="trade.ruptura.tabela">
              <thead>
                <tr>
                  <th scope="col" className={th}>Loja</th>
                  <th scope="col" className={thNum}>Itens do mix</th>
                  <th scope="col" className={thNum}>Ruptura</th>
                  <th scope="col" className={thNum}>Falha de reposição</th>
                  <th scope="col" className={thNum}>Ruptura total</th>
                  <th scope="col" className={thNum}>Repostos (un.)</th>
                  <th scope="col" className={th}>Última visita</th>
                </tr>
              </thead>
              <tbody>
                {ruptura.dados.linhas.map((l) => (
                  <tr key={l.cliente_id}>
                    <td className={td}>{l.cliente_nome ?? 'Loja sem cadastro'}</td>
                    <td className={tdNum}>{l.total}</td>
                    <td className={tdNum}>{pct(l.ruptura_pct)}</td>
                    <td className={tdNum}>{pct(l.falha_reposicao_pct)}</td>
                    <td className={tdNum}>{pct(l.ruptura_total_pct)}</td>
                    <td className={tdNum}>{l.quantidade_reposta}</td>
                    <td className={`${td} whitespace-nowrap text-ink-2`}>{formatDateTime(l.checkin_em, fuso)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ))}
      </Panel>
    </div>
  );
}

export default TradePage;
