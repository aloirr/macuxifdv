/**
 * `AreaSeguraSuperior` (R-20261102-111044): envolve o Stack do shell. Desenha a faixa da barra de status com o fundo
 * do app e repassa às telas os insets com `top: 0` (ver lib/area-segura.ts). Nenhuma tela de módulo precisa mudar:
 * `Screen` do `@macuxi/ui` e as telas que somam `useSafeAreaInsets().top` passam a começar abaixo da barra de status
 * e nada rola por baixo dela. A borda de baixo continua com cada tela e com a barra de abas.
 *
 * `useFaixaSuperior()` devolve a altura da faixa: o `KeyboardAvoidingView` mede a própria posição em relação ao pai,
 * então quem usa `behavior="padding"` passa `keyboardVerticalOffset={useFaixaSuperior()}`.
 * `useCorDaFaixa(cor)` (T-0172): a tela de entrada pinta a faixa com o fundo dela (Azul noite no Campo) enquanto está
 * montada; ao sair, a faixa volta ao fundo do app.
 */
import { colors } from '@macuxi/ui/mobile';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, StatusBar, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { dividirAreaSegura } from '@/lib/area-segura';

const FaixaSuperiorContext = createContext(0);
const CorDaFaixaContext = createContext<(cor: string | null) => void>(() => undefined);

/** Pinta a faixa da barra de status com `cor` enquanto a tela está montada (`null` = fundo do app). */
export function useCorDaFaixa(cor: string | null): void {
  const definir = useContext(CorDaFaixaContext);
  useEffect(() => {
    definir(cor);
    return () => definir(null);
  }, [cor, definir]);
}

export function useFaixaSuperior(): number {
  return useContext(FaixaSuperiorContext);
}

export function AreaSeguraSuperior({ children }: { children: ReactNode }) {
  const { top, right, bottom, left } = useSafeAreaInsets();
  const barraDeStatus = Platform.OS === 'android' ? StatusBar.currentHeight : null;
  const { faixaSuperior, insetsDasTelas } = useMemo(() => dividirAreaSegura({ top, right, bottom, left }, barraDeStatus), [top, right, bottom, left, barraDeStatus]);
  const [corDaFaixa, setCorDaFaixa] = useState<string | null>(null);
  return (
    <View testID="area-segura-superior" style={{ flex: 1, paddingTop: faixaSuperior, backgroundColor: corDaFaixa ?? colors.ground }}>
      <CorDaFaixaContext.Provider value={setCorDaFaixa}>
        <FaixaSuperiorContext.Provider value={faixaSuperior}>
          <SafeAreaInsetsContext.Provider value={insetsDasTelas}>{children}</SafeAreaInsetsContext.Provider>
        </FaixaSuperiorContext.Provider>
      </CorDaFaixaContext.Provider>
    </View>
  );
}
