/**
 * RD-0951: `CampoTexto`, o campo de texto com rótulo do app (Campo e Gestão), e `RotuloCampo`, o rótulo de campo único.
 * O `CampoSenha` usa o mesmo rótulo e a mesma entrada (`ESTILO_CAMPO`), então "Código da empresa", "E-mail" e "Senha" saem
 * no mesmo peso e no mesmo tamanho (manual da marca §5.2: mesmo papel, mesmo peso).
 *
 *   Código da empresa          ← rótulo de campo 14/600
 *   [ acme                   ] ← 52 dp, texto 16/400
 *   Informe o código.          ← erro 12, vermelho (só quando há)
 */
import type { Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { colors, fonte, radius } from './theme';

/** Altura do campo (dp): a mesma do botão principal e do `CampoSenha`. */
export const ALTURA_CAMPO = 52;

/** Rótulo, entrada e erro de todo campo de texto do kit (`CampoTexto`, `CampoSenha`). */
export const ESTILO_CAMPO = StyleSheet.create({
  caixa: { gap: 4 },
  rotulo: { ...fonte.semibold, fontSize: 14, color: colors.ink },
  entrada: {
    minHeight: ALTURA_CAMPO,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    ...fonte.body,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  entradaComErro: { borderColor: colors.danger },
  erro: { ...fonte.body, fontSize: 12, color: colors.danger },
});

/**
 * Rótulo de campo (acima ou ao lado da entrada), o único do kit (RD-0953). Use quando o controle não é um `CampoTexto`
 * (ex.: `ListaSuspensa`, `Desconto`, data). `numberOfLines`: com fonte grande, quebra em até N linhas.
 */
export function RotuloCampo({ children, nativeID, numberOfLines }: { children: string; nativeID?: string; numberOfLines?: number }) {
  return (
    <Text style={ESTILO_CAMPO.rotulo} nativeID={nativeID} numberOfLines={numberOfLines}>
      {children}
    </Text>
  );
}

export type CampoTextoProps = Omit<TextInputProps, 'value' | 'onChangeText' | 'style' | 'accessibilityLabel'> & {
  /** Rótulo acima do campo e nome falado do campo ("Código da empresa", "E-mail"). */
  rotulo: string;
  valor: string;
  aoMudar: (texto: string) => void;
  /** Texto do erro, embaixo do campo; a borda fica vermelha. `true` = só a borda (o texto fica na área de alertas). */
  erro?: string | boolean | undefined;
  inputRef?: Ref<TextInput>;
};

export function CampoTexto({ rotulo, valor, aoMudar, erro, inputRef, ...resto }: CampoTextoProps) {
  return (
    <View style={ESTILO_CAMPO.caixa}>
      <RotuloCampo>{rotulo}</RotuloCampo>
      <TextInput
        autoCorrect={false}
        placeholderTextColor={colors.ink3}
        {...resto}
        ref={inputRef}
        value={valor}
        onChangeText={aoMudar}
        accessibilityLabel={rotulo}
        style={[ESTILO_CAMPO.entrada, erro ? ESTILO_CAMPO.entradaComErro : null]}
      />
      {typeof erro === 'string' && erro ? <Text style={ESTILO_CAMPO.erro}>{erro}</Text> : null}
    </View>
  );
}
