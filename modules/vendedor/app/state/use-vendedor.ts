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
import { abrirFotoDoProduto, idsComFoto } from '../lib/foto-produto';
import { CONSULTA_BUSCA_PRODUTOS, CONSULTA_FOTO_PRODUTO, CONSULTA_PRECOS_CLIENTE, CONSULTA_SUGESTOES_PEDIDO, CONSULTA_TEXTOS_PRODUTO, type Product, type SugestoesPedidoSaida } from '@macuxi/catalogo/contracts';
import { CONSULTA_FINANCEIRO_CLIENTE, type CustomerSummary } from '@macuxi/core/contracts';
import { ehConsultaIndisponivel, ehSemConexao } from '@macuxi/platform-sdk';
import { useAmbiente, useMotorSync } from '@macuxi/platform-sdk/react';
import { DEFAULT_TZ, monthStart } from '@macuxi/ui/mobile/puro';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MixSuggestion } from '@macuxi/catalogo/contracts';
import type { CustomerDetail, EditarOrcamentoRequest, Order, OrderDetail, PedidoPush, UpdateOrderRequest } from '../../contracts';
import { orderActions, type OrderStatus } from '../../domain/order';
import type { NivelDePreco } from '../../domain/preco-pedido';
import { prefillLines, prefillNotice } from '../lib/order-prefill';
import { copiaDoDetalhe, copiaDoPayload, precosCongeladosDoOrcamento, rascunhoDaCopia, reconferirDocumento, textoDaDiferencaTotal, textoDaMudanca } from '../lib/documento';
import { precoDoOrcamentoVale, type MudancaNaConversao } from '../../domain/orcamento';
import { limparRascunhosExpirados } from '../../domain/rascunhos';
import { TEXTO_SEM_SINAL_PARA_SALVAR } from '../../domain/alertas-pedido';
import { toDomainPolicy } from '../lib/catalog';
import { montarSugestoes, SUGESTOES_VAZIAS, type SugestoesDaTela } from '../lib/sugestoes-pedido';
import { calcularPedido, faixasPorProduto, linhasParaPush } from '../lib/novo-pedido';
import { avisoDoSalvar } from '../lib/salvar-na-fila';
import { linhasDosRascunhos, type LinhaDeRascunho } from '../lib/rascunhos-lista';
import type { DadosDosPrecosDeHoje } from '../lib/precos-de-hoje';
import { aplicacaoMaxOrcamento, aplicacaoNoOrcamentoPadrao } from '../../domain/aplicacao';
import { idsSemTexto } from '../../domain/busca-seletor';
import { buscarNoCatalogoComReserva, type ResultadoBuscaCatalogo } from '../lib/busca-catalogo';
import { situacaoDoClienteSync } from '../lib/textos-pedido';
import { modeloDoCredito, type ModeloDoCredito } from '../lib/credito-cliente';
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
  formasDaTela,
  prazosDaTela,
  paraAprovar,
  politicaApi,
  limiteDoUsuarioNasLinhas,
  transportadorasDaTela,
  unidadesDaTela,
  comEstoqueDaFilial,
  produtosComPrecos,
  type CondicaoDaTela,
  type LinhasVendedor,
} from '../lib/pull';
import { criarRepositorio, DADOS_VAZIOS, type DadosVendedor } from '../lib/repositorio';
import { relogioReal } from '@macuxi/comum/relogio';
import { rascunhosAposLeitura } from '../lib/rascunhos-apos-leitura';
import { podeSincronizarManual } from '../lib/sincronizar';
import { pedidoDaConversao, preVendaAtiva } from '../lib/pre-venda';

const LOTE_PRECOS = 500;
const MSG_APP_CARREGANDO = 'Aplicativo ainda carregando. Aguarde um instante e tente de novo.';

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

  const gravacoesDeRascunho = useRef(0);
  /** geração dos rascunhos: sobe a cada toque/descarte, antes de gravar (R1: a leitura iniciada antes não sobrescreve) */
  const versaoRascunhos = useRef(0);
  const recarregar = useCallback(async () => {
    if (!repo) return;
    const geracaoAntes = versaoRascunhos.current;
    const [lidos, ls] = await Promise.all([repo.carregar(), v1 && motor ? lerLinhas(motor) : Promise.resolve(LINHAS_VAZIAS)]);
    // rascunho com gravação em andamento vale o da memória: a leitura pode ter vindo antes do toque no +/− ser gravado
    // (se a geração mudou durante a leitura ou há gravação em andamento, valem os da memória)
    const lidosOuMemoria = rascunhosAposLeitura({ lidos: lidos.rascunhos, memoria: dadosRef.current.rascunhos, geracaoAntes, geracaoAgora: versaoRascunhos.current, emAndamento: gravacoesDeRascunho.current });
    // RN-VEN-39: o rascunho some 24 h depois da última alteração (limpeza ao abrir e a cada leitura)
    const limpeza = limparRascunhosExpirados(lidosOuMemoria, new Date());
    const novos = { ...lidos, rascunhos: limpeza.mantidos };
    for (const chave of limpeza.removidos) void repo.limparRascunho(chave);
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
    // T-0141 (RN-VEN-39, spec F.1): os rascunhos ("Apenas salvar" inclusive) saíram desta lista; moram só na tela Rascunhos
    return v1 ? [...aceitosComoPedidos(aceitos, noServidor, eu), ...todos] : todos;
  }, [dados.pedidos, fila, aceitos, vendedor, v1]);

  /**
   * T-0141 F: linhas da tela Rascunhos (e a contagem da aba Pedidos), do aparelho. O total do rascunho vem do catálogo do aparelho
   * (sem tabela ou sem política, fica sem total). `agora` entra por argumento: a regra das 24 h é do domain.
   */
  const rascunhosDaLista = useCallback(
    (agora: Date): LinhaDeRascunho[] => {
      const eu = vendedor?.id ?? '';
      const total = (r: Rascunho): number | null => {
        const cli = dados.clientes.find((c) => c.id === r.customer_id);
        const tabela = dados.produtos[cli?.price_table_id ?? 'default'];
        if (!cli || !tabela || !dados.politica) return null;
        try {
          return calcularPedido({ lines: r.lines, ajustes: r.ajustes ?? {}, desconto_pct: r.discount_pct, acrescimo_pct: r.acrescimo_pct ?? 0, desconto_valor_cents: r.desconto_valor_cents, acrescimo_valor_cents: r.acrescimo_valor_cents, ajuste_em: r.ajuste_em, catalogo: tabela.items, unidades: unidadesDaTela(linhasRef.current), faixas: tabela.faixas, ...(r.precos_congelados ? { congelados: r.precos_congelados } : {}), politica: politicaApi(parametrosRef.current), vendedor_id: eu }).total_cents;
        } catch {
          return null;
        }
      };
      return linhasDosRascunhos({ rascunhos: dados.rascunhos, clientes: dados.clientes, pedidos: dados.pedidos, totalDoRascunho: total, agora, tz });
    },
    [dados.rascunhos, dados.clientes, dados.pedidos, dados.produtos, dados.politica, vendedor, tz],
  );

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

  /** T-0149 (RN-VEN-20): filial do cliente no aparelho; sem filial conhecida, vale o estoque de antes */
  const filialDoCliente = useCallback((clienteId: string): string | null => linhasRef.current.clientes.find((c) => c.id === clienteId)?.filial_id ?? null, []);
  /** O estoque mostrado e validado offline é o disponível da filial do cliente (saldo da filial − reservas dela). */
  const tabelaDe = useCallback(
    (cliente: CustomerSummary): Product[] => comEstoqueDaFilial(dadosRef.current.produtos[cliente.price_table_id ?? 'default']?.items ?? [], linhasRef.current, filialDoCliente(cliente.id)),
    [filialDoCliente],
  );

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
          const itensConsulta: Array<{ produto_id: string }> = [];
          const agora = new Date().toISOString();
          for (let i = 0; i < ativos.length; i += LOTE_PRECOS) {
            const r = await ambiente.consultar(CONSULTA_PRECOS_CLIENTE, { cliente_id: cliente.id, produto_ids: ativos.slice(i, i + LOTE_PRECOS).map((p) => p.id), em: agora });
            for (const it of r.itens) {
              precos.set(it.produto_id, it.preco_cents);
              itensConsulta.push(it);
            }
          }
          // T-0084 §12 (RN-VEN-19): a aplicação NÃO é carregada aqui (tabela inteira); a tela lê só dos itens visíveis (textosDeProdutos)
          const items = produtosComPrecos(linhasRef.current, precos, undefined, filialDoCliente(cliente.id));
          await repo.alterar('produtos', (p) => ({ ...p, [chave]: { items, synced_at: agora, faixas: faixasPorProduto(itensConsulta) } }));
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
    [v1, repo, recarregar, tabelaDe, ambiente, filialDoCliente],
  );

  /** RN-VEN-13: situação do cliente na linha do sync (ativo, cadastro incompleto) */
  const situacaoDoCliente = useCallback((clienteId: string) => situacaoDoClienteSync(linhas.clientes.find((c) => c.id === clienteId), (linhas.financeiros ?? []).find((f) => f.cliente_id === clienteId)), [linhas.clientes, linhas.financeiros]);

  /** Medidas (UN/CX), endereços de entrega e transportadoras do aparelho (T-0061); vazios sem as entidades no sync. */
  const unidades = useMemo(() => (v1 ? unidadesDaTela(linhas) : []), [v1, linhas]);
  const enderecos = useMemo(() => (v1 ? enderecosDaTela(linhas) : []), [v1, linhas]);
  const transportadoras = useMemo(() => (v1 ? transportadorasDaTela(linhas) : []), [v1, linhas]);
  /** T-0089 (RN-VEN-24): formas e prazos do aparelho; vazios antes do primeiro sync com a 0037 (vale a condição legada). */
  const formas = useMemo(() => (v1 ? formasDaTela(linhas) : []), [v1, linhas]);
  const prazos = useMemo(() => (v1 ? prazosDaTela(linhas) : []), [v1, linhas]);
  /** RN-VEN-35 (T-0101): vínculos de carteira do aparelho, para o seletor do pedido em nome */
  const carteiras = useMemo(() => (v1 ? (linhas.carteiras ?? []) : []), [v1, linhas.carteiras]);
  /** Limites do cadastro do cliente (RN-VEN-25), do pull do Core: nulo = sem teto / todas as formas. */
  /** RN-VEN-11a (T-0168): funções e limite de desconto do usuário da sessão, da entidade `usuario` do sync (vale offline; sem linha = padrão) */
  const limiteDesconto = useMemo(() => limiteDoUsuarioNasLinhas(linhas, usuario?.id), [linhas, usuario?.id]);
  const limitesDe = useCallback(
    (clienteId: string) => {
      const c = linhas.clientes.find((x) => x.id === clienteId);
      return { prazo_medio_max_dias: c?.prazo_medio_max_dias ?? null, formas_pagamento: c?.formas_pagamento ?? null };
    },
    [linhas.clientes],
  );
  /**
   * Cartão "Crédito do cliente" (RN-VEN-12/13): `core.financeiro_cliente@1` no aparelho (linhas locais do Core, vale offline) mais
   * os pedidos do cliente que ainda pesam. `null` = consulta indisponível (Core fora do app): o cartão não aparece.
   */
  const creditoDoCliente = useCallback(
    async (clienteId: string): Promise<ModeloDoCredito | null> => {
      try {
        const r = await ambiente.consultar(CONSULTA_FINANCEIRO_CLIENTE, { cliente_id: clienteId });
        return modeloDoCredito(r.financeiro, linhasRef.current.pedidos.filter((p) => p.cliente_id === clienteId && (p.tipo ?? 'pedido') === 'pedido'));
      } catch (e) {
        if (ehConsultaIndisponivel(e)) return null;
        throw e;
      }
    },
    [ambiente],
  );

  /** Condições de pagamento permitidas ao cliente (RN-VEN-14), das linhas do aparelho. */
  const condicoesDe = useCallback((clienteId: string): CondicaoDaTela[] => (v1 ? condicoesDoCliente(linhasRef.current, clienteId) : []), [v1, linhas]);

  // ---------- rascunho ----------
  const rascunhoDe = useCallback((chave: string, customerId: string): Rascunho => dadosRef.current.rascunhos[chave] ?? rascunhoVazio(customerId), []);

  /** Descarta o rascunho do aparelho (só depois de confirmar o diálogo "Descartar este pedido?"). */
  const descartarRascunho = useCallback(
    async (chave: string) => {
      if (!repo) return;
      versaoRascunhos.current += 1;
      await repo.limparRascunho(chave);
      await recarregar();
    },
    [repo, recarregar],
  );

  const atualizarRascunho = useCallback(
    async (chave: string, customerId: string, fn: (r: Rascunho) => Rascunho, opcoes: { manterAlteracao?: boolean } = {}) => {
      if (!repo) return;
      const atual = dadosRef.current.rascunhos[chave] ?? rascunhoVazio(customerId);
      // T-0141 (RN-VEN-39): gravar só a aba em que parou não conta como alteração (não renova as 24 h)
      const novo = { ...fn(atual), updated_at: opcoes.manterAlteracao ? atual.updated_at : new Date().toISOString() };
      // atualiza já na memória (digitação rápida) e persiste em seguida
      const proximo = { ...dadosRef.current, rascunhos: { ...dadosRef.current.rascunhos, [chave]: novo } };
      dadosRef.current = proximo;
      setDadosRepo(proximo);
      versaoRascunhos.current += 1;
      gravacoesDeRascunho.current += 1;
      try {
        await repo.guardarRascunho(chave, novo);
      } finally {
        gravacoesDeRascunho.current -= 1;
      }
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
      return prepararPedido({ rascunho, cliente, catalogo, politica: pol, limite: limiteDoUsuarioNasLinhas(linhasRef.current, usuario?.id), eu, emNome, filaDoClienteCents: custoDaFilaDoCliente(cliente.id, editId), pedidoEditado: editado, unidades: unidadesDaTela(linhasRef.current), faixas: dadosRef.current.produtos[cliente.price_table_id ?? 'default']?.faixas, aplicacao: { padrao: aplicacaoNoOrcamentoPadrao(parametrosRef.current), max: aplicacaoMaxOrcamento(parametrosRef.current) } });
    },
    [v1, usuario],
  );

  /** Envio da fila em segundo plano (T-0130): aceito, traz a linha do servidor; recusado, o item fica `falhou` para o vendedor corrigir. */
  const seguirEnvioEmSegundoPlano = useCallback(
    async (id: string): Promise<void> => {
      if (!motor || !repo) return;
      try {
        const r = (await motor.enviar()).find((x) => x.id === id);
        if (r && r.status === 'aceito') {
          if (v1) await motor.sincronizar().catch(() => false);
          else {
            await carregarPedido(id);
            await repo.removerExibicao(id);
          }
        }
      } catch {
        // sem rede no meio do caminho: o item segue `pendente` e o motor tenta de novo sozinho
      }
      await recarregar();
    },
    [motor, repo, v1, carregarPedido, recarregar],
  );

  /** Salva o pedido: grava na fila (persistida) e devolve na hora; o envio segue em segundo plano (T-0130). */
  const enviarPedido = useCallback(
    async (rascunho: Rascunho, cliente: CustomerSummary, catalogo: Product[]): Promise<ResultadoEnvio> => {
      if (!motor || !repo) throw new Error(MSG_APP_CARREGANDO);
      const { v, display } = prepararDoRascunho(rascunho, cliente, catalogo);
      const id = ambiente.novoId();
      const agora = new Date().toISOString();
      const payload: PedidoPush = montarPedido({ id, cliente, rascunho, v, semSinal: !ambiente.online(), agora });
      await repo.guardarExibicao(id, display);
      await motor.enfileirar({ id, entidade: 'pedido', payload, rotulo: `Pedido · ${cliente.trade_name}`, detalhe: `${(display.total_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} · ${display.items_count} ${display.items_count === 1 ? 'item' : 'itens'}` });
      await repo.limparRascunho(draftKeyFor(cliente.id));
      await recarregar();
      // T-0130 (RN-VEN-30, RN-CORE-23 item 2): a tela fecha na hora; o envio sai pela fila comum do motor, em segundo plano, com
      // retentativa e o UUID do aparelho. A recusa da API deixa o item `falhou` na fila ("Não aceito", com o motivo) para corrigir.
      if (ambiente.online()) void seguirEnvioEmSegundoPlano(id);
      return { kind: 'queued', id, message: avisoDoSalvar(!ambiente.online()) };
    },
    [motor, repo, prepararDoRascunho, recarregar, ambiente, seguirEnvioEmSegundoPlano],
  );

  const unidadesTransportadoras = useCallback(() => (v1 ? transportadorasDaTela(linhasRef.current) : []), [v1]);

  /** Duplicar (`duplicate`) ou editar (`edit`, só o que está na fila — P-2): rascunho com o mesmo cliente/itens e os preços de hoje. */
  const prepararRascunhoDoPedido = useCallback(
    async (orderId: string, modo: 'duplicate' | 'edit'): Promise<{ customerId: string; chave: string }> => {
      if (!repo) throw new Error(MSG_APP_CARREGANDO);
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
      const chave = draftKeyFor(cliente.id, modo === 'edit' ? orderId : null);
      const ehOrcamento = naFila?.payload.tipo === 'orcamento' || linhaPedido?.tipo === 'orcamento';
      // T-0134/T-0151 (RN-VEN-18): editar ou corrigir (orçamento ou pedido) mantém os preços salvos, sem faixa de "preços atualizados"; duplicar entra pelos preços de hoje
      const congelados = modo === 'edit' ? precosCongeladosDoOrcamento(det, naFila?.display?.lines, unidadesDaTela(linhasRef.current)) : null;
      await repo.guardarRascunho(chave, {
        ...(c ? c.rascunho : { lines: r!.lines, discount_pct: src.discount_pct }),
        customer_id: cliente.id,
        payment_terms: src.payment_terms,
        condicao_pagamento_id: v1 ? (linhaPedido?.condicao_pagamento_id ?? naFila?.payload.condicao_pagamento_id ?? null) : null,
        visit_id: null,
        route_stop_id: null,
        updated_at: new Date().toISOString(),
        edit_order_id: modo === 'edit' ? orderId : null,
        ...(congelados && Object.keys(congelados).length > 0 ? { precos_congelados: congelados } : {}),
        ...(modo === 'edit' && ehOrcamento ? { tipo: 'orcamento' as const } : {}),
        notice: aviso,
      });
      await recarregar();
      return { customerId: cliente.id, chave };
    },
    [repo, garantirProdutos, recarregar, detalhe, clientes, v1, unidadesTransportadoras],
  );

  /** Salva a edição. P-2: só o pedido que ainda está na fila do aparelho (funciona sem sinal); o servidor não edita pedido aceito. */
  const salvarEdicao = useCallback(
    async (orderId: string, rascunho: Rascunho, cliente: CustomerSummary, catalogo: Product[]): Promise<ResultadoAlteracao> => {
      if (!motor || !repo) throw new Error(MSG_APP_CARREGANDO);
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
        if (!ambiente.online()) throw new Error(TEXTO_SEM_SINAL_PARA_SALVAR);
        const { id: _id, tipo: _tipo, orcamento_origem_id: _origem, created_offline_at: _criado, ...corpoBase } = montarPedido({ id: orderId, cliente, rascunho, v, semSinal: false, agora: new Date().toISOString() });
        void [_id, _tipo, _origem, _criado];
        const corpo: EditarOrcamentoRequest = { ...corpoBase, atualizado_em: linhaOrc.updated_at };
        try {
          await ambiente.http.requisitar('PUT', `/vendedor/orcamentos/${encodeURIComponent(orderId)}`, { body: corpo });
        } catch (e) {
          if (ehSemConexao(e)) throw new Error(TEXTO_SEM_SINAL_PARA_SALVAR);
          throw e;
        }
        await motor.sincronizar().catch(() => false);
        await repo.limparRascunho(chave);
        await recarregar();
        const atualizado = detalheDoPedido(linhasRef.current, orderId, perfil, parametrosRef.current);
        return atualizado ? { kind: 'server', order: atualizado } : { kind: 'local' };
      }
      if (v1) throw new Error('Pedido já recebido pelo servidor não é editado. Duplique-o para fazer um novo.');
      if (!ambiente.online()) throw new Error('Modo sem sinal ligado: desligue no Perfil para salvar');
      const corpo: UpdateOrderRequest = { customer_id: cliente.id, discount_pct: rascunho.discount_pct, payment_terms: rascunho.payment_terms, items: itens };
      let order: OrderDetail;
      try {
        order = await ambiente.http.requisitar<OrderDetail>('PUT', `/orders/${encodeURIComponent(orderId)}`, { body: corpo });
      } catch (e) {
        if (ehSemConexao(e)) throw new Error(TEXTO_SEM_SINAL_PARA_SALVAR);
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
      if (!motor || !repo) throw new Error(MSG_APP_CARREGANDO);
      const naFila = filaRef.current.find((o) => o.payload.id === orderId);
      if (naFila) {
        await motor.descartar(orderId);
        await repo.removerExibicao(orderId);
        await recarregar();
        return { kind: 'local' };
      }
      if (!ambiente.online()) throw new Error('Sem sinal para cancelar');
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
        if (ehSemConexao(e)) throw new Error('Sem sinal para cancelar');
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
      if (!ambiente.online()) throw new Error('Sem sinal para decidir');
      let order: OrderDetail;
      try {
        order = await ambiente.http.requisitar<OrderDetail>('POST', `/vendedor/pedidos/${encodeURIComponent(orderId)}/${decisao === 'aprovar' ? 'aprovar' : 'rejeitar'}`, {
          body: decisao === 'aprovar' ? (texto.trim() ? { comentario: texto.trim() } : {}) : { motivo: texto.trim() },
        });
      } catch (e) {
        if (ehSemConexao(e)) throw new Error('Sem sinal para decidir');
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
      if (!motor || !repo) throw new Error(MSG_APP_CARREGANDO);
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
    async (orcamentoId: string): Promise<{ mudancas: string[]; mudancas_brutas: MudancaNaConversao[]; bloqueio: string | null; pode_enviar: boolean; nivel: NivelDePreco | null; total_cents: number; precos: DadosDosPrecosDeHoje } | null> => {
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
        faixas: dadosRef.current.produtos[cliente.price_table_id ?? 'default']?.faixas,
        cliente: situacaoDoClienteSync(linhasRef.current.clientes.find((c) => c.id === cliente.id), (linhasRef.current.financeiros ?? []).find((f) => f.cliente_id === cliente.id)),
        policy: toDomainPolicy(politicaApi(parametrosRef.current)),
        estoque_bloqueia: false,
        // RN-VEN-18 (09/11): passados os 7 dias do preço, Transformar usa a tabela do dia e mostra a diferença
        preco_vale: precoDoOrcamentoVale(d.validade_ate, new Date()),
      });
      const frases = r.mudancas.map((m) => textoDaMudanca(m, (id) => nomes.get(id) ?? 'Produto'));
      const total = textoDaDiferencaTotal(r);
      // T-0141 G: o que a folha "Preços de hoje" precisa (nome do produto sem o código, total de cada item antes e hoje)
      const precos: DadosDosPrecosDeHoje = {
        preco_vale: precoDoOrcamentoVale(d.validade_ate, new Date()),
        r: { itens_hoje: r.itens_hoje, total_orcado_cents: r.total_orcado_cents, total_hoje_cents: r.calculo.totais.total_cents, mudancas: r.mudancas, bloqueio: r.bloqueio },
        nomes: Object.fromEntries(d.items.map((i) => [i.product_id, i.description])),
      };
      return { mudancas: total ? [...frases, total] : frases, mudancas_brutas: r.mudancas, bloqueio: r.bloqueio, pode_enviar: r.pode_enviar, nivel: r.calculo.nivel, total_cents: r.calculo.totais.total_cents, precos };
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
    async (q: string, produtoIds: string[] | null, clienteId?: string): Promise<ResultadoBuscaCatalogo> => {
      if (!v1 || !q.trim()) return { tipo: 'reserva' };
      return buscarNoCatalogoComReserva(
        () => ambiente.consultar(CONSULTA_BUSCA_PRODUTOS, { q: q.trim().slice(0, 200), ...(clienteId ? { cliente_id: clienteId } : produtoIds ? { produto_ids: produtoIds } : {}), limite: 100, lista_completa: true }),
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
  /** T-0148: quem tem foto (sem rede) e abrir a foto (baixa e guarda no cache; sem sinal e sem cache, aviso curto). */
  const fotosDeProdutos = useCallback(
    async (ids: string[]): Promise<Set<string>> => (v1 ? idsComFoto((e) => ambiente.consultar(CONSULTA_FOTO_PRODUTO, e), ids) : new Set()),
    [v1, ambiente],
  );
  const abrirFotoProduto = useCallback((id: string) => abrirFotoDoProduto((e) => ambiente.consultar(CONSULTA_FOTO_PRODUTO, e), id), [ambiente]);
  /**
   * T-0138 (RN-CAT-09/10): referências cruzadas ("Equivale a") só na hora de gerar o PDF, de `catalogo.textos_produto@1`; não são
   * retrato do pedido. Falha ou aparelho sem a leitura = sem referência (o PDF sai sem a linha, nunca trava).
   */
  const referenciasDeProdutos = useCallback(
    async (ids: string[]): Promise<Map<string, Array<{ brand: string; code: string }>>> => {
      const out = new Map<string, Array<{ brand: string; code: string }>>();
      const unicos = [...new Set(ids)].slice(0, 500);
      if (!v1 || unicos.length === 0) return out;
      try {
        const r = await ambiente.consultar(CONSULTA_TEXTOS_PRODUTO, { produto_ids: unicos });
        for (const it of r.itens) if (it.referencias.length > 0) out.set(it.produto_id, it.referencias.map((x) => ({ brand: x.marca_nome, code: x.codigo })));
      } catch {
        // sem referência agora: o PDF sai sem a linha
      }
      return out;
    },
    [v1, ambiente],
  );
  const preVendaLigada = v1 && preVendaAtiva(parametros);

  // RN-VEN-31 (T-0114/T-0138): `erpAceitaCancelamento` vem do pull (`erp_aceita_cancelamento` do pedido); sem ele, vale a regra de sempre
  const acoesDe = (status: string, erpAceitaCancelamento = false) => orderActions(status as OrderStatus, { erpAceitaCancelamento });
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
    formas,
    prazos,
    carteiras,
    limitesDe,
    limiteDesconto,
    creditoDoCliente,
    sincronizadoEm: estado.sincronizado_em ?? dadosRepo.sincronizado_em ?? null,
    tabelaDe,
    rascunhoDe,
    rascunhosDaLista,
    atualizarRascunho,
    descartarRascunho,
    prepararDoRascunho,
    enviarPedido,
    converterOrcamento,
    reconferirOrcamentoLocal,
    sugestoesDoPedido,
    buscarProdutos,
    textosDeProdutos,
    fotosDeProdutos,
    abrirFotoProduto,
    referenciasDeProdutos,
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
