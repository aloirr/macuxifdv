/** Aviso rápido no alto da tela (substitui o toast do Core, que o Vendedor não pode importar). */
import { colors, fonts, radius } from '@macuxi/ui/mobile';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function useAviso() {
  const [aviso, setAviso] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const mostrar = useCallback((mensagem: string) => {
    setAviso(mensagem);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAviso(null), 3800);
  }, []);
  return { aviso, mostrar };
}

export function AvisoRapido({ mensagem }: { mensagem: string | null }) {
  const insets = useSafeAreaInsets();
  if (!mensagem) return null;
  return (
    <View style={[styles.toast, { top: insets.top + 14 }]} pointerEvents="none" testID="aviso-pedido" accessibilityRole="alert">
      <Text style={styles.texto}>{mensagem}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: { position: 'absolute', left: 14, right: 14, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12, backgroundColor: colors.success, elevation: 6 },
  texto: { fontFamily: fonts.body, fontSize: 13, lineHeight: 17.5, color: '#FFFFFF' },
});
