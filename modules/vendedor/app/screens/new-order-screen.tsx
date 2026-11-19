/**
 * Novo pedido de distribuidora (T-0061/T-0071/T-0089/T-0136/T-0137), em 4 abas: Venda, Itens, Entrega e Resumo. O Resumo é completo
 * (só leitura, desconto do pedido numa linha) e traz os botões Salvar e enviar pedido, Apenas salvar, Salvar como orçamento e Cancelar
 * (`botoesDoResumo`); não há folha intermediária.
 * Preço da tabela do cliente, medidas (UN/CX), endereços e transportadoras vêm das linhas locais (funciona sem sinal).
 * Preço, desconto e acréscimo por item e por pedido, desconto efetivo e alçada: domain de preço (`lib/novo-pedido`), a mesma
 * regra que a API revalida. Frete CIF/FOB sem valor (RN-VEN-16); endereço de entrega do cadastro (RN-VEN-17).
 * Modo edição (`editId`): "Editar pedido 10xxx", mesmo cliente; rascunho em `edit:<id>` (preenchido pelo detalhe).
 * Duplicar chega aqui como novo pedido com o rascunho do cliente já preenchido.
 */
import { formatarDocumento } from '@macuxi/comum';
import { localIsoDate } from '@macuxi/comum/fuso';
import { useAmbiente, usePode } from '@macuxi/platform-sdk/react';
import { Abas, AvisoRodape, CABECALHO, CabecalhoTela, Dialogo, Badge, Banner, Botao, Card, CampoBusca, colors, EstadoVazio, fonte, Icon, Loading, radius, Screen, Strong, type as t, useAvisoRodape } from '@macuxi/ui/mobile';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { OrderDetail } from '../../contracts';
import { botoesDoResumo, PERGUNTA_DA_ALCADA, perguntaDaAlcada } from '../../domain/botoes-resumo';
import { aplicacaoMaxOrcamento, aplicacaoNoOrcamentoPadrao } from '../../domain/aplicacao';
import { aplicarGeralNasLinhas, completarComGeral, linhasComOutroAjuste, linhasDiferentesDoGeral, type AjusteGeral } from '../../domain/desconto-geral';
import { podeEnviarPedido } from '../../domain/quantidade';
import { buscaPodeComecar, codigoExatoPrimeiro, paginaDaBusca, resolverBusca, type TrechoServeEm } from '../../domain/busca-seletor';
import { rotuloVoltarNovoPedido } from '../../domain/pedido-em-nome';
import { modalidadePadraoDosParametros, percentualAjusteParaBp } from '../../domain/preco-pedido';
import { AcimaDoTeclado, useCampoAcimaDoTeclado } from '../components/acima-do-teclado';
import { AbaEntrega, AbaResumo, AbaVenda, CardPagamento, FimDaAbaItens, linhasDoLeveMais } from '../components/novo-pedido-abas';
import { financeiroParaAprovacao, type ModeloDoCredito } from '../lib/credito-cliente';
import { disponivelParaAlerta, motivosFinanceirosDoPedido } from '../../domain/credito-pedido';
import { tituloVencidoDias } from '../../domain/pagamento';
import { itensLeveMais, linhasNaFaixa } from '../lib/leve-mais';
import { rascunhoComPagamentoPadrao, situacaoDoPagamento } from '../lib/pagamento-pedido';
import { enderecoDoRascunho } from '../lib/endereco-pedido';
import { calcularPedido, enderecosDoCliente, lerChaveDaLinha, situacaoDoFrete, politicaParaAutor, textoDoEndereco, type Ajuste, type CalculoPedido } from '../lib/novo-pedido';
import { abaAnteriorDoPedido, abaInicialDoRascunho, AVISO_PEDIDO_SALVO, abasDoPedido, avisoSalvoNoAparelho, avisoSugestaoAdicionada, confirmacaoDoEnvio, nomeDaSugestao, proximaAbaDoPedido, type AbaNovoPedido } from '../lib/textos-pedido';
import { unidadesDoProduto } from '../lib/novo-pedido';
import { MENSAGEM_ERRO_BUSCA } from '../lib/busca-catalogo';
import { alertasDoNovoPedido, idDaAba, itensSemEstoque, pendenciasDasAbasTentadas, primeiraAbaComFalta } from '../lib/alertas-novo-pedido';
import { impedeEnviarPorAlertas, soOrcamentoPorAlertas, vencidosComEfeito } from '../../domain/alertas-pedido';
import { AreaAlertas } from '../components/area-alertas';
import { MostrarMais, ResultadosDaBusca, SemResultadoDaBusca, VisorDeFoto } from '../components/busca-itens';
import { DescontoGeral } from '../components/desconto-geral';
import { FolhaDoItem } from '../components/folha-do-item';
import { AVISO_ITEM_REMOVIDO, aplicarItemNoRascunho } from '../lib/item-popup';
import { nomesDosVendedores, rotuloAcessivelDaOpcao, seletorEmNome, subtituloDoSeletor, vazioDoSeletor, type OpcaoDoSeletor } from '../lib/seletor-em-nome';
import { filterCustomers, PAYMENT_TERMS, searchProducts } from '../lib/catalog';
import { errorMessage } from '../lib/erros';
import { statusBadge } from '../lib/order-status';
import { draftKeyFor, ligarRascunho, rascunhoVazio, type Rascunho as Draft } from '../lib/pedidos';
import { hrefFichaDoCliente, hrefPedido, hrefPedidos, irParaPedidos } from '../rotas';
import { destinoAposSalvar } from '../../domain/destino-apos-salvar';
import { adicionarSugestao, aplicarTrocaDeEmbalagem, SUGESTOES_VAZIAS, type SugestoesDaTela } from '../lib/sugestoes-pedido';
import { pendenciasDePreenchimento, type AbaDoPedido } from '../../domain/pendencias-preenchimento';
import { destinoDoSalvarDaSaida, opcoesDaSaida, opcoesDaSaidaEdicao, pedidoAlterado } from '../../domain/sair-do-pedido';
import { FolhaSaidaDoPedido } from '../components/saida-do-pedido';
import { useBloquearSaida } from '../lib/bloquear-saida';
import { deixarAvisoPendente } from '../lib/aviso-pendente';
import { aplicarValorPendente } from '../lib/valor-pendente';
import { useVendedor } from '../state/use-vendedor';

/** Chaves das linhas com quantidade (as que recebem o Desc./Acrésc. geral). */
function chavesDasLinhas(lines: Record<string, number>): string[] {
  return Object.keys(lines).filter((k) => (lines[k] ?? 0) > 0);
}

export default function NewOrderScreen() {
  const { customerId, editId, visitId, stopId, vendedorId, vendedorNome } = useLocalSearchParams<{ customerId?: string; editId?: string; visitId?: string; stopId?: string; vendedorId?: string; vendedorNome?: string }>();
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
    <Screen testID="new-order-aviso" cabecalho={{ titulo: 'Novo pedido', voltar: { label: rotuloVoltarNovoPedido(vendedorId), fallback: hrefPedidos() } }}>
      <EstadoVazio titulo={titulo} texto={texto} acao={acao} />
    </Screen>
  );
}

// ---------------------------------------------------------------------------

function CustomerPicker() {
  const { dados, carteiras, pedidos, tz } = useVendedor();
  const { vendedorId, vendedorNome } = useLocalSearchParams<{ vendedorId?: string; vendedorNome?: string }>();
  const [q, setQ] = useState('');
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
    <Screen gap={12} cabecalho={{ titulo: 'Novo pedido', subtitulo: 'Para qual cliente?', voltar: { label: rotuloVoltarNovoPedido(vendedorId), fallback: hrefPedidos() } }}>
      {emNome ? (
        <Text style={t.small} testID="picker-carteira">
          {subtituloDoSeletor(emNome.nomeDoDono)}
        </Text>
      ) : null}
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
                onPress={() => router.setParams({ customerId: c.id })}
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
    </Screen>
  );
}

// ---------------------------------------------------------------------------

type Sent = { kind: 'sent'; order: OrderDetail; snapshot: Snapshot } | { kind: 'queued'; snapshot: Snapshot };
interface Snapshot {
  calculo: CalculoPedido;
  nomes: Array<[string, string]>;
  payment_terms: string;
  /** rascunho no momento do envio (o do aparelho é apagado depois de enviar): frete e endereço do resumo */
  rascunho: Draft;
}

function OrderEditor({ customerId, editId, visitId, stopId, vendedorEmNomeId, vendedorEmNomeNome }: { customerId: string; editId: string | null; visitId: string | null; stopId: string | null; vendedorEmNomeId: string | null; vendedorEmNomeNome: string | null }) {
  const app = useVendedor();
  const avisoRodape = useAvisoRodape();
  const [chaveDaRemocao, setChaveDaRemocao] = useState(0);
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
  const [query, setQuery] = useState('');
  /** T-0148: popup do item (produto aberto) */
  const [popupId, setPopupId] = useState<string | null>(null);
  /** T-0165: o último Desc./Acrésc. geral aplicado; o item que entra depois leva o mesmo. Não é gravado no pedido (o ajuste vale em cada item). */
  const [geralAplicado, setGeralAplicado] = useState<AjusteGeral | null>(null);
  /** T-0084 C9: resposta da busca do Catálogo para esta consulta; `null` = indisponível, vale a busca local (reserva) */
  const [erroBusca, setErroBusca] = useState(false);
  const [buscaCatalogo, setBuscaCatalogo] = useState<{ q: string; itens: Array<{ produto_id: string; serve_em: TrechoServeEm | null }>; sugestao: string | null } | null>(null);
  /** T-0167: páginas de 20 já à vista; volta a 1 a cada nova busca */
  const [paginasBusca, setPaginasBusca] = useState(1);
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

  const draftAtual = useRef(draft);
  draftAtual.current = draft;

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
  const [aba, setAba] = useState<AbaNovoPedido>(() => abaInicialDoRascunho(draft));
  const saveEditRef = useRef<(opcoes?: { transformar?: boolean }) => Promise<void>>(async () => undefined);
  const sendRef = useRef<(tipo?: 'pedido' | 'orcamento') => Promise<boolean>>(async () => false);
  // RN-VEN-38: folha "Sair do pedido?" e a saída que a pessoa pediu (cabeçalho, Android, barra inferior ou Cancelar)
  const [saidaAberta, setSaidaAberta] = useState(false);
  const saidaPedida = useRef<(() => void) | null>(null);
  // RN-VEN-10 (T-0151): a pergunta "Desconto acima da sua alçada. Enviar para aprovação?" guarda o que fazer ao confirmar
  const [perguntaAlcada, setPerguntaAlcada] = useState<{ seguir: () => void } | null>(null);
  /** Novo pedido alterado (edição de pedido salvo segue com o diálogo de antes) */
  const alterado = !editId && !sent && pedidoAlterado(draft);
  // T-0141 (RN-VEN-39): a lista Rascunhos retoma na aba em que o vendedor parou; gravar a aba não renova as 24 h
  const rascunhoGravado = Boolean(dados.rascunhos[draftKey]);
  useEffect(() => {
    if (sent || !rascunhoGravado || !(alterado || editId) || draft.aba === aba) return;
    void app.atualizarRascunho(draftKey, customerId, (d) => ({ ...d, aba }), { manterAlteracao: true });
  }, [aba]);
  /** Qualquer saída: com o pedido alterado pergunta (RN-VEN-38); sem alteração, sai direto. */
  const pedirSaida = (prosseguir: () => void) => {
    if (!alterado) {
      prosseguir();
      return;
    }
    saidaPedida.current = prosseguir;
    setSaidaAberta(true);
  };
  /** v1.0.1: Cancelar na edição abre a mesma folha "Sair do pedido?", com as opções da edição; a saída é sempre perguntada. */
  const pedirSaidaDaEdicao = () => {
    saidaPedida.current = () => (router.canGoBack() ? router.back() : router.replace(hrefPedidos() as never));
    setSaidaAberta(true);
  };
  const pedirSaidaRef = useRef(pedirSaida);
  pedirSaidaRef.current = pedirSaida;
  useBloquearSaida(alterado, (prosseguir) => pedirSaidaRef.current(prosseguir));
  // V1: o campo com foco fica acima do teclado (Android edge-to-edge); V13: o voltar do Android volta uma aba
  const rolagem = useCampoAcimaDoTeclado();
  // W2: o voltar do Android só vale com a tela em foco
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        if (sent || saidaAberta) return false;
        const anterior = abaAnteriorDoPedido(aba);
        if (anterior === null) {
          // RN-VEN-38: o botão Voltar do Android sai do pedido alterado só depois da folha (da aba Venda)
          if (!alterado) return false;
          pedirSaidaRef.current(() => (router.canGoBack() ? router.back() : router.replace(hrefPedidos() as never)));
          return true;
        }
        setAba(anterior);
        return true;
      });
      return () => sub.remove();
    }, [aba, sent, saidaAberta, alterado]),
  );
  const byId = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);
  // RN-VEN-10: em nome, a alçada é a do gestor (supervisor/gerente), como na API
  const politica = dados.politica && vendedorEmNomeId ? politicaParaAutor(dados.politica, app.perfil) : dados.politica;
  const vendedorId = vendedorEmNomeId ?? dados.me?.seller?.id ?? '';
  const percentualAjusteBp = percentualAjusteParaBp(draft.prazo_percentual_ajuste);
  const calculoAtual = useMemo(
    () =>
      politica
        ? calcularPedido({ lines: draft.lines, percentual_ajuste_bp: percentualAjusteBp, ajustes: draft.ajustes ?? {}, desconto_pct: draft.discount_pct, acrescimo_pct: draft.acrescimo_pct ?? 0, desconto_valor_cents: draft.desconto_valor_cents, acrescimo_valor_cents: draft.acrescimo_valor_cents, ajuste_em: draft.ajuste_em, catalogo: catalog, unidades: app.unidades, faixas: dados.produtos[tableKey]?.faixas, ...(draft.precos_congelados ? { congelados: draft.precos_congelados } : {}), aplicacao: { padrao: aplicacaoNoOrcamentoPadrao(parametrosVendedor), max: aplicacaoMaxOrcamento(parametrosVendedor) }, politica, vendedor_id: vendedorId, limite: app.limiteDesconto })
        : null,
    [parametrosVendedor, percentualAjusteBp, draft.lines, draft.ajustes, draft.discount_pct, draft.acrescimo_pct, draft.desconto_valor_cents, draft.acrescimo_valor_cents, draft.ajuste_em, catalog, app.unidades, dados.produtos, tableKey, politica, vendedorId],
  );
  const calculoBase = sent ? sent.snapshot.calculo : calculoAtual;
  const calculoRef = useRef(calculoBase);
  // T-0071 (RF-CAT-03): sugestões do fim da aba Itens, calculadas no aparelho (offline) só quando a aba está aberta
  const [sugestoes, setSugestoes] = useState<SugestoesDaTela>(SUGESTOES_VAZIAS);
  const chaveSugestoes = JSON.stringify(draft.lines);
  useEffect(() => {
    if (aba !== 'itens' || sent || !customer) return;
    let vivo = true;
    void app.sugestoesDoPedido(customer, draft.lines, catalog).then((r) => {
      if (vivo) setSugestoes(r);
    });
    return () => {
      vivo = false;
    };
  }, [aba, sent, chaveSugestoes, catalog.length, customer?.id]);
  // RN-VEN-12/13: crédito do cliente na aba Venda (core.financeiro_cliente@1 no aparelho, vale offline), lido ao abrir o pedido (não só na aba Venda), para o Resumo já mostrar "Vai para o supervisor." (RN-VEN-13)
  const [credito, setCredito] = useState<ModeloDoCredito | null | undefined>(undefined);
  // RN-VEN-13 (T-0129): título vencido há mais que o limite com prazo a prazo nunca bloqueia a forma; o pedido vai ao supervisor (aprovação)
  const prazoEscolhido = prazos.find((p) => p.id === draft.prazo_pagamento_id);
  // T-0184 (RN-VEN-12 e RN-VEN-13, P1 A, P4 A): crédito estourado e título vencido (também à vista) mandam o pedido para aprovação
  const financeiroDoPedido = sent ? null : financeiroParaAprovacao(credito, prazoEscolhido?.prazo_medio_dias, tituloVencidoDias(parametrosVendedor));
  const vencidoAprova = Boolean(financeiroDoPedido && motivosFinanceirosDoPedido({ ...financeiroDoPedido, total_cents: calculoBase?.total_cents ?? 0 }).length > 0);
  const calculo = calculoBase && vencidoAprova && calculoBase.nivel === null ? { ...calculoBase, nivel: 'supervisor' as const } : calculoBase;
  useEffect(() => {
    if (sent) return;
    let vivo = true;
    void creditoDoCliente(customerId)
      .then((m) => vivo && setCredito(m))
      .catch(() => vivo && setCredito(null));
    return () => {
      vivo = false;
    };
  }, [sent, customerId, creditoDoCliente, app.sincronizadoEm]);
  // RN-VEN-23: "Leve mais e pague menos" com as faixas do Catálogo guardadas no aparelho (vazio = o cartão some)
  const leveMais = useMemo(
    () => (calculoAtual ? itensLeveMais({ calculo: calculoAtual, faixas: dados.produtos[tableKey]?.faixas, nomeDoProduto: (id) => byId.get(id)?.description ?? 'Produto', precoTabelaUnidade: (id) => byId.get(id)?.price_cents ?? null }) : []),
    [calculoAtual, dados.produtos, tableKey, byId],
  );
  const terms = sent ? sent.snapshot.payment_terms : draft.payment_terms;
  const nomes = useMemo(() => new Map<string, string>(sent ? sent.snapshot.nomes : catalog.map((p) => [p.id, p.description] as [string, string])), [sent, catalog]);
  const frete = draft.frete ?? { modalidade: fretePadrao };

  // RN-CORE-36: as pendências de preenchimento; na tentativa, a falta aparece no campo e, vista de outra aba, numa linha de Alertas
  const pendencias = calculoBase
    ? pendenciasDePreenchimento({
        itens: calculoBase.linhas.length,
        quantidade_invalida: Object.values(draft.lines).some((q) => !Number.isFinite(q) || q < 0),
        pagamento: situacaoDoPagamento(draft, formas, prazos, limites),
        frete: situacaoDoFrete(frete),
        erros_calculo: calculoBase.pendencias,
      })
    : [];

  // RD-0170 (T-0166): a falta de preenchimento só entra em Alertas nas abas já tentadas; pedido recém-aberto: 0 alertas
  const [tentou, setTentou] = useState<ReadonlySet<AbaDoPedido>>(new Set());
  // RN-VEN-42 (T-0150): a área única Alertas, no topo de todas as abas (cliente, faltante, máximo, estoque, crédito, título)
  const codigos = useMemo(() => new Map(catalog.map((p) => [p.id, p.erp_code] as [string, string])), [catalog]);
  const marcas = useMemo(() => new Map(catalog.flatMap((p) => (p.brand?.trim() ? [[p.id, p.brand.trim()] as [string, string]] : []))), [catalog]);
  const semEstoque = !sent && calculoBase ? itensSemEstoque(calculoBase.linhas, (id) => byId.get(id)) : [];
  const semFormaParaOCliente = !sent && situacaoDoPagamento(draft, formas, prazos, limites).tipo === 'sem_forma_permitida';
  const faltaDoCampo = (id: string) => (tentou.has('venda') && pendencias.some((p) => p.id === id) ? 'Obrigatório' : null);
  const alertasDoTopo = alertasDoNovoPedido({
    cliente: app.situacaoDoCliente(customerId),
    // RD-0173: "sem forma para o cliente" é cadastro e já está sempre em Alertas; a pendência de preenchimento não repete
    pendencias: pendenciasDasAbasTentadas(pendencias.filter((p) => !(p.id === 'forma' && semFormaParaOCliente)), tentou),
    sem_forma_para_o_cliente: semFormaParaOCliente,
    acima_do_maximo: calculoBase?.acima_do_maximo ?? [],
    acima_do_limite: calculoBase?.acima_do_limite ?? null,
    produtoDoCodigo: (codigo) => catalog.find((p) => p.erp_code === codigo)?.id,
    sem_estoque: semEstoque,
    // RD-0172: título vencido só entra em Alertas quando muda o resultado (acima do limite, com prazo a prazo; RN-VEN-13)
    vencidos: vencidosComEfeito(credito?.tipo === 'dados' && credito.alerta ? { titulos: credito.alerta.titulos, valor_cents: credito.alerta.valorCents, dias: credito.alerta.dias } : null, prazoEscolhido?.prazo_medio_dias, tituloVencidoDias(parametrosVendedor)),
    disponivel_cents: financeiroDoPedido ? disponivelParaAlerta(financeiroDoPedido) : null,
    total_cents: calculoBase?.total_cents ?? 0,
    // RN-VEN-10 (T-0165): acima da alçada do autor (e dentro do limite do gestor, que já é recusa) vira UMA linha nos Alertas
    acima_da_alcada: !sent && Boolean(calculoBase && calculoBase.nivel !== null && !calculoBase.bloqueado),
    // RD-0174 e RD-0175: o que a cópia deixou de fora e o sinal que falta para salvar a edição entram em Alertas, não em faixa
    itens_fora_da_copia: sent || !draft.notice ? [] : draft.notice.split('\n'),
    sem_sinal_para_salvar: editingServer && offline,
    aba_atual: aba,
  });

  // T-0084 C9 (RN-CAT-12): busca do Catálogo com "Serve em"; indisponível (sem leitura no aparelho, sem sinal, falha) = busca local, sem erro
  const buscarNoCatalogo = app.buscarProdutos;
  // até 5.000 ids: calculados uma vez por catálogo, não a cada busca
  const idsDoCatalogo = useMemo(() => (catalogBase.length <= 5000 ? catalogBase.map((p) => p.id) : null), [catalogBase]);
  useEffect(() => {
    const q = query.trim();
    setPaginasBusca(1);
    if (!buscaPodeComecar(q) || sent) {
      setBuscaCatalogo(null);
      setErroBusca(false);
      return;
    }
    let vivo = true;
    const espera = setTimeout(() => {
      void buscarNoCatalogo(q, idsDoCatalogo, customerId ?? undefined).then((r) => {
        if (!vivo) return;
        setErroBusca(r.tipo === 'erro');
        setBuscaCatalogo(r.tipo === 'ok' ? { q, itens: r.itens, sugestao: r.sugestao } : null);
      });
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [query, sent, idsDoCatalogo, buscarNoCatalogo]);
  // T-0167: a lista ranqueada inteira (teto 400) vem uma vez; o app mostra 20 por vez e o código exato fica em 1º
  const buscando = buscaPodeComecar(query);
  const resultadosDaBusca = buscando ? (buscaCatalogo && buscaCatalogo.q === query.trim() ? resolverBusca(buscaCatalogo.itens, byId, 400) : null) : [];
  const todosOsResultados = codigoExatoPrimeiro(resultadosDaBusca ? resultadosDaBusca.map((r) => r.produto) : buscando ? searchProducts(catalog, query, 400) : [], query);
  const paginaBusca = paginaDaBusca(todosOsResultados.length, paginasBusca);
  const results = todosOsResultados.slice(0, paginaBusca.mostrando);
  const serveEmPorId = useMemo(() => new Map((resultadosDaBusca ?? []).flatMap((r) => (r.serveEm ? [[r.produto.id, r.serveEm] as const] : []))), [buscaCatalogo, query, byId]);
  // T-0084 §12 (RN-VEN-19): lê a aplicação só dos itens visíveis (≤ 40) e dos do rascunho
  const idsComTexto = [...new Set([...results.map((p) => p.id), ...Object.keys(draft.lines).filter((k) => (draft.lines[k] ?? 0) > 0).map((k) => lerChaveDaLinha(k).product_id)])];
  const chaveDosTextos = idsComTexto.join(',');
  const lerTextos = app.textosDeProdutos;
  // T-0148: ícone de câmera nos resultados com foto (consulta sem rede); tocar abre a foto
  const lerFotos = app.fotosDeProdutos;
  const [comFoto, setComFoto] = useState<ReadonlySet<string>>(new Set());
  const [fotoAberta, setFotoAberta] = useState<string | null>(null);
  const idsDosResultados = results.map((p) => p.id).join(',');
  useEffect(() => {
    if (!idsDosResultados) return;
    let vivo = true;
    void lerFotos(idsDosResultados.split(',')).then((ids) => {
      if (vivo) setComFoto(ids);
    });
    return () => {
      vivo = false;
    };
  }, [idsDosResultados, lerFotos]);
  const abrirFoto = useCallback(
    async (id: string) => {
      const r = await app.abrirFotoProduto(id);
      // relato de 14/11 (v1.0.6): o aviso da foto sai em popup no meio da tela, não no rodapé
      if (r.tipo === 'foto') setFotoAberta(r.uri);
      else Alert.alert(r.texto, undefined, [{ text: 'OK' }]);
    },
    [app.abrirFotoProduto],
  );
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

  /**
   * T-0089 / T-0137: `fn` de `depoisDeConfirmar` roda depois do render que já tem o rascunho novo. Estes hooks ficam ANTES dos
   * `return` antecipados (regra dos hooks): depois deles, o render que saía cedo ("Cliente não encontrado") e o seguinte tinham
   * número diferente de hooks, o React lançava e o app fechava ao tocar em "Novo pedido" (relato do dono do produto, 08/11).
   */
  const [rodadaDeConfirmar, setRodadaDeConfirmar] = useState(0);
  const aposConfirmar = useRef<(() => void) | null>(null);
  useEffect(() => {
    const fn = aposConfirmar.current;
    aposConfirmar.current = null;
    fn?.();
  }, [rodadaDeConfirmar]);

  // o `useVendedor` daqui é outra instância (começa vazia): até ler o aparelho, carregando — não "Cliente não encontrado"
  if (!app.carregado) return <Loading />;

  if (editId && (!dados.rascunhos[draftKey] || !editTarget)) {
    return (
      <View style={styles.root}>
        <CabecalhoTela titulo="Editar" voltar={{ label: 'Pedido', fallback: hrefPedido(editId) }} />
        <View style={{ paddingHorizontal: 20, paddingTop: CABECALHO.respiroCorpo }}>
        <EstadoVazio
          titulo={editTarget ? 'A edição ainda não começou' : 'Este pedido não está no aparelho'}
          texto={editTarget ? 'Volte ao pedido e toque em Editar.' : 'Conecte-se e puxe a tela de Pedidos para baixo para sincronizar.'}
          acao={{ rotulo: editTarget ? 'Voltar ao pedido' : 'Ir para Pedidos', onPress: () => (editTarget ? router.replace(hrefPedido(editId) as never) : irParaPedidos()) }}
        />
        </View>
      </View>
    );
  }

  if (!customer || !calculo || !politica) {
    return (
      <View style={styles.root}>
        <CabecalhoTela titulo={editId ? 'Editar' : 'Novo pedido'} voltar={{ label: 'Voltar', fallback: hrefPedidos() }} />
        <View style={{ paddingHorizontal: 20, paddingTop: CABECALHO.respiroCorpo }}>
          <EstadoVazio titulo="Cliente não encontrado" texto="Sincronize com sinal para atualizar a carteira." acao={{ rotulo: 'Ir para Pedidos', onPress: () => irParaPedidos() }} />
        </View>
      </View>
    );
  }

  const setLinhas = (lines: Record<string, number>, ajustes: Record<string, Ajuste>) => {
    setError(null);
    updateDraft(customerId, (d) => ({ ...d, lines, ajustes }));
  };
  /** T-0165 (regra 3): item que entra sem ajuste (sugestões, "Leve mais") leva o último geral aplicado. */
  const comGeral = (lines: Record<string, number>, ajustes: Record<string, Ajuste>) => completarComGeral(chavesDasLinhas(lines), ajustes, geralAplicado);
  const aplicarGeral = (g: AjusteGeral) => {
    setGeralAplicado(g);
    setLinhas(draft.lines, aplicarGeralNasLinhas(chavesDasLinhas(draft.lines), draft.ajustes ?? {}, g));
  };

  // edição de pedido já enviado com "modo sem sinal" ligado: precisa de conexão (não enfileira)
  const editBlockedOffline = editingServer && offline;
  const situacaoCliente = app.situacaoDoCliente(customerId);
  // RN-VEN-18 (09/11): o orçamento não vence; a etiqueta mostra o dia do preço (hoje, no fuso do tenant)
  const precoData = localIsoDate(new Date(), tz);
  const rascunhoVisivel: Draft = sent ? sent.snapshot.rascunho : draft;
  const enderecosCliente = enderecosDoCliente(app.enderecos, customerId);
  const enderecoEscolhido = enderecoDoRascunho(rascunhoVisivel, enderecosCliente);
  const enderecoPrincipal = enderecosCliente.find((e) => e.principal || e.tipo === 'principal') ?? enderecosCliente[0] ?? null;
  const nomeDaTransportadora = rascunhoVisivel.frete?.modalidade === 'FOB' ? (rascunhoVisivel.frete.transportadora_id ? (app.transportadoras.find((x) => x.id === rascunhoVisivel.frete?.transportadora_id)?.nome ?? null) : (rascunhoVisivel.frete.transportadora_digitada?.nome ?? null)) : null;
  const produtosDoRascunho = [...new Set(Object.keys(draft.lines).filter((k) => (draft.lines[k] ?? 0) > 0).map((k) => lerChaveDaLinha(k).product_id))].flatMap((id) => {
    const p = byId.get(id);
    return p ? [p] : [];
  });

  const idsNoPedido: ReadonlySet<string> = new Set(produtosDoRascunho.map((p) => p.id));
  const medidasDe = (id: string) => unidadesDoProduto(id, app.unidades, byId.get(id)?.unit ?? 'UN');

  const saveEdit = async (opcoes: { transformar?: boolean } = {}) => {
    if (!editId || !podeEditar) return;
    setSending(true);
    setError(null);
    try {
      const res = await saveOrderEdit(editId, draft, customer, catalog);
      if (res.kind === 'server') {
        const b = statusBadge(res.order.status);
        deixarAvisoPendente(res.order.tipo === 'orcamento' ? `Orçamento ${res.order.number} atualizado` : `Pedido ${res.order.number} atualizado · ${b.label}`);
      } else {
        deixarAvisoPendente(offline ? 'Pedido da fila atualizado no aparelho' : 'Pedido da fila atualizado');
      }
      // T-0137: Transformar em pedido abre o detalhe já com a folha do Transformar (RN-VEN-18)
      if (opcoes.transformar) router.replace(hrefPedido(editId, true) as never);
      else if (router.canGoBack()) router.back();
      else router.replace(hrefPedido(editId) as never);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  /** Devolve `true` quando o pedido foi aceito (enviado ou na fila); `false` quando deu erro e a pessoa segue no formulário. */
  const send = async (tipo: 'pedido' | 'orcamento' = 'pedido'): Promise<boolean> => {
    setSending(true);
    setError(null);
    const rascunhoEnviado: Draft = { ...draft, tipo };
    const snapshot: Snapshot = { calculo, nomes: [...nomes.entries()], payment_terms: draft.payment_terms, rascunho: rascunhoEnviado };
    try {
      const res = await submitOrder(rascunhoEnviado, customer, catalog);
      // RN-VEN-30: o editor fecha na hora e o envio segue em segundo plano. Com check-in aberto neste cliente volta para a ficha dele;
      // sem check-in vai para a lista de Pedidos, onde o pedido aparece com o status. Nenhuma das duas lê aviso pendente: não deixa um.
      const destino = res.kind === 'sent' ? res.order.id : (res.id ?? null);
      if (destino) {
        const depois = destinoAposSalvar({ clienteId: customerId, visitaAtivaNoCliente: Boolean(visitId) });
        if (depois.tela === 'pedidos') router.replace(hrefPedidos() as never);
        else if (router.canGoBack()) router.back();
        else router.replace(hrefFichaDoCliente(depois.clienteId) as never);
        return true;
      }
      setSent(res.kind === 'sent' ? { kind: 'sent', order: res.order, snapshot } : { kind: 'queued', snapshot });
      setQuery('');
      setAba('resumo');
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setSending(false);
    }
  };

  const docEdicao = editTarget?.tipo === 'orcamento' || draft.tipo === 'orcamento' ? 'orçamento' : 'pedido';
  const editTitle = editTarget?.number ? `Editar ${docEdicao} ${editTarget.number}` : `Editar ${docEdicao} no aparelho`;
  const editandoTipo = editId ? (editTarget?.tipo === 'orcamento' || draft.tipo === 'orcamento' ? 'orcamento' : 'pedido') : null;
  const botoesBase = botoesDoResumo({ cliente: situacaoCliente, pre_venda_ligada: app.preVendaLigada, editando: editandoTipo, itens_acima_do_maximo: calculo.acima_do_maximo, acima_do_limite: calculo.acima_do_limite !== null, itens_sem_estoque: semEstoque.map((x) => x.codigo), preco_data: precoData, editando_no_servidor: editingServer });
  // permissão e sinal (edição de pedido já no servidor) valem além das pendências; na edição de pedido o rótulo diz para onde vai
  const podeAgir = podeEnviarPedido({ jaEnviado: Boolean(sent), itens: calculo.linhas.length, recusado: false, edicaoSemSinal: editBlockedOffline, edicao: Boolean(editId), podeEditar });
  const liberaSalvar = (b: typeof botoesBase.enviar) => ({ ...b, habilitado: b.habilitado && podeAgir });
  const botoes = {
    ...botoesBase,
    enviar: liberaSalvar(botoesBase.enviar),
    orcamento: liberaSalvar(botoesBase.orcamento),
    salvarOrcamento: liberaSalvar(botoesBase.salvarOrcamento),
    transformar: liberaSalvar(botoesBase.transformar),
  };
  /** RD-0170: salvar, enviar e transformar ficam tocáveis; com falta, o toque marca todas as abas e leva à 1ª com falta */
  const comTentativa = <A extends unknown[]>(fn: (...a: A) => void) => (...a: A) => {
    const primeira = primeiraAbaComFalta(pendencias);
    if (primeira === null) return fn(...a);
    setTentou(new Set<AbaDoPedido>(['venda', 'itens', 'entrega', 'resumo']));
    irParaAba(primeira);
  };
  const emRascunho = (fn: (r: Draft) => Draft) => updateDraft(customerId, fn);

  const abas = abasDoPedido(calculo.linhas.length);
  const noResumo = aba === 'resumo' || Boolean(sent);
  // o valor digitado no campo em foco vale já no toque (RN-VEN-02): "0" ou vazio tira o item, número válido grava
  saveEditRef.current = saveEdit;
  calculoRef.current = calculoBase;
  sendRef.current = send;
  /**
   * T-0089 / revisão técnica (T-0137): o número digitado vale ao confirmar. `aplicarValorPendente` grava na hora e o teclado fecha
   * em seguida; `fn` roda depois do render que já tem o rascunho novo (sem `setTimeout`, que dependia de o aparelho ser rápido).
   * `saveEditRef` e `sendRef` são lidos nesse momento, então salvam a versão nova.
   */
  const depoisDeConfirmar = (fn: () => void) => {
    if (Keyboard.isVisible()) Keyboard.dismiss();
    aposConfirmar.current = fn;
    setRodadaDeConfirmar((n) => n + 1);
  };
  const irParaAba = (destino: AbaNovoPedido) => {
    aplicarValorPendente();
    depoisDeConfirmar(() => setAba(destino));
  };
  /**
   * RN-VEN-10 (T-0151): a alçada só aparece ao salvar o PEDIDO, numa pergunta ("Enviar para aprovação" / "Voltar"). Dentro da
   * alçada, orçamento e Apenas salvar não perguntam. Lê o cálculo do render que já tem o número digitado (`calculoRef`).
   */
  const perguntarAlcada = (seguir: () => void) => {
    if (perguntaDaAlcada({ tipo: 'pedido', nivel: calculoRef.current?.nivel ?? null }) === null) seguir();
    else setPerguntaAlcada({ seguir });
  };
  const sairDoPedido = () => (router.canGoBack() ? router.back() : router.replace(hrefPedidos() as never));
  /** Salvar e enviar pedido (novo) ou salvar as alterações (edição). Sem folha: 1 toque. */
  const aoEnviar = () => {
    aplicarValorPendente();
    if (editId) depoisDeConfirmar(() => perguntarAlcada(() => void saveEditRef.current()));
    else depoisDeConfirmar(() => perguntarAlcada(() => void sendRef.current('pedido')));
  };
  /** Salvar como orçamento: valida e congela os preços (RN-VEN-18); abre o detalhe do orçamento. */
  const aoSalvarComoOrcamento = () => {
    aplicarValorPendente();
    depoisDeConfirmar(() => void sendRef.current('orcamento'));
  };
  /** Editar orçamento: Salvar orçamento. */
  const aoSalvarOrcamentoEditado = () => {
    aplicarValorPendente();
    depoisDeConfirmar(() => void saveEditRef.current());
  };
  /** Editar orçamento: Transformar em pedido salva a edição e abre o detalhe com a folha do Transformar (RN-VEN-18 reconfere preço, estoque e alçada lá). */
  const aoTransformarEmPedido = () => {
    aplicarValorPendente();
    depoisDeConfirmar(() => void saveEditRef.current({ transformar: true }));
  };
  /**
   * Apenas salvar (RN-VEN-38): guarda o rascunho sem enviar e ACEITA pendências; a tela fecha com "Pedido salvo". Ao reabrir, abre no
   * Resumo com o que falta. Pedido sem nada preenchido não guarda (não há o que salvar).
   */
  const apenasSalvar = (depois?: (() => void) | null) => {
    aplicarValorPendente();
    depoisDeConfirmar(() => {
      if (pedidoAlterado(draftAtual.current)) {
        updateDraft(customerId, (d) => ({ ...d, salvo_em: new Date().toISOString() }));
        deixarAvisoPendente(AVISO_PEDIDO_SALVO);
      }
      if (depois) depois();
      else sairDoPedido();
    });
  };
  const aoApenasSalvar = () => {
    const destino = saidaPedida.current;
    saidaPedida.current = null;
    apenasSalvar(destino);
  };
  const descartar = async () => {
    await app.descartarRascunho(draftKey);
    const destino = saidaPedida.current;
    saidaPedida.current = null;
    if (destino) destino();
    else if (router.canGoBack()) router.back();
    else router.replace(hrefPedidos() as never);
  };
  /** RN-VEN-38: salvar pela folha valida tudo. Com pendência, fecha a folha, cancela a saída e abre o Resumo. */
  const salvarPelaSaida = (tipo: 'pedido' | 'orcamento') => {
    setSaidaAberta(false);
    aplicarValorPendente();
    if (destinoDoSalvarDaSaida(pendencias.length) === 'mostrar_pendencias') {
      saidaPedida.current = null;
      depoisDeConfirmar(() => setAba('resumo'));
      return;
    }
    if (editId) {
      saidaPedida.current = null;
      depoisDeConfirmar(() => (editandoTipo === 'orcamento' ? void saveEditRef.current() : perguntarAlcada(() => void saveEditRef.current())));
      return;
    }
    const destino = saidaPedida.current;
    saidaPedida.current = null;
    const enviar = () => void sendRef.current(tipo).then((ok) => (ok && tipo === 'pedido' ? destino?.() : undefined));
    depoisDeConfirmar(() => (tipo === 'pedido' ? perguntarAlcada(enviar) : enviar()));
  };
  const aoEscolherNaSaida = (acao: 'salvar' | 'apenas_salvar' | 'salvar_alternativo' | 'descartar' | 'continuar') => {
    if (acao === 'continuar') {
      setSaidaAberta(false);
      saidaPedida.current = null;
    } else if (acao === 'descartar') {
      setSaidaAberta(false);
      void descartar();
    } else if (acao === 'apenas_salvar') {
      // Apenas salvar aceita pendências: grava e segue para onde a pessoa ia
      setSaidaAberta(false);
      aoApenasSalvar();
    } else salvarPelaSaida(acao === 'salvar' ? 'pedido' : 'orcamento');
  };

  return (
    <View style={styles.root}>
      <CabecalhoTela
        testID="order-editor-cabecalho"
        titulo={editId ? editTitle : 'Novo pedido'}
        subtitulo={`${customer.trade_name} · cód. ${customer.erp_code}${vendedorEmNomeId ? ` · em nome de ${vendedorEmNomeNome ?? 'vendedor'}` : ''}`}
        voltar={
          editId
            ? { label: 'Pedido', fallback: hrefPedido(editId) }
            : { label: 'Voltar', fallback: hrefPedidos(), aoVoltar: () => pedirSaida(() => (router.canGoBack() ? router.back() : router.replace(hrefPedidos() as never))) }
        }
      />
      {!sent ? <Abas abas={abas} valor={aba} onChange={irParaAba} testID="abas-pedido" /> : null}

      <AcimaDoTeclado>
      <ScrollView ref={rolagem.ref} onScroll={rolagem.onScroll} onLayout={rolagem.onLayout} scrollEventThrottle={32} contentContainerStyle={{ paddingTop: 12, paddingHorizontal: 12, paddingBottom: 16, gap: 12 }} keyboardShouldPersistTaps="handled" testID="new-order">
        {!sent ? <AreaAlertas alertas={alertasDoTopo} aoTocar={(a) => {
          const v = a.vai_para;
          irParaAba(v && 'aba' in v ? idDaAba(v.aba) : 'itens');
          if (v && 'item' in v) setPopupId(v.item);
        }} /> : null}

        {sent?.kind === 'queued' ? (
          <Banner testID="banner-saved">
            <Strong>{avisoSalvoNoAparelho(sent.snapshot.rascunho.tipo === 'orcamento' ? 'orcamento' : 'pedido').titulo}</Strong>
          </Banner>
        ) : sent?.kind === 'sent' ? (
          <SentCard order={sent.order} tipo={sent.snapshot.rascunho.tipo === 'orcamento' ? 'orcamento' : 'pedido'} precoData={precoData} />
        ) : null}

        {!sent && aba === 'venda' ? (
          <AbaVenda
            clienteLinhas={[
              ...(enderecoPrincipal ? [{ rotulo: 'Endereço', valor: textoDoEndereco(enderecoPrincipal) }] : []),
              ...(customer.cnpj ? [{ rotulo: customer.cnpj.replace(/\D/g, '').length === 11 ? 'CPF' : 'CNPJ', valor: formatarDocumento(customer.cnpj) }] : []),
            ]}
            pagamento={<CardPagamento rascunho={draft} formas={formas} prazos={prazos} cliente={limites} legado={opcoesLegado} onRascunho={emRascunho} faltaForma={faltaDoCampo('forma')} faltaPrazo={faltaDoCampo('prazo')} />}
            credito={credito}
            prazoMedioDias={limites.prazo_medio_max_dias}
            sincronizadoEm={app.sincronizadoEm}
            agora={new Date()}
            tz={tz}
            semSinal={offline}
          />
        ) : null}

        {!sent && aba === 'itens' ? (
          <>
            {/* T-0165: Desc./Acrésc. geral no topo; os itens do pedido aparecem só no Resumo e como ✓ na lista (busca vazia) */}
            <DescontoGeral contarComOutroAjuste={(g) => linhasComOutroAjuste(chavesDasLinhas(draft.lines), draft.ajustes ?? {}, g).length} contarDiferentes={(g) => linhasDiferentesDoGeral(chavesDasLinhas(draft.lines), draft.ajustes ?? {}, g).length} semItens={chavesDasLinhas(draft.lines).length === 0} aoAplicar={aplicarGeral} />
            <CampoBusca valor={query} onChange={setQuery} onLimpar={() => setQuery('')} rotuloLimpar="Limpar busca" placeholder="Código, descrição ou veículo" rotuloAcessivel="Buscar produto" testID="product-search" />
            {buscando ? (
              erroBusca ? (
                <EstadoVazio titulo="Busca indisponível" texto={MENSAGEM_ERRO_BUSCA} testID="busca-erro" />
              ) : results.length === 0 ? (
                <SemResultadoDaBusca busca={query} sugestao={buscaCatalogo?.sugestao ?? null} aoBuscar={setQuery} />
              ) : (
                <>
                  <ResultadosDaBusca produtos={results} medidasDe={medidasDe} noPedido={idsNoPedido} serveEm={serveEmPorId} aoAdicionar={setPopupId} comFoto={comFoto} aoAbrirFoto={(id) => void abrirFoto(id)} />
                  <MostrarMais pagina={paginaBusca} aoMostrarMais={() => setPaginasBusca((n) => n + 1)} />
                </>
              )
            ) : produtosDoRascunho.length === 0 ? (
              <EstadoVazio icone="search" titulo="Nenhum item ainda" texto={catalog.length > 0 ? 'Busque pelo código, descrição ou veículo.' : 'Sincronize com sinal para baixar os preços.'} testID="itens-vazio" />
            ) : (
              <ResultadosDaBusca produtos={produtosDoRascunho} medidasDe={medidasDe} noPedido={idsNoPedido} aoAdicionar={setPopupId} comFoto={comFoto} aoAbrirFoto={(id) => void abrirFoto(id)} />
            )}
            <VisorDeFoto uri={fotoAberta} aoFechar={() => setFotoAberta(null)} />
            <FimDaAbaItens
              sugestoes={sugestoes}
            nomeDoProduto={(id) => byId.get(id)?.description ?? 'Produto'}
            onAdicionar={(id) => {
              const antes = { lines: draft.lines, ajustes: draft.ajustes ?? {} };
              {
                const linhas = adicionarSugestao(draft.lines, id);
                setLinhas(linhas, comGeral(linhas, draft.ajustes ?? {}));
              }
              avisoRodape.mostrar({ texto: avisoSugestaoAdicionada(byId.get(id)?.description ?? 'Produto', false), acao: { rotulo: 'Desfazer', onPress: () => setLinhas(antes.lines, antes.ajustes), testID: 'sugestao-desfazer' } });
            }}
            onTrocar={(sg) => {
              const p = byId.get(sg.produto_id);
              const medidas = p ? unidadesDoProduto(p.id, app.unidades, p.unit) : [];
              const de = medidas.find((m) => m.unidade === sg.de_unidade) ?? medidas[0];
              const antes = { lines: draft.lines, ajustes: draft.ajustes ?? {} };
              const r = aplicarTrocaDeEmbalagem(draft.lines, draft.ajustes ?? {}, sg, { unidade_base: p?.unit ?? sg.de_unidade, fator: de?.fator ?? 1 });
              setLinhas(r.lines, comGeral(r.lines, r.ajustes));
              avisoRodape.mostrar({ texto: avisoSugestaoAdicionada(nomeDaSugestao(p?.description ?? 'Produto', sg), true), acao: { rotulo: 'Desfazer', onPress: () => setLinhas(antes.lines, antes.ajustes), testID: 'sugestao-desfazer' } });
            }}
            leveMais={linhasDoLeveMais(leveMais, (chave, quantidade, texto) => {
              const antes = { lines: draft.lines, ajustes: draft.ajustes ?? {} };
              {
                const linhas = linhasNaFaixa(draft.lines, chave, quantidade);
                setLinhas(linhas, comGeral(linhas, draft.ajustes ?? {}));
              }
              avisoRodape.mostrar({ texto, acao: { rotulo: 'Desfazer', onPress: () => setLinhas(antes.lines, antes.ajustes), testID: 'leve-mais-desfazer' } });
            })}
            />
          </>
        ) : null}

        {!sent && aba === 'entrega' ? (
          <AbaEntrega rascunho={draft} clienteId={customerId} enderecos={app.enderecos} onRascunho={emRascunho} fretePadrao={fretePadrao} transportadoras={app.transportadoras} faltaTransportadora={tentou.has('entrega') && pendencias.some((p) => p.id === 'frete' && p.texto === 'Transportadora do frete FOB') ? 'Obrigatório' : null} />
        ) : null}

        {noResumo ? (
          <AbaResumo
            rascunho={rascunhoVisivel}
            clienteRazao={customer.legal_name}
            clienteCnpj={customer.cnpj}
            calculo={calculo}
            nomes={nomes}
            codigos={codigos}
            marcas={marcas}
            prazo={terms}
            endereco={enderecoEscolhido ? textoDoEndereco(enderecoEscolhido) : null}
            transportadora={nomeDaTransportadora}
            fretePadrao={fretePadrao}
            onRascunho={emRascunho}
            aoAbrirItem={setPopupId}
            botoes={botoes}
            onEnviar={comTentativa(aoEnviar)}
            onApenasSalvar={comTentativa(aoApenasSalvar)}
            onOrcamento={comTentativa(aoSalvarComoOrcamento)}
            onSalvarOrcamento={comTentativa(aoSalvarOrcamentoEditado)}
            onTransformar={comTentativa(aoTransformarEmPedido)}
            onCancelar={() => (editId ? pedirSaidaDaEdicao() : alterado ? pedirSaida(sairDoPedido) : void descartar())}
            salvando={sending}
            somenteLeitura={Boolean(sent)}
          />
        ) : null}

        {!sent && !noResumo ? (
          <Botao testID="avancar" nivel="principal" rotulo="Avançar" onPress={() => {
            setTentou((t) => new Set([...t, aba as AbaDoPedido]));
            irParaAba(proximaAbaDoPedido(aba));
          }} />
        ) : null}
        {popupId && byId.get(popupId) && !sent ? (
          <FolhaDoItem
            key={popupId}
            produto={byId.get(popupId)!}
            medidas={unidadesDoProduto(popupId, app.unidades, byId.get(popupId)!.unit)}
            lines={draft.lines}
            ajustes={draft.ajustes ?? {}}
            geral={geralAplicado}
            percentualAjusteBp={percentualAjusteBp}
            previa={(lines, ajustes) =>
              politica
                ? calcularPedido({ lines, percentual_ajuste_bp: percentualAjusteBp, ajustes, desconto_pct: 0, acrescimo_pct: 0, catalogo: catalog, unidades: app.unidades, faixas: dados.produtos[tableKey]?.faixas, ...(draft.precos_congelados ? { congelados: draft.precos_congelados } : {}), aplicacao: { padrao: aplicacaoNoOrcamentoPadrao(parametrosVendedor), max: aplicacaoMaxOrcamento(parametrosVendedor) }, politica, vendedor_id: vendedorId, limite: app.limiteDesconto })
                : null
            }
            onConfirmar={(estado) => {
              const r = aplicarItemNoRascunho(draft.lines, draft.ajustes ?? {}, popupId, unidadesDoProduto(popupId, app.unidades, byId.get(popupId)!.unit), estado);
              setLinhas(r.lines, r.ajustes);
              setPopupId(null);
            }}
            onRemover={() => {
              const antes = { lines: draft.lines, ajustes: draft.ajustes ?? {} };
              const r = aplicarItemNoRascunho(draft.lines, draft.ajustes ?? {}, popupId, unidadesDoProduto(popupId, app.unidades, byId.get(popupId)!.unit), null);
              setLinhas(r.lines, r.ajustes);
              setPopupId(null);
              // §5.8: sem pergunta; Desfazer por 5 s devolve o item com a embalagem, a quantidade e o ajuste
              setChaveDaRemocao((avisoRodape.props.chave ?? 0) + 1);
              avisoRodape.mostrar({ texto: AVISO_ITEM_REMOVIDO.texto, acao: { rotulo: AVISO_ITEM_REMOVIDO.desfazer, onPress: () => setLinhas(antes.lines, antes.ajustes), testID: 'item-removido-desfazer' } });
            }}
            onFechar={() => setPopupId(null)}
          />
        ) : null}
        {error ? (
          <Banner icon="alert" tone="danger" testID="order-error">
            {error}
          </Banner>
        ) : null}
      </ScrollView>
      </AcimaDoTeclado>

      {sent ? (
        <View style={[styles.footer, { paddingBottom: 22 }]}>
          <Botao testID="send-order-done" nivel="principal" rotulo="Ir para Pedidos" onPress={() => irParaPedidos()} />
        </View>
      ) : null}

      <Dialogo
        visivel={perguntaAlcada !== null}
        titulo={PERGUNTA_DA_ALCADA.titulo}
        cancelar={{ rotulo: PERGUNTA_DA_ALCADA.voltar, onPress: () => setPerguntaAlcada(null), testID: 'alcada-voltar' }}
        confirmar={{
          rotulo: PERGUNTA_DA_ALCADA.enviar,
          testID: 'alcada-enviar',
          onPress: () => {
            const seguir = perguntaAlcada?.seguir;
            setPerguntaAlcada(null);
            seguir?.();
          },
        }}
        testID="pergunta-alcada"
      />
      <AvisoRodape {...avisoRodape.props} respiroInferior={16} {...(avisoRodape.props.chave === chaveDaRemocao ? { duracaoMs: AVISO_ITEM_REMOVIDO.duracao_ms } : {})} />
      <FolhaSaidaDoPedido visivel={saidaAberta} edicao={editId ? opcoesDaSaidaEdicao({ tipo: editandoTipo ?? 'pedido' }) : null} opcoes={opcoesDaSaida({ cliente: situacaoCliente, pre_venda_ligada: app.preVendaLigada, preco_data: precoData, alertas_impedem_enviar: soOrcamentoPorAlertas(alertasDoTopo) || impedeEnviarPorAlertas(alertasDoTopo) })} onAcao={aoEscolherNaSaida} />
    </View>
  );
}

function SentCard({ order, tipo, precoData }: { order: OrderDetail; tipo: 'pedido' | 'orcamento'; precoData: string }) {
  const b = statusBadge(order.status);
  const c = confirmacaoDoEnvio({ tipo, numero: order.number, status: order.status, preco_data: precoData, pending_reason: order.pending_reason, rejection_reason: order.rejection_reason });
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
  qty: { width: 44, height: 48, textAlign: 'center', ...fonte.semibold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'], padding: 0 },
  step: { width: 44, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  pctBox: { flex: 1, height: 44, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  pctInput: { flex: 1, minWidth: 0, height: 42, textAlign: 'right', ...fonte.semibold, fontSize: 18, color: colors.ink, padding: 0 },
  pctSuffix: { flex: 1, ...fonte.semibold, fontSize: 18, color: colors.ink2, marginLeft: 2 },
  segment: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segItem: { flexGrow: 1, minWidth: 72, paddingHorizontal: 10, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segText: { ...fonte.semibold, fontSize: 14, color: colors.ink },
  sent: { backgroundColor: colors.successBg, borderRadius: radius.lg, padding: 12, gap: 8 },
  footer: { backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line, paddingTop: 14, paddingHorizontal: 20, gap: 10 },
  sumRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  sumLabel: { ...fonte.body, fontSize: 14, color: colors.ink2 },
  sumValue: { ...fonte.body, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] },
  total: { ...fonte.semibold, fontSize: 22, color: colors.ink, fontVariant: ['tabular-nums'] },
});
