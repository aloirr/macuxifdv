/**
 * "Senha criada." no rodapé da tela inicial depois da "Crie sua senha" (T-0094; spec docs/design/ciclo-de-senha.md §2): aviso do
 * kit (`AvisoRodape`, sem Desfazer) e vibração leve de confirmação. Aparece uma vez (`lib/aviso-pos-login`).
 */
import { AvisoRodape, vibrarLeve } from '@macuxi/ui/mobile';
import { useEffect, useState } from 'react';

import { consumirAvisoPosLogin } from '@/lib/aviso-pos-login';

export function AvisoPosLogin() {
  const [texto] = useState(() => consumirAvisoPosLogin());
  const [visivel, setVisivel] = useState(texto !== null);
  useEffect(() => {
    if (texto) vibrarLeve();
  }, [texto]);
  if (!texto) return null;
  return (
    <AvisoRodape
      visivel={visivel}
      texto={texto}
      onFechar={() => setVisivel(false)}
      respiroInferior={0}
      testID="aviso-pos-login"
    />
  );
}
