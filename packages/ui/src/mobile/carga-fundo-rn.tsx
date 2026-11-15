/**
 * Onda 1 do catálogo, solução 5 (docs/design/carga-em-segundo-plano.md): `IndicadorCargaFundo`, a linha fina no topo das
 * abas enquanto a primeira carga continua em segundo plano ("Catálogo 63%"). O shell monta enquanto `pendentes` não está
 * vazio e desmonta ao terminar; o toque abre o detalhe da carga (rota do shell). Não é aviso (RN-VEN-42) e não explica o
 * que o app faz por trás (R-20261110-192153). Linha de 32 dp no Pérola, ícone 14 + texto 12 semibold `ink2` (7,03:1),
 * barra de 2 dp no pé (trilho `lineSoft`, preenchimento `grafico`); alvo de toque 48 com hitSlop.
 * `CatalogoCarregando`: o estado vazio do catálogo sem sinal durante a carga (textos fechados em `carga-fundo.ts`).
 */
import { StyleSheet, Text, View } from 'react-native';

import { EstadoVazio } from './base';
import {
  ALTURA_CARGA_FUNDO,
  desenhoCargaFundo,
  ESPESSURA_BARRA_CARGA,
  FOLGA_TOQUE_CARGA,
  TEXTO_CATALOGO_CARREGANDO,
  TITULO_CATALOGO_CARREGANDO,
} from './carga-fundo';
import { Icon } from './icon';
import { Pressionavel } from './movimento-rn';
import { colors, fonts, layout } from './theme';

export interface IndicadorCargaFundoProps {
  /** Nome curto da etapa em carga ("Catálogo"). */
  etapa: string;
  /** Percentual da etapa, 0..100 (mostrado inteiro, no máximo 99 enquanto montado). */
  percentual: number;
  /** Aparelho sem sinal: a carga está parada. */
  semSinal?: boolean;
  /** Abre o detalhe da carga (tela de carga do shell). Sem ele, a linha só informa. */
  aoTocar?: () => void;
  testID?: string;
}

export function IndicadorCargaFundo({ etapa, percentual, semSinal = false, aoTocar, testID = 'carga-fundo' }: IndicadorCargaFundoProps) {
  const d = desenhoCargaFundo({ etapa, percentual, semSinal });
  const valor = { min: 0, max: 100, now: d.percentual };
  const conteudo = (
    <>
      <View style={s.linha}>
        <Icon name={d.icone} size={14} color={colors.ink2} />
        <Text style={s.texto} numberOfLines={1} testID={`${testID}-texto`}>
          {d.texto}
        </Text>
      </View>
      <View style={s.trilho}>
        <View style={[s.preenchimento, { width: `${d.percentual}%` }]} testID={`${testID}-barra`} />
      </View>
    </>
  );
  if (!aoTocar) {
    return (
      <View style={s.caixa} testID={testID} accessible accessibilityRole="progressbar" accessibilityLabel={d.rotuloAcessivel} accessibilityValue={valor}>
        {conteudo}
      </View>
    );
  }
  return (
    <Pressionavel
      style={s.caixa}
      testID={testID}
      onPress={aoTocar}
      escala={false}
      hitSlop={{ top: FOLGA_TOQUE_CARGA, bottom: FOLGA_TOQUE_CARGA }}
      accessibilityRole="button"
      accessibilityLabel={d.rotuloAcessivel}
      accessibilityHint={d.dica}
      accessibilityValue={valor}
    >
      {conteudo}
    </Pressionavel>
  );
}

/** Catálogo sem sinal durante a primeira carga: no lugar da lista e da ficha ("Catálogo ainda carregando"). */
export function CatalogoCarregando({ testID = 'catalogo-carregando' }: { testID?: string }) {
  return <EstadoVazio icone="wifiOff" titulo={TITULO_CATALOGO_CARREGANDO} texto={TEXTO_CATALOGO_CARREGANDO} testID={testID} />;
}

const s = StyleSheet.create({
  caixa: { height: ALTURA_CARGA_FUNDO, backgroundColor: colors.ground, justifyContent: 'center' },
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: layout.telaLateral },
  texto: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2, fontVariant: ['tabular-nums'], flexShrink: 1 },
  trilho: { position: 'absolute', left: 0, right: 0, bottom: 0, height: ESPESSURA_BARRA_CARGA, backgroundColor: colors.lineSoft },
  preenchimento: { height: ESPESSURA_BARRA_CARGA, backgroundColor: colors.grafico },
});
