/**
 * `BotaoVerificarAtualizacao` (item 19 do teste de campo do Campo v1.0.16): o botão "Verificar atualização". Botão do Perfil
 * (`app/profile.tsx`), nas duas variantes.
 * Lê a versão do app (`Constants.expoConfig.version`, a mesma da linha da versão do Perfil) e a variante do build; a regra
 * fica em `lib/verificar-atualizacao.ts`. Com versão nova, o botão "Versão X.Y.Z disponível" abre a folha do download
 * (`ROTA_TELA_ATUALIZAR_APP`, T-0195), a mesma do aviso do sininho.
 */
import { ROTA_TELA_ATUALIZAR_APP, tituloAvisoVersaoApp } from '@macuxi/core/contracts';
import { useHttp } from '@macuxi/platform-sdk/react';
import { Button, type as t } from '@macuxi/ui/mobile';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { Text, View } from 'react-native';

import { varianteAtual } from '@/lib/variante';
import { mensagemDaVerificacao, TEXTOS_ATUALIZACAO, verificarAtualizacao, type ResultadoVerificacao } from '@/lib/verificar-atualizacao';
import { usePlataforma } from '@/state/plataforma';

export function BotaoVerificarAtualizacao({ testID = 'verificar-atualizacao' }: { testID?: string }) {
  const http = useHttp();
  const { receberVersaoPublicada } = usePlataforma();
  const [verificando, setVerificando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoVerificacao | null>(null);
  const emCurso = useRef(false);

  const verificar = async () => {
    if (emCurso.current) return;
    emCurso.current = true;
    setVerificando(true);
    try {
      setResultado(await verificarAtualizacao(http, varianteAtual(), Constants.expoConfig?.version, receberVersaoPublicada));
    } finally {
      emCurso.current = false;
      setVerificando(false);
    }
  };

  const mensagem = mensagemDaVerificacao(resultado);

  return (
    <View testID={testID} style={{ gap: 8 }}>
      {resultado?.tipo === 'nova' ? (
        <Button
          testID={`${testID}-nova`}
          label={tituloAvisoVersaoApp(resultado.versao)}
          onPress={() => router.push(ROTA_TELA_ATUALIZAR_APP as never)}
        />
      ) : (
        <Button
          testID={`${testID}-botao`}
          variant="outline"
          label={verificando ? TEXTOS_ATUALIZACAO.verificando : TEXTOS_ATUALIZACAO.verificar}
          disabled={verificando}
          onPress={() => void verificar()}
        />
      )}
      {mensagem ? (
        <Text testID={`${testID}-mensagem`} style={t.sub} accessibilityLiveRegion="polite">
          {mensagem}
        </Text>
      ) : null}
    </View>
  );
}
