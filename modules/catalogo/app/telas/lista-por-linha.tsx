/**
 * Lista por linha (RF-CAT-09, T-0085 fatia D): sistema › grupo › linha na aba Catálogo. OFFLINE-FIRST: tudo do aparelho
 * (`lib/lista-por-linha-local.ts`). A Trilha do kit (`atualTocavel`) leva de volta a qualquer nível; no nível que tem
 * produtos, cada item traz código, medida e embalagem, descrição, aplicação (2 linhas), "Equivale a", oferece junto,
 * etiquetas, foto e, para quem vê (RN-CAT-05), preço e estoque do cliente em contexto (`?cliente=`, RN-CAT-06). Tocar no
 * item abre a ficha. Tela só de consulta: sem botão principal e sem o slot `produto.acoes` (o promotor nunca vê ação de
 * pedido, regra 7; o "Adicionar ao pedido" do Vendedor fica na ficha e na vitrine).
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { useAmbiente, useMotorSync, useParametros } from '@macuxi/platform-sdk/react';
import { BackLink, Badge, Card, colors, DEFAULT_TZ, Empty, EstadoVazio, fonts, Icon, Screen, SyncStamp, type as t, Trilha, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { contagem } from '../lib/apresentacao';
import type { ItemLista } from '../lib/lista-por-linha';
import { listaPorLinhaLocal, MAXIMO_ITENS_LISTA, type NivelLista } from '../lib/lista-por-linha-local';
import { hrefCatalogo, irParaProduto } from '../rotas';

const RAIZ = 'raiz';
const ALVO = 48;

export default function TelaListaPorLinha() {
  const params = useLocalSearchParams<{ cliente?: string; no?: string }>();
  const clienteId = params.cliente ? String(params.cliente) : null;
  const ambiente = useAmbiente();
  const { motor, estado: sync } = useMotorSync();
  const parametros = useParametros('catalogo');
  const usuario = ambiente.usuario();
  const perfil = usuario?.perfil ?? null;
  const fuso = usuario?.fuso ?? DEFAULT_TZ;
  const [noId, setNoId] = useState<string | null>(params.no ? String(params.no) : null);
  const [nivel, setNivel] = useState<NivelLista | null>(null);
  const [falhou, setFalhou] = useState(false);
  const auto = useAtualizacaoAutomatica({ tz: fuso });

  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    setFalhou(false);
    void listaPorLinhaLocal(motor, { perfil, parametros, agora: relogioReal().agora().toISOString(), clienteId, noId, fuso })
      .then((r) => vivo && setNivel(r))
      .catch(() => vivo && setFalhou(true));
    return () => {
      vivo = false;
    };
  }, [motor, noId, clienteId, perfil, parametros, fuso, sync.sincronizado_em]);

  const itensTrilha = useMemo(() => {
    const nos = nivel?.trilha ?? [];
    return [{ id: RAIZ, rotulo: 'Por linha', testID: 'lista-linha-trilha-inicio' }, ...nos.map((n) => ({ id: n.id, rotulo: n.nome, testID: `lista-linha-trilha-${n.codigo}` }))];
  }, [nivel]);

  const topo = (
    <>
      <BackLink label="Catálogo" fallback={hrefCatalogo(clienteId)} />
      <View style={s.topo}>
        <View style={{ flex: 1 }}>
          <Text style={t.h1}>Catálogo por linha</Text>
          <Text style={t.sub}>{nivel?.rotuloNivel ? `${nivel.rotuloNivel} · ${contagem(nivel.total, 'produto', 'produtos')}` : 'Sistema › grupo › linha'}</Text>
        </View>
        <SyncStamp at={sync.sincronizado_em} offline={!ambiente.online()} tz={fuso} />
      </View>
    </>
  );

  if (!motor) {
    return (
      <Screen testID="pagina-catalogo-lista-por-linha">
        {topo}
        <Empty text="O catálogo aparece depois da primeira sincronização. Entre com o seu usuário e sincronize o aparelho." />
      </Screen>
    );
  }

  return (
    <Screen testID="pagina-catalogo-lista-por-linha" refreshing={auto.puxando} onRefresh={auto.puxar}>
      {topo}
      <Trilha itens={itensTrilha} atualTocavel onEscolher={(id) => setNoId(id === RAIZ ? null : id)} testID="lista-linha-trilha" />

      {falhou ? <Empty text="Não foi possível abrir a lista agora. Puxe a tela para tentar de novo." /> : null}
      {!nivel && !falhou ? <ActivityIndicator color={colors.accent} style={{ paddingVertical: 20 }} /> : null}

      {nivel && nivel.filhos.length > 0 ? (
        <View style={s.niveis} testID="lista-linha-niveis">
          {nivel.filhos.map((f) => (
            <Pressable
              key={f.id}
              accessibilityRole="button"
              accessibilityLabel={`${f.rotuloNivel} ${f.nome}, ${contagem(f.total, 'produto', 'produtos')}`}
              onPress={() => setNoId(f.id)}
              style={({ pressed }) => [s.no, pressed && { opacity: 0.7 }]}
              testID={`lista-linha-no-${f.codigo}`}>
              <View style={{ flex: 1 }}>
                <Text style={s.nome} numberOfLines={2}>
                  {f.nome}
                </Text>
                <Text style={t.small}>{f.rotuloNivel}</Text>
              </View>
              <Text style={s.contagem}>{f.total}</Text>
              <Icon name="chevron" size={16} color={colors.ink3} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {nivel && nivel.itens.length > 0 ? (
        <Text style={s.contagem} testID="lista-linha-contagem">
          {contagem(nivel.total, 'produto', 'produtos')}
          {nivel.total > nivel.itens.length ? ` · mostrando ${MAXIMO_ITENS_LISTA}` : ''}
        </Text>
      ) : null}
      {nivel?.itens.map((item) => <ItemDaLista key={item.id} item={item} onPress={() => irParaProduto(item.id, clienteId)} onAbrirJunto={(id) => irParaProduto(id, clienteId)} />)}

      {nivel?.vazio ? (
        <EstadoVazio
          testID="lista-linha-vazio"
          icone="search"
          titulo={nivel.noInexistente ? 'Este nível não está mais no catálogo' : 'Nenhum produto neste nível'}
          texto={nivel.trilha.length > 0 ? 'Volte um nível ou sincronize o aparelho para atualizar o catálogo.' : 'Puxe a tela para sincronizar o catálogo deste aparelho.'}
          acao={nivel.trilha.length > 0 ? { rotulo: 'Voltar um nível', onPress: () => setNoId(nivel.trilha.length > 1 ? nivel.trilha[nivel.trilha.length - 2]!.id : null), testID: 'lista-linha-vazio-acao' } : undefined}
        />
      ) : null}
      <Text style={t.small} testID="lista-linha-rodape-atualizacao">
        {auto.rodape}
      </Text>
    </Screen>
  );
}

function ItemDaLista({ item, onPress, onAbrirJunto }: { item: ItemLista; onPress: () => void; onAbrirJunto: (id: string) => void }) {
  return (
    <Card testID={`lista-linha-item-${item.codigo}`} style={s.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Abrir ${item.descricao}`} onPress={onPress} style={({ pressed }) => [s.toque, pressed && { opacity: 0.7 }]}>
        <View style={s.linha}>
          {item.fotoUrl ? <Image source={{ uri: item.fotoUrl }} accessibilityLabel={`Foto de ${item.descricao}`} style={s.foto} testID={`lista-linha-foto-${item.codigo}`} /> : <View style={s.foto} />}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={s.codigo}>{[item.codigo, item.medidaEmbalagem].filter(Boolean).join(' · ')}</Text>
            <Text style={[t.title16]} numberOfLines={2}>
              {item.descricao}
            </Text>
          </View>
        </View>
        {item.aplicacao ? (
          <Text style={t.small} numberOfLines={2} testID={`lista-linha-aplicacao-${item.codigo}`}>
            {item.aplicacao}
          </Text>
        ) : null}
        {item.equivale ? (
          <Text style={s.equivale} numberOfLines={2} testID={`lista-linha-equivale-${item.codigo}`}>
            {item.equivale}
          </Text>
        ) : null}
        {item.etiquetas.length > 0 ? (
          <View style={s.linha}>
            {item.etiquetas.map((e) => (
              <Badge key={e} label={e} tone="neutral" />
            ))}
          </View>
        ) : null}
        {item.preco ? (
          <View style={s.linha}>
            <Text style={item.preco.vendavel ? s.preco : s.semPreco} testID={`lista-linha-preco-${item.codigo}`}>
              {item.preco.texto}
            </Text>
            {item.preco.riscado ? <Text style={s.riscado}>{item.preco.riscado}</Text> : null}
          </View>
        ) : null}
        {item.estoque ? (
          <View style={s.linha}>
            <Badge label={item.estoque.texto} tone={item.estoque.tom} />
            <Text style={[t.small, item.estoque.desatualizado && { color: colors.warning }]}>{item.estoque.detalhe}</Text>
          </View>
        ) : null}
      </Pressable>
      {item.ofereceJunto.length > 0 ? (
        <View style={s.junto} testID={`lista-linha-junto-${item.codigo}`}>
          <Text style={t.small}>Oferece junto:</Text>
          {item.ofereceJunto.map((o) => (
            <Pressable key={o.id} accessibilityRole="link" accessibilityLabel={`Abrir ${o.rotulo}`} onPress={() => onAbrirJunto(o.id)} style={s.juntoItem}>
              <Text style={s.juntoTexto} numberOfLines={1}>
                {o.rotulo}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const s = StyleSheet.create({
  topo: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  niveis: { gap: 8 },
  no: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: ALVO, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 12 },
  nome: { fontFamily: fonts.medium, fontSize: 15, color: colors.ink },
  contagem: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2 },
  card: { padding: 14, gap: 8 },
  toque: { gap: 6, minHeight: ALVO },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  foto: { width: 56, height: 56, borderRadius: 8, backgroundColor: colors.lineSoft },
  codigo: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2 },
  equivale: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink },
  preco: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
  semPreco: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },
  riscado: { fontFamily: fonts.body, fontSize: 13, color: colors.ink3, textDecorationLine: 'line-through' },
  junto: { gap: 2 },
  juntoItem: { minHeight: ALVO, justifyContent: 'center' },
  juntoTexto: { fontFamily: fonts.medium, fontSize: 14, color: colors.accentInk },
});
