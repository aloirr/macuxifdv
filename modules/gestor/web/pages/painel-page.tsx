'use client';

/**
 * Painel da equipe no BKO (RF-GES-01/02/10): resumo do dia, equipes abaixo (gerente) e a tabela de cada vendedor e
 * promotor do escopo. Data na URL; exporta CSV. Supervisor/gerente veem a equipe; analista/admin, o tenant em leitura
 * (RN-GES-07). O escopo é aplicado pela API (RN-CORE-04).
 */
import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { formatBRL0 } from '@macuxi/comum';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, FilterBar, KpiCard, KpiGrid, LoadingBlock, PageHeader, Panel, TableScroll, td, tdNum, th, thNum, type BadgeTone } from '@macuxi/ui/web';
import type { StatusDia } from '../../contracts';
import { STATUS_DIA_ROTULO } from '../../app/lib/apresentacao';
import { csvDaEquipe } from '../lib/csv';
import { lerFiltrosPainel, paraQuery } from '../lib/filtros';
import { useVisaoEquipe } from '../lib/queries';

const TOM: Record<StatusDia, BadgeTone> = { em_visita: 'success', em_rota: 'pending', sem_checkin: 'warning' };
const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v)}%`);
const brl = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatBRL0(v));

function Conteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const f = lerFiltrosPainel(params);
  const q = useVisaoEquipe(f);
  const v = q.data;
  return (
    <div className="flex flex-col gap-4" data-testid="gestor.painel">
      <PageHeader
        title="Painel da equipe"
        subtitle={v ? `Dia ${v.data} · ${v.membros.length} pessoas de campo` : 'Quem está em visita, vendas e cobertura do dia'}
        actions={
          <Button disabled={!v} onClick={() => v && downloadBlob(new Blob([csvDaEquipe(v)], { type: 'text/csv;charset=utf-8' }), `equipe-${v.data}.csv`)}>
            Exportar CSV
          </Button>
        }
      />
      <FilterBar>
        <label className="flex flex-col gap-1 text-[12px] text-ink-2">
          Dia
          <input
            type="date"
            className="rounded-lg border border-line px-2 py-1.5 text-[14px]"
            value={f.data ?? v?.data ?? ''}
            onChange={(e) => router.replace(`${pathname}?${new URLSearchParams(paraQuery({ data: e.target.value || null }))}`)}
          />
        </label>
      </FilterBar>
      {q.isLoading ? <LoadingBlock label="Carregando o painel da equipe…" /> : null}
      {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
      {v ? (
        <>
          <KpiGrid>
            <KpiCard label="Em visita" value={v.resumo.em_visita} sub={`${v.resumo.em_rota} em rota · ${v.resumo.sem_checkin} sem check-in`} />
            <KpiCard label="Vendas do dia" value={brl(v.resumo.vendas_cents)} sub={`${v.resumo.pedidos ?? 0} pedidos`} />
            <KpiCard label="Cobertura da rota" value={pct(v.resumo.cobertura_pct)} sub={`${v.resumo.visitas_planejadas_realizadas} de ${v.resumo.visitas_planejadas} planejadas`} />
            <KpiCard label="Meta do mês" value={pct(v.resumo.atingimento_pct)} sub={v.resumo.meta_cents === null ? 'sem meta' : `meta ${brl(v.resumo.meta_cents)}`} />
            <KpiCard label="A faturar" value={brl(v.resumo.a_faturar_cents)} sub={`faturado ${brl(v.resumo.faturado_cents)}`} />
          </KpiGrid>
          {v.equipes.length > 0 ? (
            <Panel title="Equipes">
              <TableScroll minWidth={560}>
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>Equipe</th>
                      <th className={thNum}>Pessoas</th>
                      <th className={thNum}>Em visita</th>
                      <th className={thNum}>Vendas</th>
                      <th className={thNum}>Cobertura</th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.equipes.map((e, i) => (
                      <tr key={e.gestor_id}>
                        <td className={td}>{v.gestores[i]?.nome ?? 'Equipe'}</td>
                        <td className={tdNum}>{e.membros}</td>
                        <td className={tdNum}>{e.em_visita}</td>
                        <td className={tdNum}>{brl(e.vendas_cents)}</td>
                        <td className={tdNum}>{pct(e.cobertura_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Panel>
          ) : null}
          <Panel title="Pessoas de campo">
            <TableScroll minWidth={880}>
              <table className="w-full border-collapse text-[13px]" data-testid="gestor.painel.tabela">
                <thead>
                  <tr>
                    <th className={th}>Nome</th>
                    <th className={th}>Perfil</th>
                    <th className={th}>Situação</th>
                    <th className={thNum}>Visitas</th>
                    <th className={thNum}>Cobertura</th>
                    <th className={thNum}>Vendas</th>
                    <th className={thNum}>Pedidos</th>
                    <th className={thNum}>A faturar</th>
                    <th className={thNum}>Lojas</th>
                    <th className={thNum}>Gôndola</th>
                  </tr>
                </thead>
                <tbody>
                  {v.membros.length === 0 ? (
                    <tr>
                      <td className={td} colSpan={10}>
                        Ninguém da equipe aparece neste dia.
                      </td>
                    </tr>
                  ) : null}
                  {v.membros.map(({ membro: m, painel: p }) => (
                    <tr key={m.id}>
                      <td className={td}>{m.nome}</td>
                      <td className={td}>{m.perfil === 'promotor' ? 'Promotor' : 'Vendedor'}</td>
                      <td className={td}>
                        <Badge tone={TOM[p.status_dia]}>{STATUS_DIA_ROTULO[p.status_dia].label}</Badge>
                      </td>
                      <td className={tdNum}>
                        {p.visitas.realizadas}/{p.visitas.planejadas}
                      </td>
                      <td className={tdNum}>{pct(p.visitas.cobertura_pct)}</td>
                      <td className={tdNum}>{brl(p.vendas?.vendas_cents)}</td>
                      <td className={tdNum}>{p.vendas?.pedidos ?? '—'}</td>
                      <td className={tdNum}>{brl(p.faturamento?.a_faturar_cents)}</td>
                      <td className={tdNum}>{p.trade?.lojas_visitadas ?? '—'}</td>
                      <td className={tdNum}>{p.trade ? pct(p.trade.conformidade_pct) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
        </>
      ) : null}
    </div>
  );
}

export function PainelEquipePage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando o painel da equipe…" />}>
      <Conteudo />
    </Suspense>
  );
}
