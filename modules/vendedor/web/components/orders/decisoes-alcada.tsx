'use client';

import { errorMessage } from '@macuxi/platform-sdk/web';
import { type ColunaDaTabela, ErrorBlock, EstadoVazio, formatDateTime, Panel, TabelaDados } from '@macuxi/ui/web';
import { useDecisoesRecentes, useSessaoDoBko } from '../../lib/queries';

const ROTULO_ACAO: Record<string, string> = { 'pedido.aprovar': 'Aprovou', 'pedido.rejeitar': 'Rejeitou', 'pedido.cancelar': 'Cancelou' };

/** Decisões recentes de pedidos (histórico, não parâmetro; ADR 0058 D5): quem decidiu pedidos (auditoria, RN-AUD-01). */
export function DecisoesAlcada() {
  const decisoes = useDecisoesRecentes();
  const { fuso } = useSessaoDoBko();
  const colunas: ColunaDaTabela<NonNullable<typeof decisoes.data>[number]>[] = [
    { id: 'quando', titulo: 'Quando', celula: (d) => formatDateTime(d.ocorrido_em, fuso), texto: (d) => formatDateTime(d.ocorrido_em, fuso), largura: '30%' },
    { id: 'quem', titulo: 'Quem', celula: (d) => d.usuario_nome ?? '—', texto: (d) => d.usuario_nome ?? '' },
    { id: 'o-que', titulo: 'O que', celula: (d) => ROTULO_ACAO[d.acao] ?? d.acao, texto: (d) => ROTULO_ACAO[d.acao] ?? d.acao, largura: '25%' },
  ];
  return (
    <Panel label="Decisões recentes" title="Decisões recentes de pedidos">
      {decisoes.isError && <ErrorBlock message={errorMessage(decisoes.error)} onRetry={() => void decisoes.refetch()} />}
      {decisoes.data && (
        <TabelaDados
          rotulo="Decisões recentes de pedidos"
          colunas={colunas}
          linhas={decisoes.data}
          chave={(d) => d.id}
          testId="alcadas.decisoes"
          vazio={<EstadoVazio titulo="Nenhuma decisão registrada." />}
        />
      )}
    </Panel>
  );
}
