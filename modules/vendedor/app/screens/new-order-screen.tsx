/**
 * Novo pedido de distribuidora (T-0061/T-0071/T-0089), em 3 abas: Itens, Detalhes e Resumo, sem rodapé fixo (o total do pedido fica
 * sob Forma de pagamento e Prazo, no topo de Itens).
 * Preço da tabela do cliente, medidas (UN/CX), endereços e transportadoras vêm das linhas locais (funciona sem sinal).
 * Preço, desconto e acréscimo por item e por pedido, desconto efetivo e alçada: domain de preço (`lib/novo-pedido`), a mesma
 * regra que a API revalida. Frete CIF/FOB sem valor (RN-VEN-16); endereço de entrega do cadastro (RN-VEN-17).
 * Modo edição (`editId`): "Editar pedido 10xxx", mesmo cliente; rascunho em `edit:<id>` (preenchido pelo detalhe).
 * Duplicar chega aqui como novo pedido com o rascunho do cliente já preenchido.
 */
import { useAmbiente, usePode } from '@macuxi/platform-sdk/react';
import { Abas, AvisoRodape, BackLink, Badge, Banner, Botao, Card, CampoBusca, colors, EstadoVazio, fonts, formatHHMM, Icon, Loading, radius, RotuloSecao, Screen, Strong, Trilha, type as t, useAvisoRodape } from '@macuxi/ui/mobile';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { OrderDetail } from '../../contracts';
import { aplicacaoMaxOrcamento, aplicacaoNoOrcamentoPadrao } from '../../domain/aplicacao';
import { opcoesDoSalvar, validadeDoOrcamento, validadeOrcamentoDias } from '../../domain/orcamento';
import { podeEnviarPedido } from '../../domain/quantidade';
import { resolverBusca, type TrechoServeEm } from '../../domain/busca-seletor';
import { rotuloVoltarNovoPedido } from '../../domain/pedido-em-nome';
import { modalidadePadraoDosParametros } from '../../domain/preco-pedido';
import { AcimaDoTeclado, useCampoAcimaDoTeclado } from '../components/acima-do-teclado';
import { PendenciasDoPedido } from '../components/novo-pedido';
import { ListaDeItens } from '../components/novo-pedido-itens';
import { AbaDetalhes, AbaResumo, CardPagamento, CreditoDoClienteCard, DialogoDescartar, FolhaSalvar, linhasDoLeveMais } from '../components/novo-pedido-abas';
import type { ModeloDoCredito } from '../lib/credito-cliente';
import { exigeAprovacaoPorVencido, tituloVencidoDias } from '../../domain/pagamento';
import { itensLeveMais, linhasNaFaixa } from '../lib/leve-mais';
import { pendenciaDoPagamento, rascunhoComPagamentoPadrao } from '../lib/pagamento-pedido';
import { calcularPedido, enderecosDoCliente, freteValido, lerChaveDaLinha, limiteDoVendedor, politicaParaAutor, textoDoEndereco, type Ajuste, type CalculoPedido } from '../lib/novo-pedido';
import { abasDoPedido, avisoDoOrcamentoSalvo, avisoSalvoNoAparelho, avisoSugestaoAdicionada, confirmacaoDoEnvio, niveisDaTrilha, nomeDaSugestao, textoBuscaSemResultado, type AbaNovoPedido } from '../lib/textos-pedido';
import { unidadesDoProduto } from '../lib/novo-pedido';
import { MENSAGEM_ERRO_BUSCA } from '../lib/busca-catalogo';
import { nomesDosVendedores, rotuloAcessivelDaOpcao, seletorEmNome, subtituloDoSeletor, vazioDoSeletor, type OpcaoDoSeletor } from '../lib/seletor-em-nome';
import { filterCustomers, PAYMENT_TERMS, searchProducts } from '../lib/catalog';
import { errorMessage } from '../lib/erros';
import { statusBadge } from '../lib/order-status';
import { draftKeyFor, ligarRascunho, rascunhoVazio, type Rascunho as Draft } from '../lib/pedidos';
import { hrefPedido, hrefPedidos, irParaCatalogoDoPedido, irParaPedidos } from '../rotas';
import { adicionarSugestao, aplicarTrocaDeEmbalagem, SUGESTOES_VAZIAS, type SugestoesDaTela } from '../lib/sugestoes-pedido';
import { rascunhoComProduto, rascunhoSemProduto, textoRetornoProduto } from '../lib/rascunho-com-produto';
import { descartarOrigemEditor, descartarProdutoPendente, fixarClienteDoPendente, guardarOrigemEditor, pegarProdutoPendente, produtoPendente } from '../lib/produto-pendente';
import { deixarAvisoPendente } from '../lib/aviso-pendente';
import { aplicarValorPendente } from '../lib/valor-pendente';
import { useVendedor } from '../state/use-vendedor';

export default function NewOrderScreen() {
  const { customerId, editId, visitId, stopId, vendedorId, vendedorNome } = useLocalSearchParams<{ customerId?: string; editId?: string; visitId?: string; stopId?: string; vendedorId?: string; vendedorNome?: string }>();
  // desistiu antes de escolher o cliente: o produto pendente não sobra para o próximo pedido
  useEffect(() => () => descartarProdutoPendente(), []);
  const { carregado, dados } = useVendedor();
  if (!carregado) return <Loading />;
  // RN-VEN-35: o gestor faz o pedido pelo vendedor e não tem carteira de vendedor (`me`) no aparelho
  if ((!dados.me && !vendedorId) || !dados.politica) return <AvisoDaTela titulo="Faltam dados no aparelho" texto="Abra a tela Sincronizar, com sinal, e tente de novo." />;
  if (!customerId) return <CustomerPicker />;
  return <OrderEditor key={`${customerId}:${editId ?? ''}:${vendedorId ?? ''}`} customerId={customerId} editId={editId || null} visitId={visitId || null} stopId={stopId || null} vendedorEmNomeId={editId ? null : vendedorId || null} vendedorEmNomeNome={editId ? null : vendedorNome || null} />;
}

/** Mensagem dentro de Screen (área segura) e com caminho de volta para Pedidos. */
function AvisoDaTela({ titulo, texto, acao }: { titulo: string; texto?: string; acao?: { rotulo: string; onPress: () => void } }) {
  const { vendedorId } = useLocalSearchParams<{ vendedorId?: string }>();
  return (
    <Screen testID="new-order-aviso">
      <BackLink label={rotuloVoltarNovoPedido(vendedorId)} fallback={hrefPedidos()} />
      <EstadoVazio titulo={titulo} texto={texto} acao={acao} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------

function CustomerPicker() {
  const { dados, carteiras, pedidos, tz } = useVendedor();
  const { vendedorId, vendedorNome } = useLocalSearchParams<{ vendedorId?: string; vendedorNome?: string }>();
  const insets = useSafeAreaInsets();
  const [q, setQ] = useState('');
  // lido no render sem reagir: o pendente só muda antes de navegar para cá, nunca com o seletor aberto
  const idEmEspera = produtoPendente()?.produtoId;
  const produtoEmEspera = useMemo(() => {
    if (!idEmEspera) return null;
    for (const tabela of Object.values(dados.produtos)) {
      const achado = tabela.items.find((p) => p.id === idEmEspera);
      if (achado) return achado.description;
    }
    return null;
  }, [dados.produtos, idEmEspera]);
  // RN-VEN-35 (T-0101): pedido em nome mostra a carteira do vendedor dono; o Campo (sem vendedorId) segue como antes
  const emNome = useMemo(() => {
    if (!vendedorId) return null;
    const nomes = nomesDosVendedores(pedidos, { id: vendedorId, nome: vendedorNome });
    return seletorEmNome({ clientes: dados.clientes, carteiras, vendedorId, nomes, busca: q, agora: new Date(), tz });
  }, [vendedorId, vendedorNome, pedidos, dados.clientes, carteiras, q, tz]);
  const opcoes: OpcaoDoSeletor[] = useMemo(
    () => emNome?.opcoes ?? filterCustomers(dados.clientes, q, []).slice(0, 60).map((cliente) => ({ cliente, selecionavel: true, nota: null })),
    [emNome, dados.clientes, q],
  );
  return (
    <ScrollView style={styles.root} contentContainerStyle={{ paddingTop: Math.max(16, insets.top + 4), paddingHorizontal: 20, paddingBottom: 24, gap: 12 }} keyboardShouldPersistTaps="handled">
      <BackLink label={rotuloVoltarNovoPedido(vendedorId)} fallback={hrefPedidos()} />
      <Text style={t.h1Small}>Novo pedido</Text>
      <Text style={t.sub}>Para qual cliente?</Text>
      {emNome ? (
        <Text style={t.small} testID="picker-carteira">
          {subtituloDoSeletor(emNome.nomeDoDono)}
        </Text>
      ) : null}
      {produtoEmEspera ? <Text style={t.small}>Item: {produtoEmEspera}</Text> : null}
      <CampoBusca valor={q} onChange={setQ} onLimpar={() => setQ('')} rotuloLimpar="Limpar a busca" placeholder="Nome, código ou bairro" rotuloAcessivel="Buscar cliente" testID="picker-search" />
      {opcoes.length === 0 ? (
        <EstadoVazio titulo="Nenhum cliente" texto={emNome ? vazioDoSeletor(emNome, q.trim() !== '') : 'Nenhum cliente encontrado. Confira o nome, o código ou o bairro.'} />
      ) : (
        <Card>
          {opcoes.map((o, i) => {
            const c = o.cliente;
            const ultima = i === opcoes.length - 1;
            return (
              <Pressable
                key={c.id}
                testID={`pick-${c.trade_name}`}
                accessibilityRole="button"
                accessibilityLabel={rotuloAcessivelDaOpcao(o)}
                accessibilityState={o.selecionavel ? undefined : { disabled: true }}
                disabled={!o.selecionavel}
                onPress={() => {
                  fixarClienteDoPendente(c.id);
                  router.setParams({ customerId: c.id });
                }}
                style={({ pressed }) => [styles.pickRow, !ultima && styles.divider, pressed && o.selecionavel && { backgroundColor: colors.ground }]}>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={o.selecionavel ? t.bodyStrong : [t.bodyStrong, { color: colors.ink2 }]} numberOfLines={1}>
                    {c.trade_name}
                  </Text>
                  <Text style={t.small}>{[c.city, c.district].filter(Boolean).join(' · ')}</Text>
                  {o.nota ? (
                    <Text style={t.small} testID={`pick-outra-${c.trade_name}`}>
                      {o.nota}
                    </Text>
                  ) : null}
                </View>
                {o.selecionavel ? <Icon name="chevron" size={16} color={colors.ink3} /> : null}
              </Pressable>
            );
          })}
        </Card>
      )}
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------

type Sent = { kind: 'sent'; order: OrderDetail; snapshot: Snapshot } | { kind: 'queued'; message: string; snapshot: Snapshot };
interface Snapshot {
  calculo: CalculoPedido;
  nomes: Array<[string, string]>;
  payment_terms: string;
  /** rascunho no momento do envio (o do aparelho é apagado depois de enviar): frete e endereço do resumo */
  rascunho: Draft;
}

function OrderEditor({ customerId, editId, visitId, stopId, vendedorEmNomeId, vendedorEmNomeNome }: { customerId: string; editId: string | null; visitId: string | null; stopId: string | null; vendedorEmNomeId: string | null; vendedorEmNomeNome: string | null }) {
  const app = useVendedor();
  const insets = useSafeAreaInsets();
  const avisoRodape = useAvisoRodape();
  const podeEditar = usePode('pedido.editar');
  const { dados, tz, offline, garantirProdutos: ensureProducts, enviarPedido: submitOrder, salvarEdicao: saveOrderEdit, condicoesDe, v1, formas, prazos, limitesDe, creditoDoCliente } = app;
  const draftKey = draftKeyFor(customerId, editId);
  const updateDraft = (_customerId: string, fn: (d: Draft) => Draft) => void app.atualizarRascunho(draftKey, customerId, fn);
  /** pedido em edição (servidor ou fila do aparelho) */
  const editTarget = editId ? (app.pedidos.find((o) => o.id === editId) ?? null) : null;
  const editingServer = Boolean(editTarget && !editTarget.local);
  const condicoes = condicoesDe(customerId);
  const customer = dados.clientes.find((c) => c.id === customerId) ?? null;
  const tableKey = customer?.price_table_id ?? 'default';
  const catalogBase = useMemo(() => dados.produtos[tableKey]?.items ?? [], [dados.produtos, tableKey]);
  // T-0084 §12 (RN-VEN-19): a aplicação vem só dos itens visíveis e do rascunho (cache em memória), não da tabela inteira
  const [textos, setTextos] = useState<ReadonlyMap<string, string>>(new Map());
  const catalog = useMemo(() => (textos.size === 0 ? catalogBase : catalogBase.map((p) => (textos.has(p.id) ? { ...p, applications: textos.get(p.id)! } : p))), [catalogBase, textos]);
  const productsAt = dados.produtos[tableKey]?.synced_at ?? dados.sincronizado_em ?? '';
  const [query, setQuery] = useState('');
  /** T-0084 C9: resposta da busca do Catálogo para esta consulta; `null` = indisponível, vale a busca local (reserva) */
  const [erroBusca, setErroBusca] = useState(false);
  const [buscaCatalogo, setBuscaCatalogo] = useState<{ q: string; itens: Array<{ produto_id: string; serve_em: TrechoServeEm | null }> } | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const draft: Draft = dados.rascunhos[draftKey] ?? rascunhoVazio(customerId);

  // pedido aberto pela ficha do cliente: liga o rascunho à visita e à parada da rota
  useEffect(() => {
    if (!editId && (visitId || stopId)) updateDraft(customerId, (d) => ligarRascunho(d, visitId, stopId));
  }, [visitId, stopId, editId, customerId]);

  // RN-VEN-35: o rascunho guarda o dono (vendedor) escolhido pelo gestor; sem o parâmetro, o pedido é do próprio usuário
  useEffect(() => {
    if (editId) return;
    if ((draft.vendedor_em_nome_id ?? null) !== vendedorEmNomeId || (draft.vendedor_em_nome_nome ?? null) !== vendedorEmNomeNome) updateDraft(customerId, (d) => ({ ...d, vendedor_em_nome_id: vendedorEmNomeId, vendedor_em_nome_nome: vendedorEmNomeNome }));
  }, [vendedorEmNomeId, vendedorEmNomeNome, editId, customerId, draft.vendedor_em_nome_id, draft.vendedor_em_nome_nome]);

  useEffect(() => {
    if (customer && catalog.length === 0) void ensureProducts(customer);
  }, [customer, catalog.length, ensureProducts]);

  // T-0052: "Adicionar ao pedido" do Catálogo. O produto vem de um pendente em memória (consumido uma vez, fora da URL):
  // no catálogo carregado e ao voltar do Catálogo aberto de dentro do pedido (a tela já montada ganha o foco).
  const draftAtual = useRef(draft);
  draftAtual.current = draft;
  const aplicarProdutoPendente = useCallback(() => {
    if (sent || catalog.length === 0) return;
    const id = pegarProdutoPendente(customerId, editId);
    if (!id) return;
    const r = rascunhoComProduto(draftAtual.current, id, catalog);
    if (r.resultado === 'adicionado') {
      updateDraft(customerId, (d) => rascunhoComProduto(d, id, catalog).rascunho);
      const desfazer = () => updateDraft(customerId, (d) => rascunhoSemProduto(d, id));
      avisoRodape.mostrar({ texto: textoRetornoProduto(r), acao: { rotulo: 'Desfazer', onPress: desfazer, testID: 'produto-desfazer' } });
    } else {
      avisoRodape.mostrar({ texto: textoRetornoProduto(r) });
    }
  }, [editId, sent, catalog, customerId, avisoRodape.mostrar]);
  // voltou ao editor sem escolher produto: a origem do Catálogo não sobra para outro fluxo
  useEffect(() => descartarOrigemEditor(), []);
  useEffect(() => aplicarProdutoPendente(), [aplicarProdutoPendente]);
  useFocusEffect(aplicarProdutoPendente);

  // RN-VEN-24/25: forma e prazo entre os permitidos ao cliente (formas do aparelho). Sem formas (antes do 1º sync com a 0037) vale a
  // lista de condições de antes; a demonstração usa a lista fixa da Fase M.
  const limites = limitesDe(customerId);
  const opcoesLegado = useMemo(
    () => (v1 ? condicoes.map((c) => ({ id: c.id as string | null, rotulo: c.descricao })) : PAYMENT_TERMS.map((p) => ({ id: null as string | null, rotulo: p as string }))),
    [v1, condicoes],
  );
  useEffect(() => {
    if (!v1 || sent) return;
    if (formas.length > 0) {
      // sem pagamento (ou fora da lista do cliente): a primeira forma permitida e o primeiro prazo habilitado
      const novo = rascunhoComPagamentoPadrao(draft, formas, prazos, limites);
      if (novo !== draft) updateDraft(customerId, (d) => rascunhoComPagamentoPadrao(d, formas, prazos, limites));
      return;
    }
    // sem formas no aparelho: a condição padrão, como antes
    if (editId || condicoes.length === 0) return;
    if (draft.condicao_pagamento_id && condicoes.some((c) => c.id === draft.condicao_pagamento_id)) return;
    const padrao = condicoes[0]!;
    updateDraft(customerId, (d) => ({ ...d, payment_terms: padrao.descricao, condicao_pagamento_id: padrao.id }));
  }, [v1, formas, prazos, limites.prazo_medio_max_dias, limites.formas_pagamento, condicoes, draft.forma_pagamento_id, draft.prazo_pagamento_id, draft.condicao_pagamento_id, sent, editId]);

  const ambiente = useAmbiente();
  const parametrosVendedor = ambiente.parametros('vendedor');
  const fretePadrao = modalidadePadraoDosParametros(parametrosVendedor);
  const [aba, setAba] = useState<AbaNovoPedido>('itens');
  const saveEditRef = useRef<() => Promise<void>>(async () => undefined);
  const sendRef = useRef<(tipo?: 'pedido' | 'orcamento') => Promise<void>>(async () => undefined);
  const [salvarAberto, setSalvarAberto] = useState(false);
  const [descartarAberto, setDescartarAberto] = useState(false);
  // V1: o campo com foco fica acima do teclado (Android edge-to-edge); V13: o voltar do Android volta uma aba
  const rolagem = useCampoAcimaDoTeclado();
  // W2: o voltar do Android só vale com a tela em foco
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (sent || aba === 'itens' || salvarAberto || descartarAberto) return false;
        setAba(aba === 'resumo' ? 'detalhes' : 'itens');
        return true;
      });
      return () => sub.remove();
    }, [aba, sent, salvarAberto, descartarAberto]),
  );
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  // RN-VEN-10: em nome, a alçada é a do gestor (supervisor/gerente), como na API
  const politica = dados.politica && vendedorEmNomeId ? politicaParaAutor(dados.politica, app.perfil) : dados.politica;
  const vendedorId = vendedorEmNomeId ?? dados.me?.seller?.id ?? '';
  const calculoAtual = useMemo(
    () =>
      politica
        ? calcularPedido({ lines: draft.lines, ajustes: draft.ajustes ?? {}, desconto_pct: draft.discount_pct, acrescimo_pct: draft.acrescimo_pct ?? 0, desconto_valor_cents: draft.desconto_valor_cents, acrescimo_valor_cents: draft.acrescimo_valor_cents, ajuste_em: draft.ajuste_em, catalogo: catalog, unidades: app.unidades, faixas: dados.produtos[tableKey]?.faixas, aplicacao: { padrao: aplicacaoNoOrcamentoPadrao(parametrosVendedor), max: aplicacaoMaxOrcamento(parametrosVendedor) }, politica, vendedor_id: vendedorId })
        : null,
    [parametrosVendedor, draft.lines, draft.ajustes, draft.discount_pct, draft.acrescimo_pct, draft.desconto_valor_cents, draft.acrescimo_valor_cents, draft.ajuste_em, catalog, app.unidades, dados.produtos, tableKey, politica, vendedorId],
  );
  const calculoBase = sent ? sent.snapshot.calculo : calculoAtual;
  // T-0071 (RF-CAT-03): sugestões da aba Detalhes, calculadas no aparelho (offline) só quando a aba está aberta
  const [sugestoes, setSugestoes] = useState<SugestoesDaTela>(SUGESTOES_VAZIAS);
  const chaveSugestoes = JSON.stringify(draft.lines);
  useEffect(() => {
    if (aba !== 'detalhes' || sent || !customer) return;
    let vivo = true;
    void app.sugestoesDoPedido(customer, draft.lines, catalog).then((r) => {
      if (vivo) setSugestoes(r);
    });
    return () => {
      vivo = false;
    };
  }, [aba, sent, chaveSugestoes, catalog.length, customer?.id]);
  // RN-VEN-12/13: cartão "Crédito do cliente" (core.financeiro_cliente@1 no aparelho, vale offline), lido ao abrir Detalhes
  const [credito, setCredito] = useState<ModeloDoCredito | null | undefined>(undefined);
  // RN-VEN-13 (T-0129): título vencido há mais que o limite com prazo a prazo nunca bloqueia a forma; o pedido vai ao supervisor (aprovação)
  const prazoEscolhido = prazos.find((p) => p.id === draft.prazo_pagamento_id);
  const vencidoAprova =
    !sent && credito?.tipo === 'dados' && credito.alerta !== null && prazoEscolhido !== undefined && exigeAprovacaoPorVencido({ maior_atraso_dias: credito.alerta.dias, prazo_medio_dias: prazoEscolhido.prazo_medio_dias, limite_dias: tituloVencidoDias(parametrosVendedor) });
  const calculo = calculoBase && vencidoAprova && calculoBase.nivel === null ? { ...calculoBase, nivel: 'supervisor' as const } : calculoBase;
  useEffect(() => {
    if (aba !== 'detalhes' || sent) return;
    let vivo = true;
    void creditoDoCliente(customerId)
      .then((m) => vivo && setCredito(m))
      .catch(() => vivo && setCredito(null));
    return () => {
      vivo = false;
    };
  }, [aba, sent, customerId, creditoDoCliente, app.sincronizadoEm]);
  // RN-VEN-23: "Leve mais e pague menos" com as faixas do Catálogo guardadas no aparelho (vazio = o cartão some)
  const leveMais = useMemo(
    () => (calculoAtual ? itensLeveMais({ calculo: calculoAtual, faixas: dados.produtos[tableKey]?.faixas, nomeDoProduto: (id) => byId.get(id)?.description ?? 'Produto', precoTabelaUnidade: (id) => byId.get(id)?.price_cents ?? null }) : []),
    [calculoAtual, dados.produtos, tableKey, byId],
  );
  const terms = sent ? sent.snapshot.payment_terms : draft.payment_terms;
  const nomes = useMemo(() => new Map<string, string>(sent ? sent.snapshot.nomes : catalog.map((p) => [p.id, p.description] as [string, string])), [sent, catalog]);
  const frete = draft.frete ?? { modalidade: fretePadrao };
  const freteAviso = freteValido(frete);
  const pagamentoAviso = pendenciaDoPagamento(draft, formas, prazos, limites);

  // T-0084 C9 (RN-CAT-12): busca do Catálogo com "Serve em"; indisponível (sem leitura no aparelho, sem sinal, falha) = busca local, sem erro
  const buscarNoCatalogo = app.buscarProdutos;
  useEffect(() => {
    const q = query.trim();
    if (!q || sent) {
      setBuscaCatalogo(null);
      setErroBusca(false);
      return;
    }
    let vivo = true;
    const espera = setTimeout(() => {
      void buscarNoCatalogo(q, catalogBase.length <= 5000 ? catalogBase.map((p) => p.id) : null).then((r) => {
        if (!vivo) return;
        setErroBusca(r.tipo === 'erro');
        setBuscaCatalogo(r.tipo === 'ok' ? { q, itens: r.itens } : null);
      });
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [query, sent, catalogBase, buscarNoCatalogo]);
  const resultadosDaBusca = query.trim() ? (buscaCatalogo && buscaCatalogo.q === query.trim() ? resolverBusca(buscaCatalogo.itens, byId, 40) : null) : [];
  const results = resultadosDaBusca ? resultadosDaBusca.map((r) => r.produto) : query.trim() ? searchProducts(catalog, query, 40) : [];
  const serveEmPorId = useMemo(() => new Map((resultadosDaBusca ?? []).flatMap((r) => (r.serveEm ? [[r.produto.id, r.serveEm] as const] : []))), [buscaCatalogo, query, byId]);
  // T-0084 §12 (RN-VEN-19): lê a aplicação só dos itens visíveis (≤ 40) e dos do rascunho
  const idsComTexto = [...new Set([...results.map((p) => p.id), ...Object.keys(draft.lines).filter((k) => (draft.lines[k] ?? 0) > 0).map((k) => lerChaveDaLinha(k).product_id)])];
  const chaveDosTextos = idsComTexto.join(',');
  const lerTextos = app.textosDeProdutos;
  useEffect(() => {
    if (idsComTexto.length === 0) return;
    let vivo = true;
    void lerTextos(idsComTexto).then((lidos) => {
      if (!vivo) return;
      setTextos((antes) => {
        let mudou = false;
        const prox = new Map(antes);
        for (const [id, tx] of lidos) if (prox.get(id) !== tx) { prox.set(id, tx); mudou = true; }
        return mudou ? prox : antes;
      });
    });
    return () => {
      vivo = false;
    };
  }, [chaveDosTextos, lerTextos]);

  if (editId && (!dados.rascunhos[draftKey] || !editTarget)) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 16, paddingHorizontal: 20, gap: 8 }]}>
        <BackLink label="Pedido" fallback={hrefPedido(editId)} />
        <EstadoVazio
          titulo={editTarget ? 'A edição ainda não começou' : 'Este pedido não está no aparelho'}
          texto={editTarget ? 'Volte ao pedido e toque em Editar.' : 'Conecte-se e puxe a tela de Pedidos para baixo para sincronizar.'}
          acao={{ rotulo: editTarget ? 'Voltar ao pedido' : 'Ir para Pedidos', onPress: () => (editTarget ? router.replace(hrefPedido(editId) as never) : irParaPedidos()) }}
        />
      </View>
    );
  }

  if (!customer || !calculo || !politica) {
    return (
      <View style={[styles.root, { paddingTop: insets.top + 16, paddingHorizontal: 20 }]}>
        <BackLink label="Voltar" fallback={hrefPedidos()} />
        <EstadoVazio titulo="Cliente não encontrado" texto="Sincronize com sinal para atualizar a carteira." acao={{ rotulo: 'Ir para Pedidos', onPress: () => irParaPedidos() }} />
      </View>
    );
  }

  const setLinhas = (lines: Record<string, number>, ajustes: Record<string, Ajuste>) => {
    setError(null);
    updateDraft(customerId, (d) => ({ ...d, lines, ajustes }));
  };

  const noSignal = offline;
  const limiteVendedor = limiteDoVendedor(politica, vendedorId);
  // edição de pedido já enviado com "modo sem sinal" ligado: precisa de conexão (não enfileira)
  const editBlockedOffline = editingServer && offline;
  const bloqueado = calculo.erros.length > 0 || Boolean(freteAviso) || Boolean(pagamentoAviso);
  const canSend = podeEnviarPedido({ jaEnviado: Boolean(sent), itens: calculo.linhas.length, recusado: bloqueado, edicaoSemSinal: editBlockedOffline, edicao: Boolean(editId), podeEditar });
  const vaiParaAprovacao = calculo.nivel !== null;
  const situacaoCliente = app.situacaoDoCliente(customerId);
  const diasValidade = validadeOrcamentoDias(ambiente.parametros('vendedor'));
  const validade = validadeDoOrcamento(new Date().toISOString(), diasValidade, tz);
  const opcoes = opcoesDoSalvar({ cliente: situacaoCliente, calculo, frete_erro: freteAviso, validade_data: validade.data });
  const rascunhoVisivel: Draft = sent ? sent.snapshot.rascunho : draft;
  const enderecosCliente = enderecosDoCliente(app.enderecos, customerId);
  const enderecoPadrao = enderecosCliente.find((e) => e.principal || e.tipo === 'principal') ?? null;
  const enderecoEscolhido = rascunhoVisivel.endereco_entrega_id ? (enderecosCliente.find((e) => e.id === rascunhoVisivel.endereco_entrega_id) ?? null) : enderecoPadrao;
  const produtosDoRascunho = [...new Set(Object.keys(draft.lines).filter((k) => (draft.lines[k] ?? 0) > 0).map((k) => lerChaveDaLinha(k).product_id))].flatMap((id) => {
    const p = byId.get(id);
    return p ? [p] : [];
  });

  const saveEdit = async () => {
    if (!editId || !podeEditar) return;
    setSending(true);
    setError(null);
    try {
      const res = await saveOrderEdit(editId, draft, customer, catalog);
      if (res.kind === 'server') {
        const b = statusBadge(res.order.status);
        deixarAvisoPendente(res.order.tipo === 'orcamento' ? `Orçamento ${res.order.number} atualizado` : `Pedido ${res.order.number} atualizado · ${b.label}`);
      } else {
        deixarAvisoPendente(offline ? 'Pedido da fila atualizado no aparelho. Será enviado quando o sinal voltar' : 'Pedido da fila atualizado');
      }
      if (router.canGoBack()) router.back();
      else router.replace(hrefPedido(editId) as never);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const send = async (tipo: 'pedido' | 'orcamento' = 'pedido') => {
    setSalvarAberto(false);
    setSending(true);
    setError(null);
    const rascunhoEnviado: Draft = { ...draft, tipo };
    const snapshot: Snapshot = { calculo, nomes: [...nomes.entries()], payment_terms: draft.payment_terms, rascunho: rascunhoEnviado };
    try {
      const res = await submitOrder(rascunhoEnviado, customer, catalog);
      if (tipo === 'orcamento') {
        // V8: o orçamento salvo abre em Pedidos ("‹ Pedidos"); o editor sai da pilha (replace) e o aviso vai para o detalhe
        const destino = res.kind === 'sent' ? res.order.id : (res.id ?? null);
        if (destino) {
          deixarAvisoPendente(avisoDoOrcamentoSalvo(res.kind === 'sent' ? res.order.number : null));
          router.replace(hrefPedido(destino) as never);
          return;
        }
      }
      setSent(res.kind === 'sent' ? { kind: 'sent', order: res.order, snapshot } : { kind: 'queued', message: res.message, snapshot });
      setQuery('');
      setAba('resumo');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const rotuloEdicao = !editingServer ? 'Salvar alterações no aparelho' : editTarget?.tipo === 'orcamento' ? 'Salvar orçamento' : vaiParaAprovacao ? 'Salvar e enviar para aprovação' : 'Salvar alterações';
  const docEdicao = editTarget?.tipo === 'orcamento' || draft.tipo === 'orcamento' ? 'orçamento' : 'pedido';
  const editTitle = editTarget?.number ? `Editar ${docEdicao} ${editTarget.number}` : `Editar ${docEdicao} no aparelho`;
  const emRascunho = (fn: (r: Draft) => Draft) => updateDraft(customerId, fn);
  const aoTrocarMedida = (texto: string, desfazer: () => void) => avisoRodape.mostrar({ texto, acao: { rotulo: 'Desfazer', onPress: desfazer, testID: 'medida-desfazer' } });

  const abas = abasDoPedido(calculo.linhas.length, Boolean(freteAviso) || Boolean(pagamentoAviso) || calculo.erros.length > 0);
  const noResumo = aba === 'resumo' || Boolean(sent);
  // o valor digitado no campo em foco vale já no toque (RN-VEN-02): "0" ou vazio tira o item, número válido grava
  saveEditRef.current = saveEdit;
  sendRef.current = send;
  // T-0089: o número digitado na quantidade só vale ao sair do campo; fecha o teclado e muda de aba no instante seguinte
  const depoisDeConfirmar = (fn: () => void) => {
    if (Keyboard.isVisible()) {
      Keyboard.dismiss();
      setTimeout(fn, 80);
    } else fn();
  };
  const irParaAba = (destino: AbaNovoPedido) => {
    aplicarValorPendente();
    depoisDeConfirmar(() => setAba(destino));
  };
  const aoSalvar = () => {
    const havia = aplicarValorPendente();
    // RN-VEN-35: pedido em nome vale só como pedido (sem a escolha Orçamento); vai direto
    if (!editId && vendedorEmNomeId) depoisDeConfirmar(() => void sendRef.current('pedido'));
    else if (!editId) depoisDeConfirmar(() => setSalvarAberto(true));
    // com o rascunho atualizado na próxima renderização, a edição salva a versão nova
    else if (havia) setTimeout(() => void saveEditRef.current(), 0);
    else depoisDeConfirmar(() => void saveEditRef.current());
  };
  const descartar = async () => {
    setDescartarAberto(false);
    await app.descartarRascunho(draftKey);
    if (router.canGoBack()) router.back();
    else router.replace(hrefPedidos() as never);
  };

  return (
    <View style={styles.root}>
      <View style={{ paddingTop: Math.max(16, insets.top + 4), paddingHorizontal: 20, paddingBottom: 8, gap: 2, backgroundColor: colors.surface }}>
        {editId ? <BackLink label="Pedido" fallback={hrefPedido(editId)} /> : <BackLink label="Voltar" fallback={hrefPedidos()} />}
        <Text style={t.h1Small} testID="order-editor-title">
          {editId ? editTitle : 'Novo pedido'}
        </Text>
        <Text style={t.sub} numberOfLines={2} testID="order-editor-cliente">
          {customer.trade_name} · cód. {customer.erp_code}
          {typeof limites.prazo_medio_max_dias === 'number' ? ` · prazo médio do cliente ${limites.prazo_medio_max_dias} dias` : ''}
        </Text>
        {vendedorEmNomeId ? (
          <Text style={t.sub} testID="order-editor-em-nome">
            Em nome de {vendedorEmNomeNome ?? 'vendedor'} · alçada de {app.perfil === 'gerente' ? 'gerente' : 'supervisor'}
          </Text>
        ) : null}
      </View>
      {!sent ? <Abas abas={abas} valor={aba} onChange={irParaAba} rotuloPendencia="Pendência nesta aba" testID="abas-pedido" /> : null}

      <AcimaDoTeclado>
      <ScrollView ref={rolagem.ref} onScroll={rolagem.onScroll} onLayout={rolagem.onLayout} scrollEventThrottle={32} contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 12, paddingBottom: 16, gap: 12 }} keyboardShouldPersistTaps="handled" testID="new-order">
        {draft.notice && !sent ? (
          <Banner icon="alert" testID="order-prefill-notice">
            {draft.notice}
          </Banner>
        ) : null}
        {editBlockedOffline ? (
          <Banner tone="danger" testID="banner-edit-offline">
            <Strong>Sem sinal.</Strong> Para editar um pedido já enviado, conecte-se à internet ou desligue o modo sem sinal no Perfil.
          </Banner>
        ) : null}

        {sent?.kind === 'queued' ? (
          <Banner testID="banner-saved">
            <Strong>{avisoSalvoNoAparelho(sent.snapshot.rascunho.tipo === 'orcamento' ? 'orcamento' : 'pedido').titulo}</Strong> {avisoSalvoNoAparelho('pedido').nota}
          </Banner>
        ) : sent?.kind === 'sent' ? (
          <SentCard order={sent.order} tipo={sent.snapshot.rascunho.tipo === 'orcamento' ? 'orcamento' : 'pedido'} validadeData={validade.data} />
        ) : noSignal && !editBlockedOffline ? (
          <Banner testID="banner-offline">
            <Strong>Sem sinal.</Strong> Preço e estoque de {formatHHMM(productsAt, tz)}.
          </Banner>
        ) : null}

        {!sent && aba === 'itens' ? (
          <>
            <CardPagamento rascunho={draft} formas={formas} prazos={prazos} cliente={limites} legado={opcoesLegado} itens={calculo.linhas.length} totalCents={calculo.total_cents} onRascunho={emRascunho} />
            <CampoBusca valor={query} onChange={setQuery} onLimpar={() => setQuery('')} rotuloLimpar="Limpar busca" placeholder="Código, descrição ou veículo" rotuloAcessivel="Buscar produto" testID="product-search" />
            <Trilha compacta atualTocavel itens={niveisDaTrilha(produtosDoRascunho[produtosDoRascunho.length - 1] ?? null)} onEscolher={() => {
                guardarOrigemEditor({ customerId, editId: editId ?? undefined, visitId: visitId ?? undefined, stopId: stopId ?? undefined });
                irParaCatalogoDoPedido(customerId);
              }} rotuloAcessivel={(i) => `Abrir o catálogo: ${i.rotulo}`} testID="trilha-catalogo" />
            {query.trim() ? (
              erroBusca ? (
                <EstadoVazio titulo="Busca indisponível" texto={MENSAGEM_ERRO_BUSCA} testID="busca-erro" />
              ) : results.length === 0 ? (
                <EstadoVazio titulo={textoBuscaSemResultado(query).titulo} texto={textoBuscaSemResultado(query).texto} testID="busca-sem-resultado" />
              ) : (
                <ListaDeItens produtos={results} serveEm={serveEmPorId} rascunho={draft} unidades={app.unidades} calculo={calculo} onLinhas={setLinhas} aoTrocarMedida={aoTrocarMedida} />
              )
            ) : null}
            {produtosDoRascunho.length > 0 ? (
              <>
                <RotuloSecao texto="No pedido" testID="no-pedido" />
                <View testID="order-lines">
                  <ListaDeItens produtos={produtosDoRascunho} rascunho={draft} unidades={app.unidades} calculo={calculo} onLinhas={setLinhas} aoTrocarMedida={aoTrocarMedida} />
                </View>
              </>
            ) : !query.trim() ? (
              <Card style={{ padding: 16, gap: 4 }}>
                <Text style={t.bodyStrong}>Nenhum item</Text>
                <Text style={t.small}>{catalog.length > 0 ? 'Busque um produto acima.' : 'Sincronize com sinal para baixar os preços.'}</Text>
              </Card>
            ) : null}
          </>
        ) : null}

        {!sent && aba === 'detalhes' ? (
          <AbaDetalhes
            rascunho={draft}
            clienteId={customerId}
            enderecos={app.enderecos}
            motivoCadastro={opcoes.motivo_so_orcamento}
            sugestoes={sugestoes}
            nomeDoProduto={(id) => byId.get(id)?.description ?? 'Produto'}
            onAdicionar={(id) => {
              const antes = { lines: draft.lines, ajustes: draft.ajustes ?? {} };
              setLinhas(adicionarSugestao(draft.lines, id), draft.ajustes ?? {});
              avisoRodape.mostrar({ texto: avisoSugestaoAdicionada(byId.get(id)?.description ?? 'Produto', false), acao: { rotulo: 'Desfazer', onPress: () => setLinhas(antes.lines, antes.ajustes), testID: 'sugestao-desfazer' } });
            }}
            onTrocar={(sg) => {
              const p = byId.get(sg.produto_id);
              const medidas = p ? unidadesDoProduto(p.id, app.unidades, p.unit) : [];
              const de = medidas.find((m) => m.unidade === sg.de_unidade) ?? medidas[0];
              const antes = { lines: draft.lines, ajustes: draft.ajustes ?? {} };
              const r = aplicarTrocaDeEmbalagem(draft.lines, draft.ajustes ?? {}, sg, { unidade_base: p?.unit ?? sg.de_unidade, fator: de?.fator ?? 1 });
              setLinhas(r.lines, r.ajustes);
              avisoRodape.mostrar({ texto: avisoSugestaoAdicionada(nomeDaSugestao(p?.description ?? 'Produto', sg), true), acao: { rotulo: 'Desfazer', onPress: () => setLinhas(antes.lines, antes.ajustes), testID: 'sugestao-desfazer' } });
            }}
            onRascunho={emRascunho}
            credito={<CreditoDoClienteCard credito={credito} sincronizadoEm={app.sincronizadoEm} agora={new Date()} tz={tz} semSinal={offline} />}
            fretePadrao={fretePadrao}
            transportadoras={app.transportadoras}
            leveMais={linhasDoLeveMais(leveMais, (chave, quantidade, texto) => {
              const antes = { lines: draft.lines, ajustes: draft.ajustes ?? {} };
              setLinhas(linhasNaFaixa(draft.lines, chave, quantidade), draft.ajustes ?? {});
              avisoRodape.mostrar({ texto, acao: { rotulo: 'Desfazer', onPress: () => setLinhas(antes.lines, antes.ajustes), testID: 'leve-mais-desfazer' } });
            })}
          />
        ) : null}

        {noResumo ? (
          <AbaResumo
            rascunho={rascunhoVisivel}
            calculo={calculo}
            nomes={nomes}
            prazo={terms}
            endereco={enderecoEscolhido ? textoDoEndereco(enderecoEscolhido) : null}
            limiteVendedor={limiteVendedor}
            fretePadrao={fretePadrao}
            onRascunho={emRascunho}
            onSalvar={aoSalvar}
            onCancelar={() => setDescartarAberto(true)}
            salvando={sending}
            podeSalvar={!sent && canSend}
            rotuloSalvar={editId ? rotuloEdicao : 'Salvar'}
            somenteLeitura={Boolean(sent)}
            pendencias={<PendenciasDoPedido erros={pagamentoAviso ? [...calculo.erros, pagamentoAviso] : calculo.erros} freteAviso={freteAviso} onIrPara={() => setAba('detalhes')} />}
          />
        ) : null}

        {!sent && !noResumo ? <PendenciasDoPedido erros={pagamentoAviso ? [...calculo.erros, pagamentoAviso] : calculo.erros} freteAviso={freteAviso} onIrPara={() => setAba('detalhes')} /> : null}

        {!sent && !noResumo ? (
          <Botao testID="avancar" nivel="principal" rotulo="Avançar" onPress={() => irParaAba(aba === 'itens' ? 'detalhes' : 'resumo')} />
        ) : null}
        {error ? (
          <Banner icon="alert" tone="danger" testID="order-error">
            {error}
          </Banner>
        ) : null}
      </ScrollView>
      </AcimaDoTeclado>

      {sent ? (
        <View style={[styles.footer, { paddingBottom: 22 + insets.bottom }]}>
          <Botao testID="send-order-done" nivel="principal" rotulo="Ir para Pedidos" onPress={() => irParaPedidos()} />
        </View>
      ) : null}

      <AvisoRodape {...avisoRodape.props} respiroInferior={insets.bottom + 16} />
      <FolhaSalvar visivel={salvarAberto} opcoes={opcoes} comOrcamento={app.preVendaLigada} onEnviar={() => void send('pedido')} onOrcamento={() => void send('orcamento')} onFechar={() => setSalvarAberto(false)} />
      <DialogoDescartar visivel={descartarAberto} onVoltar={() => setDescartarAberto(false)} onDescartar={() => void descartar()} />
    </View>
  );
}

function SentCard({ order, tipo, validadeData }: { order: OrderDetail; tipo: 'pedido' | 'orcamento'; validadeData: string }) {
  const b = statusBadge(order.status);
  const c = confirmacaoDoEnvio({ tipo, numero: order.number, status: order.status, validade_data: validadeData, pending_reason: order.pending_reason, rejection_reason: order.rejection_reason });
  return (
    <View style={styles.sent} testID="sent-card">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Icon name="check" size={18} color={colors.success} strokeWidth={2.4} />
        <Text style={[t.bodyStrong, { color: colors.success }]}>{c.titulo}</Text>
        {c.mostrarStatus ? <Badge label={b.label} fg={b.fg} bg={b.bg} /> : null}
      </View>
      {c.nota ? <Text style={[t.small, { color: colors.ink }]}>{c.nota}</Text> : null}
      <Botao testID="ver-pedido-enviado" rotulo={tipo === 'orcamento' ? 'Ver orçamento' : 'Ver pedido'} onPress={() => router.navigate(hrefPedido(order.id) as never)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.ground },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  pickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, minHeight: 56 },
  prod: { gap: 6, paddingVertical: 12, paddingHorizontal: 14 },
  qtyBtn: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  qty: { width: 44, height: 48, textAlign: 'center', fontFamily: fonts.bold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'], padding: 0 },
  step: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pctBox: { flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  pctInput: { flex: 1, minWidth: 0, height: 42, textAlign: 'right', fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, padding: 0 },
  pctSuffix: { flex: 1, fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink2, marginLeft: 2 },
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segItem: { flexGrow: 1, minWidth: 72, paddingHorizontal: 10, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  sent: { backgroundColor: colors.successBg, borderRadius: radius.lg, padding: 12, gap: 8 },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14, paddingHorizontal: 20, gap: 10 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  sumLabel: { fontFamily: fonts.body, fontSize: 13, color: colors.ink2 },
  sumValue: { fontFamily: fonts.body, fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] },
  total: { fontFamily: fonts.display, fontSize: 20, color: colors.ink, fontVariant: ['tabular-nums'] },
});
