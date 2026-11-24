/**
 * T-0195 (ADR 0070, RN-CORE-80; especificação docs/design/t0195-atualizacao-obrigatoria.md §2.1 e §3, designer-ux):
 * - `TelaAtualizacaoApp`: depois das 24 h, a única tela do app (sem abas, sem sino, sem menu). Mesmo esqueleto e medidas da
 *   `TelaDeErro` do kit, montado com as peças dele (o kit não tem o estado ocupado nem a linha de estado). Voltar do Android
 *   fecha o app, como na raiz de qualquer pilha;
 * - `BlocoAtualizacao`: linhas 3 a 6 (texto, estado da fila, principal e suporte), as mesmas na tela e na folha "Baixar a
 *   versão X.Y.Z" das primeiras 24 h (`app/atualizar-app.tsx`).
 * O estado e os textos vêm de `lib/portao-atualizacao.ts` (o portão de nada se perde); aqui só o desenho e as ações.
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { Banner, Botao, ChipEstado, colors, fonte, Icon, layout, space } from '@macuxi/ui/mobile';
import Constants from 'expo-constants';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, BackHandler, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { mensagemDoErroParaSuporte, registroDoErro } from '@/lib/erro-de-tela';
import {
  telaDaAtualizacao,
  TEXTOS_ATUALIZACAO_APP,
  type AcaoDaTelaAtualizacao,
  type EstadoPortao,
  type PortaoAtualizacao,
} from '@/lib/portao-atualizacao';

/** Estado do portão na tela: entra ao montar (conta e envia sozinho) e reconta quando a fila do motor muda por fora. */
export function useEstadoPortao(portao: PortaoAtualizacao): EstadoPortao {
  const [estado, setEstado] = useState(portao.estado());
  const { estado: motor } = useMotorSync();
  useEffect(() => {
    const sair = portao.assinar(setEstado);
    void portao.entrar().catch(() => undefined);
    return sair;
  }, [portao]);
  useEffect(() => {
    void portao.recontar().catch(() => undefined);
  }, [portao, motor.fila, motor.arquivos]);
  return estado;
}

function enviarAoSuporte(detalhe: string | null, estado: string): void {
  const r = registroDoErro(new Error(detalhe ?? estado), 'raiz', new Date());
  const app = [Constants.expoConfig?.name ?? 'Macuxi FDV', Constants.expoConfig?.version].filter(Boolean).join(' ');
  void Share.share({ message: mensagemDoErroParaSuporte(r, { app, titulo: TEXTOS_ATUALIZACAO_APP.titulo }) }).catch(() => undefined);
}

export function BlocoAtualizacao({
  portao,
  estado,
  temSessao,
  versao,
  aoAbrir,
  testID = 'atualizacao',
}: {
  portao: PortaoAtualizacao;
  estado: EstadoPortao;
  temSessao: boolean;
  versao: string;
  /** "Entrar", "Corrigir os não aceitos" e "Abrir os rascunhos": abre só a tela que resolve. */
  aoAbrir: (acao: Exclude<AcaoDaTelaAtualizacao, 'enviar' | 'baixar'>) => void;
  testID?: string;
}) {
  const tela = telaDaAtualizacao({ temSessao, contagem: estado.contagem, envio: estado.envio, link: estado.link, versao });
  const tocar = () => {
    const acao = tela.principal.acao;
    if (acao === 'enviar') void portao.enviarAgora();
    else if (acao === 'baixar') void portao.baixar();
    else aoAbrir(acao);
  };
  const linha = tela.linha;
  return (
    <View style={s.bloco} testID={testID}>
      <Text style={s.texto} testID={`${testID}-texto`}>
        {tela.texto}
      </Text>
      {linha?.tipo === 'chip' ? (
        <View style={s.linha} accessibilityLiveRegion="polite">
          <ChipEstado tom="aviso" icone={linha.icone} texto={linha.texto} testID={`${testID}-chip`} />
        </View>
      ) : linha?.tipo === 'banner' ? (
        <Banner tone={linha.tom} icon={linha.icone} anunciar={linha.anunciar} testID={`${testID}-banner`}>
          {linha.texto}
        </Banner>
      ) : null}
      <View style={s.acoes}>
        <Botao
          nivel="principal"
          rotulo={tela.principal.rotulo}
          ocupado={tela.principal.ocupado}
          onPress={tocar}
          testID={`${testID}-principal`}
        />
        {tela.suporte ? (
          <Botao
            nivel="neutro"
            icone="send"
            rotulo={TEXTOS_ATUALIZACAO_APP.suporte}
            onPress={() => enviarAoSuporte(estado.detalhe, tela.estado)}
            testID={`${testID}-suporte`}
          />
        ) : null}
      </View>
    </View>
  );
}

export function TelaAtualizacaoApp({
  portao,
  temSessao,
  versao,
  aoAbrir,
}: {
  portao: PortaoAtualizacao;
  temSessao: boolean;
  versao: string;
  aoAbrir: (acao: Exclude<AcaoDaTelaAtualizacao, 'enviar' | 'baixar'>) => void;
}) {
  const estado = useEstadoPortao(portao);
  // ao abrir, o leitor de tela lê "título. texto" (só na abertura: as mudanças seguintes são anunciadas pela linha de estado)
  const [anuncio] = useState(
    () => `${TEXTOS_ATUALIZACAO_APP.titulo} ${telaDaAtualizacao({ temSessao, contagem: estado.contagem, envio: estado.envio, link: estado.link, versao }).texto}`,
  );
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(anuncio);
  }, [anuncio]);
  // Voltar do Android fecha o app (não existe "pular" nem "lembrar depois")
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      BackHandler.exitApp();
      return true;
    });
    return () => sub.remove();
  }, []);
  return (
    <ScrollView testID="tela-atualizacao" style={s.raiz} contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
      <View style={s.topo}>
        <View style={s.icone} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Icon name="alert" size={26} color={colors.warning} />
        </View>
        <Text style={s.titulo} accessibilityRole="header" testID="tela-atualizacao-titulo">
          {TEXTOS_ATUALIZACAO_APP.titulo}
        </Text>
      </View>
      <BlocoAtualizacao portao={portao} estado={estado} temSessao={temSessao} versao={versao} aoAbrir={aoAbrir} testID="tela-atualizacao" />
    </ScrollView>
  );
}

const s = StyleSheet.create({
  raiz: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.ground },
  // as medidas da `TelaDeErro` (docs/design/tela-de-erro.md §2): centralizado, rolável com fonte grande, respiro de 48 dp
  conteudo: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: layout.telaLateral, paddingVertical: space.xxxl + space.lg, gap: space.md },
  topo: { alignItems: 'center', gap: space.md },
  icone: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.warningBg, alignItems: 'center', justifyContent: 'center' },
  titulo: { ...fonte.bold, fontSize: 22, lineHeight: 28, color: colors.ink, textAlign: 'center' },
  bloco: { gap: space.xxl },
  texto: { ...fonte.body, fontSize: 16, lineHeight: 22, color: colors.ink2, textAlign: 'center' },
  linha: { alignItems: 'center' },
  acoes: { gap: space.sm },
});
