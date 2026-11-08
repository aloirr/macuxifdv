/**
 * Formulário do login real (RF-CORE-01): código da empresa + e-mail + senha. Componente de apresentação:
 * o shell (apps/mobile) passa `onEntrar` (que chama `entrarComSenha` com o transporte HTTP, guarda os tokens e abre
 * o app) e o `codigoSalvo` do aparelho. Alvos de toque >= 48 dp; erros em português com a ação seguinte.
 * testIDs: login.tela, login.codigo-empresa, login.email, login.senha, login.entrar, login.erro, login.senha-olho, login.esqueci.
 * T-0094: `onEsqueci` (link "Esqueci a senha", alvo >= 48 dp) leva o código e o e-mail já digitados para a `TelaEsqueciSenha`;
 * `aviso` mostra, no lugar do erro, o texto de uma volta (ex.: "Esta senha não vale mais. Entre de novo.").
 */
import { Banner, Button, colors, fonts, radius, Screen, type as t } from '@macuxi/ui/mobile';
import { useRef, useState, type ComponentProps, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { mensagemDeErroDeLogin, rotuloOlhoSenha, validarLogin, type CamposLogin, type ErrosLogin } from '../lib/login';

export interface PropsTelaLogin {
  /** Código da empresa lembrado do último login neste aparelho. */
  codigoSalvo?: string | null;
  /** Faz o login; lança em caso de erro (a tela mostra a mensagem). */
  onEntrar: (campos: CamposLogin) => Promise<void>;
  /** Texto abaixo do formulário (ex.: versão do app). */
  rodape?: string;
  /** "Esqueci a senha": o shell abre a tela de pedido com o que já foi digitado. */
  onEsqueci?: (campos: Pick<CamposLogin, 'codigo_empresa' | 'email'>) => void;
  /** Aviso vindo de outra tela (ex.: voltou de "Crie sua senha"). */
  aviso?: string | null;
}

export function TelaLogin({ codigoSalvo, onEntrar, rodape, onEsqueci, aviso }: PropsTelaLogin) {
  const [campos, setCampos] = useState<CamposLogin>({ codigo_empresa: codigoSalvo ?? '', email: '', senha: '' });
  const [erros, setErros] = useState<ErrosLogin>({});
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const email = useRef<TextInput>(null);
  const senha = useRef<TextInput>(null);
  const [senhaVisivel, setSenhaVisivel] = useState(false);

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

      {erro ?? aviso ? (
        <Banner tone="danger" icon="alert" testID="login.erro">
          {erro ?? aviso}
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
        secureTextEntry={!senhaVisivel}
        olho={{ visivel: senhaVisivel, alternar: () => setSenhaVisivel((v) => !v) }}
        textContentType="password"
        returnKeyType="go"
        inputRef={senha}
        onSubmitEditing={() => void entrar()}
      />

      <Button testID="login.entrar" label="Entrar" variant="dark" height={52} loading={entrando} onPress={() => void entrar()} />
      {onEsqueci ? (
        <Pressable
          testID="login.esqueci"
          accessibilityRole="button"
          accessibilityLabel="Esqueci a senha"
          onPress={() => onEsqueci({ codigo_empresa: campos.codigo_empresa, email: campos.email })}
          style={styles.esqueci}
        >
          <Text style={styles.esqueciTexto}>Esqueci a senha</Text>
        </Pressable>
      ) : null}
      {rodape ? <Text style={t.small}>{rodape}</Text> : null}
    </Screen>
  );
}

interface PropsCampo extends Omit<ComponentProps<typeof TextInput>, 'value' | 'style'> {
  rotulo: string;
  valor: string;
  erro?: string | undefined;
  inputRef?: RefObject<TextInput | null>;
  /** Botão de olho (campo de senha). */
  olho?: { visivel: boolean; alternar: () => void };
}

function Campo({ rotulo, valor, erro, inputRef, olho, ...resto }: PropsCampo) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.rotulo}>{rotulo}</Text>
      <View>
        <TextInput
          ref={inputRef}
          value={valor}
          accessibilityLabel={rotulo}
          autoCorrect={false}
          style={[styles.entrada, olho ? { paddingRight: 56 } : null, erro ? { borderColor: colors.danger } : null]}
          placeholderTextColor={colors.ink3}
          {...resto}
        />
        {olho ? (
          <Pressable
            testID="login.senha-olho"
            accessibilityRole="button"
            accessibilityLabel={rotuloOlhoSenha(olho.visivel)}
            hitSlop={4}
            onPress={olho.alternar}
            style={styles.olho}
          >
            <Text style={styles.olhoTexto}>{olho.visivel ? 'Ocultar' : 'Mostrar'}</Text>
          </Pressable>
        ) : null}
      </View>
      {erro ? <Text style={[t.small, { color: colors.danger }]}>{erro}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  marca: { fontFamily: fonts.display, fontSize: 12, letterSpacing: 1.6, color: colors.accent },
  rotulo: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  esqueci: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  esqueciTexto: { fontFamily: fonts.semibold, fontSize: 14, color: colors.accent },
  olho: { position: 'absolute', right: 0, top: 0, bottom: 0, minWidth: 52, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  olhoTexto: { fontFamily: fonts.semibold, fontSize: 12, color: colors.accent },
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
