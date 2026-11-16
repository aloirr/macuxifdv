/**
 * Visor de foto comum do shell (RD-0088; imagem aprovada da foto do PDV, docs/design/telas/T-0147-fotos-pdv.png, quadro 3):
 * fundo escuro, fechar (X) com título e subtítulo no topo, a foto inteira no meio, zoom por pinça (até 4x), arraste com a
 * foto aproximada e toque duplo (aproxima / volta). Sem biblioteca de gestos: `PanResponder` + `Animated` do React Native.
 * Só desenha: a fonte e o estado vêm da rota (`app/foto.tsx`); regras puras em `@/lib/visor-foto`.
 */
import { colors, fonte, Icon } from '@macuxi/ui/mobile';
import { useMemo, useRef } from 'react';
import { ActivityIndicator, Animated, Image, PanResponder, Pressable, StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ROTULO_FECHAR_FOTO } from '@/lib/foto-pdv';
import {
  ARRASTE_MIN_PX,
  distancia,
  ehToqueDuplo,
  escalaDaPinca,
  escalaDoToqueDuplo,
  ESCALA_MIN,
  limitarDeslocamento,
  ROTULO_IMAGEM_FOTO,
  type Area,
  type EstadoVisor,
  type Ponto,
  type Toque,
} from '@/lib/visor-foto';

export interface PropsVisorDeFoto {
  titulo?: string;
  subtitulo?: string;
  estado: EstadoVisor;
  aoFechar: () => void;
  /** A imagem não abriu (endereço de rede caiu, arquivo sumiu): a rota troca o estado pela mensagem. */
  aoFalharImagem?: () => void;
}

export function VisorDeFoto({ titulo, subtitulo, estado, aoFechar, aoFalharImagem }: PropsVisorDeFoto) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[s.tela, { paddingBottom: insets.bottom }]} testID="visor-foto">
      <View style={s.topo}>
        <Pressable onPress={aoFechar} hitSlop={12} style={({ pressed }) => (pressed ? s.fecharPressionado : null)} accessibilityRole="button" accessibilityLabel={ROTULO_FECHAR_FOTO} testID="visor-foto-fechar">
          <Icon name="close" size={22} color={colors.surface} />
        </Pressable>
        <View style={s.titulos}>
          {titulo ? <Text style={s.titulo} numberOfLines={1}>{titulo}</Text> : null}
          {subtitulo ? <Text style={s.subtitulo} numberOfLines={1}>{subtitulo}</Text> : null}
        </View>
      </View>
      <View style={s.corpo}>
        {estado.tipo === 'carregando' ? (
          <ActivityIndicator color={colors.surface} testID="visor-foto-carregando" />
        ) : estado.tipo === 'ok' ? (
          <FotoComZoom key={estado.uri} uri={estado.uri} rotulo={ROTULO_IMAGEM_FOTO} aoFalhar={aoFalharImagem} />
        ) : (
          <Text style={s.erro} testID="visor-foto-erro" accessibilityLiveRegion="polite">{estado.mensagem}</Text>
        )}
      </View>
    </View>
  );
}

function pontos(e: GestureResponderEvent): Ponto[] {
  return e.nativeEvent.touches.map((t) => ({ x: t.pageX, y: t.pageY }));
}

/** A foto com pinça, arraste e toque duplo. A chave (`uri`) zera o zoom quando a foto muda. */
function FotoComZoom({ uri, rotulo, aoFalhar }: { uri: string; rotulo: string; aoFalhar?: (() => void) | undefined }) {
  const escala = useRef(new Animated.Value(1)).current;
  const tx = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(0)).current;
  const z = useRef({
    escala: 1,
    x: 0,
    y: 0,
    area: { largura: 0, altura: 0 } as Area,
    inicio: { n: 0, escala: 1, x: 0, y: 0, dist: 1, toque: { x: 0, y: 0 } as Ponto },
    moveu: false,
    ultimo: null as Toque | null,
  }).current;

  const respondedor = useMemo(() => {
    const aplicar = (s: number, d: Ponto) => {
      z.escala = s;
      z.x = d.x;
      z.y = d.y;
      escala.setValue(s);
      tx.setValue(d.x);
      ty.setValue(d.y);
    };
    const iniciar = (p: Ponto[]) => {
      z.inicio = { n: p.length, escala: z.escala, x: z.x, y: z.y, dist: p.length >= 2 ? distancia(p[0]!, p[1]!) : 1, toque: p[0] ?? { x: 0, y: 0 } };
    };
    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        z.moveu = false;
        iniciar(pontos(e));
      },
      onPanResponderMove: (e) => {
        const p = pontos(e);
        if (p.length === 0) return;
        if (p.length !== z.inicio.n) iniciar(p); // entrou ou saiu um dedo: nova base, sem pulo
        if (p.length >= 2) {
          z.moveu = true;
          const s = escalaDaPinca(z.inicio.escala, z.inicio.dist, distancia(p[0]!, p[1]!));
          aplicar(s, limitarDeslocamento({ x: z.inicio.x, y: z.inicio.y }, s, z.area));
          return;
        }
        const dx = p[0]!.x - z.inicio.toque.x;
        const dy = p[0]!.y - z.inicio.toque.y;
        if (Math.abs(dx) > ARRASTE_MIN_PX || Math.abs(dy) > ARRASTE_MIN_PX) z.moveu = true;
        if (z.escala > ESCALA_MIN) aplicar(z.escala, limitarDeslocamento({ x: z.inicio.x + dx, y: z.inicio.y + dy }, z.escala, z.area));
      },
      onPanResponderRelease: (e) => {
        if (!z.moveu) {
          const toque: Toque = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, t: Date.now() };
          if (ehToqueDuplo(z.ultimo, toque)) {
            z.ultimo = null;
            const s = escalaDoToqueDuplo(z.escala);
            aplicar(s, limitarDeslocamento({ x: z.x, y: z.y }, s, z.area));
            return;
          }
          z.ultimo = toque;
        } else {
          z.ultimo = null;
        }
        if (z.escala <= ESCALA_MIN + 0.01) aplicar(ESCALA_MIN, { x: 0, y: 0 });
      },
      onPanResponderTerminationRequest: () => false,
    });
  }, [escala, tx, ty, z]);

  const medir = (e: LayoutChangeEvent) => {
    z.area = { largura: e.nativeEvent.layout.width, altura: e.nativeEvent.layout.height };
  };

  return (
    <View style={s.area} onLayout={medir} {...respondedor.panHandlers} testID="visor-foto-area">
      <Animated.View style={[s.area, { transform: [{ translateX: tx }, { translateY: ty }, { scale: escala }] }]}>
        <Image source={{ uri }} style={s.imagem} resizeMode="contain" accessibilityLabel={rotulo} onError={aoFalhar} testID="visor-foto-imagem" />
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  tela: { flex: 1, backgroundColor: colors.ink },
  fecharPressionado: { opacity: 0.5 },
  topo: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 14 },
  titulos: { flex: 1, minWidth: 0 },
  titulo: { ...fonte.semibold, fontSize: 16, color: colors.surface },
  subtitulo: { ...fonte.body, fontSize: 12, color: colors.darkMuted, marginTop: 2 },
  corpo: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, overflow: 'hidden' },
  area: { width: '100%', height: '100%' },
  imagem: { width: '100%', height: '100%' },
  erro: { ...fonte.body, fontSize: 14, color: colors.darkMuted, textAlign: 'center', paddingHorizontal: 20 },
});
