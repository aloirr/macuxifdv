/**
 * Aba Catálogo em grade (T-0173, docs/design/catalogo-grade.md; RF-CAT-01/02/09): duas colunas de cartões (foto, nome, marca,
 * preço e tag de estoque), busca no topo com a chave "Só com estoque" logo abaixo; sistema, categoria e filial ficam na folha do botão de filtro.
 * Sem contagem de produtos e sem selo de sincronização na faixa e sem gesto de puxar (T-0192). OFFLINE-FIRST: tudo vem do aparelho;
 * a busca com texto usa a API (busca inteligente) quando há sinal e sem filtro de árvore, e cai para a busca local (FTS5 + sinônimos
 * + ranking do domain) sem sinal, em falha ou com sistema/categoria escolhidos.
 * Preço (RN-VEN-01, RN-CAT-06): pela ficha do cliente (`?cliente=`) vale a tabela dele; pelo menu, a da filial padrão do vendedor;
 * produto sem preço mostra "Sem preço". Preço e estoque somem para quem não vê (RN-CAT-05). Copiar o código é a única ação própria;
 * ações de outros módulos só pela extensão `produto.acoes` (RN-PRO-01). Com `?pedido=1` só entram os produtos da tabela do cliente. `?no=` abre com o filtro já marcado.
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { ehSemConexao } from '@macuxi/platform-sdk';
import { useAmbiente, useMotorSync, useParametros } from '@macuxi/platform-sdk/react';
import { Banner, BotaoFiltro, CampoBusca, CatalogoCarregando, colors, DEFAULT_TZ, Empty, EstadoVazio, EtiquetaFiltro, FolhaVeiculo, LinhaEtiquetas, MostrarMais, NadaEncontrado, PAGINA_DA_BUSCA, proximaPaginaDaBusca, Screen, TEXTO_CATALOGO_CARREGANDO, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState, type ComponentProps } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { caminhoCatalogo, leituraDaEtiquetaVeiculo, leituraDoBotaoVeiculo, NAVEGACAO_VEICULO, TEXTOS_VEICULO, type ChipFiltro, type GrupoFiltro, type ItemVitrine, type VeiculoEscolhido, type VeiculoParcial, type VeiculosSaida } from '../../contracts';
import { anoCivilNoFuso } from '../../domain/ano-civil';
import { montarArvore, type Arvore, type VinculoProdutoNo } from '../../domain/arvore';
import { TETO_RANKING_BUSCA } from '../../domain/busca-consulta';
import { contarChipsFiltrar, rotulosDoVeiculo } from '../../domain/veiculo-filtro';
import { idsAtivos } from '../../domain/hierarquia';
import { AVISO_BUSCA_OFFLINE, avisoDaBusca, iconeDoAviso } from '../../domain/ia';
import { textoPareceCodigo } from '../../domain/codigo-busca';
import { chipsDaGrade, classificacaoDaGrade, emLinhas, escolherCategoria, escolherFamilia, escolherLinha, escolherSistema, filtroDoNo, noDoFiltro, produtosDoFiltro, mesmoValor, reaproveitarItens, SEM_FILTRO, type FiltroDaGrade } from '../lib/grade';
import { dadosDaFolha, opcoesDoFiltroFilial, resumoDoFiltro, subtituloComFilial } from '../lib/estoque-folha';
import { cargaDoEstoque } from '../lib/carga-do-cartao';
import { buscaComSinal, modoDaCarga, paginasDaApi, soVendaveisNaCarga } from '../lib/carga-online';
import { ajustarPeloPrazoPadrao } from '../lib/prazo-padrao';
import { vazioDaBusca } from '../lib/vazio-busca';
import { arvoreLocal, buscarLocal, estoqueLocalDosProdutos, filialDeCadastroLocal, filiaisDoUsuarioLocal, filiaisLocais, nomeDoClienteLocal, produtosDaNavegacao, produtosLocais, vitrineLocal } from '../lib/local';
import { sugestaoDaBuscaLocal } from '../texto-consultas';
import { cascataLocal, lembrarVeiculo, listaComVeiculo } from '../veiculos-consulta';
import { definirVeiculoDaTela, TEXTOS_VEICULO_CATALOGO, vazioComVeiculo } from '../lib/veiculo-tela';
import { irParaProduto } from '../rotas';
import { CartaoGrade } from './comum';
import { ChaveSoComEstoque, FolhaEstoquePorFilial, FolhaFiltroCatalogo, type EscolhaFiltro } from './estoque-filial';
import { useMiniaturasDosItens } from './miniatura';

const ESPERA_DIGITACAO_MS = 350;
const ARVORE_VAZIA: Arvore = montarArvore([]);

/** Rodada de carga da lista que perdeu a vez (outra começou): termina em silêncio, sem tocar na tela. */
class RodadaCancelada extends Error {}

interface EstadoLista {
  carregando: boolean;
  itens: ItemVitrine[];
  total: number;
  aviso: string | null;
  /** Erro ao abrir (T-0192 §7.1): vira um só `EstadoVazio` com "Tentar de novo"; não é aviso. */
  erro?: boolean;
}

export default function TelaCatalogo() {
  const params = useLocalSearchParams<{ cliente?: string; q?: string; pedido?: string; no?: string }>();
  const dentroDoPedido = params.pedido === '1';
  const clienteId = params.cliente ? String(params.cliente) : null;
  const ambiente = useAmbiente();
  const { motor, estado: sync } = useMotorSync();
  const parametrosCrus = useParametros('catalogo');
  const usuario = ambiente.usuario();
  const perfil = usuario?.perfil ?? null;
  const fuso = usuario?.fuso ?? DEFAULT_TZ;

  const [texto, setTexto] = useState(params.q ? String(params.q) : '');
  const [consulta, setConsulta] = useState(texto);
  const [arvore, setArvore] = useState<{ arvore: Arvore; vinculos: VinculoProdutoNo[] } | null>(null);
  // RN-CAT-21: a lista só carrega depois da árvore (lida ao abrir e a cada sincronização): uma rodada por abertura e por sync, não duas
  const [cargaDaArvore, setCargaDaArvore] = useState(0);
  // sincronização a que a árvore lida pertence: a lista espera a árvore do sync atual (a troca carga→local não roda com a árvore velha)
  const [arvoreDoSync, setArvoreDoSync] = useState<string | null | undefined>(undefined);
  const [filtro, setFiltro] = useState<FiltroDaGrade>(SEM_FILTRO);
  const [escolha, setEscolha] = useState<EscolhaFiltro>(SEM_ESCOLHA);
  const [folhaFiltro, setFolhaFiltro] = useState(false);
  const [itemDaFolha, setItemDaFolha] = useState<ItemVitrine | null>(null);
  const [filiais, setFiliais] = useState<{ venda: string[]; todas: { id: string; nome: string }[]; cadastro: { id: string; nome: string | null } | null }>({ venda: [], todas: [], cadastro: null });
  const [nomeCliente, setNomeCliente] = useState<string | null>(null);
  const [limite, setLimite] = useState(PAGINA_DA_BUSCA); // "Mostrar mais" soma 20 (kit); ao trocar de filtro ou de busca volta ao inicial
  const [lista, setLista] = useState<EstadoLista>({ carregando: true, itens: [], total: 0, aviso: null });
  // "Tentar de novo" refaz só a carga da lista (o efeito de baixo), sem sincronizar
  const [tentativa, setTentativa] = useState(0);
  const [sugestao, setSugestao] = useState<string | null>(null);
  // RN-CAT-22: o veículo escolhido (um só, enquanto a tela está aberta), a folha dele e se o catálogo do aparelho tem veículo nas aplicações (P3)
  const [veiculo, setVeiculo] = useState<VeiculoEscolhido | null>(null);
  const [folhaVeiculo, setFolhaVeiculo] = useState(false);
  const [temVeiculos, setTemVeiculos] = useState(false);
  // RN-CAT-22: dentro do pedido a cascata só conta o que se pode vender ao cliente (a mesma lista da tabela dele)
  const [escopoPedido, setEscopoPedido] = useState<ReadonlySet<string> | null>(null);
  const [contados, setContados] = useState<Record<GrupoFiltro, ChipFiltro[]> | null>(null);
  const auto = useAtualizacaoAutomatica({ tz: fuso });
  const idsExibidos = useMemo(() => lista.itens.map((i) => i.id), [lista.itens]);
  const miniaturas = useMiniaturasDosItens(motor, idsExibidos, sync.sincronizado_em);
  // ADR 0054: catálogo ainda carregando na primeira carga = busca e preço pela API; os filtros da árvore ficam desligados
  const modoCarga = modoDaCarga(sync, ambiente.online());
  const naCarga = modoCarga !== 'local';
  const estoqueCarregando = cargaDoEstoque(sync, modoCarga);
  const noInicial = params.no ? String(params.no) : null;

  useEffect(() => setLimite(PAGINA_DA_BUSCA), [filtro, escolha, consulta, veiculo]);

  // o botão Veículo só aparece com o catálogo no aparelho e veículo nas aplicações; a ficha lê o veículo daqui
  useEffect(() => {
    if (!motor || naCarga) return setTemVeiculos(false);
    let vivo = true;
    void cascataLocal(motor, { escopo: escopoPedido }, anoCivilNoFuso(relogioReal().agora(), fuso))
      .then((c) => vivo && setTemVeiculos(c.disponivel))
      .catch(() => vivo && setTemVeiculos(false));
    return () => {
      vivo = false;
    };
  }, [motor, naCarga, fuso, sync.sincronizado_em, escopoPedido]);
  useEffect(() => {
    if (!temVeiculos) setVeiculo(null);
  }, [temVeiculos]);
  useEffect(() => {
    definirVeiculoDaTela(veiculo);
    return () => definirVeiculoDaTela(null);
  }, [veiculo]);

  // spec §3 e §4: filiais de venda (filtro e folha), todas as do tenant (nomes) e a de cadastro (faixa), das linhas locais
  const usuarioId = usuario?.id ?? null;
  useEffect(() => {
    if (!motor || naCarga || !dentroDoPedido) return setEscopoPedido(null);
    let vivo = true;
    const entrada = { perfil, parametros: parametrosCrus, agora: relogioReal().agora().toISOString(), clienteId, usuarioId, filtroFilial: escolha.filial, noId: null, soDaTabelaDoCliente: true };
    void produtosDaNavegacao(motor, entrada)
      .then((ids) => vivo && setEscopoPedido(ids ?? null))
      .catch(() => vivo && setEscopoPedido(null));
    return () => {
      vivo = false;
    };
  }, [motor, naCarga, dentroDoPedido, clienteId, perfil, parametrosCrus, usuarioId, escolha.filial, sync.sincronizado_em]);
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    void Promise.all([filiaisDoUsuarioLocal(motor, usuarioId), filiaisLocais(motor), filialDeCadastroLocal(motor, usuarioId)])
      .then(([u, todas, cadastro]) => vivo && setFiliais({ venda: [...(u?.filiaisVenda ?? [])], todas, cadastro }))
      .catch(() => vivo && setFiliais({ venda: [], todas: [], cadastro: null }));
    return () => {
      vivo = false;
    };
  }, [motor, usuarioId, sync.sincronizado_em]);

  // "Você quis dizer…": só quando a busca não achou nada, do vocabulário do índice no aparelho
  const semResultado = Boolean(consulta) && !lista.carregando && !lista.erro && lista.itens.length === 0;
  useEffect(() => {
    if (!motor || !semResultado) return setSugestao(null);
    let vivo = true;
    void sugestaoDaBuscaLocal(motor, consulta).then((x) => vivo && setSugestao(x)).catch(() => vivo && setSugestao(null));
    return () => {
      vivo = false;
    };
  }, [motor, consulta, semResultado]);

  // espera o vendedor parar de digitar antes de buscar (economiza IA e bateria)
  useEffect(() => {
    const h = setTimeout(() => setConsulta(texto.trim()), ESPERA_DIGITACAO_MS);
    return () => clearTimeout(h);
  }, [texto]);

  // nome do cliente no voltar da faixa (aberto pela ficha do cliente)
  useEffect(() => {
    if (!motor || !clienteId) return setNomeCliente(null);
    let vivo = true;
    void nomeDoClienteLocal(motor, clienteId).then((n) => vivo && setNomeCliente(n)).catch(() => vivo && setNomeCliente(null));
    return () => {
      vivo = false;
    };
  }, [motor, clienteId]);

  // árvore do ERP no aparelho: sistemas e categorias dos chips; `?no=` abre com o filtro marcado
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    const doSync = sync.sincronizado_em;
    void arvoreLocal(motor)
      .then((a) => {
        if (!vivo) return;
        setArvore(a);
        setArvoreDoSync(doSync);
        if (noInicial) setFiltro((f) => (f === SEM_FILTRO ? filtroDoNo(a.arvore, noInicial) : f));
        setCargaDaArvore((n) => n + 1);
      })
      .catch(() => {
        if (!vivo) return;
        setArvore(null);
        setArvoreDoSync(doSync);
        setCargaDaArvore((n) => n + 1);
      });
    return () => {
      vivo = false;
    };
  }, [motor, noInicial, sync.sincronizado_em]);

  useEffect(() => {
    if (!motor || cargaDaArvore === 0) return;
    if (!naCarga && arvoreDoSync !== sync.sincronizado_em) return; // a árvore deste sync ainda está sendo lida: ela dispara a rodada
    let vivo = true;
    const entrada = { perfil, parametros: parametrosCrus, agora: relogioReal().agora().toISOString(), clienteId, usuarioId, filtroFilial: escolha.filial };
    // rodada velha para no próximo passo (filtro, busca ou sync mudou enquanto lia o aparelho)
    const aindaVale = () => {
      if (!vivo) throw new RodadaCancelada();
    };
    const local = async (aviso: string | null) => {
      const doFiltro = arvore ? produtosDoFiltro(arvore.arvore, arvore.vinculos, filtro) : undefined;
      const permitidos = dentroDoPedido ? await produtosDaNavegacao(motor, { ...entrada, noId: null, soDaTabelaDoCliente: true }) : undefined;
      aindaVale();
      const ativos = idsAtivos(await produtosLocais(motor));
      aindaVale();
      const ids = doFiltro || permitidos ? new Set([...(doFiltro ?? ativos)].filter((id) => ativos.has(id) && (!permitidos || permitidos.has(id)))) : undefined;
      const chips = { ...(ids ? { only_product_ids: ids } : {}), ...(dentroDoPedido ? { only_sellable: true } : {}), ...(escolha.soComEstoque ? { only_in_stock: true } : {}) };
      if (veiculo) {
        // RN-CAT-22: o filtro de veículo é local (o catálogo está no aparelho); só as peças que servem no veículo (D4), paginado sobre a lista pronta
        const v = await listaComVeiculo(motor, { ...entrada, fuso, q: consulta, chips, veiculo, offline: aviso === AVISO_BUSCA_OFFLINE });
        return { itens: v.items.slice(0, limite), total: v.total, aviso: consulta ? avisoDaBusca(aviso, v.indexando) : null };
      }
      const r = consulta ? await buscarLocal(motor, { ...entrada, fuso, q: consulta, chips, limit: limite, offset: 0, offline: aviso === AVISO_BUSCA_OFFLINE }) : await vitrineLocal(motor, { ...entrada, chips, limit: limite, offset: 0 });
      // índice em reconstrução (T-0088): sem erro; junta com o aviso de sem sinal numa frase só (some quando o índice fica pronto)
      const organizando = 'indexando' in r && r.indexando === true;
      return { itens: r.items, total: r.total, aviso: consulta ? avisoDaBusca(aviso, organizando) : null };
    };
    const daApi = (rota: 'busca' | 'produtos') =>
      paginasDaApi<ItemVitrine>((c, q) => ambiente.http.get(c, q), caminhoCatalogo(rota), { ...(rota === 'busca' ? { q: consulta } : {}), ...(clienteId ? { customer_id: clienteId } : {}) }, limite, rota === 'busca' ? PAGINA_DA_BUSCA : undefined);
    const online = async (): Promise<Omit<EstadoLista, 'carregando'>> => {
      const pag = await daApi(consulta ? 'busca' : 'produtos');
      const itens = dentroDoPedido ? soVendaveisNaCarga(pag.items) : pag.items; // RN-CAT-06
      return { itens, total: dentroDoPedido ? itens.length : pag.total, aviso: null };
    };
    const carregar = async () => {
      setLista((l) => ({ ...l, carregando: true }));
      let r: Omit<EstadoLista, 'carregando'>;
      if (naCarga) {
        if (modoCarga === 'sem_sinal') r = { itens: [], total: 0, aviso: TEXTO_CATALOGO_CARREGANDO };
        else {
          try {
            r = await online();
          } catch (e) {
            r = ehSemConexao(e) ? { itens: [], total: 0, aviso: TEXTO_CATALOGO_CARREGANDO } : { itens: [], total: 0, aviso: null, erro: true };
          }
        }
      } else if (!consulta) r = await local(null);
      else if (!ambiente.online() || veiculo !== null || filtroLigado(filtro) || escolhaLigada(escolha) || textoPareceCodigo(consulta)) r = await local(ambiente.online() ? null : AVISO_BUSCA_OFFLINE);
      else {
        const c = await buscaComSinal(() => daApi('busca'), ehSemConexao, AVISO_BUSCA_OFFLINE);
        if (c.origem === 'aparelho') r = await local(c.aviso);
        else {
          const api = c.pag;
          // decisão 4 do R-20261115-100000: o estoque mostrado é o do aparelho, não o da API; com a carga do estoque em andamento (T-0192 §7.2) o cartão mostra "carregando"
          const doAparelho = estoqueCarregando ? new Map<string, ItemVitrine['availability']>() : await estoqueLocalDosProdutos(motor, entrada, api.items.map((i) => i.id)).catch(() => new Map<string, ItemVitrine['availability']>());
          r = { itens: api.items.map((i) => (doAparelho.has(i.id) ? { ...i, availability: doAparelho.get(i.id) ?? null } : i)), total: api.total, aviso: c.aviso };
        }
      }
      // RN-VEN-43: pela ficha do cliente o preço sai no prazo padrão dele; sem cliente, tabela pura
      aindaVale();
      if (clienteId && r.itens.length > 0) r = { ...r, itens: await ajustarPeloPrazoPadrao(r.itens, clienteId, ambiente.consultar) };
      // "Mostrar mais": ver `reaproveitarItens`
      if (vivo) setLista((antes) => ({ ...r, itens: reaproveitarItens(antes.itens, r.itens), carregando: false }));
    };
    void carregar().catch((e) => vivo && !(e instanceof RodadaCancelada) && setLista({ carregando: false, itens: [], total: 0, aviso: null, erro: true }));
    return () => {
      vivo = false;
    };
    // `arvore` fica fora: ela só muda junto com `cargaDaArvore`, que já dispara a rodada
  }, [motor, cargaDaArvore, arvoreDoSync, sync.sincronizado_em, filtro, escolha, consulta, veiculo, limite, dentroDoPedido, clienteId, perfil, parametrosCrus, ambiente, fuso, modoCarga, usuarioId, tentativa, estoqueCarregando]);

  // RN-CAT-22 (D1): com a folha Filtrar aberta, a contagem de cada chip sobre a lista de agora (veículo, busca e `Só com estoque`)
  useEffect(() => {
    if (!folhaFiltro || !motor || !arvore || naCarga) return setContados(null);
    let vivo = true;
    const a = arvore;
    void (async () => {
      const entrada = { perfil, parametros: parametrosCrus, agora: relogioReal().agora().toISOString(), clienteId, usuarioId, filtroFilial: escolha.filial, fuso };
      const permitidos = dentroDoPedido ? await produtosDaNavegacao(motor, { ...entrada, noId: null, soDaTabelaDoCliente: true }) : undefined;
      const ativos = idsAtivos(await produtosLocais(motor));
      let base: Set<string>;
      if (veiculo || consulta || escolha.soComEstoque) {
        const chips = { ...(permitidos ? { only_product_ids: permitidos } : {}), ...(dentroDoPedido ? { only_sellable: true } : {}), ...(escolha.soComEstoque ? { only_in_stock: true } : {}) };
        const itens = veiculo
          ? (await listaComVeiculo(motor, { ...entrada, q: consulta, chips, veiculo, offline: false })).items
          : consulta
            ? (await buscarLocal(motor, { ...entrada, q: consulta, chips, limit: TETO_RANKING_BUSCA, offset: 0, offline: false })).items
            : (await vitrineLocal(motor, { ...entrada, chips, limit: TETO_RANKING_BUSCA, offset: 0 })).items;
        base = new Set(itens.map((i) => i.id));
      } else base = new Set([...ativos].filter((id) => !permitidos || permitidos.has(id)));
      const grupos = contarChipsFiltrar(base, classificacaoDaGrade(a.arvore, a.vinculos, filtro), { sistema: filtro.sistemaId, familia: filtro.familiaId, linha: filtro.linhaId, categoria: filtro.categoriaId }, { cruzar: false });
      const chipsDe = (g: GrupoFiltro) => grupos.find((x) => x.grupo === g)?.chips ?? [];
      if (vivo) setContados({ sistema: chipsDe('sistema'), familia: chipsDe('familia'), linha: chipsDe('linha'), categoria: chipsDe('categoria') });
    })().catch(() => vivo && setContados(null));
    return () => {
      vivo = false;
    };
  }, [folhaFiltro, motor, arvore, naCarga, veiculo, consulta, escolha, filtro, dentroDoPedido, clienteId, perfil, parametrosCrus, usuarioId, fuso]);

  const chips = useMemo(() => chipsDaGrade(naCarga ? ARVORE_VAZIA : (arvore?.arvore ?? ARVORE_VAZIA), filtro), [arvore, filtro, naCarga]);
  const linhas = useMemo(() => emLinhas(lista.itens), [lista.itens]);
  // callbacks estáveis (ver `CartaoDaLista`)
  const abrirProduto = useCallback((id: string) => irParaProduto(id, clienteId), [clienteId]);
  const abrirFolhaDeEstoque = useCallback((item: ItemVitrine) => setItemDaFolha(item), []);
  const comFiltro = !naCarga && (filtroLigado(filtro) || escolhaLigada(escolha));
  const opcoesFilial = useMemo(() => opcoesDoFiltroFilial({ proprias: filiais.venda, filiais: filiais.todas }), [filiais]);
  const resumo = resumoDoFiltro({ opcoes: opcoesFilial, escolha, sistemaId: filtro.sistemaId, familiaId: filtro.familiaId, linhaId: filtro.linhaId, categoriaId: filtro.categoriaId });
  const subtitulo = subtituloComFilial(filiais.cadastro?.nome ?? null);
  const folhaDoItem = itemDaFolha?.availability
    ? dadosDaFolha({ availability: itemDaFolha.availability, cargaEm: sync.sincronizado_em, filialCadastro: filiais.cadastro?.id ?? null, agora: relogioReal().agora().toISOString(), fuso })
    : null;
  const nomeDoFiltro = arvore?.arvore.nos.get(noDoFiltro(filtro) ?? '')?.nome ?? '';
  const nomeDoNo = (id: string | null) => (id ? (arvore?.arvore.nos.get(id)?.nome ?? '') : '');
  // chips da folha: com a contagem pronta, só os que têm peça (e o grupo só com 2 ou mais); sem ela, os de sempre
  const comContagem = (nos: readonly { id: string; nome: string; codigo: string }[], c: ChipFiltro[] | undefined) =>
    c ? c.flatMap((x) => { const n = nos.find((y) => y.id === x.id); return n ? [{ ...n, contagem: x.contagem }] : []; }) : nos;
  const sistemasDaFolha = comContagem(chips.sistemas, contados?.sistema);
  const familiasDaFolha = comContagem(chips.familias, contados?.familia);
  const linhasDaFolha = comContagem(chips.linhas, contados?.linha);
  const categoriasDaFolha = comContagem(chips.categorias, contados?.categoria);
  // a consulta da folha Veículo: a cascata sobre as linhas locais, no escopo do pedido (null sem o aparelho pronto)
  const consultarVeiculos = useCallback(
    async (entrada: { escolha: VeiculoParcial; busca?: string }): Promise<VeiculosSaida | null> => (motor ? cascataLocal(motor, { ...entrada, escopo: escopoPedido }, anoCivilNoFuso(relogioReal().agora(), fuso)) : null),
    [motor, escopoPedido, fuso],
  );
  const tirarVeiculo = () => setVeiculo(null);
  const rotulosVeiculo = veiculo ? rotulosDoVeiculo(veiculo) : null;
  const cabecalho = {
    titulo: 'Catálogo',
    ...(subtitulo ? { subtitulo } : {}),
    posicaoSubtitulo: 'abaixo' as const,
    ...(clienteId ? { voltar: { label: nomeCliente ?? 'Cliente', fallback: '/' } } : {}),
  };

  if (!motor) {
    return (
      <Screen testID="pagina-catalogo-catalogo" cabecalho={{ titulo: 'Catálogo' }}>
        <Empty text="O catálogo aparece depois da primeira sincronização. Entre com o seu usuário e sincronize o aparelho." />
      </Screen>
    );
  }

  const erroAoAbrir = !lista.carregando && lista.erro === true;
  const aparelhoVazio = !lista.carregando && lista.itens.length === 0 && !consulta && !comFiltro;

  return (
    <Screen testID="pagina-catalogo-catalogo" cabecalho={cabecalho}>
      <View style={s.linhaBusca}>
        <View style={{ flex: 1 }}>
          <CampoBusca
            testID="catalogo-busca"
            valor={texto}
            onChange={setTexto}
            placeholder={temVeiculos ? TEXTOS_VEICULO_CATALOGO.placeholderBusca : 'Produto, código ou aplicação'}
            rotuloAcessivel="Buscar produto"
            {...(temVeiculos ? { dica: TEXTOS_VEICULO_CATALOGO.dicaBusca } : {})}
            onEnviar={() => setConsulta(texto.trim())}
            onLimpar={() => {
              setTexto('');
              setConsulta('');
            }}
            rotuloLimpar="Limpar a busca"
          />
        </View>
        {temVeiculos ? <BotaoFiltro testID="catalogo-veiculo" icone="carro" rotulo={leituraDoBotaoVeiculo(rotulosVeiculo)} ativo={veiculo !== null} onPress={() => setFolhaVeiculo(true)} /> : null}
        <BotaoFiltro testID="catalogo-filtro" contagem={resumo.contagem} rotulo="Filtrar" onPress={() => setFolhaFiltro(true)} />
      </View>
      <ChaveSoComEstoque ligada={escolha.soComEstoque} onMudar={(v) => setEscolha((e) => ({ ...e, soComEstoque: v }))} />
      {veiculo || resumo.filial || filtro.sistemaId ? (
        <LinhaEtiquetas testID="catalogo-etiquetas">
          {rotulosVeiculo ? <EtiquetaFiltro testID="catalogo-etiqueta-veiculo" texto={rotulosVeiculo.curto} onRemover={tirarVeiculo} rotuloRemover={leituraDaEtiquetaVeiculo(rotulosVeiculo)} /> : null}
          {filtro.sistemaId ? <EtiquetaFiltro testID="catalogo-etiqueta-sistema" texto={nomeDoNo(filtro.sistemaId)} onRemover={() => setFiltro(SEM_FILTRO)} rotuloRemover={`Remover filtro ${nomeDoNo(filtro.sistemaId)}`} /> : null}
          {filtro.familiaId ? <EtiquetaFiltro testID="catalogo-etiqueta-familia" texto={nomeDoNo(filtro.familiaId)} onRemover={() => setFiltro((f) => escolherFamilia(f, null))} rotuloRemover={`Remover filtro ${nomeDoNo(filtro.familiaId)}`} /> : null}
          {filtro.linhaId ? <EtiquetaFiltro testID="catalogo-etiqueta-linha" texto={nomeDoNo(filtro.linhaId)} onRemover={() => setFiltro((f) => escolherLinha(f, null))} rotuloRemover={`Remover filtro ${nomeDoNo(filtro.linhaId)}`} /> : null}
          {filtro.categoriaId ? <EtiquetaFiltro testID="catalogo-etiqueta-categoria" texto={nomeDoNo(filtro.categoriaId)} onRemover={() => setFiltro((f) => escolherCategoria(f, null))} rotuloRemover={`Remover filtro ${nomeDoNo(filtro.categoriaId)}`} /> : null}
          {resumo.filial ? (
            <EtiquetaFiltro
              testID="catalogo-etiqueta-filial"
              texto={resumo.filial.texto}
              onRemover={() => setEscolha((e) => ({ ...e, filial: null }))}
              rotuloRemover={`Remover filtro ${resumo.filial.texto}`}
            />
          ) : null}
        </LinhaEtiquetas>
      ) : null}

      {lista.aviso === TEXTO_CATALOGO_CARREGANDO ? <CatalogoCarregando /> : null}
      {lista.aviso && lista.aviso !== AVISO_BUSCA_OFFLINE && lista.aviso !== TEXTO_CATALOGO_CARREGANDO ? (
        <Banner testID="catalogo-aviso" anunciar icon={iconeDoAviso(lista.aviso)}>
          {lista.aviso}
        </Banner>
      ) : null}

      {lista.carregando && lista.itens.length === 0 ? <ActivityIndicator color={colors.accent} style={{ paddingVertical: 20 }} /> : null}
      {erroAoAbrir ? (
        <EstadoVazio testID="catalogo-erro" icone="alert" titulo="Não foi possível abrir o catálogo agora" acao={{ rotulo: 'Tentar de novo', onPress: () => setTentativa((n) => n + 1), testID: 'catalogo-erro-acao' }} />
      ) : null}
      {!erroAoAbrir && !lista.carregando && lista.itens.length === 0 && lista.aviso !== TEXTO_CATALOGO_CARREGANDO ? (
        veiculo ? (
          <VazioComVeiculo consulta={consulta} chipMarcado={comFiltro && filtroLigado(filtro)} onTirarVeiculo={tirarVeiculo} onLimparFiltros={() => setFiltro(SEM_FILTRO)} />
        ) : consulta ? (
          <VazioDaBusca
            consulta={consulta}
            filtroLigado={comFiltro}
            semInternet={lista.aviso === AVISO_BUSCA_OFFLINE}
            dentroDoPedido={dentroDoPedido}
            onLimparFiltros={() => {
              setFiltro(SEM_FILTRO);
              setEscolha(SEM_ESCOLHA);
            }}
            onLimparBusca={() => {
              setTexto('');
              setConsulta('');
            }}
            sugestao={sugestao}
            onSugestao={(termo) => {
              setTexto(termo);
              setConsulta(termo);
            }}
          />
        ) : aparelhoVazio ? (
          <EstadoVazio testID="catalogo-vazio" icone="search" titulo="O catálogo ainda não está no aparelho" acao={{ rotulo: 'Sincronizar', onPress: auto.puxar, testID: 'catalogo-vazio-acao' }} />
        ) : (
          <EstadoVazio testID="catalogo-vazio" icone="search" titulo={`Nenhum produto em ${nomeDoFiltro}`} />
        )
      ) : null}

      {linhas.map((par) => (
        <View key={par[0]!.id} style={s.linha}>
          {par.map((item) => (
            <CartaoDaLista key={item.id} item={item} clienteId={clienteId} miniatura={miniaturas.get(item.id) ?? null} estoqueCarregando={estoqueCarregando} onAbrir={abrirProduto} onEstoquePorFilial={abrirFolhaDeEstoque} />
          ))}
          {par.length === 1 ? <View style={{ flex: 1 }} /> : null}
        </View>
      ))}
      {lista.itens.length > 0 ? (
        <MostrarMais
          testID="catalogo-mostrar-mais"
          mostrando={lista.itens.length}
          total={lista.total}
          contagem={false}
          onPress={() => !lista.carregando && setLimite(proximaPaginaDaBusca(lista.itens.length, lista.total))}
        />
      ) : null}
      <FolhaFiltroCatalogo
        visivel={folhaFiltro}
        onFechar={() => setFolhaFiltro(false)}
        opcoes={opcoesFilial}
        escolha={escolha}
        onEscolher={setEscolha}
        onLimpar={() => {
          setEscolha((e) => ({ ...SEM_ESCOLHA, soComEstoque: e.soComEstoque }));
          setFiltro(SEM_FILTRO);
        }}
        sistemas={sistemasDaFolha}
        familias={familiasDaFolha}
        linhas={linhasDaFolha}
        categorias={categoriasDaFolha}
        sistemaId={filtro.sistemaId}
        familiaId={filtro.familiaId}
        linhaId={filtro.linhaId}
        categoriaId={filtro.categoriaId}
        onSistema={(id) => setFiltro((f) => escolherSistema(f, id))}
        onFamilia={(id) => setFiltro((f) => escolherFamilia(f, id))}
        onLinha={(id) => setFiltro((f) => escolherLinha(f, id))}
        onCategoria={(id) => setFiltro((f) => escolherCategoria(f, id))}
      />
      <FolhaVeiculo
        visivel={folhaVeiculo}
        consultar={consultarVeiculos}
        navegacao={NAVEGACAO_VEICULO}
        textos={TEXTOS_VEICULO}
        aplicado={veiculo}
        onAplicar={({ veiculo: v }) => {
          lembrarVeiculo(v);
          setVeiculo(v);
          setFolhaVeiculo(false);
        }}
        onFechar={() => setFolhaVeiculo(false)}
      />
      <FolhaEstoquePorFilial visivel={itemDaFolha !== null} onFechar={() => setItemDaFolha(null)} dados={folhaDoItem} />
    </Screen>
  );
}

/**
 * Cartão da grade com `memo` e sem função nova por item. No "Mostrar mais" a lista inteira é relida e os objetos são novos, então o memo compara
 * o conteúdo: o item (reaproveitado por `reaproveitarItens` quando igual) e a miniatura (objeto novo a cada leitura, igual por valor).
 */
const CartaoDaLista = memo(function CartaoDaLista({ item, clienteId, miniatura, estoqueCarregando, onAbrir, onEstoquePorFilial }: { item: ItemVitrine; clienteId: string | null; miniatura: ComponentProps<typeof CartaoGrade>['miniatura']; estoqueCarregando: boolean; onAbrir: (id: string) => void; onEstoquePorFilial: (item: ItemVitrine) => void }) {
  const abrir = useCallback(() => onAbrir(item.id), [onAbrir, item.id]);
  const estoque = useCallback(() => onEstoquePorFilial(item), [onEstoquePorFilial, item]);
  return <CartaoGrade item={item} clienteId={clienteId} miniatura={miniatura} estoqueCarregando={estoqueCarregando} onPress={abrir} onEstoquePorFilial={estoque} />;
}, (a, b) => a.item === b.item && a.clienteId === b.clienteId && a.estoqueCarregando === b.estoqueCarregando && a.onAbrir === b.onAbrir && a.onEstoquePorFilial === b.onEstoquePorFilial && mesmoValor(a.miniatura, b.miniatura));

const SEM_ESCOLHA: EscolhaFiltro = { filial: null, soComEstoque: false };
/** Filial escolhida (inclusive "Suas filiais") ou "Ocultar" ligados: a busca é local, que sabe filtrar por filial e estoque. */
const escolhaLigada = (e: EscolhaFiltro) => e.filial !== null || e.soComEstoque;
const filtroLigado = (f: FiltroDaGrade) => noDoFiltro(f) !== null;

const s = StyleSheet.create({
  linha: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
  linhaBusca: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
});

function VazioDaBusca({
  consulta,
  filtroLigado,
  semInternet,
  dentroDoPedido,
  onLimparFiltros,
  onLimparBusca,
  sugestao,
  onSugestao,
}: {
  consulta: string;
  filtroLigado: boolean;
  semInternet: boolean;
  dentroDoPedido: boolean;
  onLimparFiltros: () => void;
  onLimparBusca: () => void;
  sugestao: string | null;
  onSugestao: (termo: string) => void;
}) {
  const v = vazioDaBusca({ consulta, filtroLigado, semInternet, dentroDoPedido });
  // T-0167: sem filtro ligado vale o cartão do kit ("Nenhum produto com “agau”." + "Você quis dizer…"); com filtro, a ação é limpar o filtro
  if (v.caso !== 'filtro') return <NadaEncontrado testID="catalogo-vazio" termo={consulta} sugestao={sugestao} onSugestao={onSugestao} />;
  return (
    <EstadoVazio
      testID="catalogo-vazio"
      icone="search"
      titulo={v.titulo}
      texto={v.apoio}
      acao={{ rotulo: v.rotuloAcao, onPress: v.caso === 'filtro' ? onLimparFiltros : onLimparBusca, testID: 'catalogo-vazio-acao' }}
    />
  );
}

/** RN-CAT-22 (spec §9): com veículo, o vazio não traz apoio (o veículo já está na etiqueta); a ação é `Tirar o veículo` ou, com chip marcado, `Limpar filtros`. */
function VazioComVeiculo({ consulta, chipMarcado, onTirarVeiculo, onLimparFiltros }: { consulta: string; chipMarcado: boolean; onTirarVeiculo: () => void; onLimparFiltros: () => void }) {
  const v = vazioComVeiculo({ consulta, chipMarcado });
  const limpar = v.acao === 'limpar_filtros';
  return <EstadoVazio testID="catalogo-vazio" icone="search" titulo={v.titulo} acao={{ rotulo: limpar ? TEXTOS_VEICULO_CATALOGO.limparFiltros : TEXTOS_VEICULO_CATALOGO.tirar, onPress: limpar ? onLimparFiltros : onTirarVeiculo, testID: 'catalogo-vazio-acao' }} />;
}
