'use client';

/**
 * Painel da equipe no BKO (RF-GES-01/02/10): resumo do dia, equipes abaixo (gerente) e a tabela de cada vendedor e
 * promotor do escopo. Data na URL; exporta CSV. Supervisor/gerente veem a equipe; analista/admin, o tenant em leitura
 * (RN-GES-07). O escopo é aplicado pela API (RN-CORE-04).
 */
import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { formatBRL0 } from '@macuxi/comum';
import { ROTULO_INDICADOR_META } from '@macuxi/core/contracts';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { ErrorBlock, EstadoVazio, FilterBar, KpiCard, KpiGrid, LoadingBlock, MenuAcoes, PageHeader, Panel, rotuloComContagem, SeloSituacao, TabelaDados, TextField, type BadgeTone } from '@macuxi/ui/web';
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
        title={rotuloComContagem('Painel da equipe', v?.membros.length ?? 0)}
        actions={
          <MenuAcoes
            acoes={[
              { id: 'csv', rotulo: 'Exportar CSV', desligada: !v, aoEscolher: () => v && downloadBlob(new Blob([csvDaEquipe(v)], { type: 'text/csv;charset=utf-8' }), `equipe-${v.data}.csv`) },
              { id: 'atualizar', rotulo: q.isFetching ? 'Atualizando…' : 'Atualizar', desligada: q.isFetching, aoEscolher: () => void q.refetch() },
            ]}
          />
        }
      />
      <FilterBar>
        <TextField
          label="Dia"
          type="date"
          value={f.data ?? v?.data ?? ''}
          onChange={(e) => router.replace(`${pathname}?${new URLSearchParams(paraQuery({ data: e.target.value || null }))}`)}
        />
      </FilterBar>
      {q.isLoading ? <LoadingBlock label="Carregando o painel da equipe…" /> : null}
      {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
      {v ? (
        <>
          <KpiGrid>
            <KpiCard label="Em visita" value={v.resumo.em_visita} sub={`${v.resumo.em_rota} em rota · ${v.resumo.sem_checkin} sem check-in`} />
            <KpiCard label="Vendas do dia" value={brl(v.resumo.vendas_cents)} sub={`${v.resumo.pedidos ?? 0} pedidos`} />
            <KpiCard label={ROTULO_INDICADOR_META.cobertura_pct} value={pct(v.resumo.cobertura_pct)} sub={`${v.resumo.visitas_planejadas_realizadas} de ${v.resumo.visitas_planejadas} planejadas`} />
            <KpiCard label="Meta do mês" value={pct(v.resumo.atingimento_pct)} sub={v.resumo.meta_cents === null ? 'sem meta' : `meta ${brl(v.resumo.meta_cents)}`} />
            <KpiCard label="A faturar" value={brl(v.resumo.a_faturar_cents)} sub={`faturado ${brl(v.resumo.faturado_cents)}`} />
          </KpiGrid>
          {v.equipes.length > 0 ? (
            <Panel title={rotuloComContagem('Equipes', v.equipes.length)}>
              <TabelaDados
                rotulo="Equipes"
                testId="gestor.painel.equipes"
                linhas={v.equipes.map((e, i) => ({ e, nome: v.gestores[i]?.nome ?? 'Equipe' }))}
                chave={({ e }) => e.gestor_id}
                colunas={[
                  { id: 'equipe', titulo: 'Equipe', celula: ({ nome }) => nome, texto: ({ nome }) => nome },
                  { id: 'pessoas', titulo: 'Pessoas', numero: true, prioridade: 2, largura: '100px', celula: ({ e }) => e.membros },
                  { id: 'em_visita', titulo: 'Em visita', numero: true, largura: '110px', celula: ({ e }) => e.em_visita },
                  { id: 'vendas', titulo: 'Vendas', numero: true, largura: '130px', celula: ({ e }) => brl(e.vendas_cents) },
                  { id: 'cobertura', titulo: 'Cobertura', numero: true, prioridade: 2, largura: '110px', celula: ({ e }) => pct(e.cobertura_pct) },
                ]}
              />
            </Panel>
          ) : null}
          {v.membros.length === 0 ? (
            <EstadoVazio titulo="Ninguém da equipe aparece neste dia." testId="gestor.painel.vazio" />
          ) : (
            <Panel>
              <TabelaDados
                rotulo="Pessoas de campo"
                testId="gestor.painel.tabela"
                linhas={v.membros}
                chave={({ membro }) => membro.id}
                colunas={[
                  { id: 'nome', titulo: 'Nome', celula: ({ membro }) => membro.nome, texto: ({ membro }) => membro.nome },
                  { id: 'perfil', titulo: 'Perfil', prioridade: 3, largura: '100px', celula: ({ membro }) => (membro.perfil === 'promotor' ? 'Promotor' : 'Vendedor') },
                  { id: 'situacao', titulo: 'Situação', largura: '130px', celula: ({ painel: p }) => <SeloSituacao selos={[{ tom: TOM[p.status_dia], texto: STATUS_DIA_ROTULO[p.status_dia].label }]} /> },
                  { id: 'visitas', titulo: 'Visitas', numero: true, largura: '80px', celula: ({ painel: p }) => `${p.visitas.realizadas}/${p.visitas.planejadas}` },
                  { id: 'cobertura', titulo: 'Cobertura', numero: true, prioridade: 2, largura: '95px', celula: ({ painel: p }) => pct(p.visitas.cobertura_pct) },
                  { id: 'vendas', titulo: 'Vendas', numero: true, largura: '110px', celula: ({ painel: p }) => brl(p.vendas?.vendas_cents) },
                  { id: 'pedidos', titulo: 'Pedidos', numero: true, prioridade: 2, largura: '80px', celula: ({ painel: p }) => p.vendas?.pedidos ?? '—' },
                  { id: 'a_faturar', titulo: 'A faturar', numero: true, prioridade: 3, largura: '110px', celula: ({ painel: p }) => brl(p.faturamento?.a_faturar_cents) },
                  { id: 'lojas', titulo: 'Lojas', numero: true, prioridade: 3, largura: '70px', celula: ({ painel: p }) => p.trade?.lojas_visitadas ?? '—' },
                  { id: 'gondola', titulo: 'Gôndola', numero: true, prioridade: 3, largura: '90px', celula: ({ painel: p }) => (p.trade ? pct(p.trade.conformidade_pct) : '—') },
                ]}
              />
            </Panel>
          )}
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
