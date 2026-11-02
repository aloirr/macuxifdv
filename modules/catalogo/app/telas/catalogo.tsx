/**
 * Aba Catálogo (RF-CAT-01/02, T-0052): vitrine e busca. OFFLINE-FIRST: a vitrine sempre vem do aparelho; a busca com
 * texto usa a API (busca inteligente) quando há sinal e cai para a busca local (FTS5 + sinônimos + ranking do domain)
 * sem sinal ou em falha, com aviso discreto. Preço = tabela do cliente em contexto (`?cliente=`, RN-CAT-06); preço e
 * estoque somem para quem não vê (RN-CAT-05). "Adicionar ao pedido" só pela extensão `produto.acoes` (RN-PRO-01).
 * Até 3 toques: aba → digita → "Adicionar" no cartão.
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { ehSemConexao } from '@macuxi/platform-sdk';
import { useAmbiente, useMotorSync, useParametros } from '@macuxi/platform-sdk/react';
import { Banner, Chip, colors, DEFAULT_TZ, Empty, fonts, Icon, Screen, SyncStamp, type as t, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { caminhoCatalogo, type ItemVitrine, type RespostaBusca } from '../../contracts';
import { AVISO_BUSCA_FALHOU, AVISO_BUSCA_OFFLINE } from '../../domain/ia';
import { parametrosDoTenant } from '../../domain/parametros';
import { podeVerPrecoEstoque } from '../../domain/visibilidade';
import { contagem } from '../lib/apresentacao';
import { buscarLocal, filtrosLocais, vitrineLocal } from '../lib/local';
import { irParaProduto } from '../rotas';
import { CartaoProduto } from './comum';

const POR_PAGINA = 20;
const ESPERA_DIGITACAO_MS = 350;

interface EstadoLista {
  carregando: boolean;
  itens: ItemVitrine[];
  total: number;
  aviso: string | null;
  origem: 'aparelho' | 'servidor';
}

export default function TelaCatalogo() {
  const params = useLocalSearchParams<{ cliente?: string; q?: string }>();
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
  const [linha, setLinha] = useState<string | null>(null);
  const [soComEstoque, setSoComEstoque] = useState(false);
  const [linhas, setLinhas] = useState<string[]>([]);
  const [lista, setLista] = useState<EstadoLista>({ carregando: true, itens: [], total: 0, aviso: null, origem: 'aparelho' });
  const auto = useAtualizacaoAutomatica({ tz: fuso });
  const agora = relogioReal().agora().toISOString();

  // espera o vendedor parar de digitar antes de buscar (economiza IA e bateria)
  useEffect(() => {
    const h = setTimeout(() => setConsulta(texto.trim()), ESPERA_DIGITACAO_MS);
    return () => clearTimeout(h);
  }, [texto]);

  useEffect(() => {
    if (!motor) return;
    void filtrosLocais(motor).then((f) => setLinhas(f.linhas));
  }, [motor, sync.sincronizado_em]);

  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    const entrada = { perfil, parametros: parametrosCrus, agora: relogioReal().agora().toISOString(), clienteId };
    const chips = { line: linha ?? undefined, only_in_stock: soComEstoque || undefined };
    const local = async (aviso: string | null) => {
      const r = consulta ? await buscarLocal(motor, { ...entrada, q: consulta, chips, limit: POR_PAGINA, offset: 0, offline: aviso === AVISO_BUSCA_OFFLINE }) : await vitrineLocal(motor, { ...entrada, chips, limit: POR_PAGINA, offset: 0 });
      return { itens: r.items, total: r.total, aviso: consulta ? aviso : null, origem: 'aparelho' as const };
    };
    const carregar = async () => {
      setLista((l) => ({ ...l, carregando: true }));
      let r: Omit<EstadoLista, 'carregando'>;
      if (!consulta) r = await local(null);
      else if (!ambiente.online()) r = await local(AVISO_BUSCA_OFFLINE);
      else {
        try {
          const api = await ambiente.http.get<RespostaBusca>(caminhoCatalogo('busca'), { q: consulta, customer_id: clienteId, line: linha, only_in_stock: soComEstoque || undefined, limit: POR_PAGINA });
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
  }, [motor, consulta, linha, soComEstoque, clienteId, perfil, parametrosCrus, ambiente, sync.sincronizado_em]);

  const subtitulo = useMemo(() => {
    if (!vePrecoEstoque) return 'Fichas e fotos dos produtos.';
    return clienteId ? 'Preços da tabela do cliente selecionado.' : 'Abra pela ficha do cliente para ver o preço da tabela dele.';
  }, [vePrecoEstoque, clienteId]);

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
          <Pressable accessibilityRole="button" accessibilityLabel="Limpar a busca" onPress={() => setTexto('')} style={s.limpar} hitSlop={8}>
            <Icon name="close" size={18} color={colors.ink2} />
          </Pressable>
        ) : null}
      </View>

      <View style={s.chips}>
        {vePrecoEstoque ? <Chip label="Com estoque" active={soComEstoque} onPress={() => setSoComEstoque((v) => !v)} testID="catalogo-chip-estoque" /> : null}
        {linhas.map((l) => (
          <Chip key={l} label={l} active={linha === l} onPress={() => setLinha((atual) => (atual === l ? null : l))} testID={`catalogo-chip-${l}`} />
        ))}
      </View>

      {lista.aviso ? (
        <Banner testID="catalogo-aviso" icon={lista.aviso === AVISO_BUSCA_OFFLINE ? 'wifiOff' : 'alert'}>
          {lista.aviso}
        </Banner>
      ) : null}

      {lista.carregando && lista.itens.length === 0 ? <ActivityIndicator color={colors.accent} style={{ paddingVertical: 20 }} /> : null}
      {!lista.carregando && lista.itens.length === 0 ? (
        <Empty text={consulta ? `Nada encontrado para "${consulta}". Tente outra palavra, o código ou tire um filtro.` : 'Nenhum produto neste aparelho ainda. Puxe a tela para sincronizar.'} />
      ) : null}

      {lista.itens.length > 0 ? (
        <Text style={s.contagem} testID="catalogo-contagem">
          {contagem(lista.total, 'produto', 'produtos')}
          {lista.total > lista.itens.length ? ` · mostrando ${lista.itens.length}` : ''}
        </Text>
      ) : null}
      {lista.itens.map((item) => (
        <CartaoProduto key={item.id} item={item} agora={agora} fuso={fuso} clienteId={clienteId} onPress={() => irParaProduto(item.id, clienteId)} />
      ))}
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  contagem: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2 },
});
