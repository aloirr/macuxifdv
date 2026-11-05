/**
 * `AreaSeguraSuperior` (R-20261102-111044): envolve o Stack do shell. Desenha a faixa da barra de status com o fundo
 * do app e repassa às telas os insets com `top: 0` (ver lib/area-segura.ts). Nenhuma tela de módulo precisa mudar:
 * `Screen` do `@macuxi/ui` e as telas que somam `useSafeAreaInsets().top` passam a começar abaixo da barra de status
 * e nada rola por baixo dela. A borda de baixo continua com cada tela e com a barra de abas.
 *
 * `useFaixaSuperior()` devolve a altura da faixa: o `KeyboardAvoidingView` mede a própria posição em relação ao pai,
 * então quem usa `behavior="padding"` passa `keyboardVerticalOffset={useFaixaSuperior()}`.
 */
import { colors } from '@macuxi/ui/mobile';
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { Platform, StatusBar, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { dividirAreaSegura } from '@/lib/area-segura';

const FaixaSuperiorContext = createContext(0);

export function useFaixaSuperior(): number {
  return useContext(FaixaSuperiorContext);
}

export function AreaSeguraSuperior({ children }: { children: ReactNode }) {
  const { top, right, bottom, left } = useSafeAreaInsets();
  const barraDeStatus = Platform.OS === 'android' ? StatusBar.currentHeight : null;
  const { faixaSuperior, insetsDasTelas } = useMemo(() => dividirAreaSegura({ top, right, bottom, left }, barraDeStatus), [top, right, bottom, left, barraDeStatus]);
  return (
    <View testID="area-segura-superior" style={{ flex: 1, paddingTop: faixaSuperior, backgroundColor: colors.ground }}>
      <FaixaSuperiorContext.Provider value={faixaSuperior}>
        <SafeAreaInsetsContext.Provider value={insetsDasTelas}>{children}</SafeAreaInsetsContext.Provider>
      </FaixaSuperiorContext.Provider>
    </View>
  );
}
