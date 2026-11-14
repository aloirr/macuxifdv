/**
 * `AreaSeguraSuperior` (R-20261102-111044): envolve o Stack do shell. Desenha a faixa da barra de status e repassa às telas os insets com `top: 0` (ver lib/area-segura.ts). Nenhuma tela de módulo precisa mudar:
 * `Screen` do `@macuxi/ui` e as telas que somam `useSafeAreaInsets().top` passam a começar abaixo da barra de status
 * e nada rola por baixo dela. A borda de baixo continua com cada tela e com a barra de abas.
 *
 * `useFaixaSuperior()` devolve a altura da faixa: o `KeyboardAvoidingView` mede a própria posição em relação ao pai,
 * então quem usa `behavior="padding"` passa `keyboardVerticalOffset={useFaixaSuperior()}`.
 * `useCorDaFaixa(cor)` (T-0172): a tela de entrada pinta a faixa com o fundo dela (Azul noite no Campo) enquanto está
 * montada; ao sair, a faixa volta à cor da rota.
 * `useCorDaFaixaNoFoco(cor)` (T-0172): o mesmo, ligado ao foco da tela (as abas ficam montadas): ao focar, pinta a faixa;
 * ao perder o foco, a faixa volta à cor da rota. É assim que o Início do Campo fica em Azul noite, embora "/" esteja em
 * `ROTAS_SEM_FAIXA` (o Início da Gestão continua no Pérola).
 *
 * Cor da faixa (pedido do dono do produto em 14/11/2026; manual da marca §4): Azul noite (`colors.faixa`) por padrão,
 * para emendar no `CabecalhoTela` das telas com `<Screen cabecalho>`; só as rotas sem cabeçalho (`ROTAS_SEM_FAIXA`:
 * Início, login, sincronização e foto) ficam no Pérola. A prop `rota` vem do `usePathname()` do layout raiz. A barra de
 * status acompanha a cor efetiva (a da tela, se pintou, senão a da rota): ícones claros na faixa escura, escuros no
 * Pérola (`estiloBarraDeStatus`). Este `StatusBar` monta depois do da raiz e manda; a tela de entrada sobreposta monta
 * depois e continua mandando.
 */
import { colors, estiloBarraDeStatus } from '@macuxi/ui/mobile';
import { useFocusEffect } from 'expo-router';
import { StatusBar as BarraDeStatus } from 'expo-status-bar';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Platform, StatusBar, View } from 'react-native';
import { SafeAreaInsetsContext, useSafeAreaInsets } from 'react-native-safe-area-context';

import { dividirAreaSegura, rotaComFaixa } from '@/lib/area-segura';

const FaixaSuperiorContext = createContext(0);
export const CorDaFaixaContext = createContext<(cor: string | null) => void>(() => undefined);

/** Pinta a faixa da barra de status com `cor` enquanto a tela está montada (`null` = cor da rota). */
export function useCorDaFaixa(cor: string | null): void {
  const definir = useContext(CorDaFaixaContext);
  useEffect(() => {
    definir(cor);
    return () => definir(null);
  }, [cor, definir]);
}

/** Pinta a faixa com `cor` enquanto a tela está em foco (a barra de status acompanha); no desfoco, volta à cor da rota. */
export function useCorDaFaixaNoFoco(cor: string | null): void {
  const definir = useContext(CorDaFaixaContext);
  useFocusEffect(
    useCallback(() => {
      definir(cor);
      return () => definir(null);
    }, [cor, definir]),
  );
}

export function useFaixaSuperior(): number {
  return useContext(FaixaSuperiorContext);
}

export function AreaSeguraSuperior({ children, rota }: { children: ReactNode; rota?: string }) {
  const { top, right, bottom, left } = useSafeAreaInsets();
  const barraDeStatus = Platform.OS === 'android' ? StatusBar.currentHeight : null;
  const { faixaSuperior, insetsDasTelas } = useMemo(() => dividirAreaSegura({ top, right, bottom, left }, barraDeStatus), [top, right, bottom, left, barraDeStatus]);
  const [corDaFaixa, setCorDaFaixa] = useState<string | null>(null);
  const cor = corDaFaixa ?? (rotaComFaixa(rota) ? colors.faixa : colors.ground);
  return (
    <View testID="area-segura-superior" style={{ flex: 1, paddingTop: faixaSuperior, backgroundColor: cor }}>
      <BarraDeStatus style={estiloBarraDeStatus(cor !== colors.ground)} />
      <CorDaFaixaContext.Provider value={setCorDaFaixa}>
        <FaixaSuperiorContext.Provider value={faixaSuperior}>
          <SafeAreaInsetsContext.Provider value={insetsDasTelas}>{children}</SafeAreaInsetsContext.Provider>
        </FaixaSuperiorContext.Provider>
      </CorDaFaixaContext.Provider>
    </View>
  );
}
