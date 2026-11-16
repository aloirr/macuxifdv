/**
 * T-0088 (desenho §2 e §4): tela do shell quando o armazenamento do usuário não abre. A passagem do AsyncStorage para o
 * SQLite (1ª abertura depois da atualização) é o "Atualizando o app" da tela de entrada (T-0172, `app/_layout.tsx`).
 * - `TelaErroArmazenamento`: com os dados já no SQLite (espelho gravado) e o arquivo sem abrir, o app NÃO volta ao
 *   AsyncStorage (a fila verdadeira está no SQLite): "Tentar de novo" reabre; "Sair" fecha a sessão sem apagar nada.
 * Textos em `lib/armazenamento-aparelho.ts` (sem nome de módulo, entidade ou chave).
 * Leitor de tela (revisão de UX da T-0088): o título é anunciado quando a tela aparece (`accessibilityViewIsModal` só vale
 * no iOS; no Android o shell esconde o que está por baixo com `importantForAccessibility`, em `app/_layout.tsx`).
 */
import { Button, colors, fonte, type as t } from '@macuxi/ui/mobile';
import { useEffect } from 'react';
import { AccessibilityInfo, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  mensagemParaSuporte,
  ROTULO_ENVIAR_SUPORTE,
  TEXTO_ERRO_ARMAZENAMENTO,
  TEXTO_ERRO_DE_NOVO,
  TITULO_ERRO_ARMAZENAMENTO,
} from '@/lib/armazenamento-aparelho';

/** Anuncia o título ao abrir a tela (nada era lido no Android). */
function useAnunciarAoAbrir(titulo: string) {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(titulo);
  }, [titulo]);
}

/**
 * `tentando`: "Tentar de novo" em andamento (a tela fica, com o botão carregando; o erro só sai no sucesso).
 * `falhouDeNovo`: a nova tentativa também falhou ("Ainda não abriu…" acima do botão, lido pelo leitor de tela).
 */
export function TelaErroArmazenamento({
  detalhe,
  falhouDeNovo = false,
  tentando = false,
  onTentar,
  onSair,
}: {
  detalhe: string;
  falhouDeNovo?: boolean;
  tentando?: boolean;
  onTentar: () => void;
  onSair: () => void;
}) {
  const insets = useSafeAreaInsets();
  useAnunciarAoAbrir(TITULO_ERRO_ARMAZENAMENTO);
  // mesmo padrão do Diagnóstico de carga: o Share do sistema (WhatsApp, e-mail, copiar), sem dependência nova
  const enviar = () => {
    void Share.share({ message: mensagemParaSuporte(detalhe) }).catch(() => {});
  };
  return (
    <View testID="erro-armazenamento" style={[StyleSheet.absoluteFill, styles.root]} accessibilityViewIsModal>
      <ScrollView
        contentContainerStyle={[
          styles.conteudo,
          { paddingTop: Math.max(36, insets.top + 24), paddingBottom: Math.max(24, insets.bottom + 16) },
        ]}
      >
        <View style={{ gap: 4 }}>
          <Text style={t.h1} accessibilityRole="header">
            {TITULO_ERRO_ARMAZENAMENTO}
          </Text>
          <Text style={t.sub}>{TEXTO_ERRO_ARMAZENAMENTO}</Text>
        </View>
        {falhouDeNovo && !tentando ? (
          <Text style={t.sub} testID="armazenamento-de-novo" accessibilityLiveRegion="polite">
            {TEXTO_ERRO_DE_NOVO}
          </Text>
        ) : null}
        <Button
          testID="armazenamento-tentar"
          label="Tentar de novo"
          variant="accent"
          height={52}
          loading={tentando}
          onPress={onTentar}
        />
        <Button
          testID="armazenamento-sair"
          label="Sair / trocar usuário"
          variant="outline"
          onPress={onSair}
        />
        <Button
          testID="armazenamento-enviar"
          label={ROTULO_ENVIAR_SUPORTE}
          variant="ghost"
          onPress={enviar}
        />
        <Text selectable style={styles.mono} testID="armazenamento-detalhe">
          {detalhe}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.ground, zIndex: 10 },
  conteudo: { flexGrow: 1, paddingHorizontal: 20, gap: 22 },
  mono: { ...fonte.mono, fontSize: 12, color: colors.ink2, lineHeight: 18 },
});
