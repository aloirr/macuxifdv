'use client';

import { formatPct } from '@macuxi/comum';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { type ColunaDaTabela, ErrorBlock, LoadingBlock, Panel, TabelaDados } from '@macuxi/ui/web';
import { useAlcadas } from '../lib/queries';

interface Faixa {
  id: string;
  desconto: string;
  quem: string;
}

/**
 * Alçadas de desconto (RN-VEN-10), só leitura nesta fatia: os limites vêm dos parâmetros do tenant e são os mesmos que o
 * servidor aplica ao receber o pedido e que o aparelho mostra ao vendedor. Painel de Parâmetros (ADR 0058); o histórico
 * de decisões fica em Pedidos (`DecisoesAlcada`). Sem subtítulo nem texto de explicação (§P1, §P9).
 */
export function AlcadasPage() {
  const alcadas = useAlcadas();
  const p = alcadas.data;

  const faixas: Faixa[] = p
    ? [
        { id: 'vendedor', desconto: `Até ${formatPct(p.seller_pct)}`, quem: 'Vendedor (aprovado na hora)' },
        { id: 'supervisor', desconto: `Até ${formatPct(p.supervisor_pct)}`, quem: 'Supervisor' },
        { id: 'gerente', desconto: `Até ${formatPct(p.manager_pct)}`, quem: 'Gerente' },
        { id: 'acima', desconto: `Acima de ${formatPct(p.manager_pct)}`, quem: p.above_manager === 'block' ? 'Bloqueado: o vendedor não consegue enviar' : 'Analista comercial' },
      ]
    : [];
  const colunasFaixas: ColunaDaTabela<Faixa>[] = [
    { id: 'desconto', titulo: 'Desconto do pedido', celula: (f) => f.desconto, texto: (f) => f.desconto, largura: '40%' },
    { id: 'quem', titulo: 'Quem aprova', celula: (f) => f.quem, texto: (f) => f.quem },
  ];

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="alcadas.tela">
      {alcadas.isError && <ErrorBlock message={errorMessage(alcadas.error)} onRetry={() => void alcadas.refetch()} />}
      {alcadas.isPending && <LoadingBlock label="Carregando as alçadas…" />}
      {p && (
        <Panel label="Limites" title="Limites por nível">
          <TabelaDados rotulo="Limites por nível" colunas={colunasFaixas} linhas={faixas} chave={(f) => f.id} testId="alcadas.tabela" />
        </Panel>
      )}
    </div>
  );
}
