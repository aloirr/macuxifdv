/**
 * Barra de progresso do total (R-20261115-100000, RD-0635): a mesma da tela de entrada (docs/design/entrada-sync.md §2),
 * reaproveitada no popup da sincronização completa (`Dialogo` sem botões). Linha "rótulo · N%" e trilho de 6 dp; o
 * preenchimento anda em 240 ms (na hora com "reduzir movimento"). `pct` nulo = sem medida: sem número e com um trecho fixo.
 * Cores do tema da entrada (`TEMAS_ENTRADA` / `temaDaEntrada`).
 */
import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';

import { duracaoMovimento } from './movimento';
import { fonte } from './theme';

/** Trecho da barra quando não há medida (`pct` nulo). */
export const TRECHO_SEM_MEDIDA = 30;

export function BarraProgresso({
  rotulo,
  pct: pctBruto,
  cores,
  reduzirMovimento = false,
  rotuloAcessivel,
  testID = 'entrada',
}: {
  /** "Etapa 3 de 5 · Catálogo e preços"; o leitor anuncia só a troca dele (o percentual não é lido a cada passo). */
  rotulo: string;
  /** 0..100; `null` = sem medida. */
  pct: number | null;
  cores: { texto: string; trilho: string; preenchimento: string };
  reduzirMovimento?: boolean;
  /** Nome da barra para o leitor de tela. */
  rotuloAcessivel: string;
  /** Prefixo dos testIDs `${testID}-etapa` e `${testID}-pct`. */
  testID?: string;
}) {
  const pct = pctBruto === null ? null : Math.max(0, Math.min(100, pctBruto));
  const largura = pct ?? TRECHO_SEM_MEDIDA;
  const anim = useRef(new Animated.Value(largura)).current;
  useEffect(() => {
    if (reduzirMovimento) anim.setValue(largura);
    else
      Animated.timing(anim, {
        toValue: largura,
        duration: duracaoMovimento('barra', false),
        useNativeDriver: false,
      }).start();
  }, [largura, reduzirMovimento, anim]);
  return (
    <View style={{ gap: 8 }}>
      <View style={s.linha}>
        <Text
          testID={`${testID}-etapa`}
          style={[s.rotulo, { color: cores.texto }]}
          accessibilityLiveRegion="polite"
          accessibilityLabel={rotulo}
          numberOfLines={1}
        >
          {rotulo}
        </Text>
        {pct === null ? null : (
          <Text
            testID={`${testID}-pct`}
            style={[s.pct, { color: cores.texto }]}
            importantForAccessibility="no"
            accessibilityElementsHidden
          >
            {pct}%
          </Text>
        )}
      </View>
      <View
        style={[s.trilho, { backgroundColor: cores.trilho }]}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={rotuloAcessivel}
        accessibilityValue={pct === null ? undefined : { min: 0, max: 100, now: pct }}
      >
        <Animated.View
          style={[
            s.preenchimento,
            {
              backgroundColor: cores.preenchimento,
              width: anim.interpolate({ inputRange: [0, 100], outputRange: ['0%', '100%'] }),
            },
          ]}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  rotulo: { flex: 1, ...fonte.body, fontSize: 14 },
  pct: { ...fonte.semibold, fontSize: 14, fontVariant: ['tabular-nums'] },
  trilho: { height: 6, borderRadius: 3, overflow: 'hidden' },
  preenchimento: { height: 6, borderRadius: 3 },
});
