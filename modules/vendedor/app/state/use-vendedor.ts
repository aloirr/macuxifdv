/**
 * Hook das telas do Vendedor: lê o estado local (armazenamento do módulo) e escreve na fila do motor de sync
 * do shell (`useMotorSync`). Substitui o `app-store.tsx` da Fase M só no que é de pedido (ADR 0003).
 * Nada aqui espera a rede para mostrar dados: a rede só confirma o envio.
 */
import type { CustomerSummary } from '@macuxi/core/contracts';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { DEFAULT_TZ, monthStart } from '@macuxi/ui/mobile';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CreateOrderRequest, CustomerDetail, MixSuggestion, Order, OrderDetail, Product, UpdateOrderRequest } from '../../contracts';
import { orderActions, type OrderStatus } from '../../domain/order';
import { ambienteVendedor, ErroSemConexao, exigirAmbiente } from '../ambiente';
import { prefillLines, prefillNotice } from '../lib/order-prefill';
import {
  draftKeyFor,
  fonteDoPedido,
  mergeOrders,
  montarPedido,
  pedidosNaFila,
  prepararPedido,
  rascunhoVazio,
  type OrderDisplay,
  type PedidoDaLista,
  type PedidoNaFila,
  type Rascunho,
} from '../lib/pedidos';
import { criarRepositorio, DADOS_VAZIOS, type DadosVendedor } from '../lib/repositorio';

const PRECISA_SINAL = 'editar ou excluir pedido já enviado precisa de conexão (o status pode ter mudado no servidor).';

export type ResultadoEnvio = { kind: 'sent'; order: OrderDetail } | { kind: 'queued'; message: string };
export type ResultadoAlteracao = { kind: 'local' } | { kind: 'server'; order: OrderDetail };

export function useVendedor() {
  const { motor, estado } = useMotorSync();
  const repo = useMemo(() => (motor ? criarRepositorio(motor.armazenamentoDoModulo('vendedor')) : null), [motor]);
  const [dados, setDados] = useState<DadosVendedor>(DADOS_VAZIOS);
  const [carregado, setCarregado] = useState(false);
  const dadosRef = useRef(dados);
  dadosRef.current = dados;

  const recarregar = useCallback(async () => {
    if (!repo) return;
    const novos = await repo.carregar();
    dadosRef.current = novos;
    setDados(novos);
    setCarregado(true);
  }, [repo]);

  // recarrega ao abrir e a cada sincronização concluída (novo carimbo) ou mudança do módulo
  useEffect(() => {
    void recarregar();
  }, [recarregar, estado.sincronizado_em]);

  const tz = dados.me?.tenant.timezone || DEFAULT_TZ;
  const vendedor = dados.me?.seller ?? null;
  const fila: PedidoNaFila[] = useMemo(
    () => pedidosNaFila(estado.fila.filter((i) => i.modulo === 'vendedor'), dados.exibicoes),
    [estado.fila, dados.exibicoes],
  );
  const filaRef = useRef(fila);
  filaRef.current = fila;
  const pedidos: PedidoDaLista[] = useMemo(
    () => (vendedor ? mergeOrders(dados.pedidos, fila, { id: vendedor.id, name: vendedor.name, branch_id: vendedor.branch_id }) : dados.pedidos.map((o) => ({ ...o, local: false, local_error: '' }))),
    [dados.pedidos, fila, vendedor],
  );

  const offline = !(ambienteVendedor()?.online() ?? true);

  // ---------- leituras com rede (melhor esforço; sem rede, fica o que está no aparelho) ----------
  const atualizarPedidos = useCallback(async () => {
    const amb = ambienteVendedor();
    if (!amb || !amb.online() || !repo) return;
    try {
      const r = await amb.requisitar<{ items: Order[] }>('GET', '/orders', { query: { from: monthStart(new Date(), tz), limit: 1000 } });
      await repo.gravar('pedidos', r.items);
      await recarregar();
    } catch {
      // sem rede: continua com o cache
    }
  }, [repo, recarregar, tz]);

  const carregarPedido = useCallback(
    async (id: string) => {
      const amb = ambienteVendedor();
      if (!amb || !amb.online() || !repo) return;
      try {
        const detalhe = await amb.requisitar<OrderDetail>('GET', `/orders/${encodeURIComponent(id)}`);
        await repo.guardarPedido(detalhe);
        await recarregar();
      } catch {
        // sem rede: continua com o cache
      }
    },
    [repo, recarregar],
  );

  /** Mix sugerido e últimos pedidos do cliente para a ficha; sem sinal fica o que já está no aparelho. */
  const carregarFicha = useCallback(
    async (customerId: string) => {
      const amb = ambienteVendedor();
      if (!amb || !amb.online() || !repo) return;
      const id = encodeURIComponent(customerId);
      const [mix, detalhe] = await Promise.allSettled([
        amb.requisitar<{ items: MixSuggestion[] }>('GET', `/customers/${id}/mix-suggestions`),
        amb.requisitar<CustomerDetail>('GET', `/customers/${id}`),
      ]);
      if (mix.status === 'fulfilled') await repo.alterar('mix', (m) => ({ ...m, [customerId]: mix.value.items }));
      if (detalhe.status === 'fulfilled') await repo.alterar('ultimos', (u) => ({ ...u, [customerId]: detalhe.value.recent_orders }));
      await recarregar();
    },
    [repo, recarregar],
  );

  const tabelaDe = useCallback(
    (cliente: CustomerSummary): Product[] => dadosRef.current.produtos[cliente.price_table_id ?? 'default']?.items ?? [],
    [],
  );

  /** Garante a tabela do cliente no aparelho; com sinal e sem tabela, baixa agora. */
  const garantirProdutos = useCallback(
    async (cliente: CustomerSummary): Promise<Product[]> => {
      const atual = tabelaDe(cliente);
      const amb = ambienteVendedor();
      if (atual.length > 0 || !amb || !amb.online() || !repo) return atual;
      try {
        const r = await amb.requisitar<{ items: Product[] }>('GET', '/products', { query: { customer_id: cliente.price_table_id ? cliente.id : undefined, limit: 5000 } });
        await repo.alterar('produtos', (p) => ({ ...p, [cliente.price_table_id ?? 'default']: { items: r.items, synced_at: new Date().toISOString() } }));
        await recarregar();
        return r.items;
      } catch {
        return atual;
      }
    },
    [repo, recarregar, tabelaDe],
  );

  // ---------- rascunho ----------
  const rascunhoDe = useCallback((chave: string, customerId: string): Rascunho => dadosRef.current.rascunhos[chave] ?? rascunhoVazio(customerId), []);

  const atualizarRascunho = useCallback(
    async (chave: string, customerId: string, fn: (r: Rascunho) => Rascunho) => {
      if (!repo) return;
      const atual = dadosRef.current.rascunhos[chave] ?? rascunhoVazio(customerId);
      const novo = { ...fn(atual), updated_at: new Date().toISOString() };
      // atualiza já na memória (digitação rápida) e persiste em seguida
      const proximo = { ...dadosRef.current, rascunhos: { ...dadosRef.current.rascunhos, [chave]: novo } };
      dadosRef.current = proximo;
      setDados(proximo);
      await repo.guardarRascunho(chave, novo);
    },
    [repo],
  );

  // ---------- pedido ----------
  const custoDaFilaDoCliente = (customerId: string, ignorar?: string) =>
    filaRef.current.filter((o) => o.payload.customer_id === customerId && o.payload.id !== ignorar).reduce((s, o) => s + (o.display?.total_cents ?? 0), 0);

  const prepararDoRascunho = useCallback((rascunho: Rascunho, cliente: CustomerSummary, catalogo: Product[], editId?: string) => {
    const d = dadosRef.current;
    if (!d.politica) throw new Error('Alçadas ainda não estão no aparelho. Sincronize com sinal e tente de novo.');
    const editado = editId ? d.pedidos.find((o) => o.id === editId) ?? null : null;
    return prepararPedido({
      rascunho,
      cliente,
      catalogo,
      politica: d.politica,
      eu: d.me?.seller ?? null,
      filaDoClienteCents: custoDaFilaDoCliente(cliente.id, editId),
      pedidoEditado: editado,
    });
  }, []);

  /** Envia o pedido: grava na fila (persistida) e tenta enviar; erro definitivo volta para o vendedor corrigir. */
  const enviarPedido = useCallback(
    async (rascunho: Rascunho, cliente: CustomerSummary, catalogo: Product[]): Promise<ResultadoEnvio> => {
      if (!motor || !repo) throw new Error('Aplicativo ainda carregando. Aguarde um instante e tente de novo.');
      const amb = exigirAmbiente();
      const { v, display } = prepararDoRascunho(rascunho, cliente, catalogo);
      const id = amb.novoId();
      const agora = new Date().toISOString();
      const payload: CreateOrderRequest = montarPedido({ id, cliente, rascunho, v, semSinal: !amb.online(), agora });
      await repo.guardarExibicao(id, display);
      await motor.enfileirar({ id, entidade: 'pedido', payload, rotulo: `Pedido · ${cliente.trade_name}`, detalhe: `${(display.total_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · ${display.items_count} ${display.items_count === 1 ? 'item' : 'itens'}` });
      await repo.limparRascunho(draftKeyFor(cliente.id));
      if (!amb.online()) {
        await recarregar();
        return { kind: 'queued', message: 'Modo sem sinal: o pedido será enviado quando o sinal voltar.' };
      }
      const resultados = await motor.enviar();
      const r = resultados.find((x) => x.id === id);
      if (r && r.status === 'aceito') {
        await carregarPedido(id);
        await repo.removerExibicao(id);
        await recarregar();
        const detalhe = dadosRef.current.detalhes[id];
        if (detalhe) return { kind: 'sent', order: detalhe };
        return { kind: 'queued', message: 'Pedido enviado. Os detalhes aparecem na próxima atualização.' };
      }
      if (r) {
        // recusado pelo servidor: sai da fila e volta para o vendedor corrigir
        await motor.descartar(id);
        await repo.removerExibicao(id);
        await recarregar();
        throw new Error(r.mensagem || 'O servidor recusou o pedido. Revise os itens e tente de novo.');
      }
      await recarregar();
      const item = motor.estado().fila.find((i) => i.id === id);
      return { kind: 'queued', message: item?.ultimo_erro || 'Sem conexão: o pedido será enviado quando o sinal voltar.' };
    },
    [motor, repo, prepararDoRascunho, recarregar, carregarPedido],
  );

  /** Duplicar (`duplicate`) ou editar (`edit`): rascunho com o mesmo cliente/itens e os preços de hoje (RN-VEN preço). */
  const prepararRascunhoDoPedido = useCallback(
    async (orderId: string, modo: 'duplicate' | 'edit'): Promise<{ customerId: string; chave: string }> => {
      if (!repo) throw new Error('Aplicativo ainda carregando. Aguarde um instante e tente de novo.');
      const d = dadosRef.current;
      const src = fonteDoPedido(orderId, filaRef.current, d.detalhes);
      if (!src) throw new Error('Itens do pedido ainda não estão no aparelho. Abra o pedido com sinal e tente de novo.');
      const cliente = d.clientes.find((c) => c.id === src.customer_id);
      if (!cliente) throw new Error('Cliente fora da carteira sincronizada no aparelho.');
      const catalogo = await garantirProdutos(cliente);
      if (catalogo.length === 0) throw new Error('Tabela de preços do cliente não está no aparelho. Sincronize com sinal.');
      const r = prefillLines(src.lines, catalogo);
      if (Object.keys(r.lines).length === 0 && modo === 'duplicate') throw new Error(`Nenhum item do pedido está ativo com preço na tabela. ${prefillNotice(r)}`);
      const origem = src.number ? `pedido ${src.number}` : 'pedido no aparelho';
      const cabeca = modo === 'duplicate' ? `Cópia do ${origem} com os preços de hoje da tabela do cliente.` : 'Preços atualizados pela tabela de hoje do cliente.';
      const chave = draftKeyFor(cliente.id, modo === 'edit' ? orderId : null);
      await repo.guardarRascunho(chave, {
        customer_id: cliente.id,
        lines: r.lines,
        discount_pct: src.discount_pct,
        payment_terms: src.payment_terms,
        visit_id: null,
        route_stop_id: null,
        updated_at: new Date().toISOString(),
        edit_order_id: modo === 'edit' ? orderId : null,
        notice: [cabeca, prefillNotice(r)].filter(Boolean).join(' '),
      });
      await recarregar();
      return { customerId: cliente.id, chave };
    },
    [repo, garantirProdutos, recarregar],
  );

  /** Salva a edição. Na fila: altera o item (funciona sem sinal). No servidor: PUT, que exige conexão. */
  const salvarEdicao = useCallback(
    async (orderId: string, rascunho: Rascunho, cliente: CustomerSummary, catalogo: Product[]): Promise<ResultadoAlteracao> => {
      if (!motor || !repo) throw new Error('Aplicativo ainda carregando. Aguarde um instante e tente de novo.');
      const amb = exigirAmbiente();
      const { v, display } = prepararDoRascunho(rascunho, cliente, catalogo, orderId);
      const itens = v.totals.lines.map((l) => ({ product_id: l.product_id, quantity: l.quantity }));
      const chave = draftKeyFor(cliente.id, orderId);
      const naFila = filaRef.current.find((o) => o.payload.id === orderId);
      if (naFila) {
        await repo.guardarExibicao(orderId, display);
        await motor.alterar(orderId, { payload: { ...naFila.payload, discount_pct: rascunho.discount_pct, payment_terms: rascunho.payment_terms, total_cents: display.total_cents, items: itens } satisfies CreateOrderRequest });
        await repo.limparRascunho(chave);
        await recarregar();
        if (amb.online()) void motor.enviar({ incluirFalhos: true });
        return { kind: 'local' };
      }
      if (!amb.online()) throw new Error(`Modo sem sinal: ${PRECISA_SINAL} Desligue no Perfil quando tiver sinal.`);
      const corpo: UpdateOrderRequest = { customer_id: cliente.id, discount_pct: rascunho.discount_pct, payment_terms: rascunho.payment_terms, items: itens };
      let order: OrderDetail;
      try {
        order = await amb.requisitar<OrderDetail>('PUT', `/orders/${encodeURIComponent(orderId)}`, { body: corpo });
      } catch (e) {
        if (e instanceof ErroSemConexao) throw new Error(`Sem conexão: ${PRECISA_SINAL} Suas alterações continuam aqui; tente de novo.`);
        throw e;
      }
      await repo.guardarPedido(order);
      await repo.limparRascunho(chave);
      await recarregar();
      return { kind: 'server', order };
    },
    [motor, repo, prepararDoRascunho, recarregar],
  );

  /** Excluir = cancelar (nunca apaga no servidor). Pedido ainda na fila: sai da fila do aparelho. */
  const excluirPedido = useCallback(
    async (orderId: string, motivo: string): Promise<ResultadoAlteracao> => {
      if (!motor || !repo) throw new Error('Aplicativo ainda carregando. Aguarde um instante e tente de novo.');
      const naFila = filaRef.current.find((o) => o.payload.id === orderId);
      if (naFila) {
        await motor.descartar(orderId);
        await repo.removerExibicao(orderId);
        await recarregar();
        return { kind: 'local' };
      }
      const amb = exigirAmbiente();
      if (!amb.online()) throw new Error(`Modo sem sinal: ${PRECISA_SINAL}`);
      let order: OrderDetail;
      try {
        order = await amb.requisitar<OrderDetail>('POST', `/orders/${encodeURIComponent(orderId)}/cancel`, { body: motivo.trim() ? { reason: motivo.trim() } : {} });
      } catch (e) {
        if (e instanceof ErroSemConexao) throw new Error(`Sem conexão: ${PRECISA_SINAL}`);
        throw e;
      }
      await repo.guardarPedido(order);
      await recarregar();
      return { kind: 'server', order };
    },
    [motor, repo, recarregar],
  );

  const reenviarFila = useCallback(async () => {
    if (!motor) return;
    await motor.enviar({ incluirFalhos: true });
    await recarregar();
  }, [motor, recarregar]);

  const acoesDe = (status: string) => orderActions(status as OrderStatus);

  return {
    carregado,
    dados,
    tz,
    vendedor,
    offline,
    fila,
    pedidos,
    enviando: estado.enviando,
    sincronizando: estado.sincronizando,
    erroSync: estado.erro,
    motor,
    recarregar,
    atualizarPedidos,
    carregarPedido,
    carregarFicha,
    garantirProdutos,
    tabelaDe,
    rascunhoDe,
    atualizarRascunho,
    prepararDoRascunho,
    enviarPedido,
    prepararRascunhoDoPedido,
    salvarEdicao,
    excluirPedido,
    reenviarFila,
    acoesDe,
  };
}

export type { OrderDisplay };
