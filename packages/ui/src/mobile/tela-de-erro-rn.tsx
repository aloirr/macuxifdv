/**
 * T-0140: `TelaDeErro`, a tela que substitui uma tela (ou o app) quando o React encontra um erro de desenho. Usada pelo
 * shell nos `ErrorBoundary` do expo-router: na tela de módulo (a barra de abas continua) e na raiz (`app/_layout.tsx`).
 * Spec: docs/design/tela-de-erro.md. Textos do padrão: `TEXTOS_TELA_DE_ERRO` (tela-de-erro.ts); aqui tudo chega por props.
 *
 * Funciona FORA dos provedores do shell (a raiz cai aqui quando o próprio layout quebrou): não usa área segura, roteador
 * nem contexto; só React Native, os tokens e o `Botao`. Sem as fontes carregadas, o Android usa a fonte do sistema.
 * Hierarquia: ícone de alerta (âmbar, decorativo) → título (cabeçalho) → o que fazer → Tentar de novo (principal, único) →
 * saída (secundário, opcional) → enviar ao suporte (neutro, opcional) → onde fica o detalhe (nota).
 * Leitor de tela: anuncia título e texto ao aparecer (no Android a troca de tela não é lida sozinha).
 */
import { useEffect } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Botao } from './base';
import { Icon } from './icon';
import { leituraDaTelaDeErro } from './tela-de-erro';
import { colors, fonte, layout, space } from './theme';

export interface AcaoDaTelaDeErro {
  rotulo: string;
  onPress: () => void;
  testID?: string;
}

export function TelaDeErro({
  titulo,
  texto,
  tentar,
  saida,
  suporte,
  nota,
  testID = 'tela-erro',
}: {
  titulo: string;
  /** O que fazer ("… Tente de novo; se continuar, avise o suporte."). */
  texto: string;
  /** Principal (o único da tela): o `retry` do ErrorBoundary. */
  tentar: AcaoDaTelaDeErro;
  /** Secundário: sair para um lugar seguro ("Ir para o Início"). Não use na raiz. */
  saida?: AcaoDaTelaDeErro;
  /** Neutro: Share do sistema com o detalhe técnico para o suporte. */
  suporte?: AcaoDaTelaDeErro;
  /** Linha pequena no fim ("O detalhe do erro fica em Perfil › Diagnóstico."). */
  nota?: string;
  testID?: string;
}) {
  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(leituraDaTelaDeErro({ titulo, texto }));
  }, [titulo, texto]);
  return (
    <ScrollView testID={testID} style={s.raiz} contentContainerStyle={s.conteudo} keyboardShouldPersistTaps="handled">
      <View style={s.topo}>
        <View style={s.icone} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Icon name="alert" size={26} color={colors.warning} />
        </View>
        <Text style={s.titulo} accessibilityRole="header" testID={`${testID}-titulo`}>
          {titulo}
        </Text>
        <Text style={s.texto} testID={`${testID}-texto`}>
          {texto}
        </Text>
      </View>
      <View style={s.acoes}>
        <Botao nivel="principal" rotulo={tentar.rotulo} onPress={tentar.onPress} testID={tentar.testID ?? `${testID}-tentar`} />
        {saida ? <Botao nivel="secundario" rotulo={saida.rotulo} onPress={saida.onPress} testID={saida.testID ?? `${testID}-saida`} /> : null}
        {suporte ? <Botao nivel="neutro" icone="send" rotulo={suporte.rotulo} onPress={suporte.onPress} testID={suporte.testID ?? `${testID}-suporte`} /> : null}
      </View>
      {nota ? (
        <Text style={s.nota} testID={`${testID}-nota`}>
          {nota}
        </Text>
      ) : null}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  raiz: { flex: 1, backgroundColor: colors.ground },
  // centralizado e rolável: com fonte grande do sistema o texto rola em vez de cortar; o respiro vertical evita a câmera e a barra
  conteudo: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: layout.telaLateral, paddingVertical: space.xxxl + space.lg, gap: space.xxl },
  topo: { alignItems: 'center', gap: space.md },
  icone: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.warningBg, alignItems: 'center', justifyContent: 'center' },
  titulo: { ...fonte.displayBold, fontSize: 22, lineHeight: 28, color: colors.ink, textAlign: 'center' },
  texto: { ...fonte.body, fontSize: 16, lineHeight: 22, color: colors.ink2, textAlign: 'center' },
  acoes: { gap: space.sm },
  nota: { ...fonte.body, fontSize: 14, lineHeight: 18, color: colors.ink2, textAlign: 'center' },
});
