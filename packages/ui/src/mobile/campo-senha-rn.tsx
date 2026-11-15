/**
 * R-20261115-071000: `CampoSenha`, o campo de senha único do app (Campo e Gestão). Spec: docs/design/campo-senha/spec.md.
 *
 *   Senha
 *   [ ••••••••                    (olho) ]   ← 52 dp; olho com alvo de 48 dp, só ícone
 *
 * Controlado: a tela guarda `visivel` e troca no `aoAlternar` (em "Crie sua senha" o mesmo estado vale para os dois campos:
 * um só toque mostra os dois). Sem `aoAlternar` o campo não tem olho ("Repita a senha", que segue o olho do campo de cima).
 * As props de teclado vêm de `propsDeTecladoDaSenha` (sem autocorreção, sem maiúscula, `new-password` na criação,
 * `visible-password` no Android quando visível) e a tela não as sobrescreve.
 */
import type { Ref } from 'react';
import { Platform, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

import { CAMPO_SENHA, iconeDoOlhoDaSenha, propsDeTecladoDaSenha } from './campo-senha';
import { rotuloDoOlhoDaSenha, type FinalidadeSenha } from '../comum/senha';
import { Icon } from './icon';
import { Pressionavel } from './movimento-rn';
import { colors, fonts, radius } from './theme';

type PropsDeTeclado = 'secureTextEntry' | 'autoCorrect' | 'autoCapitalize' | 'spellCheck' | 'autoComplete' | 'textContentType' | 'keyboardType';

export type CampoSenhaProps = Omit<TextInputProps, PropsDeTeclado | 'value' | 'onChangeText' | 'style' | 'accessibilityLabel' | 'testID'> & {
  /** Rótulo acima do campo e nome falado do campo ("Senha", "Senha nova", "Repita a senha"). */
  rotulo: string;
  valor: string;
  aoMudar: (texto: string) => void;
  /** A senha está à mostra agora (estado da tela). */
  visivel: boolean;
  /** Toque no olho. Ausente = campo sem olho (segue o olho de outro campo da mesma tela). */
  aoAlternar?: () => void;
  /** `login` (padrão): `password`; `criacao`: `new-password` ("Crie sua senha", troca de senha). */
  finalidade?: FinalidadeSenha;
  /** Falta ou erro no campo: borda vermelha (o texto do erro fica com a tela, na área de alertas). */
  erro?: boolean;
  inputRef?: Ref<TextInput>;
  /** testID do campo; o olho recebe `testIDOlho` (padrão `<testID>.olho`). */
  testID?: string;
  testIDOlho?: string;
};

export function CampoSenha({
  rotulo,
  valor,
  aoMudar,
  visivel,
  aoAlternar,
  finalidade = 'login',
  erro = false,
  inputRef,
  testID,
  testIDOlho,
  ...resto
}: CampoSenhaProps) {
  const teclado = propsDeTecladoDaSenha(visivel, finalidade, Platform.OS);
  return (
    <View style={s.caixa}>
      <Text style={s.rotulo}>{rotulo}</Text>
      <View>
        <TextInput
          {...resto}
          {...teclado}
          ref={inputRef}
          testID={testID}
          value={valor}
          onChangeText={aoMudar}
          accessibilityLabel={rotulo}
          placeholderTextColor={colors.ink3}
          style={[s.entrada, aoAlternar ? { paddingRight: CAMPO_SENHA.recuoDoTexto } : null, erro ? { borderColor: colors.danger } : null]}
        />
        {aoAlternar ? (
          <Pressionavel
            testID={testIDOlho ?? (testID ? `${testID}.olho` : undefined)}
            accessibilityRole="button"
            accessibilityLabel={rotuloDoOlhoDaSenha(visivel)}
            onPress={aoAlternar}
            style={s.olho}>
            <Icon name={iconeDoOlhoDaSenha(visivel)} size={CAMPO_SENHA.icone} color={colors.ink2} />
          </Pressionavel>
        ) : null}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  caixa: { gap: 4 },
  rotulo: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  entrada: {
    minHeight: CAMPO_SENHA.altura,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
  olho: {
    position: 'absolute',
    right: 2,
    top: (CAMPO_SENHA.altura - CAMPO_SENHA.olho) / 2,
    width: CAMPO_SENHA.olho,
    height: CAMPO_SENHA.olho,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
