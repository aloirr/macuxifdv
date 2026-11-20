/**
 * Tela única de entrada (T-0172; spec docs/design/entrada-sync.md; proposta docs/marca/propostas/2026-11-12-entrada-sync):
 * o fundo e o logo da splash, parados no centro, e embaixo só a área que muda (barra, etapas, erro). Usada:
 * - na abertura do app (só o logo e o nome do app no rodapé), em `app/_layout.tsx`, no lugar da splash nativa;
 * - antes do login: "Atualizando o app" (passagem dos dados do aparelho) e "Conferindo o servidor";
 * - depois do login, na rota `/sync` (`components/tela-carga.tsx`): "Olá", a barra do total, as etapas e o erro; na carga,
 *   o bloco "Você sabia?" abaixo do "Olá" e o aviso acima da barra (T-0181, `cabeFrase`).
 * Cores do kit (`temaDaEntrada`, designer-ux); posição do logo e textos em `lib/entrada.ts`.
 * T-0182 (variação A, spec docs/design/telas/logo-cliente.md §3): na carga, com a logo da empresa guardada, o logo Macuxi reduz
 * e vai para a esquerda e a placa da logo entra ao lado, depois de um filete (240 ms; com "reduzir movimento", direto). Login,
 * telas de senha e abertura não recebem a logo.
 * MC-0088 (manual da marca §4): a linha "Etapa n de N · nome" e o percentual ficam sempre à vista sobre a barra.
 */
import type { EtapaEntrada } from '@macuxi/core/contracts';
import { BarraProgresso, Botao, fonte, Icon, PlacaLogoCliente, temaDaEntrada, useReduzirMovimento, type TemaEntrada } from '@macuxi/ui/mobile';
import { MEDIDAS_FRASE_CARGA } from '@macuxi/ui/mobile/puro';
import { StatusBar } from 'expo-status-bar';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCorDaFaixa, useFaixaSuperior } from '@/components/area-segura';
import {
  cabeFrase,
  cabeLista,
  ESPACO_FILETE,
  FILETE_ENTRADA,
  LARGURA_LOGO_COM_CLIENTE,
  LARGURA_LOGO_ENTRADA,
  linhaComLogoDoCliente,
  MARGEM_ENTRADA,
  posicaoDoLogo,
  ROTULO_BARRA_ENTRADA,
  type LinhasNaTela,
} from '@/lib/entrada';
import { LOGO_EMPILHADO_NEGATIVO, LOGO_EMPILHADO_POSITIVO, PROPORCAO_LOGO_EMPILHADO, svgParaDesenho } from '@/lib/logo-marca';
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
  /**
   * Carga (T-0181): o bloco "Você sabia?" abaixo do "Olá". Entra com 2 linhas, 1 linha ou não entra, pela altura da tela
   * (`cabeFrase`); a lista de etapas sai antes dele.
   */
  frase?: { texto: string; desenhar: (linhas: LinhasNaTela) => ReactNode } | null;
  /** Carga (T-0181): o aviso, acima da linha da barra (só com a barra na tela). */
  aviso?: ReactNode;
  /** T-0182: logo da empresa guardada no aparelho (só a carga depois do login a passa). */
  logoCliente?: LogoClienteEntrada | null;
}

/** Cópia da logo da empresa no aparelho: `file://`, largura ÷ altura guardadas e o nome para o leitor de tela. */
interface LogoClienteEntrada {
  uri: string;
  proporcao: number;
  nome: string | null;
  /** Item 15 (v1.0.17): a empresa oculta a logomarca do Macuxi; a placa entra sozinha no lugar do logo da splash. */
  soCliente?: boolean;
}

/** Duração do esmaecer da área de baixo (spec §6; a da barra é a do kit). */
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
  frase,
  aviso,
  logoCliente,
}: Props) {
  const tema = temaDaEntrada(variante);
  const insets = useSafeAreaInsets();
  const { fontScale: escala } = useWindowDimensions();
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
  const comAviso = Boolean(barra && aviso);
  // T-0181: o bloco "Você sabia?" só depois de medir a tela (prioridade: logo, "Olá", aviso e barra; spec §1.1)
  const linhasFrase = frase && saudacao && desenhou ? cabeFrase(janela, insets.bottom, frase.texto, escala) : 0;
  // antes de medir a tela, a lista entra (o logo ainda não aparece): na tela baixa ela sai assim que a altura chega
  const mostrarEtapas = Boolean(
    etapas &&
    etapas.length > 0 &&
    (altura === 0 ||
      cabeLista(janela, etapas.length, insets.bottom, Boolean(saudacao), Boolean(children), {
        aviso: comAviso,
        linhasFrase,
        escala,
      })),
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
        <LogosDaEntrada tema={tema} alturaSplash={logo.altura} cliente={logoCliente ?? null} reduzir={reduzir} />
        {saudacao ? (
          <Text testID="entrada-saudacao" style={[styles.saudacao, { color: tema.textoClaro }]}>
            {saudacao}
          </Text>
        ) : null}
        {frase && linhasFrase !== 0 ? <Fragment key={linhasFrase}>{frase.desenhar(linhasFrase)}</Fragment> : null}
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
            {/* RD-0635: a barra do kit (a mesma do popup da sincronização completa); o rótulo ("Etapa n de N · nome")
                fica sempre à vista, também com a lista, como na entrada aprovada (MC-0088, manual da marca §4). T-0181: o
                aviso da carga acima da barra */}
            {barra ? (
              <View style={styles.avisoEBarra}>
                {comAviso ? aviso : null}
                <BarraProgresso
                  rotulo={barra.rotulo}
                  pct={barra.pct}
                  cores={tema}
                  reduzirMovimento={reduzir}
                  rotuloAcessivel={ROTULO_BARRA_ENTRADA}
                  testID="entrada"
                />
              </View>
            ) : null}
            {mostrarEtapas && etapas ? <ListaEtapas tema={tema} etapas={etapas} /> : null}
            {typeof children === 'function' ? children(mostrarEtapas) : children}
          </Animated.View>
        )}
      </View>
    </View>
  );
}

function LogoMacuxi({ tema, largura, altura }: { tema: TemaEntrada; largura: number; altura: number }) {
  return (
    <View accessible accessibilityRole="image" accessibilityLabel="Macuxi Força de Vendas">
      <SvgXml xml={svgParaDesenho(tema.logo === 'negativo' ? LOGO_EMPILHADO_NEGATIVO : LOGO_EMPILHADO_POSITIVO)} width={largura} height={altura} />
    </View>
  );
}

/**
 * O logo Macuxi no lugar da splash; com a logo da empresa (T-0182, variação A), a linha Macuxi · filete · placa, na mesma altura
 * do logo da splash (o centro do Macuxi não sobe nem desce na passagem). Com a logomarca do Macuxi oculta (item 15), só a placa.
 */
function LogosDaEntrada({
  tema,
  alturaSplash,
  cliente,
  reduzir,
}: {
  tema: TemaEntrada;
  alturaSplash: number;
  cliente: LogoClienteEntrada | null;
  reduzir: boolean;
}) {
  const entrada = useEntradaDoCliente(cliente !== null, reduzir);
  if (!cliente) return <LogoMacuxi tema={tema} largura={LARGURA_LOGO_ENTRADA} altura={alturaSplash} />;
  if (cliente.soCliente) {
    return (
      <Animated.View testID="entrada-so-logo-cliente" style={[styles.linhaLogos, { height: alturaSplash, opacity: entrada }]}>
        <PlacaDoCliente tema={tema} cliente={cliente} />
      </Animated.View>
    );
  }
  const linha = linhaComLogoDoCliente(cliente.proporcao);
  return (
    <View testID="entrada-com-logo-cliente" style={[styles.linhaLogos, { height: alturaSplash }]}>
      <Animated.View
        style={{
          transform: [
            { translateX: entrada.interpolate({ inputRange: [0, 1], outputRange: [linha.deslocamentoInicial, 0] }) },
            { scale: entrada.interpolate({ inputRange: [0, 1], outputRange: [linha.escalaInicial, 1] }) },
          ],
        }}
      >
        <LogoMacuxi
          tema={tema}
          largura={LARGURA_LOGO_COM_CLIENTE}
          altura={Math.round(LARGURA_LOGO_COM_CLIENTE / PROPORCAO_LOGO_EMPILHADO)}
        />
      </Animated.View>
      <Animated.View style={[styles.linhaLogos, { opacity: entrada }]}>
        <View style={[styles.filete, { backgroundColor: tema.trilho }]} />
        <PlacaDoCliente tema={tema} cliente={cliente} />
      </Animated.View>
    </View>
  );
}

function PlacaDoCliente({ tema, cliente }: { tema: TemaEntrada; cliente: LogoClienteEntrada }) {
  return (
    <PlacaLogoCliente
      testID="entrada-logo-cliente"
      fonte={cliente.uri}
      tamanho="carga"
      // a placa branca ganha borda só sobre o Pérola (Gestão); no Azul noite (Campo), sem borda
      borda={tema.logo !== 'negativo'}
      nomeEmpresa={cliente.nome}
      proporcao={cliente.proporcao}
    />
  );
}

/** Passagem da splash para a linha com a logo da empresa: 0 → 1 em 240 ms; com "reduzir movimento", direto. */
function useEntradaDoCliente(comLogo: boolean, reduzir: boolean): Animated.Value {
  const valor = useRef(new Animated.Value(comLogo && reduzir ? 1 : 0)).current;
  useEffect(() => {
    if (!comLogo || reduzir) {
      valor.setValue(comLogo ? 1 : 0);
      return;
    }
    Animated.timing(valor, { toValue: 1, duration: DURACAO_MS, useNativeDriver: true }).start();
  }, [comLogo, reduzir, valor]);
  return valor;
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

/**
 * Linha do erro: ícone e texto na cor de erro da entrada; região viva assertiva (spec §6). `tema` explícito: o popup da
 * sincronização completa (sempre no Pérola, R-20261115-100000).
 */
export function ErroEntrada({ variante, tema: temaFixo, texto }: { variante: Variante; tema?: TemaEntrada; texto: string }) {
  const tema = temaFixo ?? temaDaEntrada(variante);
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
  avisoEBarra: { gap: MEDIDAS_FRASE_CARGA.aviso.acimaDaBarra },
  linhaLogos: { flexDirection: 'row', alignItems: 'center' },
  filete: { width: FILETE_ENTRADA.largura, height: FILETE_ENTRADA.altura, marginHorizontal: ESPACO_FILETE },
  baixo: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: MARGEM_ENTRADA },
  nomeDoApp: { ...fonte.body, fontSize: 14, textAlign: 'center' },
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
