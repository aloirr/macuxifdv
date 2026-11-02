/**
 * Início do shell: saudação, botão Sincronizar com a última sincronização e a fila (RN-CORE-23 item 1; puxar para baixo
 * = Sincronizar, item 5), estado da fila, cards dos módulos (slot `inicio.cards` do Core — ex.: "EM
 * ATENDIMENTO" do Core) e atalhos para as telas dos módulos efetivos.
 */
import { useMotorSync, useVisaoShell } from '@macuxi/platform-sdk/react';
import { Banner, BotaoSincronizar, Card, Empty, firstName, Screen, SectionHeader, SyncStamp, type as t, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { CardsDoInicio } from '@/components/extensoes-shell';
import { usePlataforma } from '@/state/plataforma';

export default function Inicio() {
  const { sessao, variante, offline, me } = usePlataforma();
  const visao = useVisaoShell();
  const { estado } = useMotorSync();
  const pendentes = estado.fila.length;
  const auto = useAtualizacaoAutomatica();
  return (
    <Screen testID="inicio" refreshing={auto.puxando} onRefresh={auto.puxar}>
      <Pressable testID="abrir-perfil" accessibilityRole="button" onPress={() => router.push('/profile')}>
        <Text style={t.sub}>{variante === 'gestao' ? 'Macuxi Gestão' : 'Macuxi Campo'}</Text>
        <Text style={t.h1}>Olá, {firstName(sessao?.user.name ?? '')}</Text>
      </Pressable>
      <SyncStamp at={estado.sincronizado_em} offline={offline} tz={me?.tenant.timezone ?? sessao?.tenant?.fuso ?? 'America/Manaus'} />
      <BotaoSincronizar testID="inicio-sincronizar" />
      {pendentes > 0 ? <Banner icon="sync">{`${pendentes} ${pendentes === 1 ? 'item' : 'itens'} na fila do aparelho.`}</Banner> : null}
      {estado.limpezaPendente.length > 0 ? (
        <Banner icon="alert" tone="danger" testID="aviso-modulo-desativado">
          Um módulo foi desativado e há itens não enviados. Veja em Perfil › Fila do aparelho.
        </Banner>
      ) : null}
      <CardsDoInicio />
      <SectionHeader title="Seus módulos" />
      {visao.navegacao.length === 0 ? (
        <Empty text="Nenhuma tela de módulo disponível para o seu perfil nesta variante do app." />
      ) : (
        visao.navegacao.map((n) => (
          <Pressable key={n.testID} testID={`inicio-${n.testID}`} accessibilityRole="button" onPress={() => router.navigate(`/m/${n.caminho}` as never)}>
            <Card style={{ padding: 14 }}>
              <Text style={t.title16}>{n.rotulo}</Text>
            </Card>
          </Pressable>
        ))
      )}
    </Screen>
  );
}
