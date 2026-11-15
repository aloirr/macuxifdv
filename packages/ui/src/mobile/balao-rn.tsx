/**
 * T-0165 (pedido-v4.md §5.3 e §5.4): `Balao`, o balão flutuante de um texto tocável.
 *   Leite em pó integral 400 g - Vale Verde      ← alvo (o filho), tocável só quando há `texto`
 *    ▲
 *   [ Lata com tampa dosadora, 12 por fardo ]     ← fundo `ink`, texto branco, até 4 linhas, largura até 300 dp
 * Abre logo abaixo do alvo, com a seta para ele (sem espaço embaixo, acima). Fecha com outro toque em qualquer lugar (o toque
 * que começaria a rolagem também fecha) e com o Voltar do Android. Um balão por vez: a camada cobre a tela enquanto está aberto.
 * TalkBack: o alvo lê `rotuloAcessivel` (o módulo junta o nome e o texto do balão); o balão não muda o foco.
 * Nenhum texto fixo. Sem `texto`, desenha só o filho, sem toque.
 */
import { useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from 'react-native';

import { BALAO, larguraMaximaDoBalao, posicaoDoBalao, type PosicaoBalao } from './balao';
import type { Retangulo } from './selecao';
import { colors, fonte } from './theme';

export function Balao({
  texto,
  children,
  rotuloAcessivel,
  tamanhoFonte = 14,
  style,
  testID = 'balao',
}: {
  /** O que o balão mostra (descrição 2; "nome - marca"). null/vazio = sem balão e sem toque. */
  texto: string | null | undefined;
  /** O alvo: o texto tocável (nome com sublinhado pontilhado, código sublinhado), desenhado pelo módulo. */
  children: ReactNode;
  /** Leitura do alvo com o texto do balão junto ("LPO-400, Leite em pó integral 400 g - Vale Verde"). */
  rotuloAcessivel?: string;
  /** 13,5 na aba Itens; 14 no Resumo. */
  tamanhoFonte?: number;
  /** Estilo da área tocável (ex.: a célula do código, com 44 dp de altura). */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const alvoRef = useRef<View | null>(null);
  const camadaRef = useRef<View | null>(null);
  const [alvoNaJanela, setAlvoNaJanela] = useState<Retangulo | null>(null);
  const [camada, setCamada] = useState<{ x: number; y: number; largura: number; altura: number } | null>(null);
  const [posicao, setPosicao] = useState<PosicaoBalao | null>(null);
  const conteudo = (texto ?? '').trim();
  if (!conteudo) {
    return (
      <View style={style} testID={testID} accessible={Boolean(rotuloAcessivel)} accessibilityLabel={rotuloAcessivel}>
        {children}
      </View>
    );
  }
  const fechar = () => {
    setAlvoNaJanela(null);
    setCamada(null);
    setPosicao(null);
  };
  const abrir = () => {
    alvoRef.current?.measureInWindow((x, y, largura, altura) => setAlvoNaJanela({ x, y, largura, altura }));
  };
  const medirCamada = () => {
    camadaRef.current?.measureInWindow((x, y, largura, altura) => setCamada({ x, y, largura, altura }));
  };
  const medirBalao = (e: LayoutChangeEvent) => {
    if (!alvoNaJanela || !camada) return;
    const { width, height } = e.nativeEvent.layout;
    // alvo em coordenadas da camada (a camada do Modal pode não começar no topo da janela)
    const alvo = { ...alvoNaJanela, x: alvoNaJanela.x - camada.x, y: alvoNaJanela.y - camada.y };
    setPosicao(posicaoDoBalao({ alvo, janela: { largura: camada.largura, altura: camada.altura }, balao: { largura: width, altura: height } }));
  };
  const aberto = alvoNaJanela !== null;
  return (
    <>
      <Pressable
        ref={alvoRef}
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={rotuloAcessivel}
        accessibilityState={{ expanded: aberto }}
        onPress={abrir}
        collapsable={false}
        style={style}>
        {children}
      </Pressable>
      <Modal visible={aberto} transparent animationType="none" onRequestClose={fechar} statusBarTranslucent>
        <View ref={camadaRef} collapsable={false} style={StyleSheet.absoluteFill} onLayout={medirCamada}>
          <Pressable style={StyleSheet.absoluteFill} onPress={fechar} onTouchMove={fechar} accessibilityRole="button" accessibilityLabel={conteudo} testID={`${testID}-fundo`} />
          {camada ? (
            <View
              pointerEvents="none"
              onLayout={medirBalao}
              testID={`${testID}-aberto`}
              style={[
                s.balao,
                { maxWidth: larguraMaximaDoBalao(camada.largura) },
                posicao ? { left: posicao.left, top: posicao.top } : s.medindo,
              ]}>
              {posicao ? <View style={[s.seta, posicao.acima ? s.setaEmbaixo : s.setaEmCima, { left: posicao.setaX - BALAO.seta }]} /> : null}
              <Text style={[s.texto, { fontSize: tamanhoFonte, lineHeight: Math.round(tamanhoFonte * 1.35) }]} numberOfLines={BALAO.linhas}>
                {conteudo}
              </Text>
            </View>
          ) : null}
        </View>
      </Modal>
    </>
  );
}

const s = StyleSheet.create({
  balao: { position: 'absolute', backgroundColor: colors.ink, borderRadius: BALAO.raio, paddingVertical: 10, paddingHorizontal: 12, elevation: 6 },
  // primeira passada: desenha fora da vista só para medir a largura e a altura
  medindo: { left: 0, top: -1000, opacity: 0 },
  texto: { ...fonte.body, color: colors.surface },
  // triângulo de bordas: a base fica colada no balão
  seta: { position: 'absolute', width: 0, height: 0, borderLeftWidth: BALAO.seta, borderRightWidth: BALAO.seta, borderLeftColor: 'transparent', borderRightColor: 'transparent' },
  setaEmCima: { top: -BALAO.seta, borderBottomWidth: BALAO.seta, borderBottomColor: colors.ink },
  setaEmbaixo: { bottom: -BALAO.seta, borderTopWidth: BALAO.seta, borderTopColor: colors.ink },
});
