/**
 * Barra do total da sincronização, extraída da `Barra` da tela de entrada (`apps/mobile/src/components/tela-entrada.tsx`,
 * T-0172; spec docs/design/entrada-sync.md §2 e §3) para o kit, para a tela de carga e o popup da sincronização completa
 * usarem a mesma barra (docs/design/sincronizacao-completa.md §2.1). Mesmo desenho e mesmos testIDs da original
 * (`entrada-etapa`, `entrada-pct` com o `testID` padrão), para a troca no shell não mudar nada na tela.
 *
 * Linha "Etapa n de N · nome" à esquerda e o percentual à direita (Plex Sans 13 / Bold 13 tabular); trilho de 6 dp, raio 3,
 * a largura anima em 240 ms (sem animar com "reduzir movimento"). `pct` null = sem medida: sem número e um trecho fixo.
 * Com a lista de etapas na tela (`comLista`), o rótulo fica só para o leitor de tela (RD-0239).
 */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import type { TemaEntrada } from './entrada';
import { useReduzirMovimento } from './movimento-rn';
import { fonts } from './theme';

/** Duração da animação da largura (spec entrada-sync §6). */
export const DURACAO_BARRA_MS = 240;
/** Trecho da barra quando não há medida. */
export const TRECHO_SEM_MEDIDA = 30;

export function BarraProgresso({
  tema,
  rotulo,
  pct,
  comLista = false,
  reduzir: reduzirProp,
  rotuloAcessivel = 'Sincronização',
  testID = 'entrada',
}: {
  /** Cores: `temaDaEntrada(variante)` (o popup usa `temaDaEntrada('gestao')`, o claro). */
  tema: Pick<TemaEntrada, 'texto' | 'trilho' | 'preenchimento'>;
  /** "Etapa 3 de 5 · Catálogo e preços" ou "Pronto". */
  rotulo: string;
  /** 0 a 100; null = sem medida. */
  pct: number | null;
  /** A lista de etapas está na tela: o rótulo fica só para o leitor. */
  comLista?: boolean;
  /** Força o "reduzir movimento" (sem a prop, lê do aparelho). */
  reduzir?: boolean;
  /** Nome da barra para o leitor de tela. */
  rotuloAcessivel?: string;
  /** Prefixo: `{testID}-etapa` e `{testID}-pct`. */
  testID?: string;
}) {
  const doAparelho = useReduzirMovimento();
  const reduzir = reduzirProp ?? doAparelho;
  const valor = pct === null ? null : Math.max(0, Math.min(100, pct));
  const largura = valor ?? TRECHO_SEM_MEDIDA;
  const anim = useRef(new Animated.Value(largura)).current;
  useEffect(() => {
    if (reduzir) anim.setValue(largura);
    else Animated.timing(anim, { toValue: largura, duration: DURACAO_BARRA_MS, useNativeDriver: false }).start();
  }, [largura, reduzir, anim]);
  return (
    <View style={{ gap: 8 }}>
      <View style={s.linha}>
        {/* o leitor anuncia só a troca de etapa (o percentual não é lido a cada passo) */}
        <Text
          testID={`${testID}-etapa`}
          style={[s.rotulo, { color: tema.texto }]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={rotulo}
          numberOfLines={1}>
          {comLista ? '' : rotulo}
        </Text>
        {valor === null ? null : (
          <Text testID={`${testID}-pct`} style={[s.pct, { color: tema.texto }]} importantForAccessibility="no" accessibilityElementsHidden>
            {valor}%
          </Text>
        )}
      </View>
      <View
        style={[s.trilho, { backgroundColor: tema.trilho }]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={rotuloAcessivel}
        accessibilityValue={valor === null ? undefined : { min: 0, max: 100, now: valor }}>
        <Animated.View
          style={[s.preenchimento, { backgroundColor: tema.preenchimento, width: anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }) }]}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  rotulo: { flex: 1, fontFamily: fonts.body, fontSize: 13 },
  pct: { fontFamily: fonts.bold, fontSize: 13, fontVariant: ['tabular-nums'] },
  trilho: { height: 6, borderRadius: 3, overflow: 'hidden' },
  preenchimento: { height: 6, borderRadius: 3 },
});
