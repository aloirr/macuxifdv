/**
 * Hook das telas do Vendedor: lê o estado local e escreve na fila do motor de sync do shell (`useMotorSync`).
 * Nada aqui espera a rede para mostrar dados: a rede só confirma o envio (offline-first, ADR 0003).
 *
 * Duas fontes (T-0029 §8):
 *  - API v1 (usuário com fuso do tenant): pedidos, itens, histórico, clientes, produtos, condições e tabelas pelo PULL do
 *    sync (linhas no aparelho); preço pela consulta `catalogo.precos_cliente@1` (ADR 0012); alçadas pelos parâmetros do
 *    tenant (E3); pedido da fila sobreposto às linhas (ADR 0009 §3). Nenhuma rota da Fase M (/orders, /customers...).
 *  - Demonstração (mock-api da Fase M): as cargas REST de `etapas.ts` alimentam o armazenamento do módulo, como antes.
 * Decidir pedido (aprovar/rejeitar) e cancelar pedido já aceito exigem internet: o estado pode ter mudado no servidor.
 */
import { CONSULTA_BUSCA_PRODUTOS, CONSULTA_PRECOS_CLIENTE, CONSULTA_SUGESTOES_PEDIDO, CONSULTA_TEXTOS_PRODUTO, type Product, type SugestoesPedidoSaida } from '@macuxi/catalogo/contracts';
import type { CustomerSummary } from '@macuxi/core/contracts';
import { ehConsultaIndisponivel, ehSemConexao } from '@macuxi/platform-sdk';
import { useAmbiente, useMotorSync } from '@macuxi/platform-sdk/react';
import { DEFAULT_TZ, monthStart } from '@macuxi/ui/mobile/puro';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MixSuggestion } from '@macuxi/catalogo/contracts';
import type { CustomerDetail, EditarOrcamentoRequest, Order, OrderDetail, PedidoPush, UpdateOrderRequest } from '../../contracts';
import { orderActions, type OrderStatus } from '../../domain/order';
import type { NivelDePreco } from '../../domain/preco-pedido';
import { prefillLines, prefillNotice } from '../lib/order-prefill';
import { copiaDoDetalhe, copiaDoPayload, rascunhoDaCopia, reconferirDocumento, textoDaMudanca } from '../lib/documento';
import { toDomainPolicy } from '../lib/catalog';
import { montarSugestoes, SUGESTOES_VAZIAS, type SugestoesDaTela } from '../lib/sugestoes-pedido';
import { embalagensDaConsulta, linhasParaPush } from '../lib/novo-pedido';
import { aplicacaoMaxOrcamento, aplicacaoNoOrcamentoPadrao } from '../../domain/aplicacao';
import { idsSemTexto } from '../../domain/busca-seletor';
import { buscarNoCatalogoComReserva, type ResultadoBuscaCatalogo } from '../lib/busca-catalogo';
import { situacaoDoClienteSync } from '../lib/textos-pedido';
import {
  aceitosComoPedidos,
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
import {
  agruparPorPedido,
  condicoesDoCliente,
  detalheDoPedido,
  LINHAS_VAZIAS,
  lerLinhas,
  listaDeClientes,
  listaDePedidos,
  meDoAparelho,
  enderecosDaTela,
  paraAprovar,
  politicaApi,
  transportadorasDaTela,
  unidadesDaTela,
  produtosComPrecos,
  type CondicaoDaTela,
  type LinhasVendedor,
} from '../lib/pull';
import { criarRepositorio, DADOS_VAZIOS, type DadosVendedor } from '../lib/repositorio';
import { relogioReal } from '@macuxi/comum/relogio';
import { podeSincronizarManual } from '../lib/sincronizar';
import { pedidoDaConversao, preVendaAtiva } from '../lib/pre-venda';

const PRECISA_SINAL = 'editar ou excluir pedido já enviado precisa de conexão (o status pode ter mudado no servidor).';
const LOTE_PRECOS = 500;

/** `id` do documento na fila (T-0071, V8): a tela abre o detalhe dele em vez de ficar no editor */
export type ResultadoEnvio = { kind: 'sent'; order: OrderDetail } | { kind: 'queued'; message: string; id?: string };
export type ResultadoAlteracao = { kind: 'local' } | { kind: 'server'; order: OrderDetail };

export function useVendedor() {
  const { motor, estado } = useMotorSync();
  const ambiente = useAmbiente();
  const repo = useMemo(() => (motor ? criarRepositorio(motor.armazenamentoDoModulo('vendedor')) : null), [motor]);
  const [dadosRepo, setDadosRepo] = useState<DadosVendedor>(DADOS_VAZIOS);
  const [linhas, setLinhas] = useState<LinhasVendedor>(LINHAS_VAZIAS);
  const [decididos, setDecididos] = useState<Record<string, OrderDetail>>({});
  const [carregado, setCarregado] = useState(false);
  const dadosRef = useRef(dadosRepo);
  dadosRef.current = dadosRepo;
  const linhasRef = useRef(linhas);
  linhasRef.current = linhas;

  const usuario = ambiente.usuario();
  /** API v1: o login traz o fuso do tenant; a demonstração (mock-api) não. */
  const v1 = Boolean(usuario?.fuso);
  const perfil = usuario?.perfil ?? '';
  const parametros = ambiente.parametros('vendedor');
  const parametrosRef = useRef(parametros);
  parametrosRef.current = parametros;

  const recarregar = useCallback(async () => {
    if (!repo) return;
    const [novos, ls] = await Promise.all([repo.carregar(), v1 && motor ? lerLinhas(motor) : Promise.resolve(LINHAS_VAZIAS)]);
    dadosRef.current = novos;
    linhasRef.current = ls;
    setDadosRepo(novos);
    setLinhas(ls);
    setCarregado(true);
    if (v1) {
      // o pull trouxe a linha: o resumo guardado para o item da fila já não faz falta
      const ids = new Set(ls.pedidos.map((p) => p.id));
      for (const id of Object.keys(novos.exibicoes)) if (ids.has(id)) void repo.removerExibicao(id);
    }
  }, [repo, motor, v1]);

  // recarrega ao abrir e a cada sincronização concluída (novo carimbo) ou mudança do módulo
  useEffect(() => {
    void (async () => {
      // o preço pode ter mudado no pull: refaz a tabela na próxima vez que a tela do pedido abrir
      if (v1 && repo) await repo.gravar('produtos', {});
      await recarregar();
    })();
  }, [recarregar, estado.sincronizado_em, v1, repo]);

  // T-0079 / V2: depois da troca de geração da base, exibição que não é de item da fila/aceito é órfã e sai (planoBaseRecriada)
  useEffect(() => {
    if (!repo || estado.sincronizando) return;
    const itens = [...estado.fila, ...estado.aceitos]
      .filter((i) => i.modulo === 'vendedor')
      .map((i) => ({ id: i.id, entidade: i.entidade, situacao: 'pendente' as const }));
    void repo.podarExibicoesOrfas(itens).then((podou) => (podou ? recarregar() : undefined));
  }, [repo, estado.sincronizando, estado.fila, estado.aceitos, recarregar]);

  // a decisão já feita volta ao normal quando o pull traz o estado novo
  useEffect(() => {
    setDecididos((d) => {
      const restantes = Object.entries(d).filter(([id, det]) => linhas.pedidos.find((p) => p.id === id)?.status !== det.status);
      return restantes.length === Object.keys(d).length ? d : Object.fromEntries(restantes);
    });
  }, [linhas.pedidos]);

  const me = useMemo(() => (v1 && usuario ? meDoAparelho({ id: usuario.id, nome: usuario.nome, perfil: usuario.perfil, fuso: usuario.fuso }, parametros, new Date()) : dadosRepo.me), [v1, usuario, parametros, dadosRepo.me]);
  const tz = me?.tenant.timezone || DEFAULT_TZ;
  const vendedor = me?.seller ?? null;
  const politica = useMemo(() => (v1 ? politicaApi(parametros) : dadosRepo.politica), [v1, parametros, dadosRepo.politica]);
  const clientes = useMemo(() => (v1 ? listaDeClientes(linhas, { id: usuario?.id ?? '', name: usuario?.nome ?? '' }) : dadosRepo.clientes), [v1, linhas, usuario, dadosRepo.clientes]);
  const pedidosServidor = useMemo(() => (v1 ? listaDePedidos(linhas, parametros) : dadosRepo.pedidos), [v1, linhas, parametros, dadosRepo.pedidos]);

  const dados: DadosVendedor = useMemo(
    () => ({ ...dadosRepo, me, politica, clientes, pedidos: pedidosServidor }),
    [dadosRepo, me, politica, clientes, pedidosServidor],
  );

  const fila: PedidoNaFila[] = useMemo(
    () => pedidosNaFila(estado.fila.filter((i) => i.modulo === 'vendedor'), dadosRepo.exibicoes),
    [estado.fila, dadosRepo.exibicoes],
  );
  const filaRef = useRef(fila);
  filaRef.current = fila;
  const aceitos: PedidoNaFila[] = useMemo(
    () => pedidosNaFila(estado.aceitos.filter((i) => i.modulo === 'vendedor' && i.entidade === 'pedido'), dadosRepo.exibicoes),
    [estado.aceitos, dadosRepo.exibicoes],
  );
  const pedidos: PedidoDaLista[] = useMemo(() => {
    if (!vendedor) return dados.pedidos.map((o) => ({ ...o, local: false, local_error: '' }));
    const eu = { id: vendedor.id, name: vendedor.name, branch_id: vendedor.branch_id };
    const noServidor = new Set(dados.pedidos.map((o) => o.id));
    const todos = mergeOrders(dados.pedidos, fila, eu);
    return v1 ? [...aceitosComoPedidos(aceitos, noServidor, eu), ...todos] : todos;
  }, [dados.pedidos, fila, aceitos, vendedor, v1]);

  const offline = !ambiente.online();

  // ---------- leituras (melhor esforço; sem rede, fica o que está no aparelho) ----------
  /**
   * RN-CORE-23 (T-0054): a tela NÃO faz consulta própria nem dispara sync ao abrir; só relê o aparelho. O pull vem do motor
   * de sync da plataforma (shell): a cada `sync_auto_min`, ao abrir o app e ao voltar ao primeiro plano depois de 30 min;
   * cada sync concluído recarrega o módulo (efeito acima, pelo `sincronizado_em`). Puxar para baixo = `sincronizarAgora`.
   */
  const atualizarPedidos = useCallback(async () => {
    if (v1) {
      await recarregar();
      return;
    }
    if (!ambiente.online() || !repo) return;
    try {
      const r = await ambiente.http.requisitar<{ items: Order[] }>('GET', '/orders', { query: { from: monthStart(new Date(), tz), limit: 1000 } });
      await repo.gravar('pedidos', r.items);
      await recarregar();
    } catch {
      // sem rede: continua com o cache
    }
  }, [v1, motor, repo, recarregar, tz, ambiente]);

  /** Detalhe do pedido: decisão recém-tomada, senão as linhas do aparelho (v1) ou o cache da demonstração. */
  const detalhe = useCallback(
    (id: string): OrderDetail | null => {
      if (!v1) return dadosRef.current.detalhes[id] ?? null;
      return decididos[id] ?? detalheDoPedido(linhasRef.current, id, perfil, parametrosRef.current);
    },
    [v1, decididos, perfil, linhas],
  );

  const carregarPedido = useCallback(
    async (id: string) => {
      if (v1) {
        // API v1: o detalhe vem das linhas do aparelho (RN-CORE-23: sem consulta própria; o estado novo chega no sync)
        await recarregar();
        return;
      }
      if (!ambiente.online() || !repo) return;
      try {
        const d = await ambiente.http.requisitar<OrderDetail>('GET', `/orders/${encodeURIComponent(id)}`);
        await repo.guardarPedido(d);
        await recarregar();
      } catch {
        // sem rede: continua com o cache
      }
    },
    [v1, repo, recarregar, ambiente],
  );

  /**
   * RN-CORE-23: "puxar para baixo" = Sincronizar — envia a fila e roda o sync completo do motor da plataforma, com
   * proteção de 30 s contra toques repetidos (dentro dela, só relê o aparelho).
   */
  const ultimoManual = useRef(0);
  const sincronizarAgora = useCallback(async () => {
    if (!v1) {
      await atualizarPedidos();
      return;
    }
    const agora = relogioReal().agora().getTime();
    const liberado = podeSincronizarManual(ultimoManual.current, agora);
    if (liberado && motor && ambiente.online() && !motor.estado().sincronizando) {
      ultimoManual.current = agora;
      await motor.enviar().catch(() => []);
      await motor.sincronizar().catch(() => false);
    }
    await recarregar();
  }, [v1, motor, ambiente, recarregar, atualizarPedidos]);

  /** Mix sugerido e últimos pedidos da ficha (demonstração); na API v1 os últimos vêm do pull e o mix fica para o Catálogo. */
  const carregarFicha = useCallback(
    async (customerId: string) => {
      if (v1 || !ambiente.online() || !repo) return;
      const id = encodeURIComponent(customerId);
      const [mix, det] = await Promise.allSettled([
        ambiente.http.requisitar<{ items: MixSuggestion[] }>('GET', `/customers/${id}/mix-suggestions`),
        ambiente.http.requisitar<CustomerDetail>('GET', `/customers/${id}`),
      ]);
      if (mix.status === 'fulfilled') await repo.alterar('mix', (m) => ({ ...m, [customerId]: mix.value.items }));
      if (det.status === 'fulfilled') await repo.alterar('ultimos', (u) => ({ ...u, [customerId]: det.value.recent_orders }));
      await recarregar();
    },
    [v1, repo, recarregar, ambiente],
  );

  const tabelaDe = useCallback((cliente: CustomerSummary): Product[] => dadosRef.current.produtos[cliente.price_table_id ?? 'default']?.items ?? [], []);

  /** Garante a tabela do cliente no aparelho: v1 calcula pela consulta do Catálogo (offline); demonstração baixa com sinal. */
  const garantirProdutos = useCallback(
    async (cliente: CustomerSummary): Promise<Product[]> => {
      const atual = tabelaDe(cliente);
      if (atual.length > 0 || !repo) return atual;
      const chave = cliente.price_table_id ?? 'default';
      if (v1) {
        try {
          const ativos = linhasRef.current.produtos.filter((p) => p.ativo);
          const precos = new Map<string, number | null>();
          const itensConsulta: Array<{ produto_id: string; embalagens?: Array<{ unidade: string; preco_cents: number }> }> = [];
          const agora = new Date().toISOString();
          for (let i = 0; i < ativos.length; i += LOTE_PRECOS) {
            const r = await ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: cliente.id, produto_ids: ativos.slice(i, i + LOTE_PRECOS).map((p) => p.id), em: agora });
            for (const it of r.itens) {
              precos.set(it.produto_id, it.preco_cents);
              itensConsulta.push(it);
            }
          }
          // T-0084 §12 (RN-VEN-19): a aplicação NÃO é carregada aqui (tabela inteira); a tela lê só dos itens visíveis (textosDeProdutos)
          const items = produtosComPrecos(linhasRef.current, precos);
          await repo.alterar('produtos', (p) => ({ ...p, [chave]: { items, synced_at: agora, embalagens: embalagensDaConsulta(itensConsulta) } }));
          await recarregar();
          return items;
        } catch {
          return atual;
        }
      }
      if (!ambiente.online()) return atual;
      try {
        const r = await ambiente.http.requisitar<{ items: Product[] }>('GET', '/products', { query: { customer_id: cliente.price_table_id ? cliente.id : undefined, limit: 5000 } });
        await repo.alterar('produtos', (p) => ({ ...p, [chave]: { items: r.items, synced_at: new Date().toISOString() } }));
        await recarregar();
        return r.items;
      } catch {
        return atual;
      }
    },
    [v1, repo, recarregar, tabelaDe, ambiente],
  );

  /** RN-VEN-13: situação do cliente na linha do sync (ativo, cadastro incompleto) */
  const situacaoDoCliente = useCallback((clienteId: string) => situacaoDoClienteSync(linhas.clientes.find((c) => c.id === clienteId), (linhas.financeiros ?? []).find((f) => f.cliente_id === clienteId)), [linhas.clientes, linhas.financeiros]);

  /** Medidas (UN/CX), endereços de entrega e transportadoras do aparelho (T-0061); vazios sem as entidades no sync. */
  const unidades = useMemo(() => (v1 ? unidadesDaTela(linhas) : []), [v1, linhas]);
  const enderecos = useMemo(() => (v1 ? enderecosDaTela(linhas) : []), [v1, linhas]);
  const transportadoras = useMemo(() => (v1 ? transportadorasDaTela(linhas) : []), [v1, linhas]);

  /** Condições de pagamento permitidas ao cliente (RN-VEN-14), das linhas do aparelho. */
  const condicoesDe = useCallback((clienteId: string): CondicaoDaTela[] => (v1 ? condicoesDoCliente(linhasRef.current, clienteId) : []), [v1, linhas]);

  // ---------- rascunho ----------
  const rascunhoDe = useCallback((chave: string, customerId: string): Rascunho => dadosRef.current.rascunhos[chave] ?? rascunhoVazio(customerId), []);

  /** Descarta o rascunho do aparelho (só depois de confirmar o diálogo "Descartar este pedido?"). */
  const descartarRascunho = useCallback(
    async (chave: string) => {
      if (!repo) return;
      await repo.limparRascunho(chave);
      await recarregar();
    },
    [repo, recarregar],
  );

  const atualizarRascunho = useCallback(
    async (chave: string, customerId: string, fn: (r: Rascunho) => Rascunho) => {
      if (!repo) return;
      const atual = dadosRef.current.rascunhos[chave] ?? rascunhoVazio(customerId);
      const novo = { ...fn(atual), updated_at: new Date().toISOString() };
      // atualiza já na memória (digitação rápida) e persiste em seguida
      const proximo = { ...dadosRef.current, rascunhos: { ...dadosRef.current.rascunhos, [chave]: novo } };
      dadosRef.current = proximo;
      setDadosRepo(proximo);
      await repo.guardarRascunho(chave, novo);
    },
    [repo],
  );

  // ---------- pedido ----------
  const custoDaFilaDoCliente = (customerId: string, ignorar?: string) =>
    filaRef.current.filter((o) => o.payload.customer_id === customerId && o.payload.id !== ignorar).reduce((s, o) => s + (o.display?.total_cents ?? 0), 0);

  const prepararDoRascunho = useCallback(
    (rascunho: Rascunho, cliente: CustomerSummary, catalogo: Product[], editId?: string) => {
      const pol = v1 ? politicaApi(parametrosRef.current) : dadosRef.current.politica;
      if (!pol) throw new Error('Alçadas ainda não estão no aparelho. Sincronize com sinal e tente de novo.');
      const editado = editId ? dadosRef.current.pedidos.find((o) => o.id === editId) ?? null : null;
      const eu = v1 && usuario?.perfil === 'vendedor' ? meDoAparelho({ id: usuario.id, nome: usuario.nome, perfil: usuario.perfil, fuso: usuario.fuso }, parametrosRef.current, new Date()).seller : dadosRef.current.me?.seller ?? null;
      // RN-VEN-35/10: pedido em nome valida pela alçada do gestor (supervisor/gerente) e dispensa o vendedor logado
      const emNome = !editId && rascunho.vendedor_em_nome_id && usuario ? { vendedor_id: rascunho.vendedor_em_nome_id, perfil_autor: usuario.perfil ?? '', ...(rascunho.vendedor_em_nome_nome ? { nome: rascunho.vendedor_em_nome_nome } : {}) } : null;
      return prepararPedido({ rascunho, cliente, catalogo, politica: pol, eu, emNome, filaDoClienteCents: custoDaFilaDoCliente(cliente.id, editId), pedidoEditado: editado, unidades: unidadesDaTela(linhasRef.current), embalagens: dadosRef.current.produtos[cliente.price_table_id ?? 'default']?.embalagens, aplicacao: { padrao: aplicacaoNoOrcamentoPadrao(parametrosRef.current), max: aplicacaoMaxOrcamento(parametrosRef.current) } });
    },
    [v1, usuario],
  );

  /** Envia o pedido: grava na fila (persistida) e tenta enviar; erro definitivo volta para o vendedor corrigir. */
  const enviarPedido = useCallback(
    async (rascunho: Rascunho, cliente: CustomerSummary, catalogo: Product[]): Promise<ResultadoEnvio> => {
      if (!motor || !repo) throw new Error('Aplicativo ainda carregando. Aguarde um instante e tente de novo.');
      const { v, display } = prepararDoRascunho(rascunho, cliente, catalogo);
      const id = ambiente.novoId();
      const agora = new Date().toISOString();
      const payload: PedidoPush = montarPedido({ id, cliente, rascunho, v, semSinal: !ambiente.online(), agora });
      await repo.guardarExibicao(id, display);
      await motor.enfileirar({ id, entidade: 'pedido', payload, rotulo: `Pedido · ${cliente.trade_name}`, detalhe: `${(display.total_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · ${display.items_count} ${display.items_count === 1 ? 'item' : 'itens'}` });
      await repo.limparRascunho(draftKeyFor(cliente.id));
      if (!ambiente.online()) {
        await recarregar();
        return { kind: 'queued', id, message: 'Modo sem sinal: o pedido será enviado quando o sinal voltar.' };
      }
      const resultados = await motor.enviar();
      const r = resultados.find((x) => x.id === id);
      if (r && r.status === 'aceito') {
        if (v1) {
          // traz a linha do servidor (número, status, nível); sem rede ou com falha, o pedido segue como "Recebido" até o próximo pull
          await motor.sincronizar().catch(() => false);
          await recarregar();
          const det = detalheDoPedido(linhasRef.current, id, perfil, parametrosRef.current);
          if (det) return { kind: 'sent', order: det };
          return { kind: 'queued', id, message: 'Pedido recebido pelo servidor. O número e o status aparecem na próxima atualização.' };
        }
        await carregarPedido(id);
        await repo.removerExibicao(id);
        await recarregar();
        const det = dadosRef.current.detalhes[id];
        if (det) return { kind: 'sent', order: det };
        return { kind: 'queued', id, message: 'Pedido enviado. Os detalhes aparecem na próxima atualização.' };
      }
      if (r) {
        // recusado pelo servidor: sai da fila e volta para o vendedor corrigir
        await motor.descartar(id);
        await repo.removerExibicao(id);
        await recarregar();
        const mensagem = 'mensagem' in r && r.mensagem ? r.mensagem : '';
        throw new Error(mensagem || 'O servidor recusou o pedido. Revise os itens e tente de novo.');
      }
      await recarregar();
      const item = motor.estado().fila.find((i) => i.id === id);
      return { kind: 'queued', id, message: item?.ultimo_erro || 'Sem conexão: o pedido será enviado quando o sinal voltar.' };
    },
    [motor, repo, prepararDoRascunho, recarregar, carregarPedido, ambiente, v1, perfil],
  );

  const unidadesTransportadoras = useCallback(() => (v1 ? transportadorasDaTela(linhasRef.current) : []), [v1]);

  /** Duplicar (`duplicate`) ou editar (`edit`, só o que está na fila — P-2): rascunho com o mesmo cliente/itens e os preços de hoje. */
  const prepararRascunhoDoPedido = useCallback(
    async (orderId: string, modo: 'duplicate' | 'edit'): Promise<{ customerId: string; chave: string }> => {
      if (!repo) throw new Error('Aplicativo ainda carregando. Aguarde um instante e tente de novo.');
      const d = dadosRef.current;
      const det = detalhe(orderId);
      const src = fonteDoPedido(orderId, filaRef.current, det ? { [orderId]: det } : d.detalhes);
      if (!src) throw new Error('Itens do pedido ainda não estão no aparelho. Abra o pedido com sinal e tente de novo.');
      const cliente = clientes.find((c) => c.id === src.customer_id);
      if (!cliente) throw new Error('Cliente fora da carteira sincronizada no aparelho.');
      const catalogo = await garantirProdutos(cliente);
      if (catalogo.length === 0) throw new Error('Tabela de preços do cliente não está no aparelho. Sincronize com sinal.');
      // T-0071: a cópia leva medida, ajustes do item (% ou R$), ajuste do pedido, frete e endereço (RN-VEN-02/16/17)
      const naFila = filaRef.current.find((o) => o.payload.id === orderId);
      const linhaPedido = linhasRef.current.pedidos.find((p) => p.id === orderId);
      const copia = naFila
        ? copiaDoPayload(naFila.payload, { observacao: null })
        : det
          ? copiaDoDetalhe(det, { condicaoId: v1 ? (linhaPedido?.condicao_pagamento_id ?? null) : null, observacao: linhaPedido?.observacao ?? null, transportadoras: unidadesTransportadoras() })
          : null;
      const c = copia ? rascunhoDaCopia(copia, catalogo, { manterAplicacao: modo === 'edit' }) : null;
      const r = c ? null : prefillLines(src.lines, catalogo);
      const linhasDoRascunho = c ? c.rascunho.lines : r!.lines;
      const aviso = c ? c.aviso : prefillNotice(r!);
      if (Object.keys(linhasDoRascunho).length === 0 && modo === 'duplicate') throw new Error(`Nenhum item do pedido está ativo com preço na tabela. ${aviso}`);
      const origem = src.number ? `pedido ${src.number}` : 'pedido no aparelho';
      const cabeca = modo === 'duplicate' ? `Cópia do ${origem} com os preços de hoje da tabela do cliente.` : 'Preços atualizados pela tabela de hoje do cliente.';
      const chave = draftKeyFor(cliente.id, modo === 'edit' ? orderId : null);
      const ehOrcamento = naFila?.payload.tipo === 'orcamento' || linhaPedido?.tipo === 'orcamento';
      await repo.guardarRascunho(chave, {
        ...(c ? c.rascunho : { lines: r!.lines, discount_pct: src.discount_pct }),
        customer_id: cliente.id,
        payment_terms: src.payment_terms,
        condicao_pagamento_id: v1 ? (linhaPedido?.condicao_pagamento_id ?? naFila?.payload.condicao_pagamento_id ?? null) : null,
        visit_id: null,
        route_stop_id: null,
        updated_at: new Date().toISOString(),
        edit_order_id: modo === 'edit' ? orderId : null,
        ...(modo === 'edit' && ehOrcamento ? { tipo: 'orcamento' as const } : {}),
        notice: [cabeca, aviso].filter(Boolean).join(' '),
      });
      await recarregar();
      return { customerId: cliente.id, chave };
    },
    [repo, garantirProdutos, recarregar, detalhe, clientes, v1, unidadesTransportadoras],
  );

  /** Salva a edição. P-2: só o pedido que ainda está na fila do aparelho (funciona sem sinal); o servidor não edita pedido aceito. */
  const salvarEdicao = useCallback(
    async (orderId: string, rascunho: Rascunho, cliente: CustomerSummary, catalogo: Product[]): Promise<ResultadoAlteracao> => {
      if (!motor || !repo) throw new Error('Aplicativo ainda carregando. Aguarde um instante e tente de novo.');
      const { v, display } = prepararDoRascunho(rascunho, cliente, catalogo, orderId);
      const itens = linhasParaPush(v.calculo.linhas);
      const chave = draftKeyFor(cliente.id, orderId);
      const naFila = filaRef.current.find((o) => o.payload.id === orderId);
      if (naFila) {
        await repo.guardarExibicao(orderId, display);
        const novo = montarPedido({ id: orderId, cliente, rascunho, v, semSinal: false, agora: naFila.payload.created_offline_at ?? new Date().toISOString() });
        await motor.alterar(orderId, {
          // refaz o payload pelo rascunho (ajustes em % ou R$, frete, endereço, observação) e guarda o que o rascunho não tem
          payload: {
            ...novo,
            total_cents: display.total_cents,
            created_offline_at: naFila.payload.created_offline_at ?? null,
            route_stop_id: naFila.payload.route_stop_id ?? null,
            visita_id: naFila.payload.visita_id ?? null,
            ...(naFila.payload.branch_id ? { branch_id: naFila.payload.branch_id } : {}),
            ...(naFila.payload.tipo ? { tipo: naFila.payload.tipo } : {}),
            ...(naFila.payload.orcamento_origem_id ? { orcamento_origem_id: naFila.payload.orcamento_origem_id } : {}),
          } satisfies PedidoPush,
        });
        await repo.limparRascunho(chave);
        await recarregar();
        if (ambiente.online()) void motor.enviar({ incluirFalhos: true });
        return { kind: 'local' };
      }
      const linhaOrc = linhasRef.current.pedidos.find((p) => p.id === orderId);
      if (v1 && linhaOrc?.tipo === 'orcamento') {
        // T-0071 (RN-VEN-18): orçamento aberto já recebido edita pela API, com a versão que o aparelho tem (concorrência otimista)
        if (!ambiente.online()) throw new Error('Sem sinal: para salvar a edição de um orçamento já enviado, conecte-se. Suas alterações continuam aqui.');
        const { id: _id, tipo: _tipo, orcamento_origem_id: _origem, created_offline_at: _criado, ...corpoBase } = montarPedido({ id: orderId, cliente, rascunho, v, semSinal: false, agora: new Date().toISOString() });
        void [_id, _tipo, _origem, _criado];
        const corpo: EditarOrcamentoRequest = { ...corpoBase, atualizado_em: linhaOrc.updated_at };
        try {
          await ambiente.http.requisitar('PUT', `/vendedor/orcamentos/${encodeURIComponent(orderId)}`, { body: corpo });
        } catch (e) {
          if (ehSemConexao(e)) throw new Error('Sem conexão: conecte-se para salvar a edição do orçamento. Suas alterações continuam aqui.');
          throw e;
        }
        await motor.sincronizar().catch(() => false);
        await repo.limparRascunho(chave);
        await recarregar();
        const atualizado = detalheDoPedido(linhasRef.current, orderId, perfil, parametrosRef.current);
        return atualizado ? { kind: 'server', order: atualizado } : { kind: 'local' };
      }
      if (v1) throw new Error('Pedido já recebido pelo servidor não é editado. Duplique-o para fazer um novo.');
      if (!ambiente.online()) throw new Error(`Modo sem sinal: ${PRECISA_SINAL} Desligue no Perfil quando tiver sinal.`);
      const corpo: UpdateOrderRequest = { customer_id: cliente.id, discount_pct: rascunho.discount_pct, payment_terms: rascunho.payment_terms, items: itens };
      let order: OrderDetail;
      try {
        order = await ambiente.http.requisitar<OrderDetail>('PUT', `/orders/${encodeURIComponent(orderId)}`, { body: corpo });
      } catch (e) {
        if (ehSemConexao(e)) throw new Error(`Sem conexão: ${PRECISA_SINAL} Suas alterações continuam aqui; tente de novo.`);
        throw e;
      }
      await repo.guardarPedido(order);
      await repo.limparRascunho(chave);
      await recarregar();
      return { kind: 'server', order };
    },
    [motor, repo, prepararDoRascunho, recarregar, ambiente, v1, perfil],
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
      if (!ambiente.online()) throw new Error(`Modo sem sinal: ${PRECISA_SINAL}`);
      try {
        if (v1) {
          const ehOrc = linhasRef.current.pedidos.find((p) => p.id === orderId)?.tipo === 'orcamento';
          await ambiente.http.requisitar('POST', `/vendedor/${ehOrc ? 'orcamentos' : 'pedidos'}/${encodeURIComponent(orderId)}/cancelar`, { body: motivo.trim() ? { motivo: motivo.trim() } : {} });
          await motor.sincronizar().catch(() => false);
          await recarregar();
          const det = detalheDoPedido(linhasRef.current, orderId, perfil, parametrosRef.current);
          if (!det) throw new Error('Pedido cancelado. A lista é atualizada na próxima sincronização.');
          return { kind: 'server', order: det };
        }
        const order = await ambiente.http.requisitar<OrderDetail>('POST', `/orders/${encodeURIComponent(orderId)}/cancel`, { body: motivo.trim() ? { reason: motivo.trim() } : {} });
        await repo.guardarPedido(order);
        await recarregar();
        return { kind: 'server', order };
      } catch (e) {
        if (ehSemConexao(e)) throw new Error(`Sem conexão: ${PRECISA_SINAL}`);
        throw e;
      }
    },
    [motor, repo, recarregar, ambiente, v1, perfil],
  );

  /**
   * Aprovar ou rejeitar (RN-GES-08; ADR 0011 D-4): exige internet, porque outro gestor pode ter decidido antes. A resposta
   * da API vale na hora; depois uma sincronização traz o estado novo para o aparelho.
   */
  const decidirPedido = useCallback(
    async (orderId: string, decisao: 'aprovar' | 'rejeitar', texto: string): Promise<OrderDetail> => {
      if (!ambiente.online()) throw new Error('Aprovar e rejeitar exigem internet: o pedido pode ter sido decidido por outra pessoa. Conecte-se e tente de novo.');
      let order: OrderDetail;
      try {
        order = await ambiente.http.requisitar<OrderDetail>('POST', `/vendedor/pedidos/${encodeURIComponent(orderId)}/${decisao === 'aprovar' ? 'aprovar' : 'rejeitar'}`, {
          body: decisao === 'aprovar' ? (texto.trim() ? { comentario: texto.trim() } : {}) : { motivo: texto.trim() },
        });
      } catch (e) {
        if (ehSemConexao(e)) throw new Error('Sem conexão: aprovar e rejeitar exigem internet. Tente de novo quando o sinal voltar.');
        throw e;
      }
      setDecididos((d) => ({ ...d, [orderId]: order }));
      void motor?.sincronizar().then(() => recarregar());
      return order;
    },
    [ambiente, motor, recarregar],
  );

  const reenviarFila = useCallback(async () => {
    if (!motor) return;
    await motor.enviar({ incluirFalhos: true });
    await recarregar();
  }, [motor, recarregar]);

  /**
   * T-0053 (RF-VEN-03): converte o orçamento em pedido OFFLINE — pedido novo na fila com `orcamento_origem_id`; o servidor
   * revalida preço do dia, alçada e validade (RN-VEN-32). Sem sinal, segue na fila como qualquer pedido.
   */
  const converterOrcamento = useCallback(
    async (orcamentoId: string): Promise<ResultadoEnvio> => {
      if (!motor || !repo) throw new Error('Aplicativo ainda carregando. Aguarde um instante e tente de novo.');
      const d = detalheDoPedido(linhasRef.current, orcamentoId, perfil, parametrosRef.current);
      if (!d || d.items.length === 0) throw new Error('Itens do orçamento ainda não sincronizados. Sincronize e tente de novo.');
      const linha = linhasRef.current.pedidos.find((x) => x.id === orcamentoId);
      const id = ambiente.novoId();
      const payload = pedidoDaConversao(d, { condicaoId: linha?.condicao_pagamento_id ?? null, observacao: linha?.observacao ?? null, novoId: id, agora: relogioReal().agora().toISOString(), transportadoras: transportadorasDaTela(linhasRef.current) });
      await motor.enfileirar({ id, entidade: 'pedido', payload, rotulo: `Pedido · ${d.customer_name}`, detalhe: `do orçamento ${d.number}` });
      if (!ambiente.online()) {
        await recarregar();
        return { kind: 'queued', message: 'Modo sem sinal: o pedido será enviado quando o sinal voltar.' };
      }
      const r = (await motor.enviar()).find((x) => x.id === id);
      if (r && r.status === 'aceito') {
        await motor.sincronizar().catch(() => false);
        await recarregar();
        const det = detalheDoPedido(linhasRef.current, id, perfil, parametrosRef.current);
        return det ? { kind: 'sent', order: det } : { kind: 'queued', message: 'Pedido recebido pelo servidor. O número e o status aparecem na próxima atualização.' };
      }
      if (r) {
        await motor.descartar(id);
        await recarregar();
        throw new Error(('mensagem' in r && r.mensagem) || 'O servidor recusou o pedido. Revise o orçamento e tente de novo.');
      }
      await recarregar();
      return { kind: 'queued', message: 'Sem conexão: o pedido será enviado quando o sinal voltar.' };
    },
    [motor, repo, recarregar, ambiente, perfil],
  );
  /**
   * T-0071 (RN-VEN-18): o que muda ao transformar o orçamento com os dados de hoje do aparelho (preço, estoque, mínimo, alçada,
   * cliente), offline. `null` = sem tabela no aparelho para conferir (o servidor revalida ao receber).
   */
  const reconferirOrcamentoLocal = useCallback(
    async (orcamentoId: string): Promise<{ mudancas: string[]; bloqueio: string | null; pode_enviar: boolean; nivel: NivelDePreco | null; total_cents: number } | null> => {
      const d = detalheDoPedido(linhasRef.current, orcamentoId, perfil, parametrosRef.current);
      if (!d || d.items.length === 0) return null;
      const cliente = clientes.find((c) => c.id === d.customer_id);
      if (!cliente) return null;
      const catalogo = await garantirProdutos(cliente);
      if (catalogo.length === 0) return null;
      const nomes = new Map(d.items.map((i) => [i.product_id, `${i.erp_code} ${i.description}`.trim()]));
      const r = reconferirDocumento({
        detalhe: d,
        catalogo,
        unidades: unidadesDaTela(linhasRef.current),
        embalagens: dadosRef.current.produtos[cliente.price_table_id ?? 'default']?.embalagens,
        cliente: situacaoDoClienteSync(linhasRef.current.clientes.find((c) => c.id === cliente.id), (linhasRef.current.financeiros ?? []).find((f) => f.cliente_id === cliente.id)),
        policy: toDomainPolicy(politicaApi(parametrosRef.current)),
        estoque_bloqueia: false,
      });
      return { mudancas: r.mudancas.map((m) => textoDaMudanca(m, (id) => nomes.get(id) ?? 'Produto')), bloqueio: r.bloqueio, pode_enviar: r.pode_enviar, nivel: r.calculo.nivel, total_cents: r.calculo.totais.total_cents };
    },
    [perfil, clientes, garantirProdutos],
  );
  /**
   * T-0071 (RF-CAT-03): "Combina com o pedido" e "Leve mais" da aba Detalhes. A consulta `catalogo.sugestoes_pedido@1` roda no
   * aparelho (offline); clientes parecidos e embalagem maior saem das linhas locais. Falha na consulta = só o que é local.
   */
  const sugestoesDoPedido = useCallback(
    async (cliente: CustomerSummary, lines: Record<string, number>, catalogo: Product[]): Promise<SugestoesDaTela> => {
      const ids = [...new Set(Object.entries(lines).filter(([, q]) => q > 0).map(([k]) => (k.includes('@') ? k.slice(0, k.indexOf('@')) : k)))];
      if (ids.length === 0 || catalogo.length === 0) return SUGESTOES_VAZIAS;
      let consulta: SugestoesPedidoSaida | null = null;
      if (v1) {
        try {
          consulta = await ambiente.consultar(CONSULTA_SUGESTOES_PEDIDO, { cliente_id: cliente.id, produto_ids: ids.slice(0, 200), em: new Date().toISOString(), limite: 5 });
        } catch {
          consulta = null;
        }
      }
      const l = linhasRef.current;
      const itens = agruparPorPedido(l.itens);
      return montarSugestoes({
        consulta,
        lines,
        catalogo,
        unidades: unidadesDaTela(l),
        embalagens: dadosRef.current.produtos[cliente.price_table_id ?? 'default']?.embalagens,
        cliente_id: cliente.id,
        clientes: l.clientes.map((c) => ({ id: c.id, segmento: c.segmento ?? null })),
        pedidos: l.pedidos.map((p) => ({ cliente_id: p.cliente_id, tipo: p.tipo ?? 'pedido', status: p.status, criado_em: p.recebido_em ?? p.created_at, produto_ids: (itens.get(p.id) ?? []).map((i) => i.produto_id) })),
        agora: new Date(),
      });
    },
    [v1, ambiente],
  );
  /**
   * T-0084 C9 (RN-CAT-12): busca do seletor pelo ranking do Catálogo, com "Serve em". `reserva` = só `ConsultaIndisponivel`
   * (aparelho sem a leitura liberada pelo SDK): a tela usa a busca local. Qualquer outro erro = `erro` (aparece na tela e vai ao log).
   */
  const buscarProdutos = useCallback(
    async (q: string, produtoIds: string[] | null): Promise<ResultadoBuscaCatalogo> => {
      if (!v1 || !q.trim()) return { tipo: 'reserva' };
      return buscarNoCatalogoComReserva(
        () => ambiente.consultar(CONSULTA_BUSCA_PRODUTOS, { q: q.trim().slice(0, 200), ...(produtoIds ? { produto_ids: produtoIds } : {}), limite: 100 }),
        ehConsultaIndisponivel,
        (m, extra) => console.warn(m, extra),
      );
    },
    [v1, ambiente],
  );
  /** T-0084 §12 (RN-VEN-19): aplicação só dos ids pedidos (≤ 500 por consulta), com cache em memória; falha = sem texto, o preço segue. */
  const cacheTextos = useRef(new Map<string, string | null>());
  const textosDeProdutos = useCallback(
    async (ids: string[]): Promise<Map<string, string>> => {
      const falta = idsSemTexto(ids, cacheTextos.current);
      if (v1 && falta.length > 0) {
        try {
          const r = await ambiente.consultar(CONSULTA_TEXTOS_PRODUTO, { produto_ids: falta });
          for (const id of falta) cacheTextos.current.set(id, null);
          for (const it of r.itens) cacheTextos.current.set(it.produto_id, it.aplicacao ?? null);
        } catch {
          // sem aplicação agora; tenta de novo na próxima busca
        }
      }
      const out = new Map<string, string>();
      for (const id of ids) {
        const tx = cacheTextos.current.get(id);
        if (tx) out.set(id, tx);
      }
      return out;
    },
    [v1, ambiente],
  );
  const preVendaLigada = v1 && preVendaAtiva(parametros);

  const acoesDe = (status: string) => orderActions(status as OrderStatus);
  const aguardandoMinhaDecisao = useMemo(() => (v1 ? paraAprovar(linhas, perfil) : []), [v1, linhas, perfil]);

  return {
    carregado,
    dados,
    v1,
    perfil,
    tz,
    vendedor,
    offline,
    fila,
    pedidos,
    aguardandoMinhaDecisao,
    enviando: estado.enviando,
    sincronizando: estado.sincronizando,
    erroSync: estado.erro,
    motor,
    recarregar,
    atualizarPedidos,
    sincronizarAgora,
    detalhe,
    carregarPedido,
    carregarFicha,
    garantirProdutos,
    condicoesDe,
    unidades,
    situacaoDoCliente,
    enderecos,
    transportadoras,
    tabelaDe,
    rascunhoDe,
    atualizarRascunho,
    descartarRascunho,
    prepararDoRascunho,
    enviarPedido,
    converterOrcamento,
    reconferirOrcamentoLocal,
    sugestoesDoPedido,
    buscarProdutos,
    textosDeProdutos,
    preVendaLigada,
    prepararRascunhoDoPedido,
    salvarEdicao,
    excluirPedido,
    decidirPedido,
    reenviarFila,
    acoesDe,
  };
}

export type { OrderDisplay };
