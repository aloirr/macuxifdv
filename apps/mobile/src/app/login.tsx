/**
 * Login do app (T-0003 F2).
 * - API real (padrão): a tela do Core (`TelaLogin`: código da empresa + e-mail + senha; o código fica salvo no
 *   aparelho). Perfil de outro app (ex.: supervisor no Campo) não entra: a sessão é encerrada e o aviso diz qual app usar.
 * - Demonstração (`EXPO_PUBLIC_API_MODO=demo`, mock-api da Fase M): escolher o usuário numa lista, sem senha. O papel
 *   em inglês vira o perfil do doc 03 (`perfilDaFaseM`); entram só os perfis da variante (`PERFIS_DO_APP`).
 * Servidor (T-0038, `endereco-do-build.ts`): nos builds preview e producao NÃO há campo Servidor; o app usa sempre o
 * endereço do build e, se a verificação de `/v1/saude` falhar, mostra só "Servidor indisponível — tente mais tarde".
 * No build de desenvolvimento o cartão Servidor fica embaixo, fechado em "Avançado" (rede local). Lá o endereço é usado
 * exatamente como digitado (R-20261101-065547-alexandre) e só é salvo se o servidor se identificar como Macuxi
 * (`testarServidor`, R-20261101-023742-alexandre).
 * Teclado e área segura (R-20261101-023401 e 023857): `KeyboardAvoidingView` (padding; o Android edge-to-edge não
 * redimensiona a janela) e o espaço da barra de navegação embaixo do cartão quando o teclado está fechado.
 */
import { ehAparelhoBloqueado, TelaLogin, type CamposLogin } from '@macuxi/core/app';
import type { FakeUser } from '@macuxi/core/contracts';
import { ErroHttp, PERFIS_DO_APP, ROTULO_PERFIL, type Perfil } from '@macuxi/platform-sdk';
import { Banner, Button, Card, colors, fonts, Icon, initials, radius, Screen, type as t } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Keyboard, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EXEMPLO_ENDERECO, normalizeApiUrl as normalize } from '@/lib/api-url';
import { avisoDeServidorNoLogin, cartaoServidorNoLogin, mensagemServidorFalhou } from '@/lib/endereco-do-build';
import { ApiClient, errorMessage } from '@/services/api';
import { usePlataforma, usuarioDaFaseM } from '@/state/plataforma';

const ORDEM: Perfil[] = ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'];
const ordem = (p: Perfil | null) => (p ? ORDEM.indexOf(p) : ORDEM.length);

/** Teclado aberto? Com ele aberto a barra de navegação fica coberta e o espaço dela não é somado. */
function useTecladoAberto() {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    const mostrou = Keyboard.addListener('keyboardDidShow', () => setAberto(true));
    const escondeu = Keyboard.addListener('keyboardDidHide', () => setAberto(false));
    return () => {
      mostrou.remove();
      escondeu.remove();
    };
  }, []);
  return aberto;
}

/** Sobe o conteúdo acima do teclado. `padding` mede o quanto o teclado cobre: se a janela já encolheu, não soma nada. */
function AcimaDoTeclado({ children }: { children: ReactNode }) {
  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.ground }} behavior="padding">
      {children}
    </KeyboardAvoidingView>
  );
}

export default function LoginScreen() {
  const { modo } = usePlataforma();
  return modo === 'demo' ? <LoginDemo /> : <LoginReal />;
}

/** Login real: tela do Core + aviso de perfil de outro app + aviso de aparelho bloqueado (RN-CORE-15) + servidor. */
function LoginReal() {
  const { avisoLogin, codigoSalvo, loginComSenha, perfilBuild, variante } = usePlataforma();
  const [aviso, setAviso] = useState<string | null>(null);
  const [servidorFora, setServidorFora] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const teclado = useTecladoAberto();
  const entrar = async (campos: CamposLogin) => {
    setAviso(null);
    setServidorFora(null);
    try {
      await loginComSenha(campos);
      router.replace('/sync');
    } catch (e) {
      if (e instanceof ErroHttp && e.codigo === 'PERFIL_FORA_DO_APP') {
        setAviso(e.message);
        return;
      }
      // endereço fixo (T-0038): servidor fora do ar não pede endereço; a mensagem é só "tente mais tarde"
      const fora = avisoDeServidorNoLogin(perfilBuild, e);
      if (fora) {
        setServidorFora(fora);
        return;
      }
      // RN-CORE-15: o aparelho já foi limpo; o aviso fica no banner abaixo (sem repetir no formulário)
      if (ehAparelhoBloqueado(e)) return;
      throw e;
    }
  };
  return (
    <AcimaDoTeclado>
      <TelaLogin codigoSalvo={codigoSalvo} onEntrar={entrar} rodape={variante === 'gestao' ? 'Macuxi Gestão · supervisores e gerentes' : 'Macuxi Campo · vendedores e promotores'} />
      <View style={[styles.rodape, { paddingBottom: 12 + (teclado ? 0 : insets.bottom) }]} testID="login.rodape">
        {avisoLogin ? (
          <Banner icon="alert" tone="danger" testID="login.aparelho-bloqueado">
            {avisoLogin}
          </Banner>
        ) : null}
        {aviso ? (
          <Banner icon="alert" tone="warning" testID="login.perfil-fora-do-app">
            {aviso}
          </Banner>
        ) : null}
        {servidorFora ? (
          <Banner icon="alert" tone="danger" testID="login.servidor-indisponivel">
            {servidorFora}
          </Banner>
        ) : null}
        <ServidorDoLogin />
      </View>
    </AcimaDoTeclado>
  );
}

/**
 * Servidor no login conforme o build (T-0038): nada nos builds preview/producao; no desenvolvimento, o link "Avançado"
 * abre o cartão Servidor (fechado por padrão; o rótulo avisa quando há endereço personalizado salvo).
 */
function ServidorDoLogin() {
  const { apiOverride, perfilBuild } = usePlataforma();
  const [aberto, setAberto] = useState(false);
  if (cartaoServidorNoLogin(perfilBuild) === 'oculto') return null;
  return (
    <View style={{ gap: 8 }}>
      <Pressable
        testID="login.avancado"
        accessibilityRole="button"
        accessibilityState={{ expanded: aberto }}
        accessibilityLabel={aberto ? 'Fechar opções avançadas' : 'Abrir opções avançadas: servidor'}
        onPress={() => setAberto((a) => !a)}
        style={styles.avancado}>
        <Text style={styles.link}>{apiOverride ? 'Avançado · servidor personalizado' : 'Avançado'}</Text>
        <View style={{ transform: [{ rotate: aberto ? '270deg' : '90deg' }] }}>
          <Icon name="chevron" size={14} color={colors.accent} />
        </View>
      </Pressable>
      {aberto ? <CartaoServidor /> : null}
    </View>
  );
}

/** Endereço do servidor (só no build de desenvolvimento): mostra, edita, testa e salva (vale para os dois modos). */
function CartaoServidor() {
  const { apiUrl, defaultApiUrl, apiOverride, setApiUrl, testApiUrl } = usePlataforma();
  const [editing, setEditing] = useState(false);
  const [urlDraft, setUrlDraft] = useState(apiUrl);
  const [urlMsg, setUrlMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [testando, setTestando] = useState(false);

  // o endereço é usado como digitado (só sem espaços nas pontas); só salva se o servidor for Macuxi
  const saveUrl = async () => {
    if (testando) return;
    const endereco = normalize(urlDraft);
    setTestando(true);
    setUrlMsg(null);
    try {
      const res = await testApiUrl(endereco);
      setUrlMsg(res);
      if (res.ok) {
        await setApiUrl(endereco === defaultApiUrl ? null : endereco);
        setEditing(false);
      }
    } finally {
      setTestando(false);
    }
  };

  return (
    <Card style={{ padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="server" size={16} color={colors.ink2} />
        <Text style={[t.label, { flex: 1 }]}>Servidor</Text>
        {!editing ? (
          <Pressable
            testID="edit-server"
            accessibilityRole="button"
            onPress={() => {
              setUrlDraft(apiUrl);
              setUrlMsg(null);
              setEditing(true);
            }}
            hitSlop={12}>
            <Text style={styles.link}>Alterar</Text>
          </Pressable>
        ) : null}
      </View>
      {editing ? (
        <>
          <TextInput
            testID="server-input"
            value={urlDraft}
            onChangeText={setUrlDraft}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            keyboardType="url"
            // várias linhas: o endereço longo (túnel) fica inteiro à vista; Enter testa em vez de quebrar linha
            multiline
            submitBehavior="blurAndSubmit"
            returnKeyType="go"
            onSubmitEditing={() => void saveUrl()}
            accessibilityLabel="Endereço do servidor"
            style={styles.input}
            placeholder={EXEMPLO_ENDERECO}
            placeholderTextColor={colors.ink3}
          />
          <Text style={t.small}>Endereço completo da API, como recebido, terminando em /v1.</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button testID="server-save" label="Testar e salvar" loading={testando} onPress={() => void saveUrl()} variant="dark" style={{ flex: 1 }} />
            <Button
              label="Padrão"
              variant="outline"
              onPress={() => {
                setUrlDraft(defaultApiUrl);
                void setApiUrl(null);
                setUrlMsg(null);
                setEditing(false);
              }}
            />
          </View>
        </>
      ) : (
        <Text testID="server-url" style={[t.body, { fontFamily: fonts.mono, fontSize: 13 }]} selectable>
          {apiUrl}
          {apiOverride ? '' : '  (padrão)'}
        </Text>
      )}
      {urlMsg ? (
        <Text testID="server-msg" accessibilityLiveRegion="polite" style={[t.small, { color: urlMsg.ok ? colors.success : colors.danger }]}>
          {urlMsg.message}
        </Text>
      ) : null}
    </Card>
  );
}

/** Demonstração (mock-api da Fase M): escolher um usuário fictício, sem senha. */
function LoginDemo() {
  const { apiUrl, loginDemo, perfilBuild, variante } = usePlataforma();
  const insets = useSafeAreaInsets();
  // endereço fixo (T-0038): falha de servidor vira "Servidor indisponível — tente mais tarde", sem detalhe de endereço
  const falhaServidor = mensagemServidorFalhou(perfilBuild);
  const [users, setUsers] = useState<FakeUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (url: string) => {
    setError(null);
    setUsers(null);
    try {
      const res = await new ApiClient(url, null).users();
      setUsers(res.items);
    } catch (e) {
      setError(falhaServidor ?? `Não foi possível falar com o servidor. ${errorMessage(e)}`);
      setUsers([]);
    }
  }, [falhaServidor]);

  useEffect(() => {
    void load(apiUrl);
  }, [apiUrl, load]);

  const enter = async (u: FakeUser) => {
    setBusy(u.id);
    setError(null);
    try {
      await loginDemo(u);
      router.replace('/sync');
    } catch (e) {
      setError(avisoDeServidorNoLogin(perfilBuild, e) ?? `Não foi possível falar com o servidor. ${errorMessage(e)}`);
    } finally {
      setBusy(null);
    }
  };

  const doApp = PERFIS_DO_APP[variante];
  const todos = (users ?? []).map(usuarioDaFaseM).sort((a, b) => ordem(a.perfil) - ordem(b.perfil));
  const sellers = todos.filter((u) => u.perfil && doApp.includes(u.perfil));
  const others = todos.filter((u) => !u.perfil || !doApp.includes(u.perfil));
  const rotulo = (p: Perfil | null) => (p ? ROTULO_PERFIL[p] : 'Perfil desconhecido');

  return (
    <AcimaDoTeclado>
      <Screen gap={16} top={36} contentStyle={{ paddingBottom: 20 + insets.bottom }}>
        <View style={{ gap: 4 }}>
          <Text style={styles.brand}>MACUXI FDV</Text>
          <Text style={t.h1}>Quem está entrando?</Text>
          <Text style={t.sub}>Demonstração: escolha um usuário fictício. Sem senha.</Text>
        </View>

        {error ? (
          <Banner icon="alert" tone="danger" testID="login.demo-erro">
            {error}
          </Banner>
        ) : null}

        <View style={{ gap: 8 }}>
          <Text style={styles.group}>{variante === 'gestao' ? 'Supervisores e gerentes' : 'Vendedores e promotores'}</Text>
          {users === null ? (
            <ActivityIndicator color={colors.accent} style={{ paddingVertical: 20 }} />
          ) : (
            <Card>
              {sellers.map((u, i) => (
                <Pressable
                  key={u.id}
                  testID={`user-${u.name}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Entrar como ${u.name}`}
                  onPress={() => void enter(u)}
                  disabled={Boolean(busy)}
                  style={({ pressed }) => [styles.userRow, i < sellers.length - 1 && styles.divider, pressed && { backgroundColor: colors.accentTint }]}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials(u.name)}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={t.title16}>{u.name}</Text>
                    <Text style={t.small}>
                      {rotulo(u.perfil)}
                      {u.team_name ? ` · ${u.team_name}` : ''}
                    </Text>
                  </View>
                  {busy === u.id ? <ActivityIndicator color={colors.accent} /> : <Icon name="chevron" size={18} color={colors.ink2} />}
                </Pressable>
              ))}
            </Card>
          )}
        </View>

        {others.length > 0 ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.group}>Outros perfis</Text>
            <Card>
              {others.map((u, i) => (
                <View key={u.id} style={[styles.userRow, styles.muted, i < others.length - 1 && styles.divider]}>
                  <View style={[styles.avatar, { backgroundColor: colors.neutralBg }]}>
                    <Text style={[styles.avatarText, { color: colors.neutralInk }]}>{initials(u.name)}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 1 }}>
                    <Text style={t.bodyStrong}>{u.name}</Text>
                    <Text style={t.small}>{rotulo(u.perfil)} · usa {u.perfil === 'vendedor' || u.perfil === 'promotor' ? 'o Macuxi Campo' : u.perfil === 'supervisor' || u.perfil === 'gerente' ? 'o Macuxi Gestão ou a web do BKO' : 'a web do BKO'}</Text>
                  </View>
                </View>
              ))}
            </Card>
          </View>
        ) : null}

        <ServidorDoLogin />
      </Screen>
    </AcimaDoTeclado>
  );
}

const styles = StyleSheet.create({
  brand: { fontFamily: fonts.displayBold, fontSize: 12, letterSpacing: 1.2, color: colors.accent },
  group: { fontFamily: fonts.semibold, fontSize: 12, color: colors.ink2, textTransform: 'uppercase', letterSpacing: 0.6 },
  userRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 11, minHeight: 60 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  muted: { opacity: 0.75 },
  avatar: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.displayBold, fontSize: 14, color: '#FFFFFF' },
  link: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accent },
  // alvo de toque >= 48 dp
  avancado: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, minHeight: 48 },
  rodape: { gap: 10, paddingHorizontal: 16, paddingBottom: 16 },
  input: { minHeight: 46, paddingVertical: 10, textAlignVertical: 'center', borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, paddingHorizontal: 12, fontFamily: fonts.mono, fontSize: 13, color: colors.ink, backgroundColor: colors.surface },
});
