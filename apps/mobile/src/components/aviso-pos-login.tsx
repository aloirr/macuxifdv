/**
 * "Senha criada." no rodapé da tela inicial depois da "Crie sua senha" (T-0094; spec docs/design/ciclo-de-senha.md §2): aviso do
 * kit (`AvisoRodape`, sem Desfazer) e vibração leve de confirmação. Aparece uma vez (`lib/aviso-pos-login`).
 * T-0178 (spec docs/design/trocar-senha/spec.md §7): `AvisoAoVoltar` mostra o mesmo aviso numa tela que já estava montada
 * (o Perfil, na volta da "Trocar senha"): lê ao ganhar o foco.
 */
import { AvisoRodape, vibrarLeve } from '@macuxi/ui/mobile';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { consumirAvisoPosLogin } from '@/lib/aviso-pos-login';

export function AvisoPosLogin() {
  const [texto] = useState(() => consumirAvisoPosLogin());
  return <AvisoDoRodape texto={texto} />;
}

/** `respiroInferior`: a tela sem barra de abas passa a área segura de baixo (barra de navegação do Android). */
export function AvisoAoVoltar({ respiroInferior = 0 }: { respiroInferior?: number }) {
  const [aviso, setAviso] = useState<{ texto: string; vez: number } | null>(null);
  useFocusEffect(
    useCallback(() => {
      const texto = consumirAvisoPosLogin();
      if (texto) setAviso((a) => ({ texto, vez: (a?.vez ?? 0) + 1 }));
    }, []),
  );
  // cada volta com aviso remonta o rodapé (visível de novo e nova vibração)
  return (
    <AvisoDoRodape key={aviso?.vez ?? 0} texto={aviso?.texto ?? null} respiroInferior={respiroInferior} />
  );
}

function AvisoDoRodape({ texto, respiroInferior = 0 }: { texto: string | null; respiroInferior?: number }) {
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
      respiroInferior={respiroInferior}
      testID="aviso-pos-login"
    />
  );
}
