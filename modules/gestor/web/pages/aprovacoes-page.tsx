'use client';

/**
 * Fila de aprovação do Gestor no BKO (RF-GES-04): prazo em dias úteis (RN-GES-03), motivo, desconto efetivo, crédito e
 * histórico. A decisão mora no Vendedor (ADR 0011): "Decidir" abre a página Pedidos já filtrada; a alçada é revalidada
 * lá (RN-VEN-10). Analista e admin acompanham em leitura (RN-GES-07).
 */
import Link from 'next/link';
import { formatBRL } from '@macuxi/comum';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, KpiCard, KpiGrid, LoadingBlock, PageHeader, Panel, TableScroll, td, tdNum, th, thNum, formatDateTime, type BadgeTone } from '@macuxi/ui/web';
import type { SituacaoPrazo } from '../../contracts';
import { MOTIVO_ROTULO, rotuloDoPrazo } from '../../app/lib/apresentacao';
import { useFila, useFusoDoTenant, useVisaoEquipe } from '../lib/queries';

const TOM: Record<SituacaoPrazo, BadgeTone> = { no_prazo: 'success', vencendo: 'warning', vencido: 'danger' };

export function AprovacoesPage() {
  const q = useFila();
  const tz = useFusoDoTenant();
  const nomes = new Map((useVisaoEquipe({ data: null }).data?.membros ?? []).map((m) => [m.membro.id, m.membro.nome]));
  const fila = q.data;
  return (
    <div className="flex flex-col gap-4" data-testid="gestor.aprovacoes">
      <PageHeader
        title="Aprovações da equipe"
        subtitle="Pedidos acima da alçada do vendedor, do prazo mais curto ao mais longo"
        actions={
          <Button disabled={q.isFetching} onClick={() => void q.refetch()}>
            Atualizar
          </Button>
        }
      />
      {q.isLoading ? <LoadingBlock label="Carregando a fila…" /> : null}
      {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
      {fila ? (
        <>
          <KpiGrid>
            <KpiCard label="Na fila" value={fila.resumo.total} />
            <KpiCard label="Para você decidir" value={fila.resumo.para_mim} />
            <KpiCard label="Vencidos" value={fila.resumo.vencidos} valueClass={fila.resumo.vencidos > 0 ? 'text-danger' : undefined} />
            <KpiCard label="Vencendo" value={fila.resumo.vencendo} />
          </KpiGrid>
          <Panel title="Fila">
            <TableScroll minWidth={980}>
              <table className="w-full border-collapse text-[13px]" data-testid="gestor.aprovacoes.tabela">
                <thead>
                  <tr>
                    <th className={th}>Vendedor</th>
                    <th className={th}>Solicitado</th>
                    <th className={th}>Motivo</th>
                    <th className={thNum}>Total</th>
                    <th className={thNum}>Desconto</th>
                    <th className={thNum}>Crédito disponível</th>
                    <th className={th}>Prazo</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody>
                  {fila.itens.length === 0 ? (
                    <tr>
                      <td className={td} colSpan={8}>
                        Nada aguardando aprovação.
                      </td>
                    </tr>
                  ) : null}
                  {fila.itens.map((i) => (
                    <tr key={i.pedido_id}>
                      <td className={td}>{nomes.get(i.vendedor_id) ?? 'Vendedor'}</td>
                      <td className={td}>{formatDateTime(i.solicitada_em, tz)}</td>
                      <td className={td}>{i.motivos.map((m) => MOTIVO_ROTULO[m]).join(', ')}</td>
                      <td className={tdNum}>{formatBRL(i.total_cents)}</td>
                      <td className={tdNum}>{i.desconto_efetivo_pct}%</td>
                      <td className={tdNum}>{i.credito ? formatBRL(i.credito.disponivel_cents) : 'indisponível'}</td>
                      <td className={td}>
                        <Badge tone={TOM[i.situacao]}>{rotuloDoPrazo(i).label}</Badge>
                      </td>
                      <td className={td}>
                        {i.pode_decidir ? (
                          <Link className="font-semibold text-accent-ink hover:underline" href={`/pedidos?status=pending_approval&seller_id=${i.vendedor_id}`}>
                            {i.acima_do_nivel ? 'Decidir (nível do supervisor)' : 'Decidir'}
                          </Link>
                        ) : (
                          <span className="text-ink-2">Acompanhar</span>
                        )}
                      </td>
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
