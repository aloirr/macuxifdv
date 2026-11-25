/**
 * Rota `/atualizar-app` (T-0195, ADR 0070 §D7; especificação docs/design/t0195-atualizacao-obrigatoria.md §2.1 e §5.2): a folha
 * "Versão X.Y.Z disponível" que o toque no aviso do sininho (e no push dele) abre nas primeiras 24 h. O conteúdo é o mesmo
 * bloco da tela de bloqueio (o portão de nada se perde vale aqui também). Toque fora, Fechar e Voltar do Android fecham; o app
 * segue liberado. "Abrir…" fecha a folha e navega; "Desligar modo sem sinal" desliga e fica na folha.
 * A rota é a `ROTA_TELA_ATUALIZAR_APP` do Core (`modules/core/contracts/app-atualizacao.ts`).
 */
import { tituloAvisoVersaoApp } from '@macuxi/core/contracts';
import { Folha } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';

import { BlocoAtualizacao, useEstadoPortao } from '@/components/tela-atualizacao';
import { TEXTOS_ATUALIZACAO_APP } from '@/lib/portao-atualizacao';
import { usePlataforma } from '@/state/plataforma';

export default function AtualizarAppScreen() {
  const { portaoAtualizacao, destinoParaAtualizar, versaoPublicada } = usePlataforma();
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
        titulo={tituloAvisoVersaoApp(versao)}
        fechar={{ rotulo: TEXTOS_ATUALIZACAO_APP.fechar }}
        rotuloFechar={TEXTOS_ATUALIZACAO_APP.fechar}
        onFechar={fechar}
        testID="folha-atualizacao"
      >
        <BlocoAtualizacao
          portao={portaoAtualizacao}
          estado={estado}
          versao={versao}
          aoAbrir={(acao) => {
            // o app segue liberado: a tela que resolve abre no lugar da folha
            setVisivel(false);
            router.replace(destinoParaAtualizar(acao).abrir as never);
          }}
          testID="folha-atualizacao-bloco"
        />
      </Folha>
    </View>
  );
}
