'use client';

/**
 * Fila de aprovação do Gestor no BKO (RF-GES-04): prazo em dias úteis (RN-GES-03), motivo, desconto efetivo, crédito e
 * histórico. A decisão mora no Vendedor (ADR 0011): "Decidir" abre a página Pedidos já filtrada; a alçada é revalidada
 * lá (RN-VEN-10). Analista e admin acompanham em leitura (RN-GES-07).
 */
import { useRouter } from 'next/navigation';
import { formatBRL, formatPct } from '@macuxi/comum';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { ErrorBlock, EstadoVazio, formatDateTime, KpiCard, KpiGrid, LoadingBlock, MenuAcoes, PageHeader, Panel, rotuloComContagem, SeloSituacao, TabelaDados, type BadgeTone } from '@macuxi/ui/web';
import type { SituacaoPrazo } from '../../contracts';
import { MOTIVO_ROTULO, rotuloDoPrazo } from '../../app/lib/apresentacao';
import { useFila, useFusoDoTenant, useVisaoEquipe } from '../lib/queries';

const TOM: Record<SituacaoPrazo, BadgeTone> = { no_prazo: 'success', vencendo: 'warning', vencido: 'danger' };

export function AprovacoesPage() {
  const q = useFila();
  const router = useRouter();
  const tz = useFusoDoTenant();
  const nomes = new Map((useVisaoEquipe({ data: null }).data?.membros ?? []).map((m) => [m.membro.id, m.membro.nome]));
  const fila = q.data;
  const nomeDe = (id: string) => nomes.get(id) ?? 'Vendedor';
  const motivos = (ms: readonly (keyof typeof MOTIVO_ROTULO)[]) => ms.map((m) => MOTIVO_ROTULO[m]).join(', ');
  return (
    <div className="flex flex-col gap-4" data-testid="gestor.aprovacoes">
      <PageHeader
        title={rotuloComContagem('Aprovações da equipe', fila?.resumo.total ?? 0)}
        actions={<MenuAcoes acoes={[{ id: 'atualizar', rotulo: q.isFetching ? 'Atualizando…' : 'Atualizar', desligada: q.isFetching, aoEscolher: () => void q.refetch() }]} />}
      />
      {q.isLoading ? <LoadingBlock label="Carregando a fila…" /> : null}
      {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
      {fila ? (
        fila.itens.length === 0 ? (
          <EstadoVazio titulo="Nada aguardando aprovação." testId="gestor.aprovacoes.vazio" />
        ) : (
          <>
            <KpiGrid>
              <KpiCard label="Para você decidir" value={fila.resumo.para_mim} />
              <KpiCard label="Vencidos" value={fila.resumo.vencidos} valueClass={fila.resumo.vencidos > 0 ? 'text-danger' : undefined} />
              <KpiCard label="Vencendo" value={fila.resumo.vencendo} />
            </KpiGrid>
            <Panel>
              <TabelaDados
                rotulo="Fila de aprovações"
                testId="gestor.aprovacoes.tabela"
                linhas={fila.itens}
                chave={(i) => i.pedido_id}
                colunas={[
                  { id: 'vendedor', titulo: 'Vendedor', celula: (i) => nomeDe(i.vendedor_id), texto: (i) => nomeDe(i.vendedor_id) },
                  { id: 'solicitado', titulo: 'Solicitado', prioridade: 3, largura: '150px', celula: (i) => formatDateTime(i.solicitada_em, tz), texto: (i) => formatDateTime(i.solicitada_em, tz) },
                  { id: 'motivo', titulo: 'Motivo', prioridade: 2, largura: '20%', celula: (i) => motivos(i.motivos), texto: (i) => motivos(i.motivos) },
                  { id: 'total', titulo: 'Total', numero: true, largura: '110px', celula: (i) => formatBRL(i.total_cents) },
                  { id: 'desconto', titulo: 'Desconto', numero: true, prioridade: 2, largura: '90px', celula: (i) => formatPct(i.desconto_efetivo_pct) },
                  { id: 'credito', titulo: 'Crédito disponível', numero: true, prioridade: 2, largura: '140px', celula: (i) => (i.credito ? formatBRL(i.credito.disponivel_cents) : 'indisponível') },
                  { id: 'prazo', titulo: 'Prazo', largura: '150px', celula: (i) => <SeloSituacao selos={[{ tom: TOM[i.situacao], texto: rotuloDoPrazo(i).label }]} /> },
                ]}
                acoes={(i) =>
                  i.pode_decidir ? [{ id: 'decidir', rotulo: 'Decidir', aoEscolher: () => router.push(`/pedidos?status=pending_approval&seller_id=${i.vendedor_id}`) }] : []
                }
              />
            </Panel>
          </>
        )
      ) : null}
    </div>
  );
}
