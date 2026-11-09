/** Aviso curto no rodapé (kit `AvisoRodape`, T-0072): substitui o toast do alto da tela. Some sozinho; leitor de tela fica mais tempo. */
import { AvisoRodape, useAvisoRodape } from '@macuxi/ui/mobile';
import { useCallback } from 'react';

import { textoDoAviso } from '../lib/textos-pedido';

type PropsDoAviso = ReturnType<typeof useAvisoRodape>['props'];

export function useAviso() {
  const { mostrar: mostrarRodape, props } = useAvisoRodape();
  const mostrar = useCallback((mensagem: string) => mostrarRodape({ texto: textoDoAviso(mensagem), tom: 'sucesso' }), [mostrarRodape]);
  return { aviso: props, mostrar };
}

/**
 * A tela de módulo roda dentro das abas e a barra do shell já reserva a área segura de baixo (revisão técnica R-20261108-154931):
 * não soma `insets.bottom` de novo. `acima` sobe o aviso quando há rodapé fixo na tela (ex.: `RodapeAcoes` do detalhe).
 */
export function AvisoRapido({ aviso, acima = 0 }: { aviso: PropsDoAviso; acima?: number }) {
  return <AvisoRodape {...aviso} respiroInferior={acima} testID="aviso-pedido" />;
}
