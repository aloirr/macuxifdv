/**
 * RD-0039: `BotaoFolha` e `LinhaOpcaoFolha`, os botões das folhas de ação do pedido (medidas e cores em `botao-folha.ts`).
 *   [      Excluir pedido      ]   ← tom `perigo`, 50 dp, vermelho sólido, texto branco
 *   [          Voltar          ]   ← tom `contorno`, 46 dp
 *   [▣  PDF para o cliente   › ]   ← `LinhaOpcaoFolha`, 64 dp
 * Toque por opacidade (Pressable, sem escala); desligado sem mudança no botão e com opacidade 0,6 na linha.
 */
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { alturaDoBotaoFolha, BOTAO_FOLHA, fonteDoBotaoFolha, LINHA_OPCAO_FOLHA, type TomBotaoFolha } from './botao-folha';
import { Icon, type IconName } from './icon';
import { colors, fonte, radius, type } from './theme';

export function BotaoFolha({
  rotulo,
  onPress,
  tom,
  altura,
  desligado,
  testID,
}: {
  rotulo: string;
  onPress: () => void;
  tom: TomBotaoFolha;
  altura?: number;
  desligado?: boolean;
  testID?: string;
}) {
  const t = BOTAO_FOLHA.tons[tom];
  const h = alturaDoBotaoFolha(tom, altura);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(desligado) }}
      disabled={desligado}
      onPress={onPress}
      style={({ pressed }) => [
        styles.botao,
        { height: h, backgroundColor: t.fundo, borderColor: t.borda ?? 'transparent', borderWidth: t.larguraBorda },
        pressed && { opacity: BOTAO_FOLHA.opacidadeAoTocar },
      ]}>
      <Text style={[styles.rotulo, { color: t.texto, fontSize: fonteDoBotaoFolha(h) }]} numberOfLines={1}>
        {rotulo}
      </Text>
    </Pressable>
  );
}

export function LinhaOpcaoFolha({
  titulo,
  texto,
  onPress,
  desligado,
  icone = 'file',
  testID,
}: {
  titulo: string;
  texto: string;
  onPress: () => void;
  desligado?: boolean;
  icone?: IconName;
  testID?: string;
}) {
  const l = LINHA_OPCAO_FOLHA;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(desligado) }}
      disabled={desligado}
      onPress={onPress}
      style={({ pressed }) => [styles.linha, pressed && { backgroundColor: l.fundoAoTocar }, desligado && { opacity: l.opacidadeDesligada }]}>
      <View style={styles.tile}>
        <Icon name={icone} size={l.icone.tamanho} color={l.icone.cor} />
      </View>
      <View style={styles.textos}>
        <Text style={styles.titulo}>{titulo}</Text>
        <Text style={type.small}>{texto}</Text>
      </View>
      <Icon name="chevron" size={l.seta.tamanho} color={l.seta.cor} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  botao: { borderRadius: BOTAO_FOLHA.raio, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  rotulo: { ...fonte.semibold },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: LINHA_OPCAO_FOLHA.alturaMinima,
    borderRadius: LINHA_OPCAO_FOLHA.raio,
    borderWidth: 1,
    borderColor: LINHA_OPCAO_FOLHA.borda,
    backgroundColor: LINHA_OPCAO_FOLHA.fundo,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  tile: {
    width: LINHA_OPCAO_FOLHA.icone.lado,
    height: LINHA_OPCAO_FOLHA.icone.lado,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: LINHA_OPCAO_FOLHA.icone.fundo,
  },
  textos: { flex: 1, gap: 2 },
  titulo: { ...fonte.semibold, fontSize: LINHA_OPCAO_FOLHA.tamanhoTitulo, color: colors.ink },
});
