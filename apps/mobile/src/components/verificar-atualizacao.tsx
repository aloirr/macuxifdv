/**
 * `BotaoVerificarAtualizacao` (item 19 do teste de campo do Campo v1.0.16): o botão "Verificar atualização". Botão do Perfil
 * (`app/profile.tsx`), nas duas variantes.
 * Lê a versão do app (`Constants.expoConfig.version`, a mesma da linha da versão do Perfil) e a variante do build; a regra
 * fica em `lib/verificar-atualizacao.ts`. Com versão nova, a linha de baixo pede o link ao administrador (T-0190: a API não manda
 * mais o `apk_url`); só se um servidor antigo mandar o `apk_url`, "Atualizar para X.Y.Z" o abre (Linking).
 */
import { useHttp } from '@macuxi/platform-sdk/react';
import { Button, type as t } from '@macuxi/ui/mobile';
import Constants from 'expo-constants';
import { useRef, useState } from 'react';
import { Linking, Text, View } from 'react-native';

import { varianteAtual } from '@/lib/variante';
import { mensagemDaVerificacao, TEXTOS_ATUALIZACAO, verificarAtualizacao, type ResultadoVerificacao } from '@/lib/verificar-atualizacao';

export function BotaoVerificarAtualizacao({ testID = 'verificar-atualizacao' }: { testID?: string }) {
  const http = useHttp();
  const [verificando, setVerificando] = useState(false);
  const [resultado, setResultado] = useState<ResultadoVerificacao | null>(null);
  const [naoAbriu, setNaoAbriu] = useState(false);
  const emCurso = useRef(false);

  const verificar = async () => {
    if (emCurso.current) return;
    emCurso.current = true;
    setVerificando(true);
    setNaoAbriu(false);
    try {
      setResultado(await verificarAtualizacao(http, varianteAtual(), Constants.expoConfig?.version));
    } finally {
      emCurso.current = false;
      setVerificando(false);
    }
  };

  const nova = resultado?.tipo === 'nova' && resultado.apkUrl ? { versao: resultado.versao, apkUrl: resultado.apkUrl } : null;
  const baixar = () => {
    if (!nova) return;
    setNaoAbriu(false);
    Linking.openURL(nova.apkUrl).catch(() => setNaoAbriu(true));
  };
  const mensagem = naoAbriu ? TEXTOS_ATUALIZACAO.naoAbriu : mensagemDaVerificacao(resultado);

  return (
    <View testID={testID} style={{ gap: 8 }}>
      {nova ? (
        <Button testID={`${testID}-baixar`} label={TEXTOS_ATUALIZACAO.atualizar(nova.versao)} onPress={baixar} />
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
