/**
 * R-20261115-100000 (docs/design/sync-completa/spec.md §4): popup de progresso SEM botão e sem ✕ (a sincronização completa).
 * Janela no meio da tela sobre o `scrim`, raio 20, margem 24 dp; o toque fora não fecha e o Voltar do Android só fecha com
 * erro. Linha e barra iguais às da tela de entrada no tema Pérola (`TEMAS_ENTRADA.perola`, docs/design/entrada-sync.md §2).
 * Com `erro`, a linha do erro toma o lugar da linha da barra e aparecem "Tentar de novo" (principal) e "Fechar" (neutro).
 * Fechar sozinho no fim e manter a tela acesa ficam com o shell. Textos prontos do shell (`TEXTOS_SYNC_COMPLETA`).
 */
import { useEffect } from 'react';
import { AccessibilityInfo, Modal, StyleSheet, Text, View } from 'react-native';

import { TEMAS_ENTRADA } from './entrada';
import { useReduzirMovimento } from './movimento-rn';
import { percentualDaBarra } from './sincronizacao-completa';
import { ALTURA, colors, fonts, type as t } from './theme';
import { Button } from './ui';

const TEMA = TEMAS_ENTRADA.perola;

export function DialogoProgresso({
  visivel,
  titulo,
  texto,
  linha,
  percentual,
  erro,
  onTentarDeNovo,
  onFechar,
  testID = 'dialogo-progresso',
}: {
  visivel: boolean;
  titulo: string;
  texto: string;
  /** "Etapa 3 de 5 · Catálogo e preços" ou "Pronto" — texto pronto do shell */
  linha: string;
  /** 0..100 */
  percentual: number;
  /** linha do erro ("Parou na etapa 3 de 5"); com ela, no lugar da linha da barra, aparecem "Tentar de novo" (principal) e "Fechar" (neutro), e só então o Voltar fecha (onFechar) */
  erro?: string | null;
  onTentarDeNovo?: () => void;
  onFechar?: () => void;
  testID?: string;
}) {
  const reduzir = useReduzirMovimento();
  const pct = percentualDaBarra(percentual);
  const comErro = Boolean(erro && erro.trim());
  useEffect(() => {
    if (visivel) AccessibilityInfo.announceForAccessibility(titulo);
  }, [visivel, titulo]);
  if (!visivel) return null;
  return (
    <Modal visible transparent animationType={reduzir ? 'none' : 'fade'} statusBarTranslucent onRequestClose={() => (comErro ? onFechar?.() : undefined)}>
      <View style={s.fundo}>
        <View style={s.janela} testID={testID} accessibilityViewIsModal>
          <Text style={s.titulo} accessibilityRole="header" testID={`${testID}-titulo`}>
            {titulo}
          </Text>
          <Text style={s.texto}>{texto}</Text>
          {comErro ? (
            <Text style={[s.linhaTexto, { color: TEMA.erro }]} testID={`${testID}-erro`} accessibilityLiveRegion="polite">
              {erro}
            </Text>
          ) : (
            <View style={s.linha} accessibilityLiveRegion="polite" accessible accessibilityLabel={`${linha}, ${pct}%`} testID={`${testID}-linha`}>
              <Text style={[s.linhaTexto, s.linhaEtapa]} numberOfLines={1}>
                {linha}
              </Text>
              <Text style={[s.linhaTexto, s.linhaPct]}>{`${pct}%`}</Text>
            </View>
          )}
          <View
            style={s.trilho}
            testID={`${testID}-barra`}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel="Sincronização"
            accessibilityValue={{ min: 0, max: 100, now: pct }}>
            <View style={[s.preenchimento, { width: `${pct}%` }]} />
          </View>
          {comErro ? (
            <View style={s.botoes}>
              <Button testID={`${testID}-tentar`} label="Tentar de novo" variant="accent" height={ALTURA.principal} onPress={onTentarDeNovo} />
              <Button testID={`${testID}-fechar`} label="Fechar" variant="ghost" height={ALTURA.secundario} onPress={onFechar} />
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  fundo: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: 24 },
  janela: { width: '100%', maxWidth: 420, backgroundColor: colors.surface, borderRadius: 20, padding: 20, gap: 10 },
  titulo: { ...t.titulo },
  texto: { fontFamily: fonts.body, fontSize: 15, lineHeight: 21, color: colors.ink2 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  linhaTexto: { fontFamily: fonts.body, fontSize: 13, color: TEMA.texto, marginTop: 6 },
  linhaEtapa: { flex: 1, minWidth: 0, marginTop: 0 },
  linhaPct: { fontFamily: fonts.bold, fontVariant: ['tabular-nums'], marginTop: 0 },
  trilho: { height: 6, borderRadius: 3, backgroundColor: TEMA.trilho, overflow: 'hidden' },
  preenchimento: { height: 6, borderRadius: 3, backgroundColor: TEMA.preenchimento },
  botoes: { gap: 10, marginTop: 8 },
});
