'use client';

/** Ranking da equipe no BKO (RF-GES-03): indicador, período e data na URL; desempate total do domain; exporta CSV. */
import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { formatBRL0 } from '@macuxi/comum';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { ErrorBlock, EstadoVazio, FilterBar, LoadingBlock, MenuAcoes, PageHeader, Panel, rotuloComContagem, SelectField, TabelaDados } from '@macuxi/ui/web';
import { INDICADORES_RANKING, PERIODOS_RANKING } from '../../contracts';
import { INDICADOR_ROTULO, PERIODO_ROTULO, valorDoIndicador } from '../../app/lib/apresentacao';
import { csvDoRanking } from '../lib/csv';
import { lerFiltrosRanking, paraQuery, type FiltrosRanking } from '../lib/filtros';
import { useRanking } from '../lib/queries';

function Conteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const f = lerFiltrosRanking(params);
  const q = useRanking(f);
  const r = q.data;
  const mudar = (x: Partial<FiltrosRanking>) => router.replace(`${pathname}?${new URLSearchParams(paraQuery({ ...f, ...x }))}`);
  return (
    <div className="flex flex-col gap-4" data-testid="gestor.ranking">
      <PageHeader
        title={rotuloComContagem('Ranking da equipe', r?.linhas.length ?? 0)}
        badge={r ? <span className="text-sm font-medium text-ink-2">{r.inicio === r.fim ? r.inicio : `${r.inicio} a ${r.fim}`}</span> : undefined}
        actions={
          <MenuAcoes
            acoes={[
              {
                id: 'csv',
                rotulo: 'Exportar CSV',
                desligada: !r,
                aoEscolher: () => r && downloadBlob(new Blob([csvDoRanking(r)], { type: 'text/csv;charset=utf-8' }), `ranking-${r.indicador}-${r.inicio}.csv`),
              },
            ]}
          />
        }
      />
      <FilterBar>
        <SelectField label="Indicador" value={f.indicador} onChange={(e) => mudar({ indicador: e.target.value as FiltrosRanking['indicador'] })}>
          {INDICADORES_RANKING.map((i) => (
            <option key={i} value={i}>
              {INDICADOR_ROTULO[i]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Período" value={f.periodo} onChange={(e) => mudar({ periodo: e.target.value as FiltrosRanking['periodo'] })}>
          {PERIODOS_RANKING.map((p) => (
            <option key={p} value={p}>
              {PERIODO_ROTULO[p]}
            </option>
          ))}
        </SelectField>
      </FilterBar>
      {q.isLoading ? <LoadingBlock label="Calculando o ranking…" /> : null}
      {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
      {r ? (
        r.linhas.length === 0 ? (
          <EstadoVazio titulo="Sem dados para este indicador no período." testId="gestor.ranking.vazio" />
        ) : (
          <Panel>
            <TabelaDados
              rotulo="Ranking da equipe"
              testId="gestor.ranking.tabela"
              linhas={r.linhas}
              chave={(l) => l.usuario_id}
              colunas={[
                { id: 'posicao', titulo: '#', numero: true, largura: '64px', celula: (l) => l.posicao ?? '—' },
                { id: 'nome', titulo: 'Nome', celula: (l) => l.nome, texto: (l) => l.nome },
                { id: 'perfil', titulo: 'Perfil', prioridade: 2, largura: '140px', celula: (l) => (l.perfil === 'promotor' ? 'Promotor' : 'Vendedor') },
                { id: 'valor', titulo: INDICADOR_ROTULO[r.indicador], numero: true, largura: '180px', celula: (l) => valorDoIndicador(r.indicador, l.valor, formatBRL0) },
              ]}
            />
          </Panel>
        )
      ) : null}
    </div>
  );
}

export function RankingPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Calculando o ranking…" />}>
      <Conteudo />
    </Suspense>
  );
}
