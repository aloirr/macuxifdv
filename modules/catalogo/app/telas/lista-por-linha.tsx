/**
 * Lista por linha (RF-CAT-09, T-0085 fatia D): sistema › grupo › linha na aba Catálogo. OFFLINE-FIRST: tudo do aparelho
 * (`lib/lista-por-linha-local.ts`). A Trilha do kit (escondida na raiz; "onde você está", sem `atualTocavel`: o atual não é tocável) leva de volta aos níveis anteriores; no nível que tem
 * produtos, cada item traz código, medida e embalagem, descrição, aplicação (2 linhas), "Equivale a", oferece junto,
 * etiquetas e, para quem vê (RN-CAT-05), preço e estoque do cliente em contexto (`?cliente=`, RN-CAT-06). Tocar no
 * item abre a ficha. Tela só de consulta: sem botão principal e sem o slot `produto.acoes` (o promotor nunca vê ação de
 * pedido, regra 7; o "Adicionar ao pedido" do Vendedor fica na ficha e na vitrine). Sem foto: ela entra quando o contrato do
 * pull tiver miniatura (pedido para depois do piloto, sob demanda, fora do pacote offline obrigatório).
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { useAmbiente, useMotorSync, useParametros } from '@macuxi/platform-sdk/react';
import { BackLink, Badge, Botao, Card, colors, DEFAULT_TZ, Empty, EstadoVazio, fonts, Icon, Screen, SyncStamp, type as t, Trilha, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, findNodeHandle, Pressable, StyleSheet, Text, View } from 'react-native';
import { contagem } from '../lib/apresentacao';
import { acaoDoVazio, anuncioMaisItens, pedirMaisItens, textosMostrarMais, type ItemLista } from '../lib/lista-por-linha';
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
  const [noId, setNoIdBruto] = useState<string | null>(params.no ? String(params.no) : null);
  const [limite, setLimite] = useState(MAXIMO_ITENS_LISTA); // "Mostrar mais" soma 100; ao trocar de nível volta a 100
  const [nivel, setNivel] = useState<NivelLista | null>(null);
  const [falhou, setFalhou] = useState(false);
  const auto = useAtualizacaoAutomatica({ tz: fuso });
  const [carregando, setCarregando] = useState(false);
  const [inicioLote, setInicioLote] = useState<number | null>(null);
  const pendente = useRef<{ antes: number } | null>(null); // lote pedido e ainda não chegado (2º toque é ignorado)
  const proximoItem = useRef<View>(null); // 1º item do lote novo: recebe o foco do leitor de tela quando o botão some
  const setNoId = (id: string | null) => {
    pendente.current = null;
    setCarregando(false);
    setInicioLote(null);
    setLimite(MAXIMO_ITENS_LISTA);
    setNoIdBruto(id);
  };
  const ultimaTrilha = useRef<string[]>([]); // trilha do último nível que existia: se ele sumir no sync, a volta usa isto

  useEffect(() => {
    if (!motor) return;
    let vivo = true;
    setFalhou(false);
    void listaPorLinhaLocal(motor, { perfil, parametros, agora: relogioReal().agora().toISOString(), clienteId, noId, fuso, ultimaTrilha: ultimaTrilha.current, limite })
      .then((r) => {
        if (!vivo) return;
        if (!r.noInexistente && r.trilha.length > 0) ultimaTrilha.current = r.trilha.map((n) => n.id);
        setNivel(r);
        const p = pendente.current;
        if (p) {
          pendente.current = null;
          setCarregando(false);
          setInicioLote(p.antes);
          const anuncio = anuncioMaisItens(p.antes, r.itens.length);
          if (anuncio) AccessibilityInfo.announceForAccessibility(anuncio);
          if (r.restantes === 0) {
            // o botão sumiu: o foco vai para o 1º item novo (ou fica onde está se não houver)
            setTimeout(() => {
              const alvo = proximoItem.current ? findNodeHandle(proximoItem.current) : null;
              if (alvo) AccessibilityInfo.setAccessibilityFocus(alvo);
            }, 0);
          }
        }
      })
      .catch(() => {
        pendente.current = null;
        setCarregando(false);
        if (vivo) setFalhou(true);
      });
    return () => {
      vivo = false;
    };
  }, [motor, noId, limite, clienteId, perfil, parametros, fuso, sync.sincronizado_em]);

  const itensTrilha = useMemo(() => {
    const nos = nivel?.trilha ?? [];
    return [{ id: RAIZ, rotulo: 'Sistemas', testID: 'lista-linha-trilha-inicio' }, ...nos.map((n) => ({ id: n.id, rotulo: n.nome, testID: `lista-linha-trilha-${n.codigo}` }))];
  }, [nivel]);

  const pedirMais = () => {
    if (!nivel) return;
    const p = pedirMaisItens({ limite, carregando: pendente.current !== null }, MAXIMO_ITENS_LISTA);
    if (p.limite === limite) return;
    pendente.current = { antes: nivel.itens.length };
    setCarregando(true);
    setLimite(p.limite);
  };

  const naRaiz = (nivel?.trilha.length ?? 0) === 0; // a trilha só aparece a partir do primeiro nível abaixo da raiz
  const raizVazia = !!nivel && nivel.vazio && naRaiz && !nivel.noInexistente;

  const acaoVazio = nivel ? acaoDoVazio(nivel) : null;

  const topo = (
    <>
      <BackLink label="Catálogo" fallback={hrefCatalogo(clienteId)} />
      <View style={s.topo}>
        <View style={{ flex: 1 }}>
          <Text style={t.h1}>Por linha</Text>
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
      {naRaiz ? null : <Trilha itens={itensTrilha} onEscolher={(id) => setNoId(id === RAIZ ? null : id)} testID="lista-linha-trilha" />}

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
          {nivel.restantes > 0 ? ` · mostrando ${nivel.itens.length}` : ''}
        </Text>
      ) : null}
      {nivel?.itens.map((item, i) => {
        const cartao = <ItemDaLista key={item.id} item={item} onPress={() => irParaProduto(item.id, clienteId)} onAbrirJunto={(id) => irParaProduto(id, clienteId)} />;
        return i === inicioLote ? (
          <View key={item.id} ref={proximoItem} accessible={false}>
            {cartao}
          </View>
        ) : (
          cartao
        );
      })}

      {nivel && nivel.restantes > 0 ? (
        <Botao
          testID="lista-linha-mostrar-mais"
          rotulo={textosMostrarMais(nivel.restantes).rotulo}
          rotuloAcessivel={textosMostrarMais(nivel.restantes).rotuloAcessivel}
          ocupado={carregando}
          onPress={pedirMais}
        />
      ) : null}

      {nivel?.vazio ? (
        <EstadoVazio
          testID="lista-linha-vazio"
          icone="search"
          titulo={raizVazia ? 'Nenhum produto neste aparelho ainda' : nivel.noInexistente ? 'Este nível não está mais no catálogo' : 'Nenhum produto neste nível'}
          texto={raizVazia ? 'Puxe a tela para sincronizar o catálogo.' : 'Volte um nível ou sincronize o aparelho para atualizar o catálogo.'}
          acao={acaoVazio ? { rotulo: acaoVazio.rotulo, onPress: () => setNoId(acaoVazio.noId), testID: 'lista-linha-vazio-acao' } : undefined}
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
        <View style={{ gap: 4 }}>
          <Text style={s.codigo}>{[item.codigo, item.medidaEmbalagem].filter(Boolean).join(' · ')}</Text>
          <Text style={[t.title16]} numberOfLines={2}>
            {item.descricao}
          </Text>
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
  codigo: { fontFamily: fonts.medium, fontSize: 12, color: colors.ink2 },
  equivale: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink },
  preco: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
  semPreco: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },
  riscado: { fontFamily: fonts.body, fontSize: 13, color: colors.ink3, textDecorationLine: 'line-through' },
  junto: { gap: 2 },
  juntoItem: { minHeight: ALVO, justifyContent: 'center' },
  juntoTexto: { fontFamily: fonts.medium, fontSize: 14, color: colors.accentInk },
});
