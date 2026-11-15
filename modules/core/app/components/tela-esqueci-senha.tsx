/**
 * "Esqueci a senha" (T-0094; RN-CORE-34; docs/design/ciclo-de-senha.md §3). Componente de apresentação: o shell liga
 * `onPedir` ao `pedirSenhaTemporaria` (202 sempre igual). A confirmação é a MESMA em qualquer sucesso: nunca "enviamos para
 * <e-mail>", nunca verde. Exige internet. testIDs: esqueci.tela, esqueci.codigo-empresa, esqueci.email, esqueci.enviar,
 * esqueci.erro, esqueci.confirmacao, esqueci.voltar.
 *
 * Modo `dentroDoApp` (T-0178; spec trocar-senha §6): aberta pela "Trocar senha" do Perfil. Sem instrução, sem o campo "Código da
 * empresa" (vem de `inicial.codigo_empresa`, da sessão) e com o e-mail da sessão como texto fixo (`esqueci.email-fixo`); título e
 * voltar ficam na faixa (`rotuloVoltar` padrão "Trocar senha", `rotaVoltar` padrão '/profile'; `onVoltar` é opcional); a
 * confirmação usa `TEXTOS_ESQUECI.confirmacaoNoApp` e mantém o "Não chegou?"; sem botão "Voltar ao login". O fluxo do login não muda.
 */
import { estilosDeAcesso } from './estilos-de-acesso';
import {
  Banner,
  Button,
  colors,
  fonts,
  radius,
  Screen,
  toneColors,
  type as t,
  Icon,
} from '@macuxi/ui/mobile';
import { useRef, useState, type ComponentProps, type RefObject } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { TEXTOS_ESQUECI } from '../../contracts';
import {
  erroDoEsqueci,
  TEXTO_ESQUECI_CONFIRMACAO,
  TEXTO_ESQUECI_INSTRUCAO,
  TEXTO_ESQUECI_NAO_CHEGOU,
  TEXTO_SEM_INTERNET_ESQUECI,
  validarEsqueci,
  type CamposEsqueci,
  type ErrosEsqueci,
} from '../lib/senha';
import { propsDoCampoCodigoEmpresa } from '../lib/login';

interface PropsBaseEsqueci {
  /** Valores que vieram do login (ou, no modo `dentroDoApp`, da sessão). */
  inicial?: Partial<CamposEsqueci>;
  semInternet?: boolean;
  /** Pede a senha temporária; lança em caso de erro (a tela mostra a mensagem). */
  onPedir: (campos: CamposEsqueci) => Promise<void>;
}

export type PropsTelaEsqueciSenha = PropsBaseEsqueci &
  (
    | {
        dentroDoApp?: false;
        /** Volta ao login com o código e o e-mail preenchidos. */
        onVoltar: (campos: CamposEsqueci) => void;
      }
    | {
        /** Aberta de dentro do app (Perfil → Trocar senha): código e e-mail da sessão, sem edição; voltar pela faixa. */
        dentroDoApp: true;
        onVoltar?: () => void;
        rotuloVoltar?: string;
        rotaVoltar?: string;
      }
  );

export function TelaEsqueciSenha(props: PropsTelaEsqueciSenha) {
  const { inicial, semInternet = false, onPedir } = props;
  const dentro = props.dentroDoApp === true;
  const onVoltar = (c: CamposEsqueci) =>
    props.dentroDoApp === true ? props.onVoltar?.() : props.onVoltar(c);

  const [campos, setCampos] = useState<CamposEsqueci>({
    codigo_empresa: inicial?.codigo_empresa ?? '',
    email: inicial?.email ?? '',
  });
  const [erros, setErros] = useState<ErrosEsqueci>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const email = useRef<TextInput>(null);
  // Dentro do app, título e voltar vão para a faixa do app (a volta leva à "Trocar senha").
  const cabecalhoDoApp =
    props.dentroDoApp === true
      ? {
          cabecalho: {
            titulo: TEXTOS_ESQUECI.titulo,
            voltar: {
              label: props.rotuloVoltar ?? 'Trocar senha',
              fallback: props.rotaVoltar ?? '/profile',
              ...(props.onVoltar ? { aoVoltar: props.onVoltar } : {}),
            },
          },
        }
      : {};

  const pedir = async () => {
    if (enviando) return;
    const e = validarEsqueci(campos);
    setErros(e);
    setErro(null);
    if (Object.keys(e).length > 0) return;
    setEnviando(true);
    try {
      await onPedir(campos);
      setEnviado(true);
    } catch (x) {
      setErro(erroDoEsqueci(x));
    } finally {
      setEnviando(false);
    }
  };

  if (enviado) {
    return (
      <Screen gap={16} top={36} testID="esqueci.tela" {...cabecalhoDoApp}>
        {dentro ? null : (
          <Text style={styles.titulo} accessibilityRole="header">
            Esqueci a senha
          </Text>
        )}
        <View
          testID="esqueci.confirmacao"
          accessible
          accessibilityLiveRegion="polite"
          style={[styles.aviso, { backgroundColor: toneColors.accent.bg }]}
        >
          <Icon name="send" size={18} color={toneColors.accent.fg} />
          <Text style={[styles.avisoTexto, { color: toneColors.accent.fg }]}>
            {dentro ? TEXTOS_ESQUECI.confirmacaoNoApp : TEXTO_ESQUECI_CONFIRMACAO}
          </Text>
        </View>
        <Text style={t.small}>{TEXTO_ESQUECI_NAO_CHEGOU}</Text>
        {dentro ? null : (
          <Button
            testID="esqueci.voltar"
            label="Voltar ao login"
            variant="accent"
            height={52}
            onPress={() => onVoltar(campos)}
          />
        )}
      </Screen>
    );
  }

  return (
    <Screen gap={16} top={36} testID="esqueci.tela" {...cabecalhoDoApp}>
      {semInternet ? (
        <Banner tone="warning" icon="wifiOff" testID="esqueci.sem-internet" anunciar>
          {TEXTO_SEM_INTERNET_ESQUECI}
        </Banner>
      ) : null}
      {dentro ? null : (
        <View style={{ gap: 4 }}>
          <Text style={styles.titulo} accessibilityRole="header">
            Esqueci a senha
          </Text>
          <Text style={t.sub}>{TEXTO_ESQUECI_INSTRUCAO}</Text>
        </View>
      )}

      {erro ? (
        <Banner tone="danger" icon="alert" testID="esqueci.erro" anunciar>
          {erro}
        </Banner>
      ) : null}

      {dentro ? (
        <View style={{ gap: 4 }}>
          <Text style={styles.rotulo}>E-mail</Text>
          <Text style={t.body} testID="esqueci.email-fixo">
            {campos.email}
          </Text>
        </View>
      ) : (
        <>
          <Campo
            rotulo="Código da empresa"
            valor={campos.codigo_empresa}
            erro={erros.codigo_empresa}
            testID="esqueci.codigo-empresa"
            onChangeText={(v) => setCampos((c) => ({ ...c, codigo_empresa: v }))}
            {...propsDoCampoCodigoEmpresa}
            autoFocus={!campos.codigo_empresa}
            returnKeyType="next"
            onSubmitEditing={() => email.current?.focus()}
          />
          <Campo
            rotulo="E-mail"
            valor={campos.email}
            erro={erros.email}
            testID="esqueci.email"
            onChangeText={(v) => setCampos((c) => ({ ...c, email: v }))}
            autoCapitalize="none"
            autoFocus={!!campos.codigo_empresa && !campos.email}
            keyboardType="email-address"
            textContentType="username"
            returnKeyType="go"
            inputRef={email}
            onSubmitEditing={() => void pedir()}
          />
        </>
      )}

      <Button
        testID="esqueci.enviar"
        label={enviando ? 'Enviando…' : 'Enviar senha temporária'}
        variant="accent"
        height={52}
        loading={enviando}
        onPress={() => void pedir()}
      />
      {dentro ? null : (
        <Pressable
          testID="esqueci.voltar-login"
          accessibilityRole="button"
          accessibilityLabel="Voltar ao login"
          onPress={() => onVoltar(campos)}
          style={styles.link}
        >
          <Text style={styles.linkTexto}>Voltar ao login</Text>
        </Pressable>
      )}
    </Screen>
  );
}

function Campo({
  rotulo,
  valor,
  erro,
  inputRef,
  ...resto
}: {
  rotulo: string;
  valor: string;
  erro?: string | undefined;
  inputRef?: RefObject<TextInput | null>;
} & Omit<ComponentProps<typeof TextInput>, 'value' | 'style'>) {
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
  ...estilosDeAcesso,
  aviso: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: radius.md },
  avisoTexto: { flex: 1, fontFamily: fonts.body, fontSize: 14, lineHeight: 20 },
});
