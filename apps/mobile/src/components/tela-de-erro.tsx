/**
 * Tela de erro do shell (T-0140, relato do dono do produto, 08/11: "Novo pedido" e a sincronização inicial fechavam o app).
 * Sem ela, um erro de render no build sem Metro encerra o processo. Exportada como `ErrorBoundary` do expo-router:
 * - `TelaDeErroDoModulo` em `(tabs)/m/[...caminho].tsx`: só a tela do módulo troca; a barra inferior continua;
 * - `TelaDeErroDaRaiz` no `app/_layout.tsx`: fora dos provedores do shell (o `TelaDeErro` do kit só usa React Native e tokens).
 * Desenho e textos do kit (`TelaDeErro` e `TEXTOS_TELA_DE_ERRO`, designer-ux; spec docs/design/tela-de-erro.md). As duas
 * gravam o último erro para o Diagnóstico do Perfil (`services/erros.ts`) e oferecem o envio do detalhe técnico ao suporte
 * pelo compartilhar do sistema, no padrão da T-0088 (app e versão, título, sem dado pessoal).
 */
import { TelaDeErro, TEXTOS_TELA_DE_ERRO, type AlcanceDoErro } from '@macuxi/ui/mobile';
import Constants from 'expo-constants';
import { router, usePathname, type ErrorBoundaryProps } from 'expo-router';
import { useEffect } from 'react';
import { Share } from 'react-native';

import { mensagemDoErroParaSuporte, registroDoErro, type OrigemDoErro } from '@/lib/erro-de-tela';
import { gravarErro } from '@/services/erros';

/** 1ª linha "Macuxi Campo 1.0.1 · Não foi possível mostrar esta tela"; depois quando, onde, mensagem e pilha (limpas). */
function enviarAoSuporte(error: Error, origem: OrigemDoErro, onde: string | null, titulo: string): void {
  const r = registroDoErro(error, origem, new Date(), onde);
  const app = [Constants.expoConfig?.name ?? 'Macuxi FDV', Constants.expoConfig?.version].filter(Boolean).join(' ');
  void Share.share({ message: mensagemDoErroParaSuporte(r, { app, titulo }) }).catch(() => undefined);
}

function Tela({ alcance, error, retry, onde, saida }: { alcance: AlcanceDoErro; error: Error; retry: () => Promise<void>; onde: string | null; saida?: () => void }) {
  const t = TEXTOS_TELA_DE_ERRO[alcance];
  const origem: OrigemDoErro = alcance === 'tela' ? 'tela' : 'raiz';
  return (
    <TelaDeErro
      titulo={t.titulo}
      texto={t.texto}
      tentar={{ rotulo: t.tentar, onPress: () => void retry() }}
      saida={saida && t.inicio ? { rotulo: t.inicio, onPress: saida } : undefined}
      suporte={{ rotulo: t.suporte, onPress: () => enviarAoSuporte(error, origem, onde, t.titulo) }}
      nota={t.nota}
      testID={alcance === 'tela' ? 'tela-erro' : 'tela-erro-raiz'}
    />
  );
}

export function TelaDeErroDoModulo({ error, retry }: ErrorBoundaryProps) {
  const onde = usePathname();
  useEffect(() => {
    void gravarErro(error, 'tela', onde);
  }, [error, onde]);
  return <Tela alcance="tela" error={error} retry={retry} onde={onde} saida={() => router.replace('/')} />;
}

export function TelaDeErroDaRaiz({ error, retry }: ErrorBoundaryProps) {
  useEffect(() => {
    void gravarErro(error, 'raiz');
  }, [error]);
  return <Tela alcance="app" error={error} retry={retry} onde={null} />;
}
