/**
 * Aba Catálogo (RF-CAT-01/02, T-0052): vitrine e busca. OFFLINE-FIRST: a vitrine sempre vem do aparelho; a busca com
 * texto usa a API (busca inteligente) quando há sinal e cai para a busca local (FTS5 + sinônimos + ranking do domain)
 * sem sinal ou em falha, com aviso discreto. Preço = tabela do cliente em contexto (`?cliente=`, RN-CAT-06); preço e
 * estoque somem para quem não vê (RN-CAT-05). "Adicionar ao pedido" só pela extensão `produto.acoes` (RN-PRO-01).
 * Até 3 toques: aba → digita → "Adicionar" no cartão.
 * T-0142 / RF-CAT-09: sem texto na busca, a página é a própria hierarquia do ERP, do maior agrupamento para o menor (função
 * `navegarHierarquia` do domain, a mesma do BKO): um nível por tela, com a contagem de produtos ativos, trilha e, no último
 * nível, a lista rica de produtos (o mesmo cartão da busca: foto, aplicação em 2 linhas, "Equivale a", etiquetas, preço e
 * estoque; chips de marca e com estoque; "Mostrar mais" de 100 em 100). Nenhum atalho nem tela à parte para a lista por linha. Com `?pedido=1` (aberto de dentro do pedido) só entram os produtos
 * da tabela de preço do cliente. Tudo lido do aparelho (offline). O promotor navega só para leitura (sem preço, sem ações
 * de pedido: o shell já esconde `produto.acoes` dele). Favoritos ainda não existem no módulo.
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { ehSemConexao } from '@macuxi/platform-sdk';
import { useAmbiente, useMotorSync, useParametros } from '@macuxi/platform-sdk/react';
import { Banner, Chip, colors, DEFAULT_TZ, Empty, EstadoVazio, fonts, Icon, LinhaChips, ListaNiveis, MostrarMais, NadaEncontrado, PAGINA_DA_BUSCA, proximaPaginaDaBusca, Screen, SyncStamp, type as t, Trilha, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { caminhoCatalogo, type ItemVitrine, type RespostaBusca } from '../../contracts';
import { idsAtivos, navegarHierarquia, type NavegacaoHierarquia } from '../../domain/hierarquia';
import { AVISO_BUSCA_FALHOU, AVISO_BUSCA_OFFLINE, avisoDaBusca, iconeDoAviso } from '../../domain/ia';
import { parametrosDoTenant } from '../../domain/parametros';
import { podeVerPrecoEstoque } from '../../domain/visibilidade';
import { contagem } from '../lib/apresentacao';
import { extrasLocais, type ExtrasProduto } from '../lib/extras-item';
import { vazioDaBusca } from '../lib/vazio-busca';
import { arvoreLocal, buscarLocal, filtrosLocais, produtosDaNavegacao, produtosLocais, vitrineLocal } from '../lib/local';
import { sugestaoDaBuscaLocal } from '../texto-consultas';
import { irParaProduto } from '../rotas';
import { CartaoProduto } from './comum';
import { useMiniaturasDosItens } from './miniatura';

const POR_PAGINA = PAGINA_DA_BUSCA;
const RAIZ = 'raiz';
const ESPERA_DIGITACAO_MS = 350;

interface EstadoLista {
  carregando: boolean;
  itens: ItemVitrine[];
  total: number;
  aviso: string | null;
  origem: 'aparelho' | 'servidor';
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
  const vePrecoEstoque = perfil !== null && podeVerPrecoEstoque(perfil, parametrosDoTenant(parametrosCrus));

  const [texto, setTexto] = useState(params.q ? String(params.q) : '');
  const [consulta, setConsulta] = useState(texto);
  const [soComEstoque, setSoComEstoque] = useState(false);
  const [marca, setMarca] = useState<string | null>(null);
  // chip "Campanha" cortado para o backlog (R-20261102-204330): filtro fica desligado até voltar
  const soCampanha = false;
  const [noId, setNoId] = useState<string | null>(params.no ? String(params.no) : null);
  const [marcas, setMarcas] = useState<string[]>([]);
  const [limite, setLimite] = useState(POR_PAGINA); // "Mostrar mais" soma 20 (kit); ao trocar de nível, busca ou filtro volta ao inicial
  const [extras, setExtras] = useState<Map<string, ExtrasProduto>>(new Map());
  // T-0142 / RF-CAT-09: a página inicial é a hierarquia (mesma função do domain que o BKO usa); `null` = ainda lendo o aparelho
  const [nav, setNav] = useState<NavegacaoHierarquia | null>(null);
  const [lista, setLista] = useState<EstadoLista>({ carregando: true, itens: [], total: 0, aviso: null, origem: 'aparelho' });
  const [sugestao, setSugestao] = useState<string | null>(null);
  const auto = useAtualizacaoAutomatica({ tz: fuso });
  const agora = relogioReal().agora().toISOString();
  const idsExibidos = useMemo(() => lista.itens.map((i) => i.id), [lista.itens]);
  const miniaturas = useMiniaturasDosItens(motor, idsExibidos, sync.sincronizado_em);

  useEffect(() => setLimite(POR_PAGINA), [noId, consulta, marca, soComEstoque]);

  // "Você quis dizer…": só quando a busca não achou nada, do vocabulário do índice no aparelho
  const semResultado = Boolean(consulta) && !lista.carregando && lista.itens.length === 0;
  useEffect(() => {
    if (!motor || !semResultado) return setSugestao(null);
    let vivo = true;
    void sugestaoDaBuscaLocal(motor, consulta).then((x) => vivo && setSugestao(x)).catch(() => vivo && setSugestao(null));
    return () => {
      vivo = false;
    };
  }, [motor, consulta, semResultado]);

  // aplicação, "Equivale a" e etiquetas dos itens da tela, lidos do aparelho (offline)
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    void extrasLocais(motor, idsExibidos).then((m) => vivo && setExtras(m)).catch(() => vivo && setExtras(new Map()));
    return () => {
      vivo = false;
    };
  }, [motor, idsExibidos, sync.sincronizado_em]);

  // espera o vendedor parar de digitar antes de buscar (economiza IA e bateria)
  useEffect(() => {
    const h = setTimeout(() => setConsulta(texto.trim()), ESPERA_DIGITACAO_MS);
    return () => clearTimeout(h);
  }, [texto]);

  useEffect(() => {
    if (!motor) return;
    void filtrosLocais(motor).then((f) => {
      setMarcas(f.marcas);
    });
  }, [motor, sync.sincronizado_em]);

  // RF-CAT-09: nível atual da hierarquia com a contagem de produtos ativos (dentro do pedido, só os da tabela do cliente)
  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    const entrada = { perfil, parametros: parametrosCrus, agora: relogioReal().agora().toISOString(), clienteId };
    void (async () => {
      const { arvore, vinculos } = await arvoreLocal(motor);
      const permitidos = await produtosDaNavegacao(motor, { ...entrada, noId: null, soDaTabelaDoCliente: dentroDoPedido });
      const ativos = idsAtivos(await produtosLocais(motor));
      const base = permitidos ? new Set([...ativos].filter((id) => permitidos.has(id))) : ativos;
      if (vivo) setNav(navegarHierarquia(arvore, vinculos, base, noId));
    })();
    return () => {
      vivo = false;
    };
  }, [motor, noId, dentroDoPedido, clienteId, perfil, parametrosCrus, sync.sincronizado_em]);

  useEffect(() => {
    if (!motor || !nav) return;
    let vivo = true;
    const entrada = { perfil, parametros: parametrosCrus, agora: relogioReal().agora().toISOString(), clienteId };
    const local = async (aviso: string | null) => {
      // sem busca, a lista são os produtos do nível em que a hierarquia chegou
      const ids = consulta || nav.tipo !== 'produtos' ? undefined : new Set(nav.produtoIds);
      const chips = {
        brand: marca ?? undefined,
        only_in_stock: soComEstoque || undefined,
        campaign: soCampanha || undefined,
        ...(ids ? { only_product_ids: ids } : {}),
        ...(dentroDoPedido ? { only_sellable: true } : {}),
      };
      const r = consulta ? await buscarLocal(motor, { ...entrada, fuso, q: consulta, chips, limit: limite, offset: 0, offline: aviso === AVISO_BUSCA_OFFLINE }) : await vitrineLocal(motor, { ...entrada, chips, limit: limite, offset: 0 });
      // índice em reconstrução (T-0088): sem erro; junta com o aviso de sem sinal/falha numa frase só (some quando o índice fica pronto)
      const organizando = 'indexando' in r && r.indexando === true;
      return { itens: r.items, total: r.total, aviso: consulta ? avisoDaBusca(aviso, organizando) : null, origem: 'aparelho' as const };
    };
    const carregar = async () => {
      setLista((l) => ({ ...l, carregando: true }));
      let r: Omit<EstadoLista, 'carregando'>;
      if (!consulta && nav.tipo === 'niveis') r = { itens: [], total: 0, aviso: null, origem: 'aparelho' }; // no meio da hierarquia não há lista
      else if (!consulta) r = await local(null);
      else if (!ambiente.online()) r = await local(AVISO_BUSCA_OFFLINE);
      else {
        try {
          const api = await ambiente.http.get<RespostaBusca>(caminhoCatalogo('busca'), { q: consulta, customer_id: clienteId, only_in_stock: soComEstoque || undefined, limit: limite });
          r = { itens: api.items, total: api.total, aviso: api.notice, origem: 'servidor' };
        } catch (e) {
          r = await local(ehSemConexao(e) ? AVISO_BUSCA_OFFLINE : AVISO_BUSCA_FALHOU);
        }
      }
      if (vivo) setLista({ ...r, carregando: false });
    };
    void carregar().catch(() => vivo && setLista({ carregando: false, itens: [], total: 0, aviso: 'Não foi possível abrir o catálogo agora. Puxe a tela para tentar de novo.', origem: 'aparelho' }));
    return () => {
      vivo = false;
    };
  }, [motor, nav, consulta, marca, limite, soCampanha, dentroDoPedido, soComEstoque, clienteId, perfil, parametrosCrus, ambiente, sync.sincronizado_em]);

  // trilha comum (@macuxi/ui): "Catálogo" é a raiz; o último é o lugar atual; nível pulado (item único) fica em cinza, sem toque
  const itensTrilha = useMemo(
    () => (!nav || nav.caminho.length === 0 ? [] : [{ id: RAIZ, rotulo: 'Catálogo', desligado: !nav.raizTocavel, testID: 'catalogo-trilha-inicio' }, ...nav.caminho.map((c) => ({ id: c.id, rotulo: c.nome, desligado: !c.tocavel, testID: `catalogo-trilha-${c.codigo}` }))]),
    [nav],
  );
  const itensNiveis = useMemo(
    () => (nav?.tipo === 'niveis' ? nav.niveis.map((n) => ({ id: n.id, nome: n.nome, contagem: n.total, secundario: n.no === null, testID: `catalogo-no-${n.codigo}` })) : []),
    [nav],
  );

  const subtitulo = useMemo(() => {
    if (!vePrecoEstoque) return 'Fichas e fotos dos produtos.';
    return clienteId ? 'Preços da tabela do cliente selecionado.' : 'Abra pela ficha do cliente para ver o preço da tabela dele.';
  }, [vePrecoEstoque, clienteId]);

  // lista de produtos: na busca, ao chegar nos produtos (ou sem hierarquia) e para os produtos ligados direto a um nível
  const mostrarLista = !nav || consulta !== '' || nav.tipo === 'produtos';

  if (!motor) {
    return (
      <Screen testID="pagina-catalogo-catalogo">
        <Text style={t.h1}>Catálogo</Text>
        <Empty text="O catálogo aparece depois da primeira sincronização. Entre com o seu usuário e sincronize o aparelho." />
      </Screen>
    );
  }

  return (
    <Screen testID="pagina-catalogo-catalogo" refreshing={auto.puxando} onRefresh={auto.puxar}>
      <View style={s.topo}>
        <View style={{ flex: 1 }}>
          <Text style={t.h1}>Catálogo</Text>
          <Text style={t.sub}>{subtitulo}</Text>
        </View>
        <SyncStamp at={sync.sincronizado_em} offline={!ambiente.online()} tz={fuso} />
      </View>

      <View style={s.busca}>
        <Icon name="search" size={18} color={colors.ink2} />
        <TextInput
          testID="catalogo-busca"
          accessibilityLabel="Buscar produto"
          placeholder="Ex.: refrigerante 2 litros, café, CAF-500"
          placeholderTextColor={colors.ink3}
          value={texto}
          onChangeText={setTexto}
          returnKeyType="search"
          onSubmitEditing={() => setConsulta(texto.trim())}
          autoCorrect={false}
          style={s.campo}
        />
        {texto ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Limpar a busca" onPress={() => { setTexto(''); setConsulta(''); }} style={s.limpar} hitSlop={8}>
            <Icon name="close" size={18} color={colors.ink2} />
          </Pressable>
        ) : null}
      </View>

      {!consulta ? <Trilha itens={itensTrilha} onEscolher={(id) => setNoId(id === RAIZ ? null : id)} testID="catalogo-trilha" /> : null}
      {!consulta && nav?.tipo === 'produtos' && nav.caminho.length > 0 ? <Text style={t.h2} testID="catalogo-nivel-titulo">{nav.caminho[nav.caminho.length - 1]!.nome}</Text> : null}
      {!consulta && nav?.tipo === 'niveis' ? (
        <>
          <ListaNiveis rotulo={nav.rotuloPlural} rotuloContagem="Produtos" itens={itensNiveis} onEscolher={setNoId} testID="catalogo-niveis" />
          <Text style={t.small} testID="catalogo-total-nivel">
            {contagem(nav.total, 'produto ativo', 'produtos ativos')}
            {nav.caminho.length > 0 ? ` em ${nav.caminho[nav.caminho.length - 1]!.nome}` : ''}
          </Text>
        </>
      ) : null}

      {mostrarLista ? (
        <>
      <LinhaChips testID="catalogo-chips">
        {vePrecoEstoque ? <Chip label="Com estoque" active={soComEstoque} onPress={() => setSoComEstoque((v) => !v)} testID="catalogo-chip-estoque" /> : null}
        {marcas.map((m) => (
          <Chip key={`marca-${m}`} label={m} active={marca === m} onPress={() => setMarca((atual) => (atual === m ? null : m))} testID={`catalogo-chip-marca-${m}`} />
        ))}
      </LinhaChips>

      {lista.aviso ? (
        <Banner testID="catalogo-aviso" anunciar icon={iconeDoAviso(lista.aviso)}>
          {lista.aviso}
        </Banner>
      ) : null}

      {lista.carregando && lista.itens.length === 0 ? <ActivityIndicator color={colors.accent} style={{ paddingVertical: 20 }} /> : null}
      {!lista.carregando && lista.itens.length === 0 ? (
        consulta ? (
          <VazioDaBusca
            consulta={consulta}
            filtroLigado={soComEstoque || marca !== null}
            semInternet={lista.aviso === AVISO_BUSCA_OFFLINE}
            dentroDoPedido={dentroDoPedido}
            onLimparFiltros={() => {
              setSoComEstoque(false);
              setMarca(null);
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
        ) : (
          <Empty text="Nenhum produto neste aparelho ainda. Puxe a tela para sincronizar." />
        )
      ) : null}

      {lista.itens.length > 0 && lista.itens.length >= lista.total ? (
        <Text style={s.contagem} testID="catalogo-contagem">
          {contagem(lista.total, 'produto', 'produtos')}
        </Text>
      ) : null}
      {lista.itens.map((item) => (
        <CartaoProduto key={item.id} item={item} agora={agora} fuso={fuso} clienteId={clienteId} miniatura={miniaturas.get(item.id) ?? null} extras={extras.get(item.id)} onPress={() => irParaProduto(item.id, clienteId)} />
      ))}
      {lista.itens.length > 0 ? (
        <MostrarMais
          testID="catalogo-mostrar-mais"
          mostrando={lista.itens.length}
          total={lista.total}
          onPress={() => !lista.carregando && setLimite(proximaPaginaDaBusca(lista.itens.length, lista.total))}
        />
      ) : null}
      </>
      ) : null}
      <Text style={t.small} testID="catalogo-rodape-atualizacao">
        {auto.rodape}
      </Text>
    </Screen>
  );
}

const s = StyleSheet.create({
  topo: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  busca: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: 12, paddingHorizontal: 12, minHeight: 48 },
  campo: { flex: 1, fontFamily: fonts.body, fontSize: 15, color: colors.ink, paddingVertical: 10 },
  limpar: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center', marginRight: -12 },
  contagem: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2 },
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
