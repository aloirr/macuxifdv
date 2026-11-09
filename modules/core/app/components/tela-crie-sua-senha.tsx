/**
 * "Crie sua senha" (T-0094; RN-CORE-32/34; docs/design/ciclo-de-senha.md §2): troca obrigatória no 1º uso ou com senha
 * temporária. Componente de apresentação como a `TelaLogin`: o shell mantém, só na memória, a senha com que a pessoa entrou,
 * liga `onSalvar(senhaNova)` ao `trocarSenhaPeloApp` e, no sucesso, guarda a sessão e abre o app. Nada mais abre antes: sem
 * abas, sem menu. Exige internet. A senha digitada nunca vai a storage, URL ou log e some ao sair da tela.
 * testIDs: crie-senha.tela, crie-senha.nova, crie-senha.repita, crie-senha.olho, crie-senha.salvar, crie-senha.erro,
 * crie-senha.voltar, crie-senha.sem-internet.
 */
import { estilosDeAcesso } from './estilos-de-acesso';
import { Banner, Button, colors, Screen, type as t } from '@macuxi/ui/mobile';
import { RegrasDaSenha, CAMPO_REPITA_A_SENHA, CAMPO_SENHA_NOVA } from '@macuxi/ui/mobile';
import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { SENHA_MIN_CARACTERES, mensagemDaSenha, type DetalhesSenhaATrocar } from '../../contracts';
import { rotuloOlhoSenha } from '../lib/login';
import { erroDaTroca, subtituloDaTroca, TEXTO_SEM_INTERNET_TROCA, TITULO_CRIE_SUA_SENHA, repeticaoDaSenha, validarTroca } from '../lib/senha';

export interface PropsTelaCrieSuaSenha {
  motivo: DetalhesSenhaATrocar['motivo'];
  email: string;
  codigoEmpresa: string;
  /** O app sabe que está sem rede: aviso no topo (o botão continua ativo, para não prender a pessoa se a detecção errar). */
  semInternet?: boolean;
  /** Troca a senha; lança em caso de erro (a tela mostra a mensagem). Sucesso: o shell abre o app. */
  onSalvar: (senhaNova: string) => Promise<void>;
  /** Volta ao login descartando a senha da memória; `aviso` aparece lá (ex.: "Esta senha não vale mais. Entre de novo."). */
  onVoltar: (aviso?: string) => void;
}

export function TelaCrieSuaSenha({ motivo, email, codigoEmpresa, semInternet = false, onSalvar, onVoltar }: PropsTelaCrieSuaSenha) {
  const [nova, setNova] = useState('');
  const [repetida, setRepetida] = useState('');
  const [visivel, setVisivel] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const repita = useRef<TextInput>(null);
  const nova$ = useRef<TextInput>(null);

  const v = validarTroca(nova, repetida);
  const destacar = tentou && !v.ok;

  const salvar = async () => {
    if (salvando) return;
    setTentou(true);
    setErro(null);
    if (!v.ok) return;
    setSalvando(true);
    try {
      await onSalvar(nova);
    } catch (x) {
      const e = erroDaTroca(x, nova);
      if (e.acao === 'voltar_ao_login') {
        onVoltar(e.texto);
        return;
      }
      setErro(e.texto);
      if (e.acao === 'limpar') {
        setNova('');
        setRepetida('');
        setTentou(false);
        nova$.current?.focus();
      }
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Screen gap={16} top={36} testID="crie-senha.tela">
      {semInternet ? (
        <Banner tone="warning" icon="wifiOff" testID="crie-senha.sem-internet" anunciar>
          {TEXTO_SEM_INTERNET_TROCA}
        </Banner>
      ) : null}
      <View style={{ gap: 4 }}>
        <Text style={styles.titulo} accessibilityRole="header">
          {TITULO_CRIE_SUA_SENHA}
        </Text>
        <Text style={t.sub}>{subtituloDaTroca(motivo)}</Text>
        <Text style={t.small} testID="crie-senha.quem">{`${email} · ${codigoEmpresa}`}</Text>
      </View>

      {erro ? (
        <Banner tone="danger" icon="alert" testID="crie-senha.erro" anunciar>
          {erro}
        </Banner>
      ) : null}

      <View style={{ gap: 4 }}>
        <Text style={styles.rotulo}>{CAMPO_SENHA_NOVA}</Text>
        <View>
          <TextInput
            ref={nova$}
            testID="crie-senha.nova"
            value={nova}
            onChangeText={setNova}
            accessibilityLabel={CAMPO_SENHA_NOVA}
            secureTextEntry={!visivel}
            autoFocus
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            autoComplete="new-password"
            returnKeyType="next"
            onSubmitEditing={() => repita.current?.focus()}
            style={[styles.entrada, { paddingRight: 56 }, destacar && v.faltas.length > 0 ? { borderColor: colors.danger } : null]}
            placeholderTextColor={colors.ink3}
          />
          <Pressable testID="crie-senha.olho" accessibilityRole="button" accessibilityLabel={rotuloOlhoSenha(visivel)} hitSlop={4} onPress={() => setVisivel((x) => !x)} style={styles.olho}>
            <Text style={styles.olhoTexto}>{visivel ? 'Esconder' : 'Mostrar'}</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ gap: 4 }}>
        <Text style={styles.rotulo}>{CAMPO_REPITA_A_SENHA}</Text>
        <TextInput
          ref={repita}
          testID="crie-senha.repita"
          value={repetida}
          onChangeText={setRepetida}
          accessibilityLabel={CAMPO_REPITA_A_SENHA}
          secureTextEntry={!visivel}
          autoCapitalize="none"
          autoCorrect={false}
          textContentType="newPassword"
          autoComplete="new-password"
          returnKeyType="go"
          onSubmitEditing={() => void salvar()}
          style={[styles.entrada, destacar && v.repeticao !== 'igual' ? { borderColor: colors.danger } : null]}
          placeholderTextColor={colors.ink3}
        />
      </View>

      <RegrasDaSenha faltas={v.faltas} minimo={SENHA_MIN_CARACTERES} resumo={mensagemDaSenha(v.faltas) ?? undefined} repeticao={repeticaoDaSenha(nova, repetida)} destacar={destacar} testID="crie-senha.regras" />

      <Button testID="crie-senha.salvar" label={salvando ? 'Salvando…' : 'Salvar e entrar'} variant="dark" height={52} loading={salvando} onPress={() => void salvar()} />
      <Pressable testID="crie-senha.voltar" accessibilityRole="button" accessibilityLabel="Voltar ao login" onPress={() => onVoltar()} style={styles.link}>
        <Text style={styles.linkTexto}>Voltar ao login</Text>
      </Pressable>
    </Screen>
  );
}

const styles = estilosDeAcesso;
