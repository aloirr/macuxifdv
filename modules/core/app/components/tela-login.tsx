/**
 * Formulário do login real (RF-CORE-01): código da empresa + e-mail + senha. Componente de apresentação:
 * o shell (apps/mobile) passa `onEntrar` (que chama `entrarComSenha` com o transporte HTTP, guarda os tokens e abre
 * o app) e o `codigoSalvo` do aparelho. Alvos de toque >= 48 dp; erros em português com a ação seguinte.
 * testIDs: login.tela, login.codigo-empresa, login.email, login.senha, login.entrar, login.erro, login.senha-olho, login.esqueci.
 * T-0094: `onEsqueci` (link "Esqueci a senha", alvo >= 48 dp) leva o código e o e-mail já digitados para a `TelaEsqueciSenha`;
 * `aviso` mostra, no lugar do erro, o texto de uma volta (ex.: "Esta senha não vale mais. Entre de novo.").
 */
import { estilosDeAcesso } from './estilos-de-acesso';
import { Banner, Button, colors, Screen, type as t } from '@macuxi/ui/mobile';
import { useRef, useState, type ComponentProps, type RefObject } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { normalizarCodigoEmpresa } from '../../contracts';
import { camposIniciaisDoLogin, mensagemDeErroDeLogin, propsDoCampoCodigoEmpresa, propsDoCampoSenha, rotuloOlhoSenha, validarLogin, type CamposLogin, type ErrosLogin } from '../lib/login';

export interface PropsTelaLogin {
  /** Código da empresa lembrado do último login neste aparelho. */
  codigoSalvo?: string | null;
  /** E-mail para reabrir o login preenchido (volta de Crie sua senha / Esqueci a senha). */
  emailInicial?: string;
  /** Faz o login; lança em caso de erro (a tela mostra a mensagem). */
  onEntrar: (campos: CamposLogin) => Promise<void>;
  /** Texto abaixo do formulário (ex.: versão do app). */
  rodape?: string;
  /** "Esqueci a senha": o shell abre a tela de pedido com o que já foi digitado. */
  onEsqueci?: (campos: Pick<CamposLogin, 'codigo_empresa' | 'email'>) => void;
  /** Aviso vindo de outra tela (ex.: voltou de "Crie sua senha"). */
  aviso?: string | null;
}

export function TelaLogin({ codigoSalvo, emailInicial, onEntrar, rodape, onEsqueci, aviso }: PropsTelaLogin) {
  const [campos, setCampos] = useState<CamposLogin>(camposIniciaisDoLogin(codigoSalvo, emailInicial));
  const [erros, setErros] = useState<ErrosLogin>({});
  const [erro, setErro] = useState<string | null>(null);
  const [entrando, setEntrando] = useState(false);
  const email = useRef<TextInput>(null);
  const senha = useRef<TextInput>(null);
  const [senhaVisivel, setSenhaVisivel] = useState(false);

  const mudar = (campo: keyof CamposLogin) => (v: string) => setCampos((c) => ({ ...c, [campo]: v }));

  const entrar = async () => {
    if (entrando) return;
    const enviar = { ...campos, codigo_empresa: normalizarCodigoEmpresa(campos.codigo_empresa) };
    const e = validarLogin(enviar);
    setErros(e);
    setErro(null);
    if (Object.keys(e).length > 0) return;
    setEntrando(true);
    try {
      await onEntrar(enviar);
    } catch (x) {
      setErro(mensagemDeErroDeLogin(x));
      setCampos((c) => ({ ...c, senha: '' }));
    } finally {
      setEntrando(false);
    }
  };

  return (
    <Screen gap={16} top={36} testID="login.tela">
      <Text style={t.h1}>Entrar</Text>

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
        onChangeText={(v) => mudar('codigo_empresa')(v.toUpperCase())}
        {...propsDoCampoCodigoEmpresa}
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
        {...propsDoCampoSenha(senhaVisivel, Platform.OS)}
        returnKeyType="go"
        inputRef={senha}
        onSubmitEditing={() => void entrar()}
      />

      <Button testID="login.entrar" label="Entrar" variant="accent" height={52} loading={entrando} onPress={() => void entrar()} />
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
            <Text style={styles.olhoTexto}>{olho.visivel ? 'Esconder' : 'Mostrar'}</Text>
          </Pressable>
        ) : null}
      </View>
      {erro ? <Text style={[t.small, { color: colors.danger }]}>{erro}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  ...estilosDeAcesso,
  esqueci: estilosDeAcesso.link,
  esqueciTexto: estilosDeAcesso.linkTexto,
});
