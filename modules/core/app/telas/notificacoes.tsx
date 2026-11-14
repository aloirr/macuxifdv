/**
 * Notificações (RF-CORE-09). Caixa lida do aparelho (offline); abrir marca como lida pela fila e, se houver `link`
 * interno, navega. testIDs: docs/modulos/core/test-ids.md. Alvos de toque >= 48 dp.
 */
import { Cartao, ChipEstado, colors, EstadoVazio, Screen, type as t } from '@macuxi/ui/mobile';
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { linkInternoNavegavel as linkNavegavel } from '@macuxi/platform-sdk';
import { rotuloDoTipo, type NotificacaoLocal } from '../lib/notificacoes';
import { useCore } from '../lib/usar-core';
import { useNotificacoes } from '../lib/usar-notificacoes';

export function TelaNotificacoes() {
  const core = useCore();
  const { caixa, naoLidas, marcarLida, carregado } = useNotificacoes();
  const visao = useVisaoShell();

  const abrir = (n: NotificacaoLocal) => {
    void marcarLida(n.id);
    const destino = linkNavegavel(n.link, (c) => visao.pagina(c) !== null);
    if (destino) router.navigate(destino as never);
  };

  return (
    <Screen
      refreshing={core.sincronizando}
      onRefresh={core.sincronizar}
      testID="notificacoes.tela"
      cabecalho={{
        titulo: 'Notificações',
        subtitulo: naoLidas === 0 ? 'Você está em dia.' : naoLidas === 1 ? '1 aviso não lido.' : `${naoLidas} avisos não lidos.`,
        testID: 'notificacoes.resumo',
      }}>
      {carregado && caixa.length === 0 ? (
        <EstadoVazio testID="notificacoes.vazio" icone="inbox" titulo="Nenhum aviso por enquanto" texto="Puxe a tela para atualizar quando tiver sinal." />
      ) : null}
      {caixa.map((n) => (
        <Pressable key={n.id} accessibilityRole="button" accessibilityLabel={`${n.titulo}. ${n.lida_em ? 'Lida' : 'Não lida'}`} onPress={() => abrir(n)} testID={`notificacoes.item.${n.id}`} style={{ minHeight: 56 }}>
          <Cartao preenchimento={12} gap={6} style={{ borderLeftWidth: n.lida_em ? 0 : 4, borderLeftColor: n.prioridade === 'alta' ? colors.danger : colors.accent }}>
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <ChipEstado pequeno tom={n.prioridade === 'alta' ? 'erro' : 'neutro'} texto={n.prioridade === 'alta' ? 'Importante' : rotuloDoTipo[n.tipo]} />
            </View>
            <Text style={n.lida_em ? t.body : t.bodyStrong}>{n.titulo}</Text>
            {n.corpo ? <Text style={t.small}>{n.corpo}</Text> : null}
          </Cartao>
        </Pressable>
      ))}
    </Screen>
  );
}
