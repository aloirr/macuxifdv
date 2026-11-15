'use client';

/**
 * Alertas da equipe no BKO (RF-GES-07): filtro de status na URL; dispensar só para quem tem `alerta_equipe.dispensar`
 * (supervisor e gerente — analista e admin leem, RN-GES-07). A proteção real é na API.
 */
import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { ErrorBlock, EstadoVazio, FilterBar, formatDateTime, LoadingBlock, MenuAcoes, Notice, PageHeader, Panel, rotuloComContagem, SelectField, SeloSituacao, TabelaDados, type BadgeTone, type Selo } from '@macuxi/ui/web';
import { STATUS_ALERTA, type Severidade } from '../../contracts';
import { TIPO_ALERTA_ROTULO } from '../../app/lib/apresentacao';
import { lerFiltrosAlertas, paraQuery } from '../lib/filtros';
import { useAlertas, useDispensarAlerta, useFusoDoTenant, useVisaoEquipe } from '../lib/queries';

const TOM: Record<Severidade, BadgeTone> = { info: 'neutral', atencao: 'warning', critica: 'danger' };
const STATUS_ROTULO = { aberto: 'Abertos', dispensado: 'Dispensados', encerrado: 'Encerrados' } as const;

/** Um selo só (§P5): aberto leva a cor da severidade; dispensado e encerrado ficam neutros. */
function selo(status: 'aberto' | 'dispensado' | 'encerrado', severidade: Severidade): Selo {
  if (status === 'aberto') return { tom: TOM[severidade], texto: 'Aberto' };
  return { tom: 'neutral', texto: status === 'dispensado' ? 'Dispensado' : 'Encerrado' };
}

function Conteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const f = lerFiltrosAlertas(params);
  const q = useAlertas(f);
  const tz = useFusoDoTenant();
  const podeDispensar = usePode('alerta_equipe.dispensar');
  const dispensar = useDispensarAlerta();
  const [erro, setErro] = useState<string | null>(null);
  const nomes = new Map((useVisaoEquipe({ data: null }).data?.membros ?? []).map((m) => [m.membro.id, m.membro.nome]));
  const responsavel = (id: string | null) => (id ? (nomes.get(id) ?? 'Equipe') : '—');
  return (
    <div className="flex flex-col gap-4" data-testid="gestor.alertas">
      <PageHeader
        title={rotuloComContagem('Alertas da equipe', q.data?.itens.length ?? 0)}
        actions={<MenuAcoes acoes={[{ id: 'atualizar', rotulo: q.isFetching ? 'Atualizando…' : 'Atualizar', desligada: q.isFetching, aoEscolher: () => void q.refetch() }]} />}
      />
      <FilterBar>
        <SelectField label="Situação" value={f.status ?? ''} onChange={(e) => router.replace(`${pathname}?${new URLSearchParams(paraQuery({ status: e.target.value || null }))}`)}>
          <option value="">Ativos</option>
          {STATUS_ALERTA.map((s) => (
            <option key={s} value={s}>
              {STATUS_ROTULO[s]}
            </option>
          ))}
        </SelectField>
      </FilterBar>
      {erro ? (
        <Notice tone="danger" onClose={() => setErro(null)}>
          {erro}
        </Notice>
      ) : null}
      {q.isLoading ? <LoadingBlock label="Carregando os alertas…" /> : null}
      {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        q.data.itens.length === 0 ? (
          <EstadoVazio titulo={f.status ? 'Nenhum alerta com esses filtros.' : 'Nenhum alerta.'} testId="gestor.alertas.vazio" />
        ) : (
          <Panel>
            <TabelaDados
              rotulo="Alertas da equipe"
              testId="gestor.alertas.tabela"
              linhas={q.data.itens}
              chave={(a) => a.id}
              colunas={[
                { id: 'tipo', titulo: 'Tipo', largura: '200px', celula: (a) => TIPO_ALERTA_ROTULO[a.tipo], texto: (a) => TIPO_ALERTA_ROTULO[a.tipo] },
                { id: 'mensagem', titulo: 'Mensagem', celula: (a) => a.mensagem, texto: (a) => a.mensagem },
                { id: 'responsavel', titulo: 'Responsável', prioridade: 2, largura: '160px', celula: (a) => responsavel(a.responsavel_id), texto: (a) => responsavel(a.responsavel_id) },
                { id: 'desde', titulo: 'Desde', prioridade: 3, largura: '150px', celula: (a) => formatDateTime(a.aberto_em, tz), texto: (a) => formatDateTime(a.aberto_em, tz) },
                { id: 'situacao', titulo: 'Situação', largura: '130px', celula: (a) => <SeloSituacao selos={[selo(a.status, a.severidade)]} /> },
              ]}
              acoes={(a) =>
                podeDispensar && a.status === 'aberto'
                  ? [{ id: 'dispensar', rotulo: 'Dispensar', desligada: dispensar.isPending, aoEscolher: () => dispensar.mutate(a.id, { onError: (e) => setErro(errorMessage(e)) }) }]
                  : []
              }
            />
          </Panel>
        )
      ) : null}
    </div>
  );
}

export function AlertasPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando os alertas…" />}>
      <Conteudo />
    </Suspense>
  );
}
