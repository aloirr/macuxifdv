/**
 * RD-0951: `CampoTexto`, o campo de texto com rótulo do app (Campo e Gestão), e `RotuloCampo`, o rótulo de campo único.
 * O `CampoSenha` usa o mesmo rótulo e a mesma entrada (`ESTILO_CAMPO`), então "Código da empresa", "E-mail" e "Senha" saem
 * no mesmo peso e no mesmo tamanho (manual da marca §5.2: mesmo papel, mesmo peso).
 *
 *   Código da empresa          ← rótulo de campo 14/600
 *   [ acme                   ] ← 52 dp, texto 16/400
 *   Informe o código.          ← erro 12, vermelho (só quando há)
 *
 * v1.0.28 (pré-cadastro, docs/design/telas/campo-cliente-pre-cadastro.md §3):
 * - `mascara` ('documento' | 'cep' | 'telefone'): pontuação ao digitar e teclado numérico (`campo-mascara.ts`); `aoMudar`
 *   recebe o texto formatado (o módulo guarda `somenteDigitos`).
 * - `opcional`: "Complemento (opcional)" no rótulo; obrigatório não leva marca.
 * - `falta`: a marca do formulário do Campo (T-0166: borda `danger` de 2 dp + `TextoDaFalta`); use com `faltaVisivel`.
 */
import type { Ref } from 'react';
import { StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { aplicarMascara, leituraDoRotulo, propsDeTecladoDaMascara, SUFIXO_OPCIONAL, type MascaraCampo } from './campo-mascara';
import { MARCA_DA_FALTA } from './falta';
import { TextoDaFalta } from './falta-rn';
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
  /** A mesma marca do `bordaDaFalta` (T-0166), tipada para o TextInput. */
  entradaComFalta: { borderColor: MARCA_DA_FALTA.cor, borderWidth: MARCA_DA_FALTA.larguraBorda },
  erro: { ...fonte.body, fontSize: 12, color: colors.danger },
  opcional: { ...fonte.body, color: colors.ink3 },
});

/**
 * Rótulo de campo (acima ou ao lado da entrada), o único do kit (RD-0953). Use quando o controle não é um `CampoTexto`
 * (ex.: `ListaSuspensa`, `Desconto`, data). `numberOfLines`: com fonte grande, quebra em até N linhas.
 */
export function RotuloCampo({
  children,
  nativeID,
  numberOfLines,
  opcional,
}: {
  children: string;
  nativeID?: string;
  numberOfLines?: number;
  /** Campo que a empresa deixou opcional: " (opcional)" em `ink3`. */
  opcional?: boolean;
}) {
  return (
    <Text style={ESTILO_CAMPO.rotulo} nativeID={nativeID} numberOfLines={numberOfLines} accessibilityLabel={leituraDoRotulo(children, opcional)}>
      {children}
      {opcional ? <Text style={ESTILO_CAMPO.opcional}>{` ${SUFIXO_OPCIONAL}`}</Text> : null}
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
  /** Pontuação ao digitar e teclado numérico; `aoMudar` recebe o texto já formatado. */
  mascara?: MascaraCampo;
  /** " (opcional)" no rótulo. Obrigatório não leva marca. */
  opcional?: boolean;
  /** Falta já visível (`faltaVisivel`): borda `danger` de 2 dp e o texto embaixo, com ícone (padrão do formulário, T-0166). */
  falta?: string | null;
};

export function CampoTexto({ rotulo, valor, aoMudar, erro, inputRef, mascara, opcional, falta, ...resto }: CampoTextoProps) {
  const teclado = mascara ? propsDeTecladoDaMascara(mascara) : null;
  const leitura = [leituraDoRotulo(rotulo, opcional), falta?.trim() ?? ''].filter(Boolean).join(', ');
  return (
    <View style={ESTILO_CAMPO.caixa}>
      <RotuloCampo opcional={opcional}>{rotulo}</RotuloCampo>
      <TextInput
        autoCorrect={false}
        placeholderTextColor={colors.ink3}
        {...teclado}
        {...resto}
        ref={inputRef}
        value={mascara ? aplicarMascara(mascara, valor) : valor}
        onChangeText={mascara ? (texto) => aoMudar(aplicarMascara(mascara, texto)) : aoMudar}
        accessibilityLabel={leitura}
        style={[ESTILO_CAMPO.entrada, erro ? ESTILO_CAMPO.entradaComErro : null, falta ? ESTILO_CAMPO.entradaComFalta : null]}
      />
      {typeof erro === 'string' && erro ? <Text style={ESTILO_CAMPO.erro}>{erro}</Text> : null}
      <TextoDaFalta texto={falta} />
    </View>
  );
}
