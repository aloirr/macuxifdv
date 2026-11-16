'use client';

import { useMemo, useState } from 'react';
import { formatBRL } from '@macuxi/comum';
import { localIsoDate } from '@macuxi/comum/fuso';
import { useAmbiente } from '@macuxi/platform-sdk/react';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoBusca, CLASSE_CAMPO_BASE, type ColunaDaTabela, ErrorBlock, EstadoVazio, FilterBar, formatDateTime, LoadingBlock, type AcaoDoMenu, MenuAcoes, nomeLegivel, PageHeader, rotuloComContagem, SelectField, SeloSituacao, TabelaDados, useToast } from '@macuxi/ui/web';
import { ORDER_STATUS_LABEL, ORDER_STATUSES, type Order } from '../../../contracts';
import { ordersToCsv } from '../../lib/csv';
import { type FiltrosPedidos, temFiltro } from '../../lib/filtros-url';
import { usePedidos, usePendentes, useSessaoDoBko } from '../../lib/queries';
import { useFiltrosNaUrl } from '../../lib/use-filtros';
import { ApprovalsPanel } from './approvals-panel';
import { DecisoesAlcada } from './decisoes-alcada';
import { useAtualizarPedidos } from './decisao';
import { ERRO_IMPRESSAO, exportarPdfDoPedido } from './exportar-pdf';
import { OrderDrawer } from './order-drawer';
import { seloDoPedido } from './status';
import { api } from '@macuxi/platform-sdk/web';
import { lerDetalheDoPedido } from '../../lib/detalhe-pedido';

/** "14/11 09:12" no fuso do tenant: cabe na coluna de 116 px sem reticências (o `title` traz a data completa). */
function dataCurta(iso: string, tz: string): string {
  const p = Object.fromEntries(new Intl.DateTimeFormat('pt-BR', { timeZone: tz, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/**
 * Pedidos no BKO (RF-VEN-04/09, T-0029 §8; revisão do BKO §P1 a §P7): título com a contagem e o total do filtro inteiro
 * (a API devolve os dois, sem os pendentes), busca com lupa, filtros na URL, quadro "Aguardando aprovação" só com pendente
 * (Aprovar/Rejeitar à vista), tabela sem rolagem lateral com um selo por pedido e as ações no "⋯". Atualiza ao abrir, ao focar
 * a janela e depois de decidir (RN-CORE-23, sem consulta periódica própria). A proteção real é na API (escopo, perfil, alçada).
 */
export function OrdersPage() {
  const sessao = useSessaoDoBko();
  const ambiente = useAmbiente();
  const toast = useToast();
  const [filtros, mudar] = useFiltrosNaUrl();
  const [aberto, setAberto] = useState<Order | null>(null);
  const lista = usePedidos(filtros);
  const pendentes = usePendentes();
  const atualizar = useAtualizarPedidos();
  const tz = sessao.fuso;

  const pedidos = useMemo(() => lista.data?.pages.flatMap((p) => p.itens) ?? [], [lista.data]);
  const totalDoFiltro = lista.data?.pages[0]?.total_filtro;
  // vendedores para o filtro: os que aparecem nas páginas carregadas e nos pendentes (a API devolve só o escopo do usuário)
  const vendedores = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of [...pedidos, ...(pendentes.data ?? [])]) m.set(o.seller_id, o.seller_name);
    if (filtros.seller_id && !m.has(filtros.seller_id)) m.set(filtros.seller_id, 'Vendedor selecionado');
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [pedidos, pendentes.data, filtros.seller_id]);
  // filiais para o filtro: as dos pedidos carregados (T-0149; o nome vem do retrato do pedido)
  const filiais = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of pedidos) if (o.branch_id) m.set(o.branch_id, o.branch_name ?? 'Filial');
    if (filtros.branch_id && !m.has(filtros.branch_id)) m.set(filtros.branch_id, 'Filial selecionada');
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [pedidos, filtros.branch_id]);
  const set = <K extends keyof FiltrosPedidos>(k: K, v: FiltrosPedidos[K]) => mudar({ [k]: v } as Partial<FiltrosPedidos>);

  const exportarCsv = () => {
    downloadBlob(new Blob([ordersToCsv(pedidos, tz)], { type: 'text/csv;charset=utf-8' }), `pedidos_${localIsoDate(new Date(), tz)}.csv`);
    toast('success', `CSV com ${pedidos.length} pedidos exportado.`);
  };
  const pdfDaLinha = async (o: Order, view: 'customer' | 'bko') => {
    try {
      const { pedido } = lerDetalheDoPedido(await api<unknown>(`/vendedor/pedidos/${o.id}`));
      await exportarPdfDoPedido(pedido, view, { ambiente, tz });
    } catch (e) {
      toast('danger', ERRO_IMPRESSAO(errorMessage(e)));
    }
  };

  // §P6 regra 3: contagem e total são do filtro inteiro (vêm da API); sem eles, a contagem das linhas carregadas e o "+"
  const quantidade = totalDoFiltro ? totalDoFiltro.quantidade : pedidos.length;
  const soma = totalDoFiltro ? totalDoFiltro.soma_cents : null;
  const titulo = lista.data ? rotuloComContagem('Pedidos', quantidade, !totalDoFiltro && !!lista.hasNextPage) : 'Pedidos';

  const acoesDaPagina: AcaoDoMenu[] = [
    { id: 'csv', rotulo: 'Exportar CSV', aoEscolher: exportarCsv, desligada: pedidos.length === 0, testId: 'pedidos.exportar-csv' },
    { id: 'atualizar', rotulo: lista.isFetching ? 'Atualizando…' : 'Atualizar', aoEscolher: () => atualizar(), desligada: lista.isFetching, testId: 'pedidos.atualizar' },
  ];

  const colunas: ColunaDaTabela<Order>[] = [
    { id: 'cliente', titulo: 'Cliente', celula: (o) => nomeLegivel(o.customer_name), texto: (o) => o.customer_name, largura: '34%' },
    { id: 'numero', titulo: 'Nº', celula: (o) => <span className="tabular-nums">{o.number || '—'}</span>, texto: (o) => o.number, prioridade: 2, largura: '92px' },
    { id: 'vendedor', titulo: 'Vendedor', celula: (o) => o.seller_name, texto: (o) => o.seller_name, prioridade: 2 },
    { id: 'recebido', titulo: 'Recebido', celula: (o) => dataCurta(o.received_at, tz), texto: (o) => formatDateTime(o.received_at, tz), numero: true, prioridade: 3, largura: '116px' },
    { id: 'valor', titulo: 'Valor', celula: (o) => formatBRL(o.total_cents), numero: true, largura: '116px' },
    { id: 'situacao', titulo: 'Situação', celula: (o) => <SeloSituacao selos={[seloDoPedido(o.status, o.situacao_orcamento)]} />, largura: '164px' },
  ];

  const vazio = (
    <EstadoVazio testId="pedidos.vazio" titulo={temFiltro(filtros) ? 'Nenhum pedido com esses filtros.' : 'Nenhum pedido ainda.'} />
  );

  return (
    <>
      <PageHeader
        title={titulo}
        badge={soma !== null && quantidade > 0 ? <span className="text-[17px] font-semibold text-ink-2" data-testid="pedidos.total">{formatBRL(soma)}</span> : undefined}
        actions={<MenuAcoes acoes={acoesDaPagina} rotulo="Mais ações" testId="pedidos.mais-acoes" />}
      />

      <FilterBar>
        <CampoBusca rotulo="Buscar cliente ou nº do pedido" value={filtros.q} maxLength={100} onChange={(e) => set('q', e.target.value)} data-testid="pedidos.filtro-busca" />
        <SelectField label="Situação" value={filtros.status} onChange={(e) => set('status', e.target.value)} data-testid="pedidos.filtro-status">
          <option value="">Todas</option>
          {ORDER_STATUSES.filter((s) => s !== 'draft' && s !== 'queued' && s !== 'pending_approval').map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABEL[s]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Vendedor" value={filtros.seller_id} onChange={(e) => set('seller_id', e.target.value)} data-testid="pedidos.filtro-vendedor">
          <option value="">Todos</option>
          {vendedores.map(([id, nome]) => (
            <option key={id} value={id}>
              {nome}
            </option>
          ))}
        </SelectField>
        <SelectField label="Filial" value={filtros.branch_id} onChange={(e) => set('branch_id', e.target.value)} data-testid="pedidos.filtro-filial">
          <option value="">Todas</option>
          {filiais.map(([id, nome]) => (
            <option key={id} value={id}>
              {nome}
            </option>
          ))}
        </SelectField>
        <fieldset className="m-0 flex min-w-0 flex-col gap-[3px] border-0 p-0">
          <legend className="float-left mb-[3px] p-0 text-[12px] font-semibold text-ink-2">Período</legend>
          <div className={`${CLASSE_CAMPO_BASE} clear-both flex h-[38px] items-center gap-1 px-2`}>
            <input type="date" aria-label="Período: de" className="w-[128px] bg-transparent text-[15px] outline-none" value={filtros.from} max={filtros.to || undefined} onChange={(e) => set('from', e.target.value)} data-testid="pedidos.filtro-de" />
            <span aria-hidden="true" className="text-ink-2">a</span>
            <input type="date" aria-label="Período: até" className="w-[128px] bg-transparent text-[15px] outline-none" value={filtros.to} min={filtros.from || undefined} onChange={(e) => set('to', e.target.value)} data-testid="pedidos.filtro-ate" />
          </div>
        </fieldset>
        {temFiltro(filtros) && (
          <Button size="sm" onClick={() => mudar({ status: '', seller_id: '', branch_id: '', from: '', to: '', q: '' })} data-testid="pedidos.limpar-filtros">
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      {lista.isError && !lista.data && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isError && lista.data && <ErrorBlock message={`Não deu para atualizar agora: ${errorMessage(lista.error)}`} />}
      {lista.isPending && <LoadingBlock />}

      {lista.data && (
        <>
          <ApprovalsPanel approvals={pendentes.data ?? []} nowMs={Date.now()} onOpen={setAberto} />

          <section aria-label="Pedidos" className={pedidos.length === 0 ? '' : 'rounded-2xl border border-line bg-surface p-4'}>
            <TabelaDados
              rotulo="Pedidos"
              colunas={colunas}
              linhas={pedidos}
              chave={(o) => o.id}
              testId="pedidos.tabela"
              linhaTestId={(o) => `pedido.linha.${o.number}`}
              aoAbrir={setAberto}
              vazio={vazio}
              acoes={(o) => [
                { id: 'pdf-cliente', rotulo: 'PDF do cliente', aoEscolher: () => void pdfDaLinha(o, 'customer') },
                { id: 'pdf-interno', rotulo: 'PDF interno', aoEscolher: () => void pdfDaLinha(o, 'bko') },
              ]}
            />
            {lista.hasNextPage && (
              <div className="mt-3 flex justify-center">
                <Button onClick={() => void lista.fetchNextPage()} disabled={lista.isFetchingNextPage} data-testid="pedidos.carregar-mais">
                  {lista.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
                </Button>
              </div>
            )}
          </section>

          <DecisoesAlcada />
        </>
      )}

      <OrderDrawer order={aberto} tz={tz} onClose={() => setAberto(null)} />
    </>
  );
}
