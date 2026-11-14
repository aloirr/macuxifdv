/**
 * Lista suspensa e campo de ajuste do Novo pedido (T-0089, fatia U1; referência
 * docs/produto/referencias/R-20261106-0703-alexandre-novo-pedido-itens-v2.png; spec docs/design/novo-pedido-itens.md):
 * - `ListaSuspensa`: campo com rótulo em cima ("FORMA DE PAGAMENTO", "PRAZO") e menu ancorado logo abaixo (ou acima, sem
 *   espaço). A opção desabilitada aparece apagada, com cadeado e sem toque, e mostra o motivo numa linha secundária abaixo do
 *   rótulo (T-0129; 12/16 em `ink2`, AA sobre o fundo da opção); o leitor de tela lê o rótulo e o motivo. O rótulo continua só o
 *   valor (RN-VEN-25: "30/60/90 dias", com "Acima do prazo médio do cliente" embaixo). Com `falta` (T-0166, RD-0170;
 *   pedido-v4.md §6.1), borda `danger` 2 e o `TextoDaFalta` 4 dp embaixo, como no `CampoEscolha`;
 * - `CampoAjuste`: desconto/acréscimo sempre aberto, com o tipo ao lado (Desc %, Desc R$, Acrésc %, Acrésc R$) num menu do
 *   mesmo tipo, e o valor digitável à direita.
 * Regras do kit: alvo de toque ≥ 48 dp (44 dp na linha densa do item, sempre dentro do contêiner, sem `hitSlop`), nenhum texto fixo (tudo chega por props ou dos ids e
 * rótulos de `TIPOS_AJUSTE`), sem regra de negócio (quem habilita o prazo é o domain do Vendedor).
 * Movimento: o menu esmaece em 120 ms; com "reduzir movimento", aparece e some sem animação.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type StyleProp, type ViewStyle } from 'react-native';

import { ALVO_TOQUE } from './componentes';
import { bordaDaFalta, TextoDaFalta } from './falta-rn';
import { Icon } from './icon';
import { duracaoMovimento } from './movimento';
import { curvaPadrao, Pressionavel, useReduzirMovimento } from './movimento-rn';
import {
  alturaDoMenu,
  ALTURA_OPCAO_MENU,
  leituraDaOpcao,
  MAX_OPCOES_VISIVEIS,
  motivoVisivel,
  MOTIVO_OPCAO,
  PASSO_COMPACTO,
  posicaoDoMenu,
  RESPIRO_OPCAO_COM_MOTIVO,
  textoDaSelecao,
  type OpcaoLista,
  type PosicaoMenu,
} from './selecao';
import { colors, fonts, radius, shadow } from './theme';

/** Altura visual (moldura) e alvo do campo do ajuste: os mesmos do `Passo compacto` da linha 3 do item. */
const ALTURA_AJUSTE = PASSO_COMPACTO.altura;
const ALVO_AJUSTE = PASSO_COMPACTO.alvo;
/** Largura mínima do menu do tipo do ajuste (o rótulo "Acrésc R$" inteiro). */
const LARGURA_MENU_TIPO = 168;

// ---------- menu ancorado (interno) ----------

/** Mede o campo na janela e devolve onde abrir o menu (a altura conta a opção com motivo, que tem 2 linhas a mais). */
function useAncora(opcoes: ReadonlyArray<OpcaoLista>, larguraMinima?: number) {
  const quantidade = opcoes.length;
  const alturaConteudo = alturaDoMenu(opcoes);
  const ancora = useRef<View | null>(null);
  const janela = useWindowDimensions();
  const [posicao, setPosicao] = useState<PosicaoMenu | null>(null);
  const abrir = useCallback(() => {
    Keyboard.dismiss();
    ancora.current?.measureInWindow((x, y, largura, altura) => {
      setPosicao(posicaoDoMenu({ campo: { x, y, largura, altura }, janela: { largura: janela.width, altura: janela.height }, quantidade, larguraMinima, alturaConteudo }));
    });
  }, [janela.width, janela.height, quantidade, larguraMinima, alturaConteudo]);
  const fechar = useCallback(() => setPosicao(null), []);
  return { ancora, posicao, abrir, fechar };
}

function MenuAncorado<T extends string>({
  posicao,
  opcoes,
  valor,
  onEscolher,
  onFechar,
  rotuloFechar,
  rotuloAcessivel,
  testID,
}: {
  posicao: PosicaoMenu | null;
  opcoes: ReadonlyArray<OpcaoLista<T>>;
  valor: T | null;
  onEscolher: (id: T) => void;
  onFechar: () => void;
  rotuloFechar: string;
  rotuloAcessivel?: string;
  testID: string;
}) {
  const reduzir = useReduzirMovimento();
  const visivel = posicao !== null;
  const [ultima, setUltima] = useState<PosicaoMenu | null>(posicao);
  const [montado, setMontado] = useState(visivel);
  const opacidade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (posicao) setUltima(posicao);
  }, [posicao]);
  useEffect(() => {
    if (visivel) setMontado(true);
    const duracao = duracaoMovimento('toque', reduzir);
    if (duracao === 0) {
      opacidade.setValue(visivel ? 1 : 0);
      if (!visivel) setMontado(false);
      return;
    }
    const a = Animated.timing(opacidade, { toValue: visivel ? 1 : 0, duration: duracao, easing: curvaPadrao, useNativeDriver: true });
    a.start(() => {
      if (!visivel) setMontado(false);
    });
    return () => a.stop();
  }, [visivel, reduzir, opacidade]);
  const p = posicao ?? ultima;
  if (!(montado || visivel) || !p) return null;
  // com motivo, a altura é um teto estimado: deixa rolar para nunca cortar a última opção
  const rolar = opcoes.length > MAX_OPCOES_VISIVEIS || opcoes.some((o) => motivoVisivel(o) !== null);
  return (
    <Modal visible transparent animationType="none" onRequestClose={onFechar} statusBarTranslucent>
      <Pressable style={StyleSheet.absoluteFill} onPress={onFechar} accessibilityRole="button" accessibilityLabel={rotuloFechar} testID={`${testID}-fora`} />
      <Animated.View
        testID={`${testID}-menu`}
        accessibilityViewIsModal
        accessibilityRole="menu"
        accessibilityLabel={rotuloAcessivel}
        style={[s.menu, { left: p.left, width: p.width, top: p.top, bottom: p.bottom, maxHeight: p.maxHeight, opacity: opacidade }]}>
        <ScrollView scrollEnabled={rolar} bounces={false} keyboardShouldPersistTaps="handled">
          {opcoes.map((o, i) => {
            const marcada = o.id === valor;
            const off = Boolean(o.desabilitada);
            const motivo = motivoVisivel(o);
            return (
              <Pressionavel
                key={o.id}
                testID={o.testID ?? `${testID}-${o.id}`}
                accessibilityRole="menuitem"
                accessibilityLabel={leituraDaOpcao(o)}
                accessibilityState={{ selected: marcada, disabled: off }}
                disabled={off}
                escala={false}
                onPress={() => onEscolher(o.id)}
                style={[s.opcao, motivo !== null && s.opcaoComMotivo, i > 0 && s.opcaoDivisor, off && s.opcaoDesligada]}>
                <View style={s.opcaoTextos}>
                  <Text style={[s.opcaoTexto, marcada && s.opcaoTextoMarcada, off && s.opcaoTextoDesligada]} numberOfLines={1}>
                    {o.rotulo}
                  </Text>
                  {motivo !== null ? (
                    <Text testID={`${o.testID ?? `${testID}-${o.id}`}-motivo`} style={s.opcaoMotivo} numberOfLines={MOTIVO_OPCAO.linhas}>
                      {motivo}
                    </Text>
                  ) : null}
                </View>
                {marcada ? <Icon name="check" size={16} color={colors.accent} strokeWidth={2.6} /> : off ? <Icon name="lock" size={14} color={colors.inkDisabled} /> : null}
              </Pressionavel>
            );
          })}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// ---------- ListaSuspensa ----------
export function ListaSuspensa<T extends string>({
  rotulo,
  rotuloAcessivel,
  opcoes,
  valor,
  onChange,
  placeholder,
  rotuloFechar,
  desligado,
  erro,
  falta,
  style,
  testID = 'lista',
}: {
  /** Rótulo em cima, em maiúsculas ("Forma de pagamento", "Prazo"); opcional. */
  rotulo?: string;
  /** Nome do campo para o leitor de tela; sem ele, usa o rótulo. */
  rotuloAcessivel?: string;
  opcoes: ReadonlyArray<OpcaoLista<T>>;
  /** Opção marcada; null = nenhuma (mostra o placeholder). */
  valor: T | null;
  onChange: (id: T) => void;
  /** Ex.: "Escolha". */
  placeholder: string;
  /** Leitura da área fora do menu (toque fora fecha), ex.: "Fechar a lista". */
  rotuloFechar: string;
  /** Campo inteiro sem toque (ex.: forma ainda não escolhida, para o Prazo). */
  desligado?: boolean;
  /**
   * Borda vermelha (falta escolher).
   * @deprecated RD-0235: refaz a borda de `falta`. Use `falta` (borda `danger` 2 e o texto embaixo do campo); a prop sai do kit
   * quando a UF do endereço do pedido (modules/vendedor/app/components/endereco-pedido.tsx) passar para `falta`.
   */
  erro?: boolean;
  /** Texto curto da falta já visível (`faltaVisivel`, ex.: "Obrigatório"): borda `danger` 2 e o texto embaixo do campo. */
  falta?: string | null;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { ancora, posicao, abrir, fechar } = useAncora(opcoes);
  const { texto, vazio } = textoDaSelecao(opcoes, valor, placeholder);
  const aberto = posicao !== null;
  const off = Boolean(desligado) || opcoes.length === 0;
  const nome = rotuloAcessivel ?? rotulo ?? placeholder;
  return (
    <View style={[s.campoBloco, style]}>
      {rotulo ? (
        <Text style={s.rotulo} numberOfLines={2}>
          {rotulo}
        </Text>
      ) : null}
      <View>
        <View ref={ancora} collapsable={false}>
          <Pressionavel
            testID={testID}
            accessibilityRole="combobox"
            accessibilityLabel={falta ? `${nome}: ${texto}, ${falta}` : `${nome}: ${texto}`}
            accessibilityState={{ expanded: aberto, disabled: off }}
            disabled={off}
            escala={false}
            onPress={abrir}
            style={[s.campo, aberto && s.campoAberto, erro && !aberto && s.campoErro, !aberto && bordaDaFalta(falta), off && s.campoDesligado]}>
            <Text style={[s.campoTexto, vazio && s.campoTextoVazio, off && s.campoTextoDesligado]} numberOfLines={1}>
              {texto}
            </Text>
            <View style={aberto ? s.setaAberta : null}>
              <Icon name="abaixo" size={18} color={off ? colors.inkDisabled : colors.ink} strokeWidth={2.4} />
            </View>
          </Pressionavel>
        </View>
        <TextoDaFalta texto={falta} testID={`${testID}-falta`} />
      </View>
      <MenuAncorado
        posicao={posicao}
        opcoes={opcoes}
        valor={valor}
        onEscolher={(id) => {
          fechar();
          if (id !== valor) onChange(id);
        }}
        onFechar={fechar}
        rotuloFechar={rotuloFechar}
        rotuloAcessivel={nome}
        testID={testID}
      />
    </View>
  );
}

// ---------- CampoAjuste ----------
export function CampoAjuste<T extends string>({
  tipos,
  tipo,
  onChangeTipo,
  texto,
  onChangeTexto,
  onConfirmar,
  placeholder,
  rotuloAcessivel,
  rotuloTipo,
  rotuloFechar,
  erro,
  desligado,
  style,
  testID = 'ajuste',
}: {
  /** Os tipos (use `TIPOS_AJUSTE`: Desc %, Desc R$, Acrésc %, Acrésc R$). Tipo desabilitado aparece com cadeado. */
  tipos: ReadonlyArray<OpcaoLista<T>>;
  tipo: T;
  onChangeTipo: (t: T) => void;
  /** Texto do valor (controlado; o módulo saneia com `sanearDecimal` e lê com `lerDecimal`). */
  texto: string;
  onChangeTexto: (t: string) => void;
  /** Ao sair do campo ou tocar em OK no teclado. */
  onConfirmar?: () => void;
  /** Ex.: "0". */
  placeholder: string;
  /** Nome do valor para o leitor de tela (ex.: "Valor do ajuste de Água mineral 1,5 L"). */
  rotuloAcessivel: string;
  /** Nome do seletor do tipo (ex.: "Tipo do ajuste"). */
  rotuloTipo: string;
  rotuloFechar: string;
  /** Borda vermelha (ex.: acima da alçada); o motivo vai em texto perto, pela tela. */
  erro?: boolean;
  desligado?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const { ancora, posicao, abrir, fechar } = useAncora(tipos, LARGURA_MENU_TIPO);
  const atual = tipos.find((t) => t.id === tipo);
  const aberto = posicao !== null;
  return (
    <View style={[s.ajuste, style]} testID={testID}>
      {/* moldura de 30 dp (visual da referência) atrás; o tipo e o valor têm 44 dp de altura DENTRO do contêiner, sem folga de toque */}
      <View ref={ancora} collapsable={false} pointerEvents="none" style={[s.ajusteMoldura, erro && s.campoErro, desligado && s.campoDesligado]} />
      <Pressionavel
        testID={`${testID}-tipo`}
        accessibilityRole="combobox"
        accessibilityLabel={`${rotuloTipo}: ${atual ? leituraDaOpcao({ ...atual, desabilitada: false }) : ''}`}
        accessibilityState={{ expanded: aberto, disabled: Boolean(desligado) }}
        disabled={desligado}
        escala={false}
        onPress={abrir}
        style={s.ajusteTipoAlvo}>
        <View style={[s.ajusteTipo, aberto && s.ajusteTipoAberto]}>
          <Text style={s.ajusteTipoTexto} numberOfLines={1}>
            {atual?.rotulo ?? ''}
          </Text>
          <Icon name="abaixo" size={12} color={colors.ink2} strokeWidth={2.6} />
        </View>
      </Pressionavel>
      <TextInput
        testID={`${testID}-valor`}
        value={texto}
        onChangeText={onChangeTexto}
        onBlur={onConfirmar}
        onSubmitEditing={onConfirmar}
        editable={!desligado}
        keyboardType="decimal-pad"
        selectTextOnFocus
        placeholder={placeholder}
        placeholderTextColor={colors.ink3}
        accessibilityLabel={rotuloAcessivel}
        style={s.ajusteValor}
      />
      <MenuAncorado
        posicao={posicao}
        opcoes={tipos}
        valor={tipo}
        onEscolher={(id) => {
          fechar();
          if (id !== tipo) onChangeTipo(id);
        }}
        onFechar={fechar}
        rotuloFechar={rotuloFechar}
        rotuloAcessivel={rotuloTipo}
        testID={`${testID}-tipo`}
      />
    </View>
  );
}

const s = StyleSheet.create({
  // rótulo + campo (.lbl / .sel)
  campoBloco: { gap: 4, minWidth: 0 },
  rotulo: { fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },
  campo: { minHeight: ALVO_TOQUE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  campoAberto: { borderColor: colors.ink, borderWidth: 1.5 },
  campoErro: { borderColor: colors.danger, borderWidth: 1.5 },
  campoDesligado: { backgroundColor: colors.lineSoft, borderColor: colors.line },
  campoTexto: { flexShrink: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  campoTextoVazio: { fontFamily: fonts.body, color: colors.ink3 },
  campoTextoDesligado: { color: colors.ink3 },
  setaAberta: { transform: [{ rotate: '180deg' }] },
  // .menu
  menu: { position: 'absolute', backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.line, overflow: 'hidden', ...shadow.aviso },
  opcao: { minHeight: ALTURA_OPCAO_MENU, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 12 },
  opcaoDivisor: { borderTopWidth: 1, borderTopColor: colors.line },
  opcaoComMotivo: { paddingVertical: RESPIRO_OPCAO_COM_MOTIVO },
  opcaoDesligada: { backgroundColor: MOTIVO_OPCAO.fundo },
  opcaoTextos: { flexShrink: 1, gap: 2 },
  opcaoTexto: { fontFamily: fonts.body, fontSize: 15, lineHeight: 20, color: colors.ink },
  opcaoTextoMarcada: { fontFamily: fonts.bold },
  opcaoTextoDesligada: { color: colors.inkDisabled },
  opcaoMotivo: { fontFamily: fonts.body, fontSize: MOTIVO_OPCAO.tamanhoFonte, lineHeight: MOTIVO_OPCAO.alturaLinha, color: MOTIVO_OPCAO.cor },
  // .desc (ajuste com o tipo ao lado): contêiner de 44 dp com os alvos dentro; moldura de 30 dp atrás
  ajuste: { flexDirection: 'row', alignItems: 'center', height: ALVO_AJUSTE, minWidth: 112 },
  ajusteMoldura: { position: 'absolute', left: 0, right: 0, top: (ALVO_AJUSTE - ALTURA_AJUSTE) / 2, height: ALTURA_AJUSTE, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  ajusteTipoAlvo: { height: ALVO_AJUSTE, justifyContent: 'center', paddingLeft: 1 },
  ajusteTipo: { flexDirection: 'row', alignItems: 'center', gap: 3, height: ALTURA_AJUSTE - 2, paddingHorizontal: 8, borderRightWidth: 1, borderRightColor: colors.line, backgroundColor: colors.ground, borderTopLeftRadius: radius.sm - 1, borderBottomLeftRadius: radius.sm - 1 },
  ajusteTipoAberto: { backgroundColor: colors.lineSoft },
  ajusteTipoTexto: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink2 },
  ajusteValor: { flex: 1, minWidth: 44, height: ALVO_AJUSTE, paddingVertical: 0, paddingHorizontal: 8, textAlign: 'right', textAlignVertical: 'center', fontFamily: fonts.bold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
});
