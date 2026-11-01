/**
 * Notificações (RF-CORE-09). Caixa lida do aparelho (offline); abrir marca como lida pela fila e, se houver `link`
 * interno, navega. testIDs: docs/modulos/core/test-ids.md. Alvos de toque >= 48 dp.
 */
import { Badge, Card, colors, Screen, type as t } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { linkNavegavel, rotuloDoTipo, type NotificacaoLocal } from '../lib/notificacoes';
import { useCore } from '../lib/usar-core';
import { useNotificacoes } from '../lib/usar-notificacoes';

export function TelaNotificacoes() {
  const core = useCore();
  const { caixa, naoLidas, marcarLida, carregado } = useNotificacoes();

  const abrir = (n: NotificacaoLocal) => {
    void marcarLida(n.id);
    const destino = linkNavegavel(n.link);
    if (destino) router.navigate(destino as never);
  };

  return (
    <Screen refreshing={core.sincronizando} onRefresh={core.sincronizar} testID="notificacoes.tela">
      <View style={{ gap: 2 }}>
        <Text style={t.h1}>Notificações</Text>
        <Text style={t.sub} testID="notificacoes.resumo">
          {naoLidas === 0 ? 'Você está em dia.' : naoLidas === 1 ? '1 aviso não lido.' : `${naoLidas} avisos não lidos.`}
        </Text>
      </View>
      {carregado && caixa.length === 0 ? (
        <Card style={{ padding: 14 }} testID="notificacoes.vazio">
          <Text style={t.sub}>Nenhum aviso por enquanto. Puxe a tela para atualizar quando tiver sinal.</Text>
        </Card>
      ) : null}
      {caixa.map((n) => (
        <Pressable key={n.id} accessibilityRole="button" accessibilityLabel={`${n.titulo}. ${n.lida_em ? 'Lida' : 'Não lida'}`} onPress={() => abrir(n)} testID={`notificacoes.item.${n.id}`} style={{ minHeight: 56 }}>
          <Card style={{ padding: 12, gap: 6, borderLeftWidth: n.lida_em ? 0 : 4, borderLeftColor: n.prioridade === 'alta' ? colors.danger : colors.accent }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Badge tone={n.prioridade === 'alta' ? 'danger' : 'neutral'} label={n.prioridade === 'alta' ? 'Importante' : rotuloDoTipo[n.tipo]} />
              {n.leituraPendente ? <Badge tone="warning" label="Leitura não enviada" /> : null}
            </View>
            <Text style={n.lida_em ? t.body : t.bodyStrong}>{n.titulo}</Text>
            <Text style={t.small}>{n.corpo}</Text>
          </Card>
        </Pressable>
      ))}
    </Screen>
  );
}
