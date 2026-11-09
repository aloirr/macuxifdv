'use client';

import { Badge, Panel } from '@macuxi/ui/web';
import type { AlertaMonitor } from '../../contracts';
import { ROTULO_ENTIDADE, ROTULO_SEVERIDADE, TOM_SEVERIDADE } from '../lib/apresentacao';

/** Alertas do monitor (`montarAlertasMonitor` no domain, já ordenados: críticos primeiro), cada um com a causa e a ação seguinte.
 * RD-0026: o cancelamento recusado mostra aqui só uma linha curta; a frase completa fica em Pedidos no ERP › Erros de retorno. */
export function AlertasPanel({ alertas }: { alertas: readonly AlertaMonitor[] }) {
  return (
    <Panel label="Alertas" title={<>Alertas <span className="font-sans text-[13px] font-normal text-ink-2">· {alertas.length}</span></>}>
      {alertas.length === 0 ? (
        <span className="text-[13px] text-ink-2" data-testid="integracao.alertas.vazio">
          Nenhum alerta: Conectores no ar, lotes aplicados e pedidos fluindo.
        </span>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="integracao.alertas">
          {alertas.map((a, i) => (
            <li key={`${a.codigo}-${a.conector_id ?? ''}-${a.entidade ?? ''}-${i}`} className="flex items-start gap-2 text-[14px]" data-testid={`integracao.alerta.${a.codigo}`}>
              <Badge tone={TOM_SEVERIDADE[a.severidade]}>{ROTULO_SEVERIDADE[a.severidade]}</Badge>
              <span>
                {a.codigo === 'cancelamento_recusado' ? 'Cancelamento recusado: veja os pedidos em Pedidos no ERP.' : a.mensagem}
                {(a.conector_id || a.entidade) && (
                  <span className="text-[12px] text-ink-2">
                    {' '}
                    ({[a.conector_id, a.entidade ? ROTULO_ENTIDADE[a.entidade] : null].filter(Boolean).join(' · ')})
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
