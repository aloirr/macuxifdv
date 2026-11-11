/**
 * RN-VEN-42 (T-0150; spec docs/design/pedido-v4.md §0.1): a área única "Alertas". Título "ALERTAS" em danger, cartão branco com
 * borda line e raio 12, uma linha por alerta (alvo >= 44 dp): ícone alerta + texto + chevron quando a linha leva a algum lugar.
 * Sem alerta, não desenha nada (nem o título). Quem decide o que é alerta é o domain (`alertasDoPedido`).
 */
import { colors, fonts, Icon, Pressionavel } from '@macuxi/ui/mobile';
import { StyleSheet, Text, View } from 'react-native';

import type { AlertaDoPedido } from '../../domain/alertas-pedido';

export function AreaAlertas({ alertas, aoTocar, texto, testID = 'area-alertas' }: { alertas: readonly AlertaDoPedido[]; aoTocar?: (a: AlertaDoPedido) => void; texto?: (a: AlertaDoPedido) => string; testID?: string }) {
  if (alertas.length === 0) return null;
  return (
    <View style={s.root} testID={testID}>
      <Text style={s.titulo} accessibilityRole="header" accessibilityLabel={`Alertas, ${alertas.length}`}>
        ALERTAS
      </Text>
      <View style={s.cartao}>
        {alertas.map((a, i) => {
          const toca = a.vai_para !== undefined && aoTocar !== undefined;
          const linha = (
            <View style={[s.linha, i > 0 && s.separador]}>
              <Icon name="alert" size={18} color={colors.danger} />
              <Text style={s.texto} numberOfLines={2}>
                {texto ? texto(a) : a.texto}
                {a.aba ? <Text style={s.aba}>{` · aba ${a.aba}`}</Text> : null}
              </Text>
              {toca ? <Icon name="chevron" size={16} color={colors.ink3} /> : null}
            </View>
          );
          return toca ? (
            <Pressionavel key={a.id} escala={false} testID={`alerta-${a.id}`} accessibilityRole="button" accessibilityLabel={a.leitura} onPress={() => aoTocar!(a)}>
              {linha}
            </Pressionavel>
          ) : (
            <View key={a.id} testID={`alerta-${a.id}`} accessible accessibilityLabel={a.leitura}>
              {linha}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { gap: 6 },
  titulo: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.6, color: colors.danger },
  cartao: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  linha: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  separador: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  texto: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink },
  aba: { color: colors.ink2 },
});
