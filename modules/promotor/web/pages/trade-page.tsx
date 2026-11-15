'use client';

/**
 * BKO de trade (T-0056, RF-PRO-12; revisão do BKO T-0173, §P1 a §P9): share × meta por loja/categoria e ruptura do mix por
 * loja, no escopo de quem lê (a API filtra equipe e carteira, RN-CORE-04) e só com visitas que contam (permanência mínima,
 * RN-PRO-07). Período e loja na URL; "Mais ações" exporta CSV e atualiza. Só leitura: a proteção real é na API; a página
 * só aparece para supervisor, gerente, analista e admin (shell). RN-PRO-01: nada de pedido.
 */
import { api, downloadBlob, errorMessage, useSession } from '@macuxi/platform-sdk/web';
import { Button, DEFAULT_TZ, ErrorBlock, EstadoVazio, FilterBar, formatDateTime, KpiCard, KpiGrid, LoadingBlock, MenuAcoes, PageHeader, Panel, rotuloComContagem, SeloSituacao, TabelaDados, TextField, type AcaoDoMenu, type ColunaDaTabela } from '@macuxi/ui/web';
import { useCallback, useEffect, useState } from 'react';
import { RelatorioRupturaApi, RelatorioShareApi, type RelatorioRupturaApi as RelatorioRuptura, type RelatorioShareApi as RelatorioShare } from '../../contracts';
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

type LinhaShare = RelatorioShare['linhas'][number];
type LinhaRuptura = RelatorioRuptura['linhas'][number];

export function TradePage() {
  const fuso = useSession<{ fuso?: string }>().user?.fuso ?? DEFAULT_TZ;
  const [filtros, setFiltros] = useFiltrosNaUrl();
  const [share, recarregarShare] = useRelatorio('/promotor/relatorios/share', parseShare, filtros);
  const [ruptura, recarregarRuptura] = useRelatorio('/promotor/relatorios/ruptura', parseRuptura, filtros);
  const comFiltro = !!(filtros.de || filtros.ate || filtros.cliente_id);
  const linhasShare = share.situacao === 'ok' ? share.dados.linhas : [];
  const linhasRuptura = ruptura.situacao === 'ok' ? ruptura.dados.linhas : [];
  const loja = (nome: string | null) => nome ?? 'Loja sem cadastro';
  const dataHora = (iso: string) => formatDateTime(iso, fuso);

  const maisAcoes: AcaoDoMenu[] = [
    ...(share.situacao === 'ok' && linhasShare.length > 0
      ? [{ id: 'csv-share', rotulo: 'Exportar CSV do share', testId: 'trade.share.csv', aoEscolher: () => downloadBlob(new Blob([shareCsv(share.dados)], { type: 'text/csv;charset=utf-8' }), 'share-x-meta.csv') }]
      : []),
    ...(ruptura.situacao === 'ok' && linhasRuptura.length > 0
      ? [{ id: 'csv-ruptura', rotulo: 'Exportar CSV da ruptura', testId: 'trade.ruptura.csv', aoEscolher: () => downloadBlob(new Blob([rupturaCsv(ruptura.dados)], { type: 'text/csv;charset=utf-8' }), 'ruptura-por-loja.csv') }]
      : []),
    { id: 'atualizar', rotulo: 'Atualizar', aoEscolher: () => { recarregarShare(); recarregarRuptura(); } },
  ];

  const colunasShare: ColunaDaTabela<LinhaShare>[] = [
    { id: 'loja', titulo: 'Loja', celula: (l) => loja(l.cliente_nome), texto: (l) => loja(l.cliente_nome) },
    { id: 'categoria', titulo: 'Categoria', celula: (l) => l.categoria_nome ?? 'Categoria sem cadastro', texto: (l) => l.categoria_nome ?? 'Categoria sem cadastro' },
    { id: 'share', titulo: 'Share', numero: true, prioridade: 2, celula: (l) => pct(l.share_pct) },
    { id: 'meta', titulo: 'Meta', numero: true, prioridade: 2, celula: (l) => pct(l.meta_pct) },
    { id: 'atingimento', titulo: 'Atingimento', numero: true, celula: (l) => pct(l.atingimento_pct) },
    { id: 'situacao', titulo: 'Situação', celula: (l) => <SeloSituacao selos={[{ tom: l.situacao === 'atingiu' ? 'success' : l.situacao === 'abaixo' ? 'danger' : 'neutral', texto: ROTULO_SITUACAO_SHARE[l.situacao] }]} /> },
    { id: 'medido', titulo: 'Medido em', prioridade: 3, celula: (l) => dataHora(l.medido_em), texto: (l) => dataHora(l.medido_em), largura: '150px' },
  ];
  const colunasRuptura: ColunaDaTabela<LinhaRuptura>[] = [
    { id: 'loja', titulo: 'Loja', celula: (l) => loja(l.cliente_nome), texto: (l) => loja(l.cliente_nome) },
    { id: 'total', titulo: 'Itens do mix', numero: true, prioridade: 2, celula: (l) => l.total },
    { id: 'ruptura', titulo: 'Ruptura', numero: true, celula: (l) => pct(l.ruptura_pct) },
    { id: 'falha', titulo: 'Falha de reposição', numero: true, prioridade: 2, celula: (l) => pct(l.falha_reposicao_pct) },
    { id: 'total_pct', titulo: 'Ruptura total', numero: true, celula: (l) => pct(l.ruptura_total_pct) },
    { id: 'repostos', titulo: 'Repostos (un.)', numero: true, prioridade: 3, celula: (l) => l.quantidade_reposta },
    { id: 'visita', titulo: 'Última visita', prioridade: 3, celula: (l) => dataHora(l.checkin_em), texto: (l) => dataHora(l.checkin_em), largura: '150px' },
  ];

  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-5" data-testid="trade.tela">
      <PageHeader title="Trade marketing" actions={<MenuAcoes rotulo="Mais ações" acoes={maisAcoes} testId="trade.mais-acoes" />} />
      <FilterBar>
        <TextField label="De" type="date" data-testid="trade.filtro.de" value={filtros.de ?? ''} onChange={(e) => setFiltros({ ...filtros, de: e.target.value || undefined })} />
        <TextField label="Até" type="date" data-testid="trade.filtro.ate" value={filtros.ate ?? ''} onChange={(e) => setFiltros({ ...filtros, ate: e.target.value || undefined })} />
        {comFiltro && (
          <Button type="button" size="sm" onClick={() => setFiltros({})}>
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      <Panel label="Share × meta" title={rotuloComContagem('Share de gôndola × meta', linhasShare.length)}>
        {share.situacao === 'carregando' && <LoadingBlock label="Carregando o share…" />}
        {share.situacao === 'erro' && <ErrorBlock message={share.mensagem} onRetry={recarregarShare} />}
        {share.situacao === 'ok' && (
          <>
            <KpiGrid>
              <KpiCard label="Share médio" value={pct(share.dados.resumo.share_medio_pct)} />
              <KpiCard label="Meta média" value={pct(share.dados.resumo.meta_media_pct)} />
              <KpiCard label="Atingimento" value={pct(share.dados.resumo.atingimento_pct)} dark />
            </KpiGrid>
            <TabelaDados
              rotulo="Share de gôndola × meta"
              testId="trade.share.tabela"
              colunas={colunasShare}
              linhas={linhasShare}
              chave={(l) => `${l.cliente_id}-${l.categoria_gondola_id}`}
              aoAbrir={(l) => setFiltros({ ...filtros, cliente_id: l.cliente_id })}
              vazio={<EstadoVazio titulo="Nenhuma medição de share no período." />}
            />
          </>
        )}
      </Panel>

      <Panel label="Ruptura por loja" title={rotuloComContagem('Ruptura do mix por loja', linhasRuptura.length)}>
        {ruptura.situacao === 'carregando' && <LoadingBlock label="Carregando a ruptura…" />}
        {ruptura.situacao === 'erro' && <ErrorBlock message={ruptura.mensagem} onRetry={recarregarRuptura} />}
        {ruptura.situacao === 'ok' && (
          <TabelaDados
            rotulo="Ruptura do mix por loja"
            testId="trade.ruptura.tabela"
            colunas={colunasRuptura}
            linhas={linhasRuptura}
            chave={(l) => l.cliente_id}
            vazio={<EstadoVazio titulo="Nenhuma conferência do mix no período." />}
          />
        )}
      </Panel>
    </div>
  );
}

export default TradePage;
