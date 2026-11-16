/**
 * "Esqueci a senha" (T-0094; RN-CORE-34; docs/design/ciclo-de-senha.md §3). Componente de apresentação: o shell liga
 * `onPedir` ao `pedirSenhaTemporaria` (202 sempre igual). A confirmação é a MESMA em qualquer sucesso: nunca "enviamos para
 * <e-mail>", nunca verde. Exige internet. testIDs: esqueci.tela, esqueci.codigo-empresa, esqueci.email, esqueci.enviar,
 * esqueci.erro, esqueci.confirmacao, esqueci.voltar.
 */
import { estilosDeAcesso } from './estilos-de-acesso';
import { Banner, Button, CampoTexto, fonte, radius, RotuloCampo, Screen, toneColors, type as t, Icon } from '@macuxi/ui/mobile';
import { useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { TEXTOS_ESQUECI, TEXTOS_TROCAR_SENHA } from '../../contracts';
import { erroDoEsqueci, TEXTO_ESQUECI_CONFIRMACAO, TEXTO_ESQUECI_INSTRUCAO, TEXTO_ESQUECI_NAO_CHEGOU, TEXTO_SEM_INTERNET_ESQUECI, validarEsqueci, type CamposEsqueci, type ErrosEsqueci } from '../lib/senha';
import { propsDoCampoCodigoEmpresa } from '../lib/login';

export interface PropsTelaEsqueciSenha {
  /** Valores que vieram do login. */
  inicial?: Partial<CamposEsqueci>;
  semInternet?: boolean;
  /** Pede a senha temporária; lança em caso de erro (a tela mostra a mensagem). */
  onPedir: (campos: CamposEsqueci) => Promise<void>;
  /** Volta ao login com o código e o e-mail preenchidos. */
  onVoltar?: (campos: CamposEsqueci) => void;
  /**
   * T-0178 (trocar-senha/spec.md §6): modo dentro do app, a partir da "Trocar senha". Sem instrução, sem "Código da empresa"
   * (vem daqui), e-mail como texto fixo, título e voltar na faixa (volta à "Trocar senha") e a confirmação do app.
   */
  dentroDoApp?: { codigoEmpresa: string; email: string };
}

export function TelaEsqueciSenha({ inicial, semInternet = false, onPedir, onVoltar, dentroDoApp }: PropsTelaEsqueciSenha) {
  const [campos, setCampos] = useState<CamposEsqueci>(
    dentroDoApp ? { codigo_empresa: dentroDoApp.codigoEmpresa, email: dentroDoApp.email } : { codigo_empresa: inicial?.codigo_empresa ?? '', email: inicial?.email ?? '' },
  );
  const [erros, setErros] = useState<ErrosEsqueci>({});
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const email = useRef<TextInput>(null);

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

  const faixa = dentroDoApp ? { cabecalho: { titulo: TEXTOS_ESQUECI.titulo, voltar: { label: TEXTOS_TROCAR_SENHA.titulo, fallback: '/trocar-senha' } } } : { top: 36 };

  if (enviado) {
    return (
      <Screen gap={16} {...faixa} testID="esqueci.tela">
        {dentroDoApp ? null : (
          <Text style={styles.titulo} accessibilityRole="header">
            {TEXTOS_ESQUECI.titulo}
          </Text>
        )}
        <View testID="esqueci.confirmacao" accessible accessibilityLiveRegion="polite" style={[styles.aviso, { backgroundColor: toneColors.accent.bg }]}>
          <Icon name="send" size={18} color={toneColors.accent.fg} />
          <Text style={[styles.avisoTexto, { color: toneColors.accent.fg }]}>{dentroDoApp ? TEXTOS_ESQUECI.confirmacaoNoApp : TEXTO_ESQUECI_CONFIRMACAO}</Text>
        </View>
        <Text style={t.small}>{TEXTO_ESQUECI_NAO_CHEGOU}</Text>
        {dentroDoApp || !onVoltar ? null : <Button testID="esqueci.voltar" label={TEXTOS_ESQUECI.voltar} variant="accent" height={52} onPress={() => onVoltar(campos)} />}
      </Screen>
    );
  }

  return (
    <Screen gap={16} {...faixa} testID="esqueci.tela">
      {semInternet ? (
        <Banner tone="warning" icon="wifiOff" testID="esqueci.sem-internet" anunciar>
          {TEXTO_SEM_INTERNET_ESQUECI}
        </Banner>
      ) : null}
      {dentroDoApp ? null : (
        <View style={{ gap: 4 }}>
          <Text style={styles.titulo} accessibilityRole="header">
            {TEXTOS_ESQUECI.titulo}
          </Text>
          <Text style={t.sub}>{TEXTO_ESQUECI_INSTRUCAO}</Text>
        </View>
      )}

      {erro ? (
        <Banner tone="danger" icon="alert" testID="esqueci.erro" anunciar>
          {erro}
        </Banner>
      ) : null}

      {dentroDoApp ? (
        <View style={{ gap: 4 }}>
          <RotuloCampo>{TEXTOS_ESQUECI.email}</RotuloCampo>
          <Text style={t.sub} testID="esqueci.email-fixo" selectable={false}>
            {dentroDoApp.email}
          </Text>
        </View>
      ) : (
        <>
          <CampoTexto
            rotulo={TEXTOS_ESQUECI.codigoEmpresa}
            valor={campos.codigo_empresa}
            erro={erros.codigo_empresa}
            testID="esqueci.codigo-empresa"
            aoMudar={(v) => setCampos((c) => ({ ...c, codigo_empresa: v }))}
            {...propsDoCampoCodigoEmpresa}
            autoFocus={!campos.codigo_empresa}
            returnKeyType="next"
            onSubmitEditing={() => email.current?.focus()}
          />
          <CampoTexto
            rotulo={TEXTOS_ESQUECI.email}
            valor={campos.email}
            erro={erros.email}
            testID="esqueci.email"
            aoMudar={(v) => setCampos((c) => ({ ...c, email: v }))}
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

      <Button testID="esqueci.enviar" label={enviando ? TEXTOS_ESQUECI.enviando : TEXTOS_ESQUECI.enviar} variant="accent" height={52} loading={enviando} onPress={() => void pedir()} />
      {dentroDoApp || !onVoltar ? null : (
        <Pressable testID="esqueci.voltar-login" accessibilityRole="button" accessibilityLabel={TEXTOS_ESQUECI.voltar} onPress={() => onVoltar(campos)} style={styles.link}>
          <Text style={styles.linkTexto}>{TEXTOS_ESQUECI.voltar}</Text>
        </Pressable>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  ...estilosDeAcesso,
  aviso: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: radius.md },
  avisoTexto: { flex: 1, ...fonte.body, fontSize: 14, lineHeight: 20 },
});
