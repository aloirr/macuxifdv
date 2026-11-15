/**
 * Tela única de entrada (T-0172; spec docs/design/entrada-sync.md; proposta docs/marca/propostas/2026-11-12-entrada-sync):
 * o fundo e o logo da splash, parados no centro, e embaixo só a área que muda (barra, etapas, erro). Usada:
 * - na abertura do app (só o logo e o nome do app no rodapé), em `app/_layout.tsx`, no lugar da splash nativa;
 * - antes do login: "Atualizando o app" (passagem dos dados do aparelho) e "Conferindo o servidor";
 * - depois do login, na rota `/sync` (`components/tela-carga.tsx`): "Olá", a barra do total, as etapas e o erro.
 * Cores do kit (`temaDaEntrada`, designer-ux); posição do logo e textos em `lib/entrada.ts`.
 */
import type { EtapaEntrada } from '@macuxi/core/contracts';
import { Botao, fonte, Icon, temaDaEntrada, useReduzirMovimento, type TemaEntrada } from '@macuxi/ui/mobile';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCorDaFaixa, useFaixaSuperior } from '@/components/area-segura';
import {
  cabeLista,
  LARGURA_LOGO_ENTRADA,
  MARGEM_ENTRADA,
  posicaoDoLogo,
  ROTULO_BARRA_ENTRADA,
} from '@/lib/entrada';
import { LOGO_EMPILHADO_NEGATIVO, LOGO_EMPILHADO_POSITIVO, svgParaDesenho } from '@/lib/logo-marca';
import type { Variante } from '@/lib/variante-tipo';

export interface BarraEntrada {
  rotulo: string;
  /** `null` = sem medida (conferir o servidor): sem número e com um trecho fixo da barra. */
  pct: number | null;
}

interface Props {
  variante: Variante;
  testID?: string;
  /** Por cima de tudo (abertura e "Atualizando o app", fora do roteador); sem ela, ocupa a tela da rota. */
  sobreposta?: boolean;
  /** "Olá, Lucas" (só depois do login). */
  saudacao?: string | null;
  barra?: BarraEntrada | null;
  etapas?: readonly EtapaEntrada[] | null;
  /**
   * Erro e ações (no lugar da barra; a lista continua, com a etapa que parou marcada). Como função, recebe se a lista está
   * na tela (RD-0239: com a lista, o erro não repete o número da etapa).
   */
  children?: ReactNode | ((comLista: boolean) => ReactNode);
  /** O logo já foi desenhado (a abertura esconde a splash nativa aqui, sem piscar). */
  aoDesenhar?: () => void;
  /** Nome do app no rodapé, só com a área de baixo vazia (abertura). */
  nomeDoApp?: string;
}

/** Duração do esmaecer da área de baixo e da largura da barra (spec §6). */
const DURACAO_MS = 240;

export function TelaEntrada({
  variante,
  testID = 'tela-entrada',
  sobreposta,
  saudacao,
  barra,
  etapas,
  children,
  aoDesenhar,
  nomeDoApp,
}: Props) {
  const tema = temaDaEntrada(variante);
  const insets = useSafeAreaInsets();
  const reduzir = useReduzirMovimento();
  // dentro do roteador, a faixa da barra de status é do shell (AreaSeguraSuperior): ela ganha o fundo da entrada e o logo
  // conta com ela, para ficar no centro da janela, onde a splash o desenha
  const faixaDoShell = useFaixaSuperior();
  const faixa = sobreposta ? 0 : faixaDoShell;
  useCorDaFaixa(sobreposta ? null : tema.fundo);
  const [altura, setAltura] = useState(0);
  const janela = altura + faixa;
  const desenhou = altura > 0;
  useEffect(() => {
    if (desenhou) aoDesenhar?.();
  }, [desenhou, aoDesenhar]);
  const logo = posicaoDoLogo(janela);
  // antes de medir a tela, a lista entra (o logo ainda não aparece): na tela baixa ela sai assim que a altura chega
  const mostrarEtapas = Boolean(
    etapas &&
    etapas.length > 0 &&
    (altura === 0 || cabeLista(janela, etapas.length, insets.bottom, Boolean(saudacao), Boolean(children))),
  );
  const vazia = !barra && !mostrarEtapas && !children;
  const opacidade = useEsmaecer(!vazia, reduzir);
  return (
    <View
      testID={testID}
      style={[styles.raiz, { backgroundColor: tema.fundo }, sobreposta ? StyleSheet.absoluteFill : null]}
      onLayout={(e) => setAltura(e.nativeEvent.layout.height)}
      accessibilityViewIsModal={sobreposta}
    >
      <StatusBar style={tema.barraDeStatus} />
      {/* invisível até medir a tela: o logo só aparece no lugar da splash */}
      <View style={[styles.logo, { top: logo.topo - faixa, opacity: desenhou ? 1 : 0 }]}>
        <View accessible accessibilityRole="image" accessibilityLabel="Macuxi Força de Vendas">
          <SvgXml
            xml={svgParaDesenho(tema.logo === 'negativo' ? LOGO_EMPILHADO_NEGATIVO : LOGO_EMPILHADO_POSITIVO)}
            width={LARGURA_LOGO_ENTRADA}
            height={logo.altura}
          />
        </View>
        {saudacao ? (
          <Text testID="entrada-saudacao" style={[styles.saudacao, { color: tema.textoClaro }]}>
            {saudacao}
          </Text>
        ) : null}
      </View>
      <View style={[styles.baixo, { paddingBottom: MARGEM_ENTRADA + insets.bottom }]}>
        {vazia ? (
          nomeDoApp ? (
            <Text testID="entrada-nome-do-app" style={[styles.nomeDoApp, { color: tema.textoClaro }]}>
              {nomeDoApp}
            </Text>
          ) : null
        ) : (
          <Animated.View style={{ gap: 18, opacity: opacidade }}>
            {barra ? <Barra tema={tema} barra={barra} reduzir={reduzir} comLista={mostrarEtapas} /> : null}
            {mostrarEtapas && etapas ? <ListaEtapas tema={tema} etapas={etapas} /> : null}
            {typeof children === 'function' ? children(mostrarEtapas) : children}
          </Animated.View>
        )}
      </View>
    </View>
  );
}

/** A área de baixo aparece com esmaecer de 240 ms; com "reduzir movimento", na hora. */
function useEsmaecer(visivel: boolean, reduzir: boolean): Animated.Value {
  const opacidade = useRef(new Animated.Value(visivel ? 1 : 0)).current;
  useEffect(() => {
    if (reduzir || !visivel) {
      opacidade.setValue(visivel ? 1 : 0);
      return;
    }
    Animated.timing(opacidade, { toValue: 1, duration: DURACAO_MS, useNativeDriver: true }).start();
  }, [visivel, reduzir, opacidade]);
  return opacidade;
}

/**
 * Barra do total. Com a lista de etapas na tela, a linha mostra só o percentual e o rótulo ("Etapa n de N · nome") fica só
 * para o leitor de tela, na região viva (RD-0239); sem a lista (tela baixa), o rótulo aparece.
 */
function Barra({
  tema,
  barra,
  reduzir,
  comLista,
}: {
  tema: TemaEntrada;
  barra: BarraEntrada;
  reduzir: boolean;
  comLista: boolean;
}) {
  const pct = barra.pct === null ? null : Math.max(0, Math.min(100, barra.pct));
  const largura = pct ?? TRECHO_SEM_MEDIDA;
  const anim = useRef(new Animated.Value(largura)).current;
  useEffect(() => {
    if (reduzir) anim.setValue(largura);
    else Animated.timing(anim, { toValue: largura, duration: DURACAO_MS, useNativeDriver: false }).start();
  }, [largura, reduzir, anim]);
  return (
    <View style={{ gap: 8 }}>
      <View style={styles.linha}>
        {/* o leitor anuncia só a troca de etapa (o percentual não é lido a cada passo) */}
        <Text
          testID="entrada-etapa"
          style={[styles.rotulo, { color: tema.texto }]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={barra.rotulo}
          numberOfLines={1}
        >
          {comLista ? '' : barra.rotulo}
        </Text>
        {pct === null ? null : (
          <Text
            testID="entrada-pct"
            style={[styles.pct, { color: tema.texto }]}
            importantForAccessibility="no"
            accessibilityElementsHidden
          >
            {pct}%
          </Text>
        )}
      </View>
      <View
        style={[styles.trilho, { backgroundColor: tema.trilho }]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={ROTULO_BARRA_ENTRADA}
        accessibilityValue={pct === null ? undefined : { min: 0, max: 100, now: pct }}
      >
        <Animated.View
          style={[
            styles.preenchimento,
            {
              backgroundColor: tema.preenchimento,
              width: anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
            },
          ]}
        />
      </View>
    </View>
  );
}

/** Trecho da barra quando não há medida (o teste do servidor dura no máximo `TEMPO_SERVIDOR_ABERTURA_MS`). */
const TRECHO_SEM_MEDIDA = 30;

const ROTULO_SITUACAO: Record<EtapaEntrada['situacao'], string> = {
  feita: 'feita',
  atual: 'em andamento',
  pendente: 'falta',
  parou: 'parou',
};

function ListaEtapas({ tema, etapas }: { tema: TemaEntrada; etapas: readonly EtapaEntrada[] }) {
  return (
    <View testID="entrada-etapas">
      {etapas.map((e) => {
        const destaque = e.situacao === 'atual' || e.situacao === 'parou';
        return (
          <View
            key={e.id}
            style={styles.etapa}
            testID={`entrada-etapa-${e.numero}-${e.situacao}`}
            accessible
            accessibilityLabel={`${e.nome}, ${ROTULO_SITUACAO[e.situacao]}`}
          >
            <Marcador tema={tema} situacao={e.situacao} />
            <Text
              style={[
                styles.nomeEtapa,
                {
                  color: e.situacao === 'pendente' ? tema.textoClaro : tema.texto,
                  ...(destaque ? fonte.semibold : fonte.body),
                },
              ]}
            >
              {e.nome}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

function Marcador({ tema, situacao }: { tema: TemaEntrada; situacao: EtapaEntrada['situacao'] }) {
  if (situacao === 'feita')
    return (
      <View style={[styles.marcador, { backgroundColor: tema.feita, borderColor: tema.feita }]}>
        <Icon name="check" size={12} color={tema.fundo} strokeWidth={3} />
      </View>
    );
  if (situacao === 'parou')
    return (
      <View style={[styles.marcador, { backgroundColor: tema.erro, borderColor: tema.erro }]}>
        <Text style={[styles.exclamacao, { color: tema.fundo }]}>!</Text>
      </View>
    );
  if (situacao === 'pendente') return <View style={[styles.marcador, { borderColor: tema.trilho }]} />;
  return (
    <View style={[styles.marcador, { borderColor: tema.preenchimento }]}>
      <View style={[styles.ponto, { backgroundColor: tema.preenchimento }]} />
    </View>
  );
}

/** Linha do erro: ícone e texto na cor de erro da entrada; região viva assertiva (spec §6). */
export function ErroEntrada({ variante, texto }: { variante: Variante; texto: string }) {
  const tema = temaDaEntrada(variante);
  return (
    <View style={styles.erro} testID="entrada-erro" accessibilityLiveRegion="assertive">
      <Icon name="alert" size={16} color={tema.erro} />
      <Text style={[styles.textoErro, { color: tema.erro }]}>{texto}</Text>
    </View>
  );
}

/** Ações da entrada: principal e secundário pelo `Botao` do kit (sobre o escuro no Campo) e o link "Trocar usuário". */
export function AcaoEntrada({
  variante,
  rotulo,
  onPress,
  tipo,
  testID,
}: {
  variante: Variante;
  rotulo: string;
  onPress: () => void;
  tipo: 'principal' | 'secundario' | 'link';
  testID: string;
}) {
  const tema = temaDaEntrada(variante);
  if (tipo !== 'link')
    return (
      <Botao
        testID={testID}
        rotulo={rotulo}
        nivel={tipo}
        alto
        sobreEscuro={tema.logo === 'negativo'}
        onPress={onPress}
      />
    );
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.link, pressed ? { opacity: 0.7 } : null]}
    >
      <Text style={[styles.textoLink, { color: tema.textoClaro }]}>{rotulo}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  raiz: { flex: 1 },
  logo: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  saudacao: { ...fonte.body, fontSize: 16, marginTop: 28, textAlign: 'center' },
  baixo: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: MARGEM_ENTRADA },
  nomeDoApp: { ...fonte.body, fontSize: 14, textAlign: 'center' },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  rotulo: { flex: 1, ...fonte.body, fontSize: 14 },
  pct: { ...fonte.bold, fontSize: 14, fontVariant: ['tabular-nums'] },
  trilho: { height: 6, borderRadius: 3, overflow: 'hidden' },
  preenchimento: { height: 6, borderRadius: 3 },
  etapa: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 32 },
  marcador: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ponto: { width: 8, height: 8, borderRadius: 4 },
  exclamacao: { ...fonte.bold, fontSize: 14, lineHeight: 16 },
  nomeEtapa: { fontSize: 14 },
  erro: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  textoErro: { ...fonte.semibold, fontSize: 14 },
  link: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  textoLink: { ...fonte.semibold, fontSize: 14 },
});
