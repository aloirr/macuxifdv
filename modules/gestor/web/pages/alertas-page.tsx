'use client';

/**
 * Alertas da equipe no BKO (RF-GES-07): filtro de status na URL; dispensar só para quem tem `alerta_equipe.dispensar`
 * (supervisor e gerente — analista e admin leem, RN-GES-07). A proteção real é na API.
 */
import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, FilterBar, formatDateTime, LoadingBlock, Notice, PageHeader, Panel, SelectField, TableScroll, td, th, type BadgeTone } from '@macuxi/ui/web';
import { STATUS_ALERTA, type Severidade } from '../../contracts';
import { TIPO_ALERTA_ROTULO } from '../../app/lib/apresentacao';
import { lerFiltrosAlertas, paraQuery } from '../lib/filtros';
import { useAlertas, useDispensarAlerta, useFusoDoTenant, useVisaoEquipe } from '../lib/queries';

const TOM: Record<Severidade, BadgeTone> = { info: 'neutral', atencao: 'warning', critica: 'danger' };
const STATUS_ROTULO = { aberto: 'Abertos', dispensado: 'Dispensados', encerrado: 'Encerrados' } as const;

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
  return (
    <div className="flex flex-col gap-4" data-testid="gestor.alertas">
      <PageHeader
        title="Alertas da equipe"
        subtitle="Clientes sem visita, ritmo abaixo da meta, aprovações paradas e alertas de trade"
        actions={
          <Button disabled={q.isFetching} onClick={() => void q.refetch()}>
            Atualizar
          </Button>
        }
      />
      <FilterBar>
        <SelectField label="Situação" value={f.status ?? ''} onChange={(e) => router.replace(`${pathname}?${new URLSearchParams(paraQuery({ status: e.target.value || null }))}`)}>
          <option value="">Ativos (abertos e dispensados)</option>
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
        <Panel title={`${q.data.itens.length} alertas`}>
          <TableScroll minWidth={860}>
            <table className="w-full border-collapse text-[13px]" data-testid="gestor.alertas.tabela">
              <thead>
                <tr>
                  <th className={th}>Tipo</th>
                  <th className={th}>Mensagem</th>
                  <th className={th}>Responsável</th>
                  <th className={th}>Desde</th>
                  <th className={th}>Situação</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {q.data.itens.length === 0 ? (
                  <tr>
                    <td className={td} colSpan={6}>
                      Nenhum alerta.
                    </td>
                  </tr>
                ) : null}
                {q.data.itens.map((a) => (
                  <tr key={a.id}>
                    <td className={td}>{TIPO_ALERTA_ROTULO[a.tipo]}</td>
                    <td className={td}>{a.mensagem}</td>
                    <td className={td}>{a.responsavel_id ? (nomes.get(a.responsavel_id) ?? 'Equipe') : '—'}</td>
                    <td className={td}>{formatDateTime(a.aberto_em, tz)}</td>
                    <td className={td}>
                      <Badge tone={a.status === 'aberto' ? TOM[a.severidade] : 'neutral'}>{a.status === 'aberto' ? 'Aberto' : a.status === 'dispensado' ? 'Dispensado' : 'Encerrado'}</Badge>
                    </td>
                    <td className={td}>
                      {podeDispensar && a.status === 'aberto' ? (
                        <Button size="sm" disabled={dispensar.isPending} onClick={() => dispensar.mutate(a.id, { onError: (e) => setErro(errorMessage(e)) })}>
                          Dispensar
                        </Button>
                      ) : null}
                    </td>
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

export function AlertasPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando os alertas…" />}>
      <Conteudo />
    </Suspense>
  );
}
