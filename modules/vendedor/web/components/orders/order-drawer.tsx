'use client';

import { useState, type ReactNode } from 'react';
import { formatBRL, formatPct } from '@macuxi/comum';
import { useAmbiente, usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, Drawer, ErrorBlock, formatDateTime, HistoricoEmTags, LoadingBlock, type NoticeTone, Notice, tagsDoHistorico, td, tdNum, th, thNum } from '@macuxi/ui/web';
import type { Order } from '../../../contracts';
import { eventosDoOrcamento, eventosDoPedido } from '../../../domain/historico-pedido';
import { enviadoAoErp, MSG_CANCELAR_APOS_ENVIO } from '../../../domain/order';
import { descontoDoPedidoPct } from '../../../domain/preco-pedido';
import type { OrderPdfView } from '../../../domain/pdf-pedido';
import { DICA_PDF_SEM_DETALHE, MSG_ITENS_INDISPONIVEIS, MSG_SEM_DOCUMENTO, textoDaModalidade, textoDaTransportadora, textoDoAjusteDoItem, textoDoEnderecoEntrega, enderecoFoiEditado, SELO_ENDERECO_EDITADO } from '../../lib/detalhe-pedido';
import { usePedido } from '../../lib/queries';
import { AvisoDeDecisao, BotoesDeDecisao } from './decisao';
import { ERRO_IMPRESSAO, exportarPdfDoPedido } from './exportar-pdf';
import { OrderStatusBadge } from './status';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[12px] text-ink-2">{label}</span>
      <span className="text-[15px] font-medium">{children}</span>
    </div>
  );
}


/** Gaveta do pedido (RF-VEN-04/05/06): itens, histórico, aprovação e Exportar PDF (cliente | interno) pelo diálogo de impressão. */
export function OrderDrawer({ order, tz, onClose }: { order: Order | null; tz: string; onClose: () => void }) {
  const detail = usePedido(order?.id ?? null);
  const dados = detail.data?.pedido ?? null;
  const semDocumento = detail.data?.semDocumento ?? false;
  const ambiente = useAmbiente();
  const podeAprovar = usePode('pedido.aprovar');
  const [aviso, setAviso] = useState<{ tom: NoticeTone; texto: string } | null>(null);
  const [erroPdf, setErroPdf] = useState<string | null>(null);
  const [gerando, setGerando] = useState<OrderPdfView | null>(null);
  const o = dados ?? order;

  const exportar = async (view: OrderPdfView) => {
    if (!dados) return;
    setGerando(view);
    setErroPdf(null);
    try {
      await exportarPdfDoPedido(dados, view, { ambiente, tz });
    } catch (e) {
      setErroPdf(errorMessage(e));
    } finally {
      setGerando(null);
    }
  };

  const aprovacao = dados?.aprovacao ?? null;
  // T-0138 (RN-VEN-30/18): o orçamento mostra Salvo · Transformado em pedido nº · Cancelado (o orçamento não vence); o pedido, o status de cada evento
  const eventos = dados
    ? dados.tipo === 'orcamento'
      ? eventosDoOrcamento(dados.history, { vendedorNome: dados.seller_name, situacao: dados.situacao_orcamento ?? 'aberto', criadoEm: dados.received_at, convertidoEm: dados.updated_at, numeroPedido: null })
      : eventosDoPedido(dados.history, { vendedorNome: dados.seller_name, motivoDoFechamento: dados.rejection_reason })
    : [];
  // T-0054: coluna "Faturado" só quando o retorno do ERP trouxe quantidades
  const temFaturado = dados?.items.some((it) => it.quantity_invoiced !== undefined) ?? false;

  return (
    <Drawer
      open={!!order}
      onClose={onClose}
      title={o ? <span className="tabular-nums">{o.tipo === 'orcamento' ? 'Orçamento' : 'Pedido'} {o.number}</span> : 'Pedido'}
      subtitle={o ? `${o.customer_name} · ${o.seller_name}` : undefined}
    >
      {o && (
        <div className="flex flex-col gap-4" data-testid="pedido.detalhe">
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={o.status} situacaoOrcamento={o.situacao_orcamento} />
            {o.erp_order_code && <span className="text-[12px] text-ink-2">ERP {o.erp_order_code}</span>}
            <div className="ml-auto flex gap-2">
              <Button size="sm" disabled={!dados || gerando !== null} title={dados ? undefined : DICA_PDF_SEM_DETALHE} onClick={() => void exportar('customer')} data-testid="pedido.pdf.cliente">
                {gerando === 'customer' ? 'Gerando…' : 'PDF do cliente'}
              </Button>
              <Button size="sm" disabled={!dados || gerando !== null} title={dados ? undefined : DICA_PDF_SEM_DETALHE} onClick={() => void exportar('bko')} data-testid="pedido.pdf.interno">
                {gerando === 'bko' ? 'Gerando…' : 'PDF interno'}
              </Button>
            </div>
          </div>
          {erroPdf && <Notice tone="danger">{ERRO_IMPRESSAO(erroPdf)}</Notice>}
          {semDocumento && <Notice tone="warning">{MSG_SEM_DOCUMENTO}</Notice>}
          <AvisoDeDecisao aviso={aviso} onClose={() => setAviso(null)} />
          {enviadoAoErp(o.status) && <Notice tone="info">{MSG_CANCELAR_APOS_ENVIO}</Notice>}

          {aprovacao && podeAprovar && aprovacao.pode_decidir && dados && (
            <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
              <h3 className="m-0 text-[17px] font-bold">Decisão</h3>
              <BotoesDeDecisao pedido={dados} tamanho="md" onFeito={(tom, texto) => setAviso({ tom, texto })} />
            </section>
          )}

          <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4">
            <Field label="Condição">{o.payment_terms || '—'}</Field>
            <Field label="Recebido">{formatDateTime(o.received_at, tz)}</Field>
            <Field label="Feito sem sinal">{o.created_offline_at ? formatDateTime(o.created_offline_at, tz) : 'Não'}</Field>
            <Field label="Itens">
              {o.items_count} · {o.units} un.
            </Field>
            {o.price_table_name ? <Field label="Tabela de preço">{o.price_table_name}</Field> : null}
            {dados?.cliente?.documento ? <Field label="Documento do cliente">{dados.cliente.documento}</Field> : null}
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4 text-[15px] tabular-nums">
            <div className="flex justify-between">
              <span className="text-ink-2">Subtotal</span>
              <span>{formatBRL(o.subtotal_cents)}</span>
            </div>
            {(o.surcharge_pct ?? 0) > 0 ? (
              <div className="flex justify-between">
                <span className="text-ink-2">Acréscimo ({formatPct(o.surcharge_pct!)})</span>
                <span>+ {formatBRL(Math.max(0, o.total_cents - o.subtotal_cents))}</span>
              </div>
            ) : (
              <div className="flex justify-between">
                <span className="text-ink-2">Desconto ({formatPct(descontoDoPedidoPct(o.subtotal_cents, o.total_cents))})</span>
                <span>− {formatBRL(o.discount_cents)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-line-2 pt-1.5 text-[20px] font-semibold">
              <span>Total</span>
              <span>{formatBRL(o.total_cents)}</span>
            </div>
          </div>

          {(o.freight || o.delivery_address) && (
            <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4" data-testid="pedido.entrega">
              <h3 className="m-0 text-[17px] font-bold">Frete e entrega</h3>
              {o.freight ? (
                <div className="grid grid-cols-1 gap-2">
                  <Field label="Frete">{textoDaModalidade(o.freight)}</Field>
                  {textoDaTransportadora(o.freight) ? <Field label="Transportadora">{textoDaTransportadora(o.freight)}</Field> : null}
                </div>
              ) : null}
              {textoDoEnderecoEntrega(o.delivery_address) ? (
                <Field label="Endereço de entrega">
                  {textoDoEnderecoEntrega(o.delivery_address)}
                  {enderecoFoiEditado(o.delivery_address) ? (
                    <span className="ml-2 rounded-md bg-accent-soft px-2 py-0.5 text-[12px] font-semibold text-accent-ink" data-testid="pedido.endereco-editado">
                      {SELO_ENDERECO_EDITADO}
                    </span>
                  ) : null}
                </Field>
              ) : null}
            </section>
          )}

          {(o.situacao_faturamento?.length || dados?.faturamento) && (
            <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4" data-testid="pedido.faturamento">
              <h3 className="m-0 text-[17px] font-bold">Faturamento e devolução</h3>
              {(o.situacao_faturamento ?? []).map((l) => (
                <span key={l} className="text-[13px]">
                  {l}
                </span>
              ))}
              {dados?.faturamento && dados.faturamento.notas.length + dados.faturamento.devolucoes.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[420px] border-collapse text-[13px]" data-testid="pedido.notas">
                    <thead>
                      <tr>
                        <th scope="col" className={th}>Nota</th>
                        <th scope="col" className={th}>Tipo</th>
                        <th scope="col" className={th}>Data</th>
                        <th scope="col" className={thNum}>Un.</th>
                        <th scope="col" className={thNum}>Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dados.faturamento.notas.map((n, i) => (
                        <tr key={`nf-${n.numero ?? i}-${n.faturado_em}`}>
                          <td className={`${td} tabular-nums whitespace-nowrap`}>{n.numero ? `${n.numero}${n.serie ? `/${n.serie}` : ''}` : '—'}</td>
                          <td className={td}>{n.parcial ? 'Faturamento parcial' : 'Faturamento'}</td>
                          <td className={`${td} whitespace-nowrap`}>{formatDateTime(n.faturado_em, tz)}</td>
                          <td className={tdNum}>{n.unidades}</td>
                          <td className={`${tdNum} whitespace-nowrap`}>{n.total_cents === null ? '—' : formatBRL(n.total_cents)}</td>
                        </tr>
                      ))}
                      {dados.faturamento.devolucoes.map((d, i) => (
                        <tr key={`dev-${d.numero}-${i}`}>
                          <td className={`${td} tabular-nums whitespace-nowrap`}>{`${d.numero}${d.serie ? `/${d.serie}` : ''}`}</td>
                          <td className={td}>Devolução</td>
                          <td className={`${td} whitespace-nowrap`}>{formatDateTime(d.emitida_em, tz)}</td>
                          <td className={tdNum}>—</td>
                          <td className={`${tdNum} whitespace-nowrap`}>− {formatBRL(d.total_cents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {detail.isPending && <LoadingBlock label="Carregando itens e histórico…" />}
          {detail.isError && <ErrorBlock message={errorMessage(detail.error)} fallback={MSG_ITENS_INDISPONIVEIS} onRetry={() => void detail.refetch()} />}
          {dados && (
            <>
              <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
                <h3 className="m-0 text-[17px] font-bold">Itens</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[620px] border-collapse text-[13px]" data-testid="pedido.itens">
                    <thead>
                      <tr>
                        <th scope="col" className={th}>Código</th>
                        <th scope="col" className={th}>Descrição</th>
                        <th scope="col" className={th}>Medida</th>
                        <th scope="col" className={thNum}>Qtd</th>
                        <th scope="col" className={thNum}>Tabela</th>
                        <th scope="col" className={thNum}>Desc./Acr.</th>
                        <th scope="col" className={thNum}>Total</th>
                        {temFaturado && <th scope="col" className={thNum}>Faturado</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {dados.items.map((it) => (
                        <tr key={it.id}>
                          <td className={`${td} font-mono whitespace-nowrap`}>{it.erp_code}</td>
                          <td className={td}>
                            {it.description}
                            {it.application ? <span className="block text-[12px] text-ink-2" data-testid={`aplicacao-${it.erp_code}`}>Aplicação: {it.application}</span> : null}
                          </td>
                          <td className={`${td} whitespace-nowrap`}>{it.unit_label || 'UN'}</td>
                          <td className={tdNum}>{it.quantity}</td>
                          <td className={`${tdNum} whitespace-nowrap`}>{formatBRL(it.unit_price_cents)}</td>
                          <td className={`${tdNum} whitespace-nowrap`}>{textoDoAjusteDoItem(it)}</td>
                          <td className={`${tdNum} whitespace-nowrap`}>{formatBRL(it.total_cents)}</td>
                          {temFaturado && <td className={tdNum}>{`${it.quantity_invoiced ?? 0} de ${it.quantity_base ?? it.quantity}`}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4" data-testid="pedido.historico">
                <h3 className="m-0 text-[17px] font-bold">Histórico</h3>
                {/* T-0138 (RN-VEN-30): só tags de status, com data e hora curtas; motivo em 1 linha no Rejeitado e no Cancelado; autor só quando não é o vendedor */}
                <HistoricoEmTags tags={tagsDoHistorico(eventos, { tipo: dados.tipo === 'orcamento' ? 'orcamento' : 'pedido', tz, agora: new Date() })} titulo="Histórico" testId="pedido.historico.tags" />
              </section>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
