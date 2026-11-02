/**
 * Perfil (copiado da Fase M): sincronizar agora, fila do aparelho, modo sem sinal (simulado),
 * endereço do servidor (editável só no build de desenvolvimento; nos demais, só leitura — T-0038) e sair/trocar usuário. A fila agora é a do motor de sync (genérica, de todos os
 * módulos) e mostra os itens de módulo desativado como "não enviado — módulo desativado"; os dados do
 * módulo só são apagados depois que o usuário confirma (RN-CORE-02, Q4).
 * T-0059 (R-20261102-090915): o cartão de sincronização não mostra nome de entidade nem etapa; o detalhe técnico da
 * última falha (etapa e mensagem) e as entidades ainda sem provedor ficam na área "Diagnóstico", fechada por padrão.
 * RN-CORE-23 (T-0065): botão Sincronizar do kit (última sincronização · N na fila, proteção de 30 s) e puxar para baixo.
 * ADR 0017: o Diagnóstico mostra também a "Última sincronização em segundo plano" (resultado, duração e mensagem).
 */
import { ROTULO_PERFIL, rotuloDoArquivo, rotuloDoItem } from '@macuxi/platform-sdk';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import {
  BackLink,
  Badge,
  BotaoSincronizar,
  Button,
  Card,
  colors,
  dateTimeLabel,
  fonts,
  Icon,
  initials,
  intervaloSyncAutoMs,
  PARAMETRO_SYNC_AUTO,
  ProgressBar,
  radius,
  Screen,
  SectionHeader,
  type as t,
  useAtualizacaoAutomatica,
} from '@macuxi/ui/mobile';
import { Redirect, router } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import { ItensDoMenu } from '@/components/extensoes-shell';
import { normalizeApiUrl } from '@/lib/api-url';
import { mensagemDeErroDaCarga } from '@/lib/frases-carga';
import { textoDoResultado } from '@/lib/segundo-plano';
import { usePlataforma } from '@/state/plataforma';

export default function ProfileScreen() {
  const app = usePlataforma();
  const { sessao, me, offline, apiUrl, apiOverride, defaultApiUrl, perfil } = app;
  const { motor, estado } = useMotorSync();
  const [url, setUrl] = useState(apiUrl);
  const [urlMsg, setUrlMsg] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);
  const [diagnosticoAberto, setDiagnosticoAberto] = useState(false);
  const auto = useAtualizacaoAutomatica();
  const falha = app.falhaSync;
  const segundoPlano = app.segundoPlano;

  if (!sessao) return <Redirect href="/login" />;
  const tz = me?.tenant.timezone ?? sessao.tenant?.fuso ?? 'America/Manaus';
  const empresa = me?.tenant.name ?? sessao.tenant?.nome ?? null;
  const name = me?.seller?.name ?? sessao.user.name;
  const fila = estado.fila;
  // ADR 0010 §4: fotos ainda não aceitas pelo servidor (as enviadas ficam 7 dias só para a tela offline)
  const fotos = estado.arquivos.filter((a) => a.situacao !== 'enviado');

  const saveUrl = async () => {
    const u = normalizeApiUrl(url);
    const res = await app.testApiUrl(u);
    setUrlMsg(res);
    if (res.ok) {
      setUrl(u);
      await app.setApiUrl(u === defaultApiUrl ? null : u);
    }
  };

  return (
    <Screen top={16} testID="profile" refreshing={auto.puxando} onRefresh={auto.puxar}>
      <BackLink label="Início" fallback="/" />
      <View style={styles.who}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initials(name)}</Text>
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={t.h1Small}>{name}</Text>
          <Text style={t.sub} testID="perfil-rotulo">
            {perfil ? ROTULO_PERFIL[perfil] : 'Perfil desconhecido'}
            {me?.seller ? ` · ${me.seller.team_name} · alçada ${me.seller.max_discount_pct.toLocaleString('pt-BR')}%` : ''}
          </Text>
          <Text style={t.small}>
            {sessao.user.email}
            {empresa ? ` · ${empresa}` : ''}
          </Text>
        </View>
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeader title="Sincronização" />
        <Card style={{ padding: 14, gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
            <Text style={t.sub}>Última sincronização</Text>
            <Text style={t.bodyStrong} testID="last-sync">
              {estado.sincronizado_em ? dateTimeLabel(estado.sincronizado_em, new Date(), tz) : 'nunca'}
            </Text>
          </View>
          {estado.sincronizando ? (
            <View style={{ gap: 6 }}>
              <Text style={t.small} testID="sync-andamento">
                Sincronizando… {Math.round(estado.progresso * 100)}%
              </Text>
              <ProgressBar pct={estado.progresso * 100} />
            </View>
          ) : null}
          {estado.erro && !estado.sincronizando ? (
            <Text style={[t.small, { color: colors.danger }]} testID="sync-erro">
              {mensagemDeErroDaCarga(offline)} O detalhe fica em Diagnóstico, no fim desta tela.
            </Text>
          ) : null}
          <BotaoSincronizar testID="sync-now" />
          <Text style={t.small}>
            {`Automática ao abrir o app, ao voltar depois de 30 min e a cada ${Math.round(intervaloSyncAutoMs(motor?.parametros('core')[PARAMETRO_SYNC_AUTO]) / 60_000)} min com o app em uso. Pedidos e visitas sobem sozinhos assim que houver sinal.`}
          </Text>
        </Card>
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeader title="Modo sem sinal" />
        <Card style={{ padding: 14, gap: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Icon name="wifiOff" size={20} color={offline ? colors.warning : colors.ink2} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={t.bodyStrong}>Simular aparelho sem sinal</Text>
              <Text style={t.small}>Tudo o que você registrar vai para a fila. Ao desligar, a fila é enviada.</Text>
            </View>
            <Switch
              testID="offline-switch"
              value={offline}
              onValueChange={(v) => void app.setOffline(v)}
              trackColor={{ false: colors.lineStrong, true: colors.accentLight }}
              thumbColor={offline ? colors.accent : '#FFFFFF'}
              accessibilityLabel="Modo sem sinal"
            />
          </View>
        </Card>
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeader title="Módulos" />
        <Card style={{ padding: 14, gap: 8 }}>
          <Text style={t.small}>Os módulos ativos para você, as versões e o que ficou sem enviar de módulo desativado.</Text>
          <Button testID="abrir-meus-modulos" label="Meus módulos" icon="chevron" variant="outline" onPress={() => router.push('/m/meus-modulos')} />
        </Card>
      </View>

      <ItensDoMenu />

      {estado.limpezaPendente.map((modulo) => (
        <Card key={modulo} testID={`limpeza-${modulo}`} style={{ padding: 14, gap: 10 }}>
          <Text style={t.bodyStrong}>Módulo {modulo} desativado</Text>
          <Text style={t.small}>
            Os itens abaixo marcados como “não enviado — módulo desativado” não chegaram ao servidor. Ao confirmar, eles e os dados desse módulo são apagados deste aparelho.
          </Text>
          <Button testID={`confirmar-limpeza-${modulo}`} label="Entendi, apagar do aparelho" variant="danger" onPress={() => void motor?.confirmarLimpeza(modulo)} />
        </Card>
      ))}

      {estado.avisos.length > 0 ? (
        <Card testID="avisos-sync" style={{ padding: 14, gap: 6 }}>
          <Text style={t.bodyStrong}>Parte dos dados ainda não está disponível no servidor</Text>
          <Text style={t.small}>O resto foi sincronizado. O que você registrar fica no aparelho e na fila até o servidor receber. Detalhes em Diagnóstico.</Text>
        </Card>
      ) : null}

      <View style={{ gap: 8 }}>
        <SectionHeader title="Fila do aparelho" right={fila.length === 0 ? 'vazia' : `${fila.length} ${fila.length === 1 ? 'item' : 'itens'}`} />
        <Card testID="outbox-card">
          {fila.length === 0 ? <Text style={[t.sub, { padding: 14 }]}>Nada pendente. Tudo enviado ao servidor.</Text> : null}
          {fila.map((it, i) => (
            <View key={it.id} testID={`fila-${it.id}`} style={[styles.qRow, i < fila.length - 1 && styles.divider]}>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={t.bodyStrong} numberOfLines={1}>
                  {it.rotulo}
                </Text>
                <Text style={t.small}>
                  {dateTimeLabel(it.criado_em, new Date(), tz)}
                  {it.detalhe ? ` · ${it.detalhe}` : ''}
                  {it.tentativas > 0 ? ` · ${it.tentativas} tentativa${it.tentativas > 1 ? 's' : ''}` : ''}
                </Text>
                {it.ultimo_erro ? <Text style={[t.small, { color: it.situacao === 'pendente' ? colors.warning : colors.danger }]}>{it.ultimo_erro}</Text> : null}
              </View>
              {it.situacao === 'falhou' ? (
                <Pressable accessibilityRole="button" testID={`descartar-${it.id}`} onPress={() => void motor?.descartar(it.id)} hitSlop={8} style={styles.discard}>
                  <Text style={[t.smallStrong, { color: colors.danger }]}>Descartar</Text>
                </Pressable>
              ) : (
                <Badge label={it.situacao === 'pendente' && offline ? 'aguardando sinal' : rotuloDoItem(it)} tone={it.situacao === 'modulo_inativo' ? 'danger' : 'warning'} />
              )}
            </View>
          ))}
        </Card>
        {fotos.length > 0 ? (
          <Card testID="fotos-pendentes" style={{ padding: 14, gap: 6 }}>
            <Text style={t.bodyStrong}>Fotos pendentes: {fotos.length}</Text>
            {fotos.map((a) => (
              <View key={a.id} testID={`foto-${a.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={t.small} numberOfLines={1}>
                    {a.rotulo} · {offline && a.situacao === 'pendente' ? 'aguardando sinal' : rotuloDoArquivo(a)}
                  </Text>
                  {a.ultimo_erro ? <Text style={[t.small, { color: a.situacao === 'pendente' ? colors.warning : colors.danger }]}>{a.ultimo_erro}</Text> : null}
                </View>
                {a.situacao === 'falhou' ? (
                  <Pressable accessibilityRole="button" testID={`descartar-foto-${a.id}`} onPress={() => void motor?.descartarArquivo(a.id)} hitSlop={8} style={styles.discard}>
                    <Text style={[t.smallStrong, { color: colors.danger }]}>Descartar</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
          </Card>
        ) : null}
        {fila.length > 0 || fotos.length > 0 ? (
          <Button
            testID="send-now"
            label={offline ? 'Desligue o modo sem sinal para enviar' : 'Enviar agora'}
            icon="send"
            variant="accent"
            disabled={offline}
            loading={estado.enviando}
            onPress={() => void app.enviarFila({ incluirFalhos: true })}
          />
        ) : null}
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeader title="Servidor" />
        {!app.servidorEditavel ? (
          <Card style={{ padding: 14, gap: 6 }}>
            <Text testID="profile-server-fixo" selectable style={[t.body, { fontFamily: fonts.mono, fontSize: 13 }]}>
              {apiUrl}
            </Text>
            <Text style={t.small}>Endereço definido nesta versão do aplicativo.</Text>
          </Card>
        ) : (
          <Card style={{ padding: 14, gap: 10 }}>
            <TextInput testID="profile-server" value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" style={styles.input} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button label="Testar e salvar" variant="dark" style={{ flex: 1 }} onPress={() => void saveUrl()} />
              <Button
                label="Padrão"
                variant="outline"
                onPress={() => {
                  setUrl(defaultApiUrl);
                  setUrlMsg(null);
                  void app.setApiUrl(null);
                }}
              />
            </View>
            <Text style={t.small}>{apiOverride ? `Personalizado. Padrão: ${defaultApiUrl}` : 'Usando o endereço padrão.'}</Text>
            {urlMsg ? <Text style={[t.small, { color: urlMsg.ok ? colors.success : colors.danger }]}>{urlMsg.message}</Text> : null}
          </Card>
        )}
      </View>

      <View style={{ gap: 8 }}>
        <SectionHeader
          title="Diagnóstico"
          right={diagnosticoAberto ? 'ocultar' : 'mostrar'}
          onRightPress={() => setDiagnosticoAberto((v) => !v)}
          rightTestID="diagnostico-alternar"
        />
        {diagnosticoAberto ? (
          <Card testID="diagnostico-sync" style={{ padding: 14, gap: 6 }}>
            <Text style={t.small}>Informações técnicas para o suporte.</Text>
            <Text selectable style={styles.mono}>
              {falha
                ? `Última falha da sincronização: ${dateTimeLabel(falha.quando, new Date(), tz)}${falha.etapa ? ` · etapa ${falha.etapa}` : ''}\n${falha.mensagem}`
                : 'Nenhuma falha de sincronização registrada neste aparelho.'}
            </Text>
            <Text selectable style={styles.mono} testID="diagnostico-segundo-plano">
              {segundoPlano
                ? `Última sincronização em segundo plano: ${dateTimeLabel(segundoPlano.quando, new Date(), tz)} · ${textoDoResultado(segundoPlano)}`
                : 'Nenhuma sincronização em segundo plano registrada neste aparelho.'}
            </Text>
            {estado.avisos.length > 0 ? (
              <Text selectable style={styles.mono}>
                Sem provedor no servidor: {estado.avisos.map((a) => a.entidade).join(', ')}
              </Text>
            ) : null}
            <Text selectable style={styles.mono}>
              Módulos ativos: {estado.modulosAtivos.join(', ') || 'nenhum'}
            </Text>
          </Card>
        ) : null}
      </View>

      <View style={{ gap: 8, marginBottom: 12 }}>
        {confirmExit && fila.length > 0 ? (
          <Text style={[t.small, { color: colors.warning }]}>
            Há {fila.length} {fila.length === 1 ? 'item' : 'itens'} na fila. Eles ficam guardados neste aparelho e são enviados quando {sessao.user.name.split(' ')[0]} entrar de novo.
          </Text>
        ) : null}
        <Button
          testID="logout"
          label={confirmExit && fila.length > 0 ? 'Sair mesmo assim' : 'Sair / trocar usuário'}
          icon="logout"
          variant="danger"
          onPress={() => {
            if (fila.length > 0 && !confirmExit) {
              setConfirmExit(true);
              return;
            }
            void app.logout().then(() => router.replace('/login'));
          }}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  who: { flexDirection: 'row', gap: 14, alignItems: 'center' },
  avatar: { width: 56, height: 56, borderRadius: 28, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: fonts.displayBold, fontSize: 19, color: '#FFFFFF' },
  qRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 14 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  discard: { height: 44, justifyContent: 'center' },
  mono: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink2 },
  input: { height: 46, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, paddingHorizontal: 12, fontFamily: fonts.mono, fontSize: 13, color: colors.ink, backgroundColor: colors.surface },
});
