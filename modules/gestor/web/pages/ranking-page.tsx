'use client';

/** Ranking da equipe no BKO (RF-GES-03): indicador, período e data na URL; desempate total do domain; exporta CSV. */
import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { formatBRL0 } from '@macuxi/comum';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, FilterBar, LoadingBlock, PageHeader, Panel, SelectField, TableScroll, td, tdNum, th, thNum } from '@macuxi/ui/web';
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
        title="Ranking da equipe"
        subtitle={r ? `${INDICADOR_ROTULO[r.indicador]} · ${r.inicio === r.fim ? r.inicio : `${r.inicio} a ${r.fim}`}` : 'Quem lidera cada indicador no período'}
        actions={
          <Button disabled={!r} onClick={() => r && downloadBlob(new Blob([csvDoRanking(r)], { type: 'text/csv;charset=utf-8' }), `ranking-${r.indicador}-${r.inicio}.csv`)}>
            Exportar CSV
          </Button>
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
        <Panel title={`${r.linhas.length} pessoas`}>
          <TableScroll minWidth={520}>
            <table className="w-full border-collapse text-[13px]" data-testid="gestor.ranking.tabela">
              <thead>
                <tr>
                  <th className={thNum}>#</th>
                  <th className={th}>Nome</th>
                  <th className={th}>Perfil</th>
                  <th className={thNum}>{INDICADOR_ROTULO[r.indicador]}</th>
                </tr>
              </thead>
              <tbody>
                {r.linhas.length === 0 ? (
                  <tr>
                    <td className={td} colSpan={4}>
                      Sem dados para este indicador (módulo desativado ou ninguém no período).
                    </td>
                  </tr>
                ) : null}
                {r.linhas.map((l) => (
                  <tr key={l.usuario_id}>
                    <td className={tdNum}>{l.posicao ?? '—'}</td>
                    <td className={td}>{l.nome}</td>
                    <td className={td}>{l.perfil === 'promotor' ? 'Promotor' : 'Vendedor'}</td>
                    <td className={tdNum}>{valorDoIndicador(r.indicador, l.valor, formatBRL0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
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
