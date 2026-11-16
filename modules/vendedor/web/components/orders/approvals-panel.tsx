'use client';

import { useState } from 'react';
import { formatBRL } from '@macuxi/comum';
import { Badge, formatAge, type NoticeTone, nomeLegivel, Panel, rotuloComContagem } from '@macuxi/ui/web';
import type { Order } from '../../../contracts';
import { AvisoDeDecisao, BotoesDeDecisao } from './decisao';

/** RD-0064: o cartão diz o % e o nível ("8,8% · Supervisor"); sem desconto (crédito, título vencido), o motivo da API. */
export function motivoDoCartao(a: Pick<Order, 'effective_discount_pct' | 'nivel_aprovacao' | 'pending_reason'>): string {
  const nivel = a.nivel_aprovacao ? a.nivel_aprovacao.charAt(0).toUpperCase() + a.nivel_aprovacao.slice(1) : null;
  const pct = a.effective_discount_pct && a.effective_discount_pct > 0 ? `${a.effective_discount_pct.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%` : null;
  if (!pct) return a.pending_reason || nivel || 'Aguardando';
  return nivel ? `${pct} · ${nivel}` : pct;
}

/**
 * "Aguardando aprovação" (RF-VEN-09): os pedidos pendentes do escopo do usuário. Os botões só aparecem em quem decide o
 * nível do pedido agora (`pode_decidir`, calculado pela API: supervisor, gerente e analista, P-3).
 */
export function ApprovalsPanel({ approvals, nowMs, onOpen }: { approvals: Order[]; nowMs: number; onOpen: (o: Order) => void }) {
  const [aviso, setAviso] = useState<{ tom: NoticeTone; texto: string } | null>(null);

  // §P6 regra 5: o quadro só existe com pelo menos um pedido pendente
  if (approvals.length === 0) return null;

  return (
    <Panel label="Aguardando aprovação" title={rotuloComContagem('Aguardando aprovação', approvals.length)} className="w-full">
      <AvisoDeDecisao aviso={aviso} onClose={() => setAviso(null)} />
      <div className="grid max-h-[320px] grid-cols-1 gap-3 overflow-y-auto md:grid-cols-2 xl:grid-cols-3" data-testid="pedidos.pendentes">
        {approvals.map((a) => {
          const idade = Math.max(0, Math.round((nowMs - Date.parse(a.received_at)) / 60000));
          return (
            <div key={a.id} className="flex flex-col gap-2 rounded-xl border border-line p-3">
              <div className="flex justify-between gap-2">
                <button type="button" onClick={() => onOpen(a)} className="flex min-w-0 flex-col gap-px text-left hover:underline" aria-label={`Abrir pedido ${a.number}`}>
                  <span className="text-[15px] font-semibold">{nomeLegivel(a.customer_name)}</span>
                </button>
                <span className="text-[15px] font-semibold whitespace-nowrap tabular-nums">{formatBRL(a.total_cents)}</span>
              </div>
              {/* RD-0217: a linha 2 é o motivo, com a idade em tag ao lado; o Nº fica só no aria-label */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold text-accent-ink">{motivoDoCartao(a)}</span>
                <Badge tone="neutral">há {formatAge(idade)}</Badge>
              </div>
              {a.pode_decidir ? (
                <BotoesDeDecisao pedido={a} onFeito={(tom, texto) => setAviso({ tom, texto })} />
              ) : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
