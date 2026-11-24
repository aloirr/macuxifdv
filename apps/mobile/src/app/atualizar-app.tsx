/**
 * Rota `/atualizar-app` (T-0195, ADR 0070 §D7; especificação docs/design/t0195-atualizacao-obrigatoria.md §2.1): a folha
 * "Baixar a versão X.Y.Z" que a ação da notificação do sininho abre nas primeiras 24 h. O conteúdo é o mesmo bloco da tela de
 * bloqueio (o portão de nada se perde vale aqui também). Toque fora, ✕ e Voltar do Android fecham; o app segue liberado.
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { Folha } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { BlocoAtualizacao, useEstadoPortao } from '@/components/tela-atualizacao';
import { destinoDaAcao, TEXTOS_ATUALIZACAO_APP } from '@/lib/portao-atualizacao';
import { usePlataforma } from '@/state/plataforma';

export default function AtualizarAppScreen() {
  const { portaoAtualizacao, versaoPublicada, sessao } = usePlataforma();
  const { estado: motor } = useMotorSync();
  const estado = useEstadoPortao(portaoAtualizacao);
  const [visivel, setVisivel] = useState(true);
  const versao = versaoPublicada?.versao ?? null;
  const fechar = useCallback(() => {
    setVisivel(false);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, []);
  // sem versão publicada conhecida, não há o que baixar
  useEffect(() => {
    if (!versao) fechar();
  }, [versao, fechar]);
  if (!versao) return null;
  return (
    <View style={{ flex: 1 }}>
      <Folha
        visivel={visivel}
        titulo={TEXTOS_ATUALIZACAO_APP.folha(versao)}
        fechar={{ rotulo: TEXTOS_ATUALIZACAO_APP.fechar }}
        rotuloFechar={TEXTOS_ATUALIZACAO_APP.fechar}
        onFechar={fechar}
        testID="folha-atualizacao"
      >
        <BlocoAtualizacao
          portao={portaoAtualizacao}
          estado={estado}
          temSessao={sessao !== null}
          versao={versao}
          aoAbrir={(acao) => {
            // o app segue liberado: a tela que resolve abre no lugar da folha
            setVisivel(false);
            router.replace(destinoDaAcao(acao, motor.fila).abrir as never);
          }}
          testID="folha-atualizacao-bloco"
        />
      </Folha>
    </View>
  );
}
