/**
 * Formulário do login real (RF-CORE-01): código da empresa + e-mail + senha. Componente de apresentação:
 * o shell (apps/mobile) passa `onEntrar` (que chama `entrarComSenha` com o transporte HTTP, guarda os tokens e abre
 * o app) e o `codigoSalvo` do aparelho. Alvos de toque >= 48 dp; erros em português com a ação seguinte.
 * testIDs: login.tela, login.codigo-empresa, login.email, login.senha, login.entrar, login.erro.
 */
import { Banner, Button, colors, fonts, radius, Screen, type as t } from '@macuxi/ui/mobile';
import { useRef, useState, type ComponentProps, type RefObject } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { mensagemDeErroDeLogin, validarLogin, type CamposLogin, type ErrosLogin } from '../lib/login';

export interface PropsTelaLogin {
  /** Código da empresa lembrado do último login neste aparelho. */
  codigoSalvo?: string | null;
  /** Faz o login; lança em caso de erro (a tela mostra a mensagem). */
  onEntrar: (campos: CamposLogin) => Promise<void>;
  /** Texto abaixo do formulário (ex.: versão do app). */
  rodape?: string;
}

export function TelaLogin({ codigoSalvo, onEntrar, rodape }: PropsTelaLogin) {
  const [campos, setCampos] = useState<CamposLogin>({ codigo_empresa: codigoSalvo ?? '', email: '', senha: '' });
  const [erros, setErros] = useState<ErrosLogin>({});
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const email = useRef<TextInput>(null);
  const senha = useRef<TextInput>(null);

  const mudar = (campo: keyof CamposLogin) => (v: string) => setCampos((c) => ({ ...c, [campo]: v }));

  const entrar = async () => {
    if (entrando) return;
    const e = validarLogin(campos);
    setErros(e);
    setErro(null);
    if (Object.keys(e).length > 0) return;
    setEntrando(true);
    try {
      await onEntrar(campos);
    } catch (x) {
      setErro(mensagemDeErroDeLogin(x));
      setCampos((c) => ({ ...c, senha: '' }));
    } finally {
      setEntrando(false);
    }
  };

  return (
    <Screen gap={16} top={36} testID="login.tela">
      <View style={{ gap: 4 }}>
        <Text style={styles.marca}>MACUXI FDV</Text>
        <Text style={t.h1}>Entrar</Text>
        <Text style={t.sub}>Use o código da sua empresa, o seu e-mail e a sua senha.</Text>
      </View>

      {erro ? (
        <Banner tone="danger" icon="alert" testID="login.erro">
          {erro}
        </Banner>
      ) : null}

      <Campo
        rotulo="Código da empresa"
        valor={campos.codigo_empresa}
        erro={erros.codigo_empresa}
        testID="login.codigo-empresa"
        onChangeText={mudar('codigo_empresa')}
        autoCapitalize="none"
        returnKeyType="next"
        onSubmitEditing={() => email.current?.focus()}
      />
      <Campo
        rotulo="E-mail"
        valor={campos.email}
        erro={erros.email}
        testID="login.email"
        onChangeText={mudar('email')}
        autoCapitalize="none"
        keyboardType="email-address"
        textContentType="username"
        returnKeyType="next"
        inputRef={email}
        onSubmitEditing={() => senha.current?.focus()}
      />
      <Campo
        rotulo="Senha"
        valor={campos.senha}
        erro={erros.senha}
        testID="login.senha"
        onChangeText={mudar('senha')}
        secureTextEntry
        textContentType="password"
        returnKeyType="go"
        inputRef={senha}
        onSubmitEditing={() => void entrar()}
      />

      <Button testID="login.entrar" label="Entrar" variant="dark" height={52} loading={entrando} onPress={() => void entrar()} />
      {rodape ? <Text style={t.small}>{rodape}</Text> : null}
    </Screen>
  );
}

interface PropsCampo extends Omit<ComponentProps<typeof TextInput>, 'value' | 'style'> {
  rotulo: string;
  valor: string;
  erro?: string | undefined;
  inputRef?: RefObject<TextInput | null>;
}

function Campo({ rotulo, valor, erro, inputRef, ...resto }: PropsCampo) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.rotulo}>{rotulo}</Text>
      <TextInput
        ref={inputRef}
        value={valor}
        accessibilityLabel={rotulo}
        autoCorrect={false}
        style={[styles.entrada, erro ? { borderColor: colors.danger } : null]}
        placeholderTextColor={colors.ink3}
        {...resto}
      />
      {erro ? <Text style={[t.small, { color: colors.danger }]}>{erro}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  marca: { fontFamily: fonts.display, fontSize: 12, letterSpacing: 1.6, color: colors.accent },
  rotulo: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  entrada: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.lineStrong,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
  },
});
