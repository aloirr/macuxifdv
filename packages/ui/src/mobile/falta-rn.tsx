/**
 * T-0166 (RN-CORE-36; RD-0170, RD-0177): componentes da "falta no campo". Spec: docs/design/formulario-pendencias.md §0.0.
 * - `TextoDaFalta`: ícone `alert` 14 + texto curto 12,5/600 `danger`, logo embaixo do campo (nada quando `texto` é null);
 * - `bordaDaFalta`: estilo da borda `danger` de 2 dp para o próprio campo (null sem falta).
 * Quando mostrar é do `faltaVisivel` (falta.ts); o texto é do domain do módulo. Sem fundo vermelho, faixa ou bolinha.
 */
import { StyleSheet, Text, View, type ViewStyle } from 'react-native';

import { MARCA_DA_FALTA } from './falta';
import { Icon } from './icon';
import { fonte } from './theme';

export function TextoDaFalta({ texto, testID = 'falta' }: { texto: string | null | undefined; testID?: string }) {
  if (!texto) return null;
  return (
    <View style={s.linha} testID={testID} accessibilityLiveRegion="polite">
      <Icon name="alert" size={MARCA_DA_FALTA.icone} color={MARCA_DA_FALTA.cor} />
      <Text style={s.texto} numberOfLines={1}>
        {texto}
      </Text>
    </View>
  );
}

const BORDA: ViewStyle = { borderColor: MARCA_DA_FALTA.cor, borderWidth: MARCA_DA_FALTA.larguraBorda };

/** Estilo para somar ao do campo: `style={[s.campo, bordaDaFalta(falta)]}`. */
export function bordaDaFalta(texto: string | null | undefined): ViewStyle | null {
  return texto ? BORDA : null;
}

const s = StyleSheet.create({
  linha: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: MARCA_DA_FALTA.respiro },
  texto: { flexShrink: 1, ...fonte.semibold, fontSize: MARCA_DA_FALTA.tamanhoFonte, lineHeight: MARCA_DA_FALTA.alturaLinha, color: MARCA_DA_FALTA.cor },
});
