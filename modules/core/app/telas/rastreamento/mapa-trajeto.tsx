/**
 * Mapa do trajeto do dia (T-0156; spec §3): desenhado no aparelho em SVG, sem provedor de mapa (o trajeto não sai do aparelho; desenho §9).
 * Fundo Névoa, traço Azul noite 3 dp, trecho tracejado onde houve pausa, círculo vazado no início, cheio no fim e com halo no último ponto
 * de hoje. Sem arrastar nem zoom. O mapa é um elemento só para o leitor de tela, com o resumo falado.
 */
import { colors } from '@macuxi/ui/mobile';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import type { PontoDoTrajeto } from '../../../contracts';
import { projetarPontos, trechosDoTrajeto, type PausaDoDia } from '../../lib/rastreamento-local';

const ALTURA = 220;
const MARGEM = 16;

export function MapaTrajeto({ pontos, pausas, ultimoDeHoje, leitura }: { pontos: readonly PontoDoTrajeto[]; pausas: readonly PausaDoDia[]; ultimoDeHoje: boolean; leitura: string }) {
  const [largura, setLargura] = useState(320);
  const ordenados = [...pontos].sort((a, b) => Date.parse(a.capturado_em) - Date.parse(b.capturado_em));
  const xy = projetarPontos(ordenados, largura, ALTURA, MARGEM);
  const posicao = new Map(ordenados.map((p, i) => [p, xy[i]!]));
  const { solidos, tracejados } = trechosDoTrajeto(ordenados, pausas);
  const como = (trecho: PontoDoTrajeto[]) => trecho.map((p) => `${posicao.get(p)!.x},${posicao.get(p)!.y}`).join(' ');
  const inicio = xy[0];
  const fim = xy.at(-1);
  return (
    <View
      style={styles.mapa}
      accessible
      accessibilityRole="image"
      accessibilityLabel={leitura}
      onLayout={(e) => {
        const w = Math.round(e.nativeEvent.layout.width) - 2;
        if (w > 50) setLargura(w);
      }}
      testID="meu-trajeto.mapa">
      <Svg width={largura} height={ALTURA}>
        {solidos.map((s, i) => (
          <Polyline key={`s${i}`} points={como(s)} stroke={colors.faixa} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        ))}
        {tracejados.map((s, i) => (
          <Polyline key={`t${i}`} points={como(s)} stroke={colors.ink3} strokeWidth={3} strokeDasharray="6 6" strokeLinecap="round" fill="none" />
        ))}
        {inicio ? <Circle cx={inicio.x} cy={inicio.y} r={7} fill={colors.surface} stroke={colors.faixa} strokeWidth={3} /> : null}
        {fim && xy.length > 1 ? (
          <>
            {ultimoDeHoje ? <Circle cx={fim.x} cy={fim.y} r={13} fill={colors.accentSoft} /> : null}
            <Circle cx={fim.x} cy={fim.y} r={7} fill={colors.faixa} />
          </>
        ) : null}
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  mapa: { height: ALTURA, borderRadius: 18, overflow: 'hidden', backgroundColor: colors.mapBg, borderWidth: 1, borderColor: colors.mapBorder },
});
