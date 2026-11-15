/**
 * Sobe o conteúdo acima do teclado (R-20261101-023401 e 023857): `KeyboardAvoidingView` com `padding` (o Android
 * edge-to-edge não redimensiona a janela). Usado no login e nas telas de senha do Perfil (T-0178).
 */
import { colors } from '@macuxi/ui/mobile';
import type { ReactNode } from 'react';
import { KeyboardAvoidingView } from 'react-native';

import { useFaixaSuperior } from '@/components/area-segura';

export function AcimaDoTeclado({ children }: { children: ReactNode }) {
  // o KeyboardAvoidingView mede a posição relativa ao pai: soma a faixa da barra de status reservada pelo shell
  const faixaSuperior = useFaixaSuperior();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.ground }}
      behavior="padding"
      keyboardVerticalOffset={faixaSuperior}
    >
      {children}
    </KeyboardAvoidingView>
  );
}
