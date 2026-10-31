/**
 * Login de demonstração (copiado da Fase M): escolher o usuário numa lista, sem senha, contra o mock-api.
 * O papel em inglês da Fase M vira o perfil do doc 03 (`perfilDaFaseM`); entram só os perfis da variante
 * (Campo: vendedor e promotor; Gestão: supervisor e gerente — `PERFIS_DO_APP`). Os demais aparecem
 * como "usa outro app". O login definitivo (código da empresa + e-mail + senha, Q3) chega com a T-0003.
 * Embaixo, o endereço do servidor (mock-api) pode ser editado.
 */
import type { FakeUser } from '@macuxi/core/contracts';
import { PERFIS_DO_APP, ROTULO_PERFIL, type Perfil } from '@macuxi/platform-sdk';
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
  const { apiUrl, defaultApiUrl, apiOverride, setApiUrl, testApiUrl, login, variante } = usePlataforma();
  const [users, setUsers] = useState<FakeUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [urlDraft, setUrlDraft] = useState(apiUrl);
  const [urlMsg, setUrlMsg] = useState<{ ok: boolean; message: string } | null>(null);

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
      await login(u);
      router.replace('/sync');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  const saveUrl = async () => {
    const res = await testApiUrl(normalize(urlDraft));
    setUrlMsg(res);
    if (res.ok) {
      await setApiUrl(normalize(urlDraft) === defaultApiUrl ? null : normalize(urlDraft));
      setEditing(false);
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
              placeholder="http://192.168.0.10:8000/v1"
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
  input: { height: 46, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, paddingHorizontal: 12, fontFamily: fonts.mono, fontSize: 13, color: colors.ink, backgroundColor: colors.surface },
});
