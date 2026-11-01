'use client';

import { formatPct } from '@macuxi/comum';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { ErrorBlock, formatDateTime, LoadingBlock, Notice, PageHeader, Panel, td, th } from '@macuxi/ui/web';
import { useAlcadas, useDecisoesRecentes, useSessaoDoBko } from '../lib/queries';

const ROTULO_ACAO: Record<string, string> = { 'pedido.aprovar': 'Aprovou', 'pedido.rejeitar': 'Rejeitou', 'pedido.cancelar': 'Cancelou' };

/**
 * Alçadas de desconto (RN-VEN-10), só leitura nesta fatia: os limites vêm dos parâmetros do tenant e são os mesmos que o
 * servidor aplica ao receber o pedido e que o aparelho mostra ao vendedor. Editar alçadas com auditoria é a próxima fatia
 * (T-0029 §14). A trilha mostra quem decidiu pedidos (auditoria da plataforma, RN-AUD-01).
 */
export function AlcadasPage() {
  const alcadas = useAlcadas();
  const decisoes = useDecisoesRecentes();
  const { fuso } = useSessaoDoBko();
  const p = alcadas.data;

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="alcadas.tela">
      <PageHeader title="Alçadas de desconto" subtitle="Quem aprova cada faixa de desconto de um pedido." />
      <Notice tone="info">Os limites abaixo vêm dos parâmetros da empresa e valem para todos os vendedores. A edição pelo BKO chega em uma próxima atualização; até lá, a mudança é pedida ao suporte.</Notice>
      {alcadas.isError && <ErrorBlock message={errorMessage(alcadas.error)} onRetry={() => void alcadas.refetch()} />}
      {alcadas.isPending && <LoadingBlock label="Carregando as alçadas…" />}
      {p && (
        <Panel label="Limites" title="Limites por nível">
          <table className="w-full max-w-[640px] border-collapse text-[14px]" data-testid="alcadas.tabela">
            <thead>
              <tr>
                <th scope="col" className={th}>Desconto do pedido</th>
                <th scope="col" className={th}>Quem aprova</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className={td}>Até {formatPct(p.seller_pct)}</td>
                <td className={td}>Vendedor (aprovado na hora)</td>
              </tr>
              <tr>
                <td className={td}>
                  Até {formatPct(p.supervisor_pct)}
                </td>
                <td className={td}>Supervisor</td>
              </tr>
              <tr>
                <td className={td}>Até {formatPct(p.manager_pct)}</td>
                <td className={td}>Gerente</td>
              </tr>
              <tr>
                <td className={td}>Acima de {formatPct(p.manager_pct)}</td>
                <td className={td}>{p.above_manager === 'block' ? 'Bloqueado: o vendedor não consegue enviar' : 'Analista comercial'}</td>
              </tr>
            </tbody>
          </table>
          <span className="text-[12px] text-ink-2">O gerente também pode decidir os pedidos do nível do supervisor; a decisão fica registrada como acima do nível.</span>
        </Panel>
      )}
      <Panel label="Decisões recentes" title="Decisões recentes de pedidos">
        {decisoes.isError && <ErrorBlock message={errorMessage(decisoes.error)} onRetry={() => void decisoes.refetch()} />}
        {decisoes.data && decisoes.data.length === 0 && <span className="text-[13px] text-ink-2">Nenhuma decisão registrada ainda.</span>}
        {decisoes.data && decisoes.data.length > 0 && (
          <table className="w-full border-collapse text-[13px]" data-testid="alcadas.decisoes">
            <thead>
              <tr>
                <th scope="col" className={th}>Quando</th>
                <th scope="col" className={th}>Quem</th>
                <th scope="col" className={th}>O que</th>
              </tr>
            </thead>
            <tbody>
              {decisoes.data.map((d) => (
                <tr key={d.id}>
                  <td className={`${td} whitespace-nowrap text-ink-2`}>{formatDateTime(d.ocorrido_em, fuso)}</td>
                  <td className={td}>{d.usuario_nome ?? '—'}</td>
                  <td className={td}>{ROTULO_ACAO[d.acao] ?? d.acao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
