/**
 * Folha inferior, opção da folha e diálogo de confirmação (T-0071, fatia 4; medidas da referência do Novo pedido:
 * `.dim`, `.sheet`, `.opt`, `.ic`). Generaliza o `BottomSheet` do Vendedor e do Core.
 * Nenhum texto fixo: título, opções, "Voltar" e o rótulo do fundo para o leitor de tela chegam por props.
 * Alvos de toque ≥ 48 dp. O botão Voltar do Android fecha (onRequestClose).
 */
import type { ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ALVO_TOQUE } from './componentes';
import { Icon, type IconName } from './icon';
import { colors, fonts, radius } from './theme';

export interface AcaoTexto {
  rotulo: string;
  onPress: () => void;
  testID?: string;
}

export function Folha({
  visivel,
  onFechar,
  rotuloFechar,
  titulo,
  rotuloAcessivel,
  rodape,
  children,
  testID = 'folha',
}: {
  visivel: boolean;
  onFechar: () => void;
  /** Rótulo do fundo escurecido para o leitor de tela (toque fora fecha). */
  rotuloFechar: string;
  /** Título visível ("Salvar pedido"); opcional. */
  titulo?: string;
  /** Nome da folha para o leitor de tela; sem ele usa o título. */
  rotuloAcessivel?: string;
  /** Ação de texto centralizada no fim (ex.: "Voltar"). */
  rodape?: AcaoTexto;
  children?: ReactNode;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visivel} transparent animationType="fade" onRequestClose={onFechar} statusBarTranslucent>
      <Pressable style={s.fundo} onPress={onFechar} accessibilityRole="button" accessibilityLabel={rotuloFechar} testID={`${testID}-fundo`} />
      <View style={[s.folha, { paddingBottom: 22 + insets.bottom }]} testID={testID} accessibilityViewIsModal accessibilityLabel={rotuloAcessivel ?? titulo}>
        {titulo ? (
          <Text style={s.titulo} accessibilityRole="header">
            {titulo}
          </Text>
        ) : null}
        {children}
        {rodape ? (
          <Pressable testID={rodape.testID ?? `${testID}-rodape`} accessibilityRole="button" onPress={rodape.onPress} style={({ pressed }) => [s.rodape, pressed && s.pressionado]}>
            <Text style={s.rodapeTexto}>{rodape.rotulo}</Text>
          </Pressable>
        ) : null}
      </View>
    </Modal>
  );
}

export type TomOpcaoFolha = 'destaque' | 'neutro' | 'perigo';

export function OpcaoFolha({
  icone,
  titulo,
  subtitulo,
  subtituloErro,
  tom = 'destaque',
  onPress,
  desligado,
  testID,
}: {
  icone: IconName;
  titulo: string;
  /** Linha curta abaixo do título ("Vai direto ao ERP.", "Válido até 10/11."). */
  subtitulo?: string;
  /** Mostra o subtítulo na cor de erro (motivo do desligado, ex.: "Informe a transportadora do frete FOB."). */
  subtituloErro?: boolean;
  /** Cor do quadradinho do ícone: laranja (`destaque`), cinza (`neutro`) ou vermelho (`perigo`). */
  tom?: TomOpcaoFolha;
  onPress: () => void;
  desligado?: boolean;
  testID?: string;
}) {
  const c = TOM_OPCAO[tom];
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={subtitulo ? `${titulo}. ${subtitulo}` : titulo}
      accessibilityState={{ disabled: Boolean(desligado) }}
      disabled={desligado}
      onPress={onPress}
      style={({ pressed }) => [s.opcao, pressed && s.pressionado]}>
      <View style={[s.icone, { backgroundColor: c.bg }, desligado && s.desligado]}>
        <Icon name={icone} size={18} color={c.fg} strokeWidth={2.2} />
      </View>
      <View style={s.opcaoTextos}>
        <Text style={[s.opcaoTitulo, desligado && { color: colors.ink3 }]}>{titulo}</Text>
        {subtitulo ? <Text style={[s.opcaoSub, subtituloErro && { color: colors.danger }]}>{subtitulo}</Text> : null}
      </View>
    </Pressable>
  );
}

const TOM_OPCAO: Record<TomOpcaoFolha, { fg: string; bg: string }> = {
  destaque: { fg: colors.accent, bg: colors.accentSoft },
  neutro: { fg: colors.ink, bg: colors.neutralBg },
  perigo: { fg: colors.danger, bg: colors.dangerBg },
};

export function Dialogo({
  visivel,
  titulo,
  mensagem,
  cancelar,
  confirmar,
  perigo,
  onFechar,
  testID = 'dialogo',
}: {
  visivel: boolean;
  /** Ex.: "Descartar este pedido?". */
  titulo: string;
  /** Linha opcional abaixo do título (use só quando o título não basta). */
  mensagem?: string;
  /** Botão da esquerda (ex.: "Voltar"); também é o que o botão Voltar do Android faz quando não há `onFechar`. */
  cancelar: AcaoTexto;
  /** Botão da direita (ex.: "Descartar"). */
  confirmar: AcaoTexto & { ocupado?: boolean };
  /** Confirmar em vermelho (ação destrutiva). */
  perigo?: boolean;
  onFechar?: () => void;
  testID?: string;
}) {
  const fechar = onFechar ?? cancelar.onPress;
  return (
    <Modal visible={visivel} transparent animationType="fade" onRequestClose={fechar} statusBarTranslucent>
      <View style={s.dialogoFundo}>
        <View style={s.dialogo} testID={testID} accessibilityViewIsModal accessibilityRole="alert">
          <Text style={s.dialogoTitulo} accessibilityRole="header">
            {titulo}
          </Text>
          {mensagem ? <Text style={s.dialogoMsg}>{mensagem}</Text> : null}
          <View style={s.dialogoBotoes}>
            <Pressable testID={cancelar.testID ?? `${testID}-cancelar`} accessibilityRole="button" onPress={cancelar.onPress} style={({ pressed }) => [s.dialogoBotao, s.dialogoBotaoFora, pressed && s.pressionado]}>
              <Text style={[s.dialogoBotaoTexto, { color: colors.ink }]} numberOfLines={1}>
                {cancelar.rotulo}
              </Text>
            </Pressable>
            <Pressable
              testID={confirmar.testID ?? `${testID}-confirmar`}
              accessibilityRole="button"
              accessibilityState={{ disabled: Boolean(confirmar.ocupado), busy: Boolean(confirmar.ocupado) }}
              disabled={confirmar.ocupado}
              onPress={confirmar.onPress}
              style={({ pressed }) => [s.dialogoBotao, { backgroundColor: perigo ? colors.danger : colors.accent }, confirmar.ocupado && s.desligado, pressed && s.pressionado]}>
              <Text style={[s.dialogoBotaoTexto, { color: colors.surface }]} numberOfLines={1}>
                {confirmar.rotulo}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const FUNDO = 'rgba(15,20,25,0.45)';

const s = StyleSheet.create({
  pressionado: { opacity: 0.7 },
  desligado: { opacity: 0.45 },
  // .dim / .sheet
  fundo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: FUNDO },
  folha: { position: 'absolute', left: 0, right: 0, bottom: 0, alignSelf: 'center', width: '100%', maxWidth: 560, backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 16, paddingHorizontal: 16, gap: 9 },
  titulo: { fontFamily: fonts.display, fontSize: 19, color: colors.ink, marginBottom: 0 },
  rodape: { minHeight: ALVO_TOQUE, alignItems: 'center', justifyContent: 'center', marginTop: 5 },
  rodapeTexto: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
  // .opt / .ic
  opcao: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, minHeight: 56, paddingVertical: 11, paddingHorizontal: 12, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface },
  icone: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  opcaoTextos: { flex: 1, minWidth: 0, gap: 2 },
  opcaoTitulo: { fontFamily: fonts.bold, fontSize: 14, color: colors.ink },
  opcaoSub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink2 },
  // diálogo central
  dialogoFundo: { flex: 1, backgroundColor: FUNDO, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialogo: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: radius.xxl, padding: 18, gap: 8 },
  dialogoTitulo: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  dialogoMsg: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink2 },
  dialogoBotoes: { flexDirection: 'row', gap: 9, marginTop: 8 },
  dialogoBotao: { flex: 1, minHeight: ALVO_TOQUE, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  dialogoBotaoFora: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line },
  dialogoBotaoTexto: { fontFamily: fonts.bold, fontSize: 14 },
});
