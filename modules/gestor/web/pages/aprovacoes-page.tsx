'use client';

/**
 * Fila de aprovação do Gestor no BKO (RF-GES-04). Cliente, Vendedor, Nº, Total, Motivo e Prazo; Solicitado fica no detalhe.
 * A decisão mora no Vendedor (ADR 0011): "Decidir" abre a página Pedidos já filtrada; a alçada é revalidada
 * lá (RN-VEN-10). Analista e admin acompanham em leitura (RN-GES-07).
 */
import { useRouter } from 'next/navigation';
import { formatBRL, formatPct } from '@macuxi/comum';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { ErrorBlock, EstadoVazio, LoadingBlock, MenuAcoes, PageHeader, Panel, rotuloComContagem, SeloSituacao, TabelaDados } from '@macuxi/ui/web';
import type { ItemFilaAprovacao } from '../../contracts';
import { linhaDeMotivos, selosDoPrazo } from '../../app/lib/apresentacao';
import { larguraDaColuna } from '../lib/colunas-aprovacoes';
import { useFila, useVisaoEquipe } from '../lib/queries';

export function AprovacoesPage() {
  const q = useFila();
  const router = useRouter();
  const nomes = new Map((useVisaoEquipe({ data: null }).data?.membros ?? []).map((m) => [m.membro.id, m.membro.nome]));
  const fila = q.data;
  const clienteDe = (i: ItemFilaAprovacao) => i.cliente_nome?.trim() || i.cliente_codigo?.trim() || 'Cliente';
  const nomeDe = (id: string) => nomes.get(id) ?? 'Vendedor';
  const motivoDe = (i: ItemFilaAprovacao) =>
    linhaDeMotivos(i.motivos, i.desconto_efetivo_pct, formatPct, i.credito ? formatBRL(i.credito.disponivel_cents) : undefined, i.inadimplencia?.maior_atraso_dias ?? null);
  return (
    <div className="flex flex-col gap-4" data-testid="gestor.aprovacoes">
      <PageHeader
        title={rotuloComContagem('Aprovações da equipe', fila?.resumo.total ?? 0)}
        actions={<MenuAcoes acoes={[{ id: 'atualizar', rotulo: 'Atualizar', desligada: q.isFetching, aoEscolher: () => void q.refetch() }]} />}
      />
      {q.isLoading ? <LoadingBlock label="Carregando a fila…" /> : null}
      {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
      {fila ? (
        fila.itens.length === 0 ? (
          <EstadoVazio titulo="Nada aguardando aprovação." testId="gestor.aprovacoes.vazio" />
        ) : (
          <>
            <Panel>
              <TabelaDados
                rotulo="Fila de aprovações"
                testId="gestor.aprovacoes.tabela"
                linhas={fila.itens}
                chave={(i) => i.pedido_id}
                colunas={[
                  { id: 'cliente', titulo: 'Cliente', largura: larguraDaColuna('cliente'), celula: clienteDe, texto: clienteDe },
                  { id: 'vendedor', titulo: 'Vendedor', largura: larguraDaColuna('vendedor'), celula: (i) => nomeDe(i.vendedor_id), texto: (i) => nomeDe(i.vendedor_id) },
                  { id: 'pedido', titulo: 'Nº', largura: larguraDaColuna('pedido'), celula: (i) => i.pedido_numero ?? '—', texto: (i) => i.pedido_numero ?? '' },
                  { id: 'total', titulo: 'Total', numero: true, largura: larguraDaColuna('total'), celula: (i) => formatBRL(i.total_cents) },
                  { id: 'motivo', titulo: 'Motivo', largura: larguraDaColuna('motivo'), celula: motivoDe, texto: motivoDe },
                  {
                    id: 'prazo',
                    titulo: 'Prazo',
                    largura: larguraDaColuna('prazo'),
                    celula: (i) => (
                      <span className="flex flex-col items-start gap-1">
                        {selosDoPrazo(i).map((s) => (
                          <SeloSituacao key={s.texto} selos={[s]} />
                        ))}
                      </span>
                    ),
                  },
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
