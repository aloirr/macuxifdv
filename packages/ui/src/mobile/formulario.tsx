/**
 * Componentes genéricos de formulário (T-0071, fatia 4; medidas da referência do Novo pedido,
 * docs/produto/referencias/R-20261103-130003-alexandre-novo-pedido.html):
 * - `Abas`: abas com sublinhado Azul noite e contador opcional ("Itens (3)");
 * - `Segmentado`: escolha única em botões lado a lado (CIF/FOB, prazo, Desc./Acrésc., %/R$);
 * - `Passo`: − n + (quantidade), com digitação opcional;
 * - `CampoBusca`: busca com lupa e botão de limpar;
 * - `RotuloSecao`: rótulo de seção em maiúsculas, com ação opcional à direita ("Entrega · Trocar");
 * - `ChipMedida`: chip da medida ("FD c/ 12"), tocável para trocar;
 * - `BotaoIcone`: botão quadrado só com ícone (+, ⇄).
 * Regras: alvo de toque ≥ 48 dp (visual menor ganha `hitSlop`; nas linhas densas, o modo `compacto` tem alvo de 44 dp
 * dentro do próprio botão, porque no Android a folga não passa da borda do pai); nenhum texto fixo (tudo chega por props, inclusive os
 * rótulos do leitor de tela); sem regra de negócio (quem decide valores e limites é o domain do módulo).
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';

import { ALVO_TOQUE, folgaDeToque, lerQuantidade, limitarPasso, rotuloComContador } from './componentes';
import { Icon, type IconName } from './icon';
import { PASSO_COMPACTO, passoComTexto, SEGMENTADO_COMPACTO } from './selecao';
import { colors, fonts, radius } from './theme';

function folga(visual: number) {
  const f = folgaDeToque(visual);
  return { top: f, bottom: f, left: f, right: f };
}

// ---------- Abas ----------
export interface AbaItem<T extends string> {
  id: T;
  rotulo: string;
  /** Número entre parênteses ("Itens (3)"); undefined/null esconde. */
  contador?: number | null;
  /** Ponto vermelho de pendência na aba. */
  pendente?: boolean;
  testID?: string;
}

export function Abas<T extends string>({
  abas,
  valor,
  onChange,
  rotuloPendencia,
  testID = 'abas',
}: {
  abas: ReadonlyArray<AbaItem<T>>;
  valor: T;
  onChange: (id: T) => void;
  /** Texto lido pelo leitor de tela quando a aba tem pendência (ex.: "falta informar"). */
  rotuloPendencia?: string;
  testID?: string;
}) {
  return (
    <View style={s.abas} accessibilityRole="tablist" testID={testID}>
      {abas.map((a) => {
        const on = a.id === valor;
        const texto = rotuloComContador(a.rotulo, a.contador);
        return (
          <Pressable
            key={a.id}
            testID={a.testID ?? `${testID}-${a.id}`}
            accessibilityRole="tab"
            accessibilityLabel={a.pendente && rotuloPendencia ? `${texto}, ${rotuloPendencia}` : texto}
            accessibilityState={{ selected: on }}
            onPress={() => onChange(a.id)}
            style={({ pressed }) => [s.aba, on && s.abaOn, pressed && s.pressionado]}>
            <Text style={[s.abaTexto, on && s.abaTextoOn]} numberOfLines={1}>
              {texto}
            </Text>
            {a.pendente ? <View style={s.ponto} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- Segmentado ----------
export interface OpcaoSegmentado<T extends string> {
  id: T;
  rotulo: string;
  /** Rótulo do leitor de tela quando o visível é abreviado ("Desc." → "Desconto"). */
  rotuloAcessivel?: string;
  desligado?: boolean;
  testID?: string;
}

export function Segmentado<T extends string>({
  opcoes,
  valor,
  onChange,
  rotuloAcessivel,
  compacto,
  desligado,
  style,
  testID = 'segmentado',
}: {
  opcoes: ReadonlyArray<OpcaoSegmentado<T>>;
  /** Opção marcada; null = nenhuma. */
  valor: T | null;
  onChange: (id: T) => void;
  /** Nome do grupo para o leitor de tela (ex.: "Frete"). */
  rotuloAcessivel?: string;
  /** Visual baixo (30 dp) com alvo de 44 × 44 dp dentro do próprio botão, para linhas densas (UN | CX na linha 3 do item). */
  compacto?: boolean;
  desligado?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[s.seg, style]} accessibilityRole="radiogroup" accessibilityLabel={rotuloAcessivel} testID={testID}>
      {opcoes.map((o) => {
        const on = o.id === valor;
        const off = Boolean(desligado || o.desligado);
        return (
          <Pressable
            key={o.id}
            testID={o.testID ?? `${testID}-${o.id}`}
            accessibilityRole="radio"
            accessibilityLabel={o.rotuloAcessivel ?? o.rotulo}
            accessibilityState={{ checked: on, disabled: off }}
            disabled={off}
            onPress={() => onChange(o.id)}
            style={({ pressed }) => (compacto ? s.segAlvoCompacto : [s.segItem, on && s.segOn, off && s.desligado, pressed && s.pressionado])}>
            {({ pressed }) =>
              compacto ? (
                // visual de 30 dp dentro de um alvo de 44 dp do próprio botão (no Android a folga não passa da borda do pai)
                <View style={[s.segItem, s.segItemCompacto, on && s.segOn, off && s.desligado, pressed && s.pressionado]}>
                  <Text style={[s.segTexto, s.segTextoCompacto, on && s.segTextoOn]} numberOfLines={1}>
                    {o.rotulo}
                  </Text>
                </View>
              ) : (
                <Text style={[s.segTexto, on && s.segTextoOn]} numberOfLines={1}>
                  {o.rotulo}
                </Text>
              )
            }
          </Pressable>
        );
      })}
    </View>
  );
}

/** Segmentado compacto: visual de 30 dp (o mesmo do passo e do ajuste da linha 3 do item) e alvo de 44 dp. */
const ALTURA_SEG_COMPACTO = SEGMENTADO_COMPACTO.altura;
const ALVO_SEG_COMPACTO = SEGMENTADO_COMPACTO.alvo;

// ---------- Passo (stepper) ----------
export function Passo({
  valor,
  onChange,
  rotulo,
  rotuloDiminuir,
  rotuloAumentar,
  min = 0,
  max,
  passo = 1,
  editavel,
  desligado,
  desligadoAumentar,
  compacto,
  testID = 'passo',
}: {
  valor: number;
  onChange: (n: number) => void;
  /** Nome do valor para o leitor de tela (ex.: "Quantidade de Água mineral 500 ml"). */
  rotulo: string;
  /** Rótulos do leitor de tela dos botões (ex.: "Diminuir", "Aumentar"). */
  rotuloDiminuir: string;
  rotuloAumentar: string;
  min?: number;
  max?: number;
  passo?: number;
  /** Permite digitar o número (teclado numérico). */
  editavel?: boolean;
  desligado?: boolean;
  /** Só o + sem toque (ex.: produto sem preço). */
  desligadoAumentar?: boolean;
  /**
   * Caixa única "− n +" da linha 3 do item (T-0089): visual de 30 dp de altura (botões de 32 dp), alvo de 44 × 44 dp
   * dentro do próprio contêiner (124 × 44 dp), sem hitSlop. Sem a prop, os botões de 40 dp de antes.
   */
  compacto?: boolean;
  testID?: string;
}) {
  const [texto, setTexto] = useState(String(valor));
  // refs: o toque no − / + com o teclado aberto lê o texto e o valor do momento (sem closure velha) — T-0089, bug do "+"
  const vivo = useRef({ texto: String(valor), valor, focado: false });
  vivo.current.valor = valor;
  useEffect(() => {
    vivo.current.texto = String(valor);
    setTexto(String(valor));
  }, [valor]);
  const mudarTexto = (t: string) => {
    vivo.current.texto = t;
    setTexto(t);
  };
  const aplicar = (n: number) => {
    const novo = limitarPasso(n, min, max);
    vivo.current.texto = String(novo);
    if (novo !== vivo.current.valor) {
      vivo.current.valor = novo;
      onChange(novo);
    }
    setTexto(String(novo));
  };
  const confirmarTexto = () => {
    vivo.current.focado = false;
    const lido = lerQuantidade(vivo.current.texto);
    if (lido === null) mudarTexto(String(vivo.current.valor));
    else aplicar(lido);
  };
  const tocar = (direcao: -1 | 1) => aplicar(passoComTexto(vivo.current, direcao, passo, min, max));
  const podeDiminuir = !desligado && valor > min;
  const podeAumentar = !desligado && !desligadoAumentar && (max === undefined || valor < max);
  const C = PASSO_COMPACTO;
  const valorTela =
    editavel && !desligado ? (
      <TextInput
        testID={`${testID}-valor`}
        value={texto}
        onChangeText={mudarTexto}
        onFocus={() => {
          vivo.current.focado = true;
        }}
        onBlur={confirmarTexto}
        onSubmitEditing={confirmarTexto}
        keyboardType="number-pad"
        selectTextOnFocus
        accessibilityLabel={rotulo}
        style={compacto ? [s.passoValor, s.passoValorCompacto] : [s.passoValor, s.passoInput]}
      />
    ) : (
      <Text
        testID={`${testID}-valor`}
        style={compacto ? [s.passoValor, s.passoValorCompacto, { lineHeight: C.alvo }] : s.passoValor}
        accessibilityRole="adjustable"
        accessibilityLabel={rotulo}
        accessibilityValue={{ now: valor, min, max }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => {
          if (desligado) return;
          if (e.nativeEvent.actionName === 'increment' && podeAumentar) tocar(1);
          if (e.nativeEvent.actionName === 'decrement') tocar(-1);
        }}>
        {valor}
      </Text>
    );
  if (compacto) {
    // Caixa "− n +" de 30 dp desenhada atrás (moldura); os botões de 44 × 44 dp ficam DENTRO do contêiner (no Android o
    // hitSlop não passa da borda do pai, então o alvo não depende de folga).
    return (
      <View style={s.passoCompacto} testID={testID}>
        <View style={s.passoMoldura} pointerEvents="none">
          <View style={s.passoMolduraValor} />
        </View>
        <BotaoPasso icone="minus" rotulo={rotuloDiminuir} desligado={!podeDiminuir} onPress={() => tocar(-1)} compacto lado="esquerda" testID={`${testID}-menos`} />
        {valorTela}
        <BotaoPasso icone="plus" rotulo={rotuloAumentar} desligado={!podeAumentar} onPress={() => tocar(1)} compacto lado="direita" testID={`${testID}-mais`} />
      </View>
    );
  }
  return (
    <View style={s.passo} testID={testID}>
      <BotaoPasso icone="minus" rotulo={rotuloDiminuir} desligado={!podeDiminuir} onPress={() => tocar(-1)} lado="esquerda" testID={`${testID}-menos`} />
      {valorTela}
      <BotaoPasso icone="plus" rotulo={rotuloAumentar} desligado={!podeAumentar} onPress={() => tocar(1)} lado="direita" testID={`${testID}-mais`} />
    </View>
  );
}

const LADO_PASSO = 40;

function BotaoPasso({
  icone,
  rotulo,
  desligado,
  onPress,
  compacto,
  lado,
  testID,
}: {
  icone: 'plus' | 'minus';
  rotulo: string;
  desligado: boolean;
  onPress: () => void;
  compacto?: boolean;
  lado: 'esquerda' | 'direita';
  testID: string;
}) {
  if (compacto) {
    // alvo de 44 × 44 dp no próprio Pressable; o visual de 32 × 30 dp encosta no número (lado de dentro)
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={rotulo}
        accessibilityState={{ disabled: desligado }}
        disabled={desligado}
        onPress={onPress}
        style={[s.passoAlvoCompacto, lado === 'esquerda' ? s.passoAlvoEsquerda : s.passoAlvoDireita]}>
        {({ pressed }) => (
          <View style={[s.passoBotaoCompacto, lado === 'esquerda' ? s.passoBotaoEsquerda : s.passoBotaoDireita, desligado && s.desligado, pressed && s.passoBotaoCompactoPressionado]}>
            <Icon name={icone} size={15} color={colors.ink} strokeWidth={2.4} />
          </View>
        )}
      </Pressable>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityState={{ disabled: desligado }}
      disabled={desligado}
      onPress={onPress}
      hitSlop={folga(LADO_PASSO)}
      style={({ pressed }) => [s.passoBotao, desligado && s.desligado, pressed && s.pressionado]}>
      <Icon name={icone} size={16} color={colors.ink} strokeWidth={2.2} />
    </Pressable>
  );
}

// ---------- CampoBusca ----------
export function CampoBusca({
  valor,
  onChange,
  placeholder,
  rotuloAcessivel,
  onLimpar,
  rotuloLimpar,
  onEnviar,
  autoFocus,
  testID = 'busca',
}: {
  valor: string;
  onChange: (texto: string) => void;
  /** Ex.: "Código, descrição ou veículo". */
  placeholder: string;
  /** Rótulo do leitor de tela; sem ele, usa o placeholder. */
  rotuloAcessivel?: string;
  /** Mostra o botão × quando há texto. Sem `rotuloLimpar` o botão não aparece. */
  onLimpar?: () => void;
  rotuloLimpar?: string;
  onEnviar?: () => void;
  autoFocus?: boolean;
  testID?: string;
}) {
  const mostrarLimpar = Boolean(onLimpar && rotuloLimpar && valor.length > 0);
  return (
    <View style={s.busca}>
      <Icon name="search" size={18} color={colors.ink3} />
      <TextInput
        testID={testID}
        value={valor}
        onChangeText={onChange}
        onSubmitEditing={onEnviar}
        placeholder={placeholder}
        placeholderTextColor={colors.ink3}
        accessibilityLabel={rotuloAcessivel ?? placeholder}
        returnKeyType="search"
        autoCorrect={false}
        autoFocus={autoFocus}
        style={s.buscaInput}
      />
      {mostrarLimpar ? (
        <Pressable testID={`${testID}-limpar`} accessibilityRole="button" accessibilityLabel={rotuloLimpar} onPress={onLimpar} style={({ pressed }) => [s.buscaLimpar, pressed && s.pressionado]}>
          <Icon name="close" size={16} color={colors.ink2} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------- RotuloSecao ----------
export function RotuloSecao({
  texto,
  acao,
  testID,
}: {
  /** Mostrado em maiúsculas ("Entrega", "Observações"). */
  texto: string;
  /** Link à direita (ex.: "Trocar"). */
  acao?: { rotulo: string; onPress: () => void; rotuloAcessivel?: string; testID?: string };
  testID?: string;
}) {
  return (
    <View style={s.rotuloLinha} testID={testID}>
      <Text style={s.rotulo} accessibilityRole="header" numberOfLines={1}>
        {texto}
      </Text>
      {acao ? (
        <Pressable
          testID={acao.testID}
          accessibilityRole="button"
          accessibilityLabel={acao.rotuloAcessivel ?? acao.rotulo}
          onPress={acao.onPress}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          style={({ pressed }) => [s.rotuloAcao, pressed && s.pressionado]}>
          <Text style={s.rotuloAcaoTexto}>{acao.rotulo}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ---------- ChipMedida ----------
export function ChipMedida({
  rotulo,
  onPress,
  rotuloAcessivel,
  testID,
}: {
  /** Ex.: "FD c/ 12", "UN". */
  rotulo: string;
  /** Sem onPress o chip é só leitura (produto com uma medida). */
  onPress?: () => void;
  /** Ex.: "Medida FD c/ 12, tocar para trocar". */
  rotuloAcessivel?: string;
  testID?: string;
}) {
  const conteudo = (
    <Text style={s.medidaTexto} numberOfLines={1}>
      {rotulo}
    </Text>
  );
  if (!onPress) {
    return (
      <View style={s.medida} testID={testID} accessibilityLabel={rotuloAcessivel ?? rotulo}>
        {conteudo}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={rotuloAcessivel ?? rotulo}
      onPress={onPress}
      hitSlop={folga(ALTURA_MEDIDA)}
      style={({ pressed }) => [s.medida, s.medidaTocavel, pressed && s.pressionado]}>
      {conteudo}
    </Pressable>
  );
}

const ALTURA_MEDIDA = 28;

// ---------- BotaoIcone ----------
export function BotaoIcone({
  icone,
  rotuloAcessivel,
  onPress,
  desligado,
  tamanho = 36,
  cor = colors.accent,
  testID,
}: {
  icone: IconName;
  /** Obrigatório: o botão não tem texto visível (ex.: "Adicionar Açúcar cristal 1 kg"). */
  rotuloAcessivel: string;
  onPress: () => void;
  desligado?: boolean;
  /** Lado visual em dp (alvo de toque sempre ≥ 48 dp). */
  tamanho?: number;
  cor?: string;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={rotuloAcessivel}
      accessibilityState={{ disabled: Boolean(desligado) }}
      disabled={desligado}
      onPress={onPress}
      hitSlop={folga(tamanho)}
      style={({ pressed }) => [s.botaoIcone, { width: tamanho, height: tamanho }, desligado && s.desligado, pressed && s.pressionado]}>
      <Icon name={icone} size={Math.round(tamanho * 0.5)} color={cor} strokeWidth={2.2} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  pressionado: { opacity: 0.7 },
  desligado: { opacity: 0.45 },
  // .tabs / .tab / .tab.on
  abas: { flexDirection: 'row', backgroundColor: colors.ground, borderBottomWidth: 1, borderBottomColor: colors.line },
  aba: { flex: 1, minHeight: ALVO_TOQUE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 4, borderBottomWidth: 3, borderBottomColor: 'transparent' },
  abaOn: { borderBottomColor: colors.accent },
  abaTexto: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },
  abaTextoOn: { fontFamily: fonts.bold, color: colors.ink },
  ponto: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  // .seg / .seg span / .seg.sm span
  seg: { flexDirection: 'row', gap: SEGMENTADO_COMPACTO.vao },
  segItem: { flex: 1, minWidth: ALVO_TOQUE, height: ALVO_TOQUE, paddingHorizontal: 8, borderRadius: 9, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  segAlvoCompacto: { flex: 1, minWidth: ALVO_SEG_COMPACTO, height: ALVO_SEG_COMPACTO, justifyContent: 'center' },
  // flex: 0 anula o flex: 1 do segItem: dentro do alvo (coluna) ele virava flexBasis 0 + grow e o visual esticava até 44 dp
  segItemCompacto: { flex: 0, minWidth: 0, height: ALTURA_SEG_COMPACTO, borderRadius: 7, paddingHorizontal: 6 },
  segOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segTexto: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  segTextoCompacto: { fontSize: 12 },
  segTextoOn: { color: colors.surface },
  // .qty / .qty i
  passo: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  passoBotao: { width: LADO_PASSO, height: LADO_PASSO, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  passoValor: { minWidth: 32, textAlign: 'center', fontFamily: fonts.bold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  passoInput: { height: LADO_PASSO, minWidth: 44, padding: 0, borderBottomWidth: 1, borderBottomColor: colors.lineStrong },
  // caixa "− n +" (T-0089, .qty da referência das 7h03): contêiner de 44 dp de altura com os alvos dentro; moldura de 30 dp atrás
  passoCompacto: { flexDirection: 'row', alignItems: 'center', height: PASSO_COMPACTO.alvo, width: PASSO_COMPACTO.largura },
  passoMoldura: {
    position: 'absolute',
    left: PASSO_COMPACTO.recuo,
    right: PASSO_COMPACTO.recuo,
    top: (PASSO_COMPACTO.alvo - PASSO_COMPACTO.altura) / 2,
    height: PASSO_COMPACTO.altura,
    flexDirection: 'row',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    backgroundColor: colors.surface,
  },
  passoMolduraValor: { width: PASSO_COMPACTO.valor, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line },
  passoAlvoCompacto: { width: PASSO_COMPACTO.alvo, height: PASSO_COMPACTO.alvo, justifyContent: 'center' },
  passoAlvoEsquerda: { alignItems: 'flex-end' },
  passoAlvoDireita: { alignItems: 'flex-start' },
  passoBotaoCompacto: { width: PASSO_COMPACTO.botao, height: PASSO_COMPACTO.altura - 2, alignItems: 'center', justifyContent: 'center' },
  passoBotaoEsquerda: { borderTopLeftRadius: radius.sm - 1, borderBottomLeftRadius: radius.sm - 1 },
  passoBotaoDireita: { borderTopRightRadius: radius.sm - 1, borderBottomRightRadius: radius.sm - 1 },
  passoBotaoCompactoPressionado: { backgroundColor: colors.lineSoft },
  passoValorCompacto: { width: PASSO_COMPACTO.valor, minWidth: PASSO_COMPACTO.valor, height: PASSO_COMPACTO.alvo, padding: 0, fontSize: 15, textAlignVertical: 'center' },
  // .search
  busca: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: ALVO_TOQUE, paddingLeft: 10, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  buscaInput: { flex: 1, minWidth: 0, height: ALVO_TOQUE - 2, padding: 0, fontFamily: fonts.body, fontSize: 14, color: colors.ink },
  buscaLimpar: { width: ALVO_TOQUE, height: ALVO_TOQUE - 2, alignItems: 'center', justifyContent: 'center' },
  // .lbl (+ link "Trocar")
  rotuloLinha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 20 },
  rotulo: { flexShrink: 1, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },
  rotuloAcao: { minHeight: 24, justifyContent: 'center' },
  rotuloAcaoTexto: { fontFamily: fonts.bold, fontSize: 13, color: colors.accentInk },
  // .chip (medida)
  medida: { alignSelf: 'flex-start', minHeight: ALTURA_MEDIDA, justifyContent: 'center', paddingHorizontal: 8, borderRadius: 6, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  medidaTocavel: { borderColor: colors.lineStrong },
  medidaTexto: { fontFamily: fonts.bold, fontSize: 12, color: colors.ink },
  // .plus
  botaoIcone: { borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
});
