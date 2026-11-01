/**
 * Login do app (T-0003 F2).
 * - API real (padrão): a tela do Core (`TelaLogin`: código da empresa + e-mail + senha; o código fica salvo no
 *   aparelho). Perfil de outro app (ex.: supervisor no Campo) não entra: a sessão é encerrada e o aviso diz qual app usar.
 * - Demonstração (`EXPO_PUBLIC_API_MODO=demo`, mock-api da Fase M): escolher o usuário numa lista, sem senha. O papel
 *   em inglês vira o perfil do doc 03 (`perfilDaFaseM`); entram só os perfis da variante (`PERFIS_DO_APP`).
 * Embaixo, o endereço do servidor pode ser editado (testado na rota de saúde de cada servidor).
 */
import { ehAparelhoBloqueado, TelaLogin, type CamposLogin } from '@macuxi/core/app';
import type { FakeUser } from '@macuxi/core/contracts';
import { ErroHttp, PERFIS_DO_APP, ROTULO_PERFIL, type Perfil } from '@macuxi/platform-sdk';
import { Banner, Button, Card, colors, fonts, Icon, initials, radius, Screen, type as t } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { normalizeApiUrl as normalize } from '@/lib/api-url';
import { ApiClient, errorMessage } from '@/services/api';
import { usePlataforma, usuarioDaFaseM } from '@/state/plataforma';

const ORDEM: Perfil[] = ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'];
const ordem = (p: Perfil | null) => (p ? ORDEM.indexOf(p) : ORDEM.length);

export default function LoginScreen() {
  const { modo } = usePlataforma();
  return modo === 'demo' ? <LoginDemo /> : <LoginReal />;
}

/** Login real: tela do Core + aviso de perfil de outro app + aviso de aparelho bloqueado (RN-CORE-15) + servidor. */
function LoginReal() {
  const { avisoLogin, codigoSalvo, loginComSenha, variante } = usePlataforma();
  const [aviso, setAviso] = useState<string | null>(null);
  const entrar = async (campos: CamposLogin) => {
    setAviso(null);
    try {
      await loginComSenha(campos);
      router.replace('/sync');
    } catch (e) {
      if (e instanceof ErroHttp && e.codigo === 'PERFIL_FORA_DO_APP') {
        setAviso(e.message);
        return;
      }
      // RN-CORE-15: o aparelho já foi limpo; o aviso fica no banner abaixo (sem repetir no formulário)
      if (ehAparelhoBloqueado(e)) return;
      throw e;
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <TelaLogin codigoSalvo={codigoSalvo} onEntrar={entrar} rodape={variante === 'gestao' ? 'Macuxi Gestão · supervisores e gerentes' : 'Macuxi Campo · vendedores e promotores'} />
      <View style={styles.rodape}>
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
        <CartaoServidor />
      </View>
    </View>
  );
}

/** Endereço do servidor: mostra, edita, testa e salva (vale para os dois modos). */
function CartaoServidor() {
  const { apiUrl, defaultApiUrl, apiOverride, setApiUrl, testApiUrl } = usePlataforma();
  const [editing, setEditing] = useState(false);
  const [urlDraft, setUrlDraft] = useState(apiUrl);
  const [urlMsg, setUrlMsg] = useState<{ ok: boolean; message: string } | null>(null);

  const saveUrl = async () => {
    const res = await testApiUrl(normalize(urlDraft));
    setUrlMsg(res);
    if (res.ok) {
      await setApiUrl(normalize(urlDraft) === defaultApiUrl ? null : normalize(urlDraft));
      setEditing(false);
    }
  };

  return (
    <Card style={{ padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Icon name="server" size={16} color={colors.ink2} />
        <Text style={[t.label, { flex: 1 }]}>Servidor</Text>
        {!editing ? (
          <Pressable testID="edit-server" accessibilityRole="button" onPress={() => setEditing(true)} hitSlop={12}>
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
            keyboardType="url"
            style={styles.input}
            placeholder="http://192.168.0.10:8100/v1"
            placeholderTextColor={colors.ink3}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="Testar e salvar" onPress={() => void saveUrl()} variant="dark" style={{ flex: 1 }} />
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
          {urlMsg ? <Text style={[t.small, { color: urlMsg.ok ? colors.success : colors.danger }]}>{urlMsg.message}</Text> : null}
        </>
      ) : (
        <Text style={[t.body, { fontFamily: fonts.mono, fontSize: 13 }]} selectable>
          {apiUrl}
          {apiOverride ? '' : '  (padrão)'}
        </Text>
      )}
    </Card>
  );
}

/** Demonstração (mock-api da Fase M): escolher um usuário fictício, sem senha. */
function LoginDemo() {
  const { apiUrl, loginDemo, variante } = usePlataforma();
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
      setError(errorMessage(e));
      setUsers([]);
    }
  }, []);

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
      setError(errorMessage(e));
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
    <Screen gap={16} top={36}>
      <View style={{ gap: 4 }}>
        <Text style={styles.brand}>MACUXI FDV</Text>
        <Text style={t.h1}>Quem está entrando?</Text>
        <Text style={t.sub}>Demonstração: escolha um usuário fictício. Sem senha.</Text>
      </View>

      {error ? <Banner icon="alert" tone="danger">{`Não foi possível falar com o servidor. ${error}`}</Banner> : null}

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

      <CartaoServidor />
    </Screen>
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
  rodape: { gap: 10, paddingHorizontal: 16, paddingBottom: 16 },
  input: { height: 46, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, paddingHorizontal: 12, fontFamily: fonts.mono, fontSize: 13, color: colors.ink, backgroundColor: colors.surface },
});
