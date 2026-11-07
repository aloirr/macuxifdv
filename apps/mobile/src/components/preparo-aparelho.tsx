/**
 * T-0088 (desenho §2 e §4): telas do shell em volta da abertura do armazenamento do usuário.
 * - `TelaPreparoAparelho`: "Atualizando os dados do aparelho…" durante a passagem do AsyncStorage para o SQLite (1ª
 *   abertura depois da atualização). Aparece por cima de tudo, só se a abertura passar de `ESPERA_TELA_PREPARO_MS`, e
 *   não trava o app: a passagem cede o loop a cada lote e a barra anda pelo progresso do SDK.
 * - `TelaErroArmazenamento`: com os dados já no SQLite (espelho gravado) e o arquivo sem abrir, o app NÃO volta ao
 *   AsyncStorage (a fila verdadeira está no SQLite): "Tentar de novo" reabre; "Sair" fecha a sessão sem apagar nada.
 * Textos em `lib/armazenamento-aparelho.ts` (sem nome de módulo, entidade ou chave).
 * Leitor de tela (revisão de UX da T-0088): o título é anunciado quando a tela aparece (`accessibilityViewIsModal` só vale
 * no iOS; no Android o shell esconde o que está por baixo com `importantForAccessibility`, em `app/_layout.tsx`), a barra
 * tem papel de barra de progresso com valor e o aviso em faixa é região viva.
 */
import type { ProgressoPassagem } from '@macuxi/platform-sdk';
import { Banner, Button, colors, fonts, ProgressBar, type as t } from '@macuxi/ui/mobile';
import { useEffect } from 'react';
import { AccessibilityInfo, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AVISO_PREPARO,
  fraseDaPassagem,
  mensagemParaSuporte,
  percentualDaPassagem,
  ROTULO_BARRA_PREPARO,
  ROTULO_ENVIAR_SUPORTE,
  TEXTO_ERRO_ARMAZENAMENTO,
  TEXTO_ERRO_DE_NOVO,
  TEXTO_PREPARO,
  TITULO_ERRO_ARMAZENAMENTO,
  TITULO_PREPARO,
} from '@/lib/armazenamento-aparelho';

/** Anuncia o título ao abrir a tela (nada era lido no Android). */
function useAnunciarAoAbrir(titulo: string) {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(titulo);
  }, [titulo]);
}

export function TelaPreparoAparelho({ progresso }: { progresso: ProgressoPassagem | null }) {
  const insets = useSafeAreaInsets();
  const pct = percentualDaPassagem(progresso);
  useAnunciarAoAbrir(TITULO_PREPARO);
  return (
    <View testID="preparo-aparelho" style={[StyleSheet.absoluteFill, styles.root]} accessibilityViewIsModal>
      <ScrollView
        contentContainerStyle={[
          styles.conteudo,
          { paddingTop: Math.max(36, insets.top + 24), paddingBottom: Math.max(24, insets.bottom + 16) },
        ]}
      >
        <View style={{ gap: 4 }}>
          <Text style={t.h1} accessibilityRole="header">
            {TITULO_PREPARO}
          </Text>
          <Text style={t.sub}>{TEXTO_PREPARO}</Text>
        </View>
        <View style={{ gap: 8 }}>
          <View style={styles.linha}>
            <Text style={t.label} testID="preparo-frase" accessibilityLiveRegion="polite">
              {fraseDaPassagem(progresso)}
            </Text>
            {/* o número fica fora do leitor: a barra já diz o valor (não lê duas vezes) */}
            <Text
              style={[t.label, { color: colors.ink }]}
              testID="preparo-pct"
              importantForAccessibility="no"
              accessibilityElementsHidden
            >
              {pct}%
            </Text>
          </View>
          <ProgressBar pct={pct} rotulo={ROTULO_BARRA_PREPARO} />
        </View>
        <Banner icon="clock" tone="warning" testID="preparo-app-aberto" anunciar>
          {AVISO_PREPARO}
        </Banner>
      </ScrollView>
    </View>
  );
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
  linha: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
  mono: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink2, lineHeight: 18 },
});
