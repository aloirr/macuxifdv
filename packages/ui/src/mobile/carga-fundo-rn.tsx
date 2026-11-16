/**
 * Componentes do indicador de carga em segundo plano e do catálogo sem sinal: desenho em docs/design/carga-em-segundo-plano.md,
 * medidas e textos em `carga-fundo.ts`.
 */
import { StyleSheet, Text, View } from 'react-native';

import { EstadoVazio } from './base';
import {
  ALTURA_CARGA_FUNDO,
  desenhoCargaFundo,
  desenhoCatalogoCarregando,
  ESPESSURA_BARRA_CARGA,
  FOLGA_TOQUE_CARGA,
} from './carga-fundo';
import { Icon } from './icon';
import { Pressionavel } from './movimento-rn';
import { colors, fonte, layout } from './theme';

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

export interface CatalogoCarregandoProps {
  /** Ícone `wifiOff` e título "Catálogo ainda carregando": na ficha e no Novo pedido, que não mostram o indicador. */
  comTitulo?: boolean;
  testID?: string;
}

/** Catálogo sem sinal durante a primeira carga, no lugar da lista ou da ficha. Na aba Catálogo, só "Busque quando tiver sinal.". */
export function CatalogoCarregando({ comTitulo = false, testID = 'catalogo-carregando' }: CatalogoCarregandoProps) {
  const d = desenhoCatalogoCarregando({ comTitulo });
  return <EstadoVazio icone={d.icone} titulo={d.titulo} texto={d.texto} testID={testID} />;
}

const s = StyleSheet.create({
  caixa: { height: ALTURA_CARGA_FUNDO, backgroundColor: colors.ground, justifyContent: 'center' },
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: layout.telaLateral },
  texto: { ...fonte.semibold, fontSize: 12, color: colors.ink2, fontVariant: ['tabular-nums'], flexShrink: 1 },
  trilho: { position: 'absolute', left: 0, right: 0, bottom: 0, height: ESPESSURA_BARRA_CARGA, backgroundColor: colors.lineSoft },
  preenchimento: { height: ESPESSURA_BARRA_CARGA, backgroundColor: colors.grafico },
});
