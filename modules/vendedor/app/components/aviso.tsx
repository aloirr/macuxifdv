/** Aviso curto no rodapé (kit `AvisoRodape`, T-0072): substitui o toast do alto da tela. Some sozinho; leitor de tela fica mais tempo. */
import { AvisoRodape, useAvisoRodape } from '@macuxi/ui/mobile';
import { useCallback } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { textoDoAviso } from '../lib/textos-pedido';

type PropsDoAviso = ReturnType<typeof useAvisoRodape>['props'];

export function useAviso() {
  const { mostrar: mostrarRodape, props } = useAvisoRodape();
  const mostrar = useCallback((mensagem: string) => mostrarRodape({ texto: textoDoAviso(mensagem), tom: 'sucesso' }), [mostrarRodape]);
  return { aviso: props, mostrar };
}

export function AvisoRapido({ aviso }: { aviso: PropsDoAviso }) {
  const insets = useSafeAreaInsets();
  return <AvisoRodape {...aviso} respiroInferior={insets.bottom} testID="aviso-pedido" />;
}
