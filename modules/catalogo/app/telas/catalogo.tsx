/**
 * Aba Catálogo em grade (T-0173, docs/design/catalogo-grade.md; RF-CAT-01/02/09): duas colunas de cartões (foto, nome, marca,
 * preço e tag de estoque), busca no topo, sistema e categoria em chips e a contagem na faixa. OFFLINE-FIRST: tudo vem do aparelho;
 * a busca com texto usa a API (busca inteligente) quando há sinal e sem filtro de árvore, e cai para a busca local (FTS5 + sinônimos
 * + ranking do domain) sem sinal, em falha ou com sistema/categoria escolhidos.
 * Preço (RN-VEN-01, RN-CAT-06): pela ficha do cliente (`?cliente=`) vale a tabela dele; pelo menu, a da filial padrão do vendedor;
 * produto sem preço mostra "Sem preço". Preço e estoque somem para quem não vê (RN-CAT-05). Copiar o código é a única ação própria;
 * ações de outros módulos só pela extensão `produto.acoes` (RN-PRO-01). Com `?pedido=1` só entram os produtos da tabela do cliente. `?no=` abre com o filtro já marcado.
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { ehSemConexao } from '@macuxi/platform-sdk';
import { useAmbiente, useMotorSync, useParametros } from '@macuxi/platform-sdk/react';
import { Banner, CampoBusca, Chip, colors, DEFAULT_TZ, Empty, EstadoVazio, LinhaChips, MostrarMais, NadaEncontrado, PAGINA_DA_BUSCA, proximaPaginaDaBusca, Screen, SeloAtualizacao, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { caminhoCatalogo, type ItemVitrine, type RespostaBusca } from '../../contracts';
import { montarArvore, type Arvore, type VinculoProdutoNo } from '../../domain/arvore';
import { idsAtivos } from '../../domain/hierarquia';
import { AVISO_BUSCA_FALHOU, AVISO_BUSCA_OFFLINE, avisoDaBusca, iconeDoAviso } from '../../domain/ia';
import { textoPareceCodigo } from '../../domain/codigo-busca';
import { chipsDaGrade, emLinhas, escolherCategoria, escolherSistema, filtroDoNo, produtosDoFiltro, SEM_FILTRO, subtituloDaGrade, type FiltroDaGrade } from '../lib/grade';
import { vazioDaBusca } from '../lib/vazio-busca';
import { arvoreLocal, buscarLocal, nomeDoClienteLocal, produtosDaNavegacao, produtosLocais, vitrineLocal } from '../lib/local';
import { sugestaoDaBuscaLocal } from '../texto-consultas';
import { irParaProduto } from '../rotas';
import { CartaoGrade } from './comum';
import { useMiniaturasDosItens } from './miniatura';

const POR_PAGINA = PAGINA_DA_BUSCA;
const ESPERA_DIGITACAO_MS = 350;
const ARVORE_VAZIA: Arvore = montarArvore([]);

interface EstadoLista {
  carregando: boolean;
  itens: ItemVitrine[];
  total: number;
  aviso: string | null;
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
  const [filtro, setFiltro] = useState<FiltroDaGrade>(SEM_FILTRO);
  const [nomeCliente, setNomeCliente] = useState<string | null>(null);
  const [limite, setLimite] = useState(POR_PAGINA); // "Mostrar mais" soma 20 (kit); ao trocar de filtro ou de busca volta ao inicial
  const [lista, setLista] = useState<EstadoLista>({ carregando: true, itens: [], total: 0, aviso: null });
  const [sugestao, setSugestao] = useState<string | null>(null);
  const auto = useAtualizacaoAutomatica({ tz: fuso });
  const idsExibidos = useMemo(() => lista.itens.map((i) => i.id), [lista.itens]);
  const miniaturas = useMiniaturasDosItens(motor, idsExibidos, sync.sincronizado_em);
  const noInicial = params.no ? String(params.no) : null;

  useEffect(() => setLimite(POR_PAGINA), [filtro, consulta]);

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
    void arvoreLocal(motor)
      .then((a) => {
        if (!vivo) return;
        setArvore(a);
        if (noInicial) setFiltro((f) => (f === SEM_FILTRO ? filtroDoNo(a.arvore, noInicial) : f));
      })
      .catch(() => vivo && setArvore(null));
    return () => {
      vivo = false;
    };
  }, [motor, noInicial, sync.sincronizado_em]);

  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    const entrada = { perfil, parametros: parametrosCrus, agora: relogioReal().agora().toISOString(), clienteId };
    const local = async (aviso: string | null) => {
      const doFiltro = arvore ? produtosDoFiltro(arvore.arvore, arvore.vinculos, filtro) : undefined;
      const permitidos = dentroDoPedido ? await produtosDaNavegacao(motor, { ...entrada, noId: null, soDaTabelaDoCliente: true }) : undefined;
      const ativos = idsAtivos(await produtosLocais(motor));
      const ids = doFiltro || permitidos ? new Set([...(doFiltro ?? ativos)].filter((id) => ativos.has(id) && (!permitidos || permitidos.has(id)))) : undefined;
      const chips = { ...(ids ? { only_product_ids: ids } : {}), ...(dentroDoPedido ? { only_sellable: true } : {}) };
      const r = consulta ? await buscarLocal(motor, { ...entrada, fuso, q: consulta, chips, limit: limite, offset: 0, offline: aviso === AVISO_BUSCA_OFFLINE }) : await vitrineLocal(motor, { ...entrada, chips, limit: limite, offset: 0 });
      // índice em reconstrução (T-0088): sem erro; junta com o aviso de sem sinal/falha numa frase só (some quando o índice fica pronto)
      const organizando = 'indexando' in r && r.indexando === true;
      return { itens: r.items, total: r.total, aviso: consulta ? avisoDaBusca(aviso, organizando) : null };
    };
    const carregar = async () => {
      setLista((l) => ({ ...l, carregando: true }));
      let r: Omit<EstadoLista, 'carregando'>;
      if (!consulta) r = await local(null);
      else if (!ambiente.online() || filtroLigado(filtro) || textoPareceCodigo(consulta)) r = await local(ambiente.online() ? null : AVISO_BUSCA_OFFLINE);
      else {
        try {
          const api = await ambiente.http.get<RespostaBusca>(caminhoCatalogo('busca'), { q: consulta, customer_id: clienteId, limit: limite });
          r = { itens: api.items, total: api.total, aviso: api.notice };
        } catch (e) {
          r = await local(ehSemConexao(e) ? AVISO_BUSCA_OFFLINE : AVISO_BUSCA_FALHOU);
        }
      }
      if (vivo) setLista({ ...r, carregando: false });
    };
    void carregar().catch(() => vivo && setLista({ carregando: false, itens: [], total: 0, aviso: 'Não foi possível abrir o catálogo agora. Puxe a tela para tentar de novo.' }));
    return () => {
      vivo = false;
    };
  }, [motor, arvore, filtro, consulta, limite, dentroDoPedido, clienteId, perfil, parametrosCrus, ambiente, fuso, sync.sincronizado_em]);

  const chips = useMemo(() => chipsDaGrade(arvore?.arvore ?? ARVORE_VAZIA, filtro), [arvore, filtro]);
  const linhas = useMemo(() => emLinhas(lista.itens), [lista.itens]);
  const comFiltro = filtroLigado(filtro);
  const nomeDoFiltro = arvore?.arvore.nos.get(filtro.categoriaId ?? filtro.sistemaId ?? '')?.nome ?? '';
  const cabecalho = {
    titulo: 'Catálogo',
    ...(lista.carregando && lista.itens.length === 0 ? {} : { subtitulo: subtituloDaGrade(lista.total) }),
    posicaoSubtitulo: 'abaixo' as const,
    ...(clienteId ? { voltar: { label: nomeCliente ?? 'Cliente', fallback: '/' } } : {}),
    direita: <SeloAtualizacao testID="catalogo-selo-sync" semRede={!ambiente.online()} onSincronizar={auto.puxar} sobreFaixa />,
  };

  if (!motor) {
    return (
      <Screen testID="pagina-catalogo-catalogo" cabecalho={{ titulo: 'Catálogo' }}>
        <Empty text="O catálogo aparece depois da primeira sincronização. Entre com o seu usuário e sincronize o aparelho." />
      </Screen>
    );
  }

  const aparelhoVazio = !lista.carregando && lista.itens.length === 0 && !consulta && !comFiltro;

  return (
    <Screen testID="pagina-catalogo-catalogo" refreshing={auto.puxando} onRefresh={auto.puxar} cabecalho={cabecalho}>
      <CampoBusca
        testID="catalogo-busca"
        valor={texto}
        onChange={setTexto}
        placeholder="Produto, código ou aplicação"
        rotuloAcessivel="Buscar produto"
        onEnviar={() => setConsulta(texto.trim())}
        onLimpar={() => {
          setTexto('');
          setConsulta('');
        }}
        rotuloLimpar="Limpar a busca"
      />

      {chips.sistemas.length > 0 ? (
        <LinhaChips testID="catalogo-chips-sistema">
          <Chip label="Todos" active={filtro.sistemaId === null} onPress={() => setFiltro((f) => escolherSistema(f, null))} testID="catalogo-chip-sistema-todos" />
          {chips.sistemas.map((n) => (
            <Chip key={n.id} label={n.nome} active={filtro.sistemaId === n.id} onPress={() => setFiltro((f) => escolherSistema(f, n.id))} testID={`catalogo-chip-sistema-${n.codigo}`} />
          ))}
        </LinhaChips>
      ) : null}
      {chips.categorias.length > 0 ? (
        <LinhaChips testID="catalogo-chips-categoria">
          <Chip label="Todas" active={filtro.categoriaId === null} onPress={() => setFiltro((f) => escolherCategoria(f, null))} testID="catalogo-chip-categoria-todas" />
          {chips.categorias.map((n) => (
            <Chip key={n.id} label={n.nome} active={filtro.categoriaId === n.id} onPress={() => setFiltro((f) => escolherCategoria(f, n.id))} testID={`catalogo-chip-categoria-${n.codigo}`} />
          ))}
        </LinhaChips>
      ) : null}

      {lista.aviso && lista.aviso !== AVISO_BUSCA_OFFLINE ? (
        <Banner testID="catalogo-aviso" anunciar icon={iconeDoAviso(lista.aviso)}>
          {lista.aviso}
        </Banner>
      ) : null}

      {lista.carregando && lista.itens.length === 0 ? <ActivityIndicator color={colors.accent} style={{ paddingVertical: 20 }} /> : null}
      {!lista.carregando && lista.itens.length === 0 ? (
        consulta ? (
          <VazioDaBusca
            consulta={consulta}
            filtroLigado={comFiltro}
            semInternet={lista.aviso === AVISO_BUSCA_OFFLINE}
            dentroDoPedido={dentroDoPedido}
            onLimparFiltros={() => setFiltro(SEM_FILTRO)}
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
            <CartaoGrade key={item.id} item={item} clienteId={clienteId} miniatura={miniaturas.get(item.id) ?? null} onPress={() => irParaProduto(item.id, clienteId)} />
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
    </Screen>
  );
}

const filtroLigado = (f: FiltroDaGrade) => f.sistemaId !== null || f.categoriaId !== null;

const s = StyleSheet.create({
  linha: { flexDirection: 'row', gap: 12, alignItems: 'stretch' },
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
