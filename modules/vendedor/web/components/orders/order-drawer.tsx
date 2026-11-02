'use client';

import { useState, type ReactNode } from 'react';
import { formatBRL, formatPct } from '@macuxi/comum';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage, imprimirHtml } from '@macuxi/platform-sdk/web';
import { Button, Drawer, ErrorBlock, formatDateTime, LoadingBlock, type NoticeTone, Notice, td, tdNum, th, thNum } from '@macuxi/ui/web';
import { ORDER_STATUS_LABEL, type Order, type OrderStatus } from '../../../contracts';
import { enviadoAoErp, MSG_CANCELAR_APOS_ENVIO } from '../../../domain/order';
import { buildOrderPdfHtml, orderPdfFileName, pdfDoPedido, type OrderPdfView } from '../../../domain/pdf-pedido';
import { usePedido, useSessaoDoBko } from '../../lib/queries';
import { AvisoDeDecisao, BotoesDeDecisao } from './decisao';
import { OrderStatusBadge } from './status';

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[12px] text-ink-2">{label}</span>
      <span className="text-[14px] font-medium">{children}</span>
    </div>
  );
}

const NIVEL: Record<string, string> = { supervisor: 'Supervisor', gerente: 'Gerente', analista: 'Analista' };

/** Gaveta do pedido (RF-VEN-04/05/06): itens, histórico, aprovação e Exportar PDF (cliente | interno) pelo diálogo de impressão. */
export function OrderDrawer({ order, tz, onClose }: { order: Order | null; tz: string; onClose: () => void }) {
  const detail = usePedido(order?.id ?? null);
  const sessao = useSessaoDoBko();
  const podeAprovar = usePode('pedido.aprovar');
  const [aviso, setAviso] = useState<{ tom: NoticeTone; texto: string } | null>(null);
  const [erroPdf, setErroPdf] = useState<string | null>(null);
  const [gerando, setGerando] = useState<OrderPdfView | null>(null);
  const o = detail.data ?? order;

  const exportar = async (view: OrderPdfView) => {
    if (!detail.data) return;
    setGerando(view);
    setErroPdf(null);
    try {
      const html = buildOrderPdfHtml(pdfDoPedido(detail.data), view, { tenant_name: sessao.empresa, product_name: 'Macuxi FDV', tz, generated_at: new Date().toISOString() });
      // o título vira o nome sugerido do arquivo no "Salvar como PDF" do navegador
      await imprimirHtml(html, orderPdfFileName(detail.data.number || null, view).replace(/\.pdf$/, ''));
    } catch (e) {
      setErroPdf(errorMessage(e));
    } finally {
      setGerando(null);
    }
  };

  const aprovacao = detail.data?.aprovacao ?? null;
  // T-0054: coluna "Faturado" só quando o retorno do ERP trouxe quantidades
  const temFaturado = detail.data?.items.some((it) => it.quantity_invoiced !== undefined) ?? false;

  return (
    <Drawer
      open={!!order}
      onClose={onClose}
      title={o ? <span className="font-mono">{o.tipo === 'orcamento' ? 'Orçamento' : 'Pedido'} {o.number}</span> : 'Pedido'}
      subtitle={o ? `${o.customer_name} · ${o.seller_name}` : undefined}
    >
      {o && (
        <div className="flex flex-col gap-4" data-testid="pedido.detalhe">
          <div className="flex flex-wrap items-center gap-2">
            <OrderStatusBadge status={o.status} situacaoOrcamento={o.situacao_orcamento} />
            {o.erp_order_code && <span className="text-[12px] text-ink-2">ERP {o.erp_order_code}</span>}
            <div className="ml-auto flex gap-2">
              <Button size="sm" disabled={!detail.data || gerando !== null} onClick={() => void exportar('customer')} data-testid="pedido.pdf.cliente">
                {gerando === 'customer' ? 'Gerando…' : 'PDF do cliente'}
              </Button>
              <Button size="sm" disabled={!detail.data || gerando !== null} onClick={() => void exportar('bko')} data-testid="pedido.pdf.interno">
                {gerando === 'bko' ? 'Gerando…' : 'PDF interno'}
              </Button>
            </div>
          </div>
          {erroPdf && <Notice tone="danger">Não deu para abrir a impressão: {erroPdf} Tente de novo ou permita pop-ups deste site.</Notice>}
          <AvisoDeDecisao aviso={aviso} onClose={() => setAviso(null)} />
          {enviadoAoErp(o.status) && <Notice tone="info">{MSG_CANCELAR_APOS_ENVIO}</Notice>}
          {o.status === 'pending_approval' && o.pending_reason && <Notice tone="warning">{o.pending_reason}</Notice>}
          {o.status === 'rejected' && o.rejection_reason && <Notice tone="danger">Motivo: {o.rejection_reason}</Notice>}

          {aprovacao && podeAprovar && aprovacao.pode_decidir && detail.data && (
            <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
              <h3 className="m-0 font-display text-[16px] font-bold">Decisão</h3>
              <span className="text-[13px] text-ink-2">
                Desconto {formatPct(aprovacao.desconto_efetivo_pct)} · alçada do vendedor {formatPct(aprovacao.limite_vendedor_pct)} · cabe ao nível {NIVEL[aprovacao.nivel] ?? aprovacao.nivel}
                {aprovacao.acima_do_nivel ? ' (decisão registrada como acima do nível)' : ''}
              </span>
              <BotoesDeDecisao pedido={detail.data} tamanho="md" onFeito={(tom, texto) => setAviso({ tom, texto })} />
            </section>
          )}

          <div className="grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface p-4">
            <Field label="Condição">{o.payment_terms || '—'}</Field>
            <Field label="Recebido">{formatDateTime(o.received_at, tz)}</Field>
            <Field label="Feito sem sinal">{o.created_offline_at ? formatDateTime(o.created_offline_at, tz) : 'Não'}</Field>
            <Field label="Itens">
              {o.items_count} itens · {o.units} un.
            </Field>
            <Field label="Desconto">{formatPct(o.discount_pct)}</Field>
            {detail.data?.cliente?.documento ? <Field label="Documento do cliente">{detail.data.cliente.documento}</Field> : null}
          </div>

          <div className="flex flex-col gap-1 rounded-xl border border-line bg-surface p-4 text-[14px] tabular-nums">
            <div className="flex justify-between">
              <span className="text-ink-2">Subtotal</span>
              <span>{formatBRL(o.subtotal_cents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-2">Desconto ({formatPct(o.discount_pct)})</span>
              <span>− {formatBRL(o.discount_cents)}</span>
            </div>
            <div className="flex justify-between border-t border-line-2 pt-1.5 font-display text-[18px] font-extrabold">
              <span>Total</span>
              <span>{formatBRL(o.total_cents)}</span>
            </div>
          </div>

          {(o.situacao_faturamento?.length || detail.data?.faturamento) && (
            <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4" data-testid="pedido.faturamento">
              <h3 className="m-0 font-display text-[16px] font-bold">Faturamento e devolução</h3>
              {(o.situacao_faturamento ?? []).map((l) => (
                <span key={l} className="text-[13px]">
                  {l}
                </span>
              ))}
              {detail.data?.faturamento && detail.data.faturamento.notas.length + detail.data.faturamento.devolucoes.length > 0 && (
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
                      {detail.data.faturamento.notas.map((n, i) => (
                        <tr key={`nf-${n.numero ?? i}-${n.faturado_em}`}>
                          <td className={`${td} font-mono whitespace-nowrap`}>{n.numero ? `${n.numero}${n.serie ? `/${n.serie}` : ''}` : '—'}</td>
                          <td className={td}>{n.parcial ? 'Faturamento parcial' : 'Faturamento'}</td>
                          <td className={`${td} whitespace-nowrap`}>{formatDateTime(n.faturado_em, tz)}</td>
                          <td className={tdNum}>{n.unidades}</td>
                          <td className={`${tdNum} whitespace-nowrap`}>{n.total_cents === null ? '—' : formatBRL(n.total_cents)}</td>
                        </tr>
                      ))}
                      {detail.data.faturamento.devolucoes.map((d, i) => (
                        <tr key={`dev-${d.numero}-${i}`}>
                          <td className={`${td} font-mono whitespace-nowrap`}>{`${d.numero}${d.serie ? `/${d.serie}` : ''}`}</td>
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
          {detail.isError && <ErrorBlock message={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />}
          {detail.data && (
            <>
              <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
                <h3 className="m-0 font-display text-[16px] font-bold">Itens</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[460px] border-collapse text-[13px]" data-testid="pedido.itens">
                    <thead>
                      <tr>
                        <th scope="col" className={th}>Código</th>
                        <th scope="col" className={th}>Descrição</th>
                        <th scope="col" className={thNum}>Qtd</th>
                        <th scope="col" className={thNum}>Tabela</th>
                        <th scope="col" className={thNum}>Total</th>
                        {temFaturado && <th scope="col" className={thNum}>Faturado</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {detail.data.items.map((it) => (
                        <tr key={it.id}>
                          <td className={`${td} font-mono whitespace-nowrap`}>{it.erp_code}</td>
                          <td className={td}>{it.description}</td>
                          <td className={tdNum}>{it.quantity}</td>
                          <td className={`${tdNum} whitespace-nowrap`}>{formatBRL(it.unit_price_cents)}</td>
                          <td className={`${tdNum} whitespace-nowrap`}>{formatBRL(it.total_cents)}</td>
                          {temFaturado && <td className={tdNum}>{it.quantity_invoiced ?? 0}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
                <h3 className="m-0 font-display text-[16px] font-bold">Histórico</h3>
                <ol className="m-0 flex list-none flex-col gap-3 p-0">
                  {detail.data.history.map((h, i) => (
                    <li key={`${h.at}-${i}`} className="flex gap-3">
                      <span className="w-[92px] shrink-0 text-[12px] text-ink-2 tabular-nums">{formatDateTime(h.at, tz)}</span>
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[13px] font-semibold">
                          {ORDER_STATUS_LABEL[h.status as OrderStatus] ?? h.status} <span className="font-normal text-ink-2">· {h.by}</span>
                        </span>
                        {h.note && <span className="text-[12px] text-ink-2">{h.note}</span>}
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </div>
      )}
    </Drawer>
  );
}
