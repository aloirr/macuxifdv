/**
 * Quantidade do item em KG e M (RN-VEN-02 v3, ADR 0076): "− 1,25 +" com teclado de vírgula, até 4 casas. As outras unidades
 * continuam no `Passo` do kit (teclado inteiro). A conta e a leitura do texto ficam em `lib/quantidade-digitada.ts` (sem float).
 * Com a trava fechada (ADR 0076 D6) vale só o inteiro e a vírgula devolve a mensagem curta.
 */
import { colors, fonte, Icon } from '@macuxi/ui/mobile';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { lerQuantidadeDigitada, MENSAGEM_SO_INTEIRO, passoDaQuantidade, tecladoDaQuantidade, textoDaQuantidade } from '../lib/quantidade-digitada';

export interface PropsCampoQuantidade {
  valor: number;
  unidade: string;
  fracaoLiberada: boolean;
  onChange: (n: number) => void;
  rotulo: string;
  rotuloDiminuir: string;
  rotuloAumentar: string;
  desligadoAumentar?: boolean;
  testID?: string;
}

export function CampoQuantidade({ valor, unidade, fracaoLiberada, onChange, rotulo, rotuloDiminuir, rotuloAumentar, desligadoAumentar, testID = 'quantidade' }: PropsCampoQuantidade) {
  const [texto, setTexto] = useState(textoDaQuantidade(valor));
  const [aviso, setAviso] = useState(false);
  const vivo = useRef({ valor, texto: textoDaQuantidade(valor) });
  vivo.current.valor = valor;
  useEffect(() => {
    vivo.current.texto = textoDaQuantidade(valor);
    setTexto(vivo.current.texto);
  }, [valor]);
  const gravar = (n: number) => {
    vivo.current.valor = n;
    vivo.current.texto = textoDaQuantidade(n);
    setTexto(vivo.current.texto);
    if (n !== valor) onChange(n);
  };
  const digitar = (t: string) => {
    const r = lerQuantidadeDigitada(t, unidade, fracaoLiberada);
    setAviso(r.so_inteiro);
    // o texto digitado fica como está (a vírgula de "1," não some); só vale a quantidade positiva já lida
    const limpo = fracaoLiberada ? t.replace(/[^\d,]/g, '').replace(/,(.*),/, ',$1') : t.replace(/\D/g, '');
    vivo.current.texto = limpo;
    setTexto(limpo);
    if (r.valor !== null && r.valor > 0 && r.valor !== vivo.current.valor) {
      vivo.current.valor = r.valor;
      onChange(r.valor);
    }
  };
  const confirmar = () => {
    const r = lerQuantidadeDigitada(vivo.current.texto, unidade, fracaoLiberada);
    gravar(r.valor !== null && r.valor > 0 ? r.valor : vivo.current.valor);
    setAviso(false);
  };
  const tocar = (d: 1 | -1) => {
    const r = lerQuantidadeDigitada(vivo.current.texto, unidade, fracaoLiberada);
    const base = r.valor !== null && r.valor > 0 ? r.valor : vivo.current.valor;
    gravar(passoDaQuantidade(base, d));
  };
  const podeDiminuir = valor > 1;
  return (
    <View style={{ gap: 4 }}>
      <View style={s.linha} testID={testID}>
        <Botao icone="minus" rotulo={rotuloDiminuir} desligado={!podeDiminuir} onPress={() => tocar(-1)} testID={`${testID}-menos`} />
        <TextInput
          testID={`${testID}-valor`}
          value={texto}
          onChangeText={digitar}
          onBlur={confirmar}
          onSubmitEditing={confirmar}
          keyboardType={tecladoDaQuantidade(unidade)}
          selectTextOnFocus
          accessibilityLabel={rotulo}
          style={s.valor}
        />
        <Botao icone="plus" rotulo={rotuloAumentar} desligado={Boolean(desligadoAumentar)} onPress={() => tocar(1)} testID={`${testID}-mais`} />
      </View>
      {aviso ? (
        <Text style={s.aviso} testID={`${testID}-aviso`}>
          {MENSAGEM_SO_INTEIRO}
        </Text>
      ) : null}
    </View>
  );
}

function Botao({ icone, rotulo, desligado, onPress, testID }: { icone: 'plus' | 'minus'; rotulo: string; desligado: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={rotulo} accessibilityState={{ disabled: desligado }} disabled={desligado} onPress={onPress} style={({ pressed }) => [s.botao, desligado && { opacity: 0.4 }, pressed && { backgroundColor: colors.lineSoft }]}>
      <Icon name={icone} size={16} color={colors.ink} strokeWidth={2.2} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  linha: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  botao: { width: 48, height: 48, borderRadius: 8, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  valor: { height: 48, minWidth: 72, padding: 0, textAlign: 'center', ...fonte.semibold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'], borderBottomWidth: 1, borderBottomColor: colors.lineStrong },
  aviso: { ...fonte.semibold, fontSize: 12, color: colors.danger },
});
