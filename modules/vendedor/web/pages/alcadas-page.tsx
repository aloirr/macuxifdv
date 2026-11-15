'use client';

import { formatPct } from '@macuxi/comum';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { type ColunaDaTabela, ErrorBlock, EstadoVazio, formatDateTime, LoadingBlock, PageHeader, Panel, TabelaDados } from '@macuxi/ui/web';
import { useAlcadas, useDecisoesRecentes, useSessaoDoBko } from '../lib/queries';

const ROTULO_ACAO: Record<string, string> = { 'pedido.aprovar': 'Aprovou', 'pedido.rejeitar': 'Rejeitou', 'pedido.cancelar': 'Cancelou' };

interface Faixa {
  id: string;
  desconto: string;
  quem: string;
}

/**
 * Alçadas de desconto (RN-VEN-10), só leitura nesta fatia: os limites vêm dos parâmetros do tenant e são os mesmos que o
 * servidor aplica ao receber o pedido e que o aparelho mostra ao vendedor. Revisão do BKO: sem subtítulo nem texto de
 * explicação (§P1, §P9). A trilha mostra quem decidiu pedidos (auditoria da plataforma, RN-AUD-01).
 */
export function AlcadasPage() {
  const alcadas = useAlcadas();
  const decisoes = useDecisoesRecentes();
  const { fuso } = useSessaoDoBko();
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
  const colunasDecisoes: ColunaDaTabela<NonNullable<typeof decisoes.data>[number]>[] = [
    { id: 'quando', titulo: 'Quando', celula: (d) => formatDateTime(d.ocorrido_em, fuso), texto: (d) => formatDateTime(d.ocorrido_em, fuso), largura: '30%' },
    { id: 'quem', titulo: 'Quem', celula: (d) => d.usuario_nome ?? '—', texto: (d) => d.usuario_nome ?? '' },
    { id: 'o-que', titulo: 'O que', celula: (d) => ROTULO_ACAO[d.acao] ?? d.acao, texto: (d) => ROTULO_ACAO[d.acao] ?? d.acao, largura: '25%' },
  ];

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="alcadas.tela">
      <PageHeader title="Alçadas de desconto" />
      {alcadas.isError && <ErrorBlock message={errorMessage(alcadas.error)} onRetry={() => void alcadas.refetch()} />}
      {alcadas.isPending && <LoadingBlock label="Carregando as alçadas…" />}
      {p && (
        <Panel label="Limites" title="Limites por nível">
          <TabelaDados rotulo="Limites por nível" colunas={colunasFaixas} linhas={faixas} chave={(f) => f.id} testId="alcadas.tabela" />
        </Panel>
      )}
      <Panel label="Decisões recentes" title="Decisões recentes de pedidos">
        {decisoes.isError && <ErrorBlock message={errorMessage(decisoes.error)} onRetry={() => void decisoes.refetch()} />}
        {decisoes.data && (
          <TabelaDados
            rotulo="Decisões recentes de pedidos"
            colunas={colunasDecisoes}
            linhas={decisoes.data}
            chave={(d) => d.id}
            testId="alcadas.decisoes"
            vazio={<EstadoVazio titulo="Nenhuma decisão registrada." />}
          />
        )}
      </Panel>
    </div>
  );
}
