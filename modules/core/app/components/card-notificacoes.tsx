/** Card "N não lidas" do Início (slot `inicio.cards` do Core; RF-CORE-09). Lê do aparelho; toque abre a caixa. */
import { Card, type as t } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { Pressable, Text } from 'react-native';

import { useNotificacoes } from '../lib/usar-notificacoes';

export function CardNotificacoes() {
  const { naoLidas } = useNotificacoes();
  if (naoLidas === 0) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${naoLidas} avisos não lidos. Abrir notificações`}
      onPress={() => router.navigate('/m/notificacoes' as never)}
      testID="inicio.card-notificacoes"
      style={{ minHeight: 56 }}
    >
      <Card style={{ padding: 14, gap: 2 }}>
        <Text style={t.bodyStrong}>{naoLidas === 1 ? '1 aviso não lido' : `${naoLidas} avisos não lidos`}</Text>
        <Text style={t.small}>Toque para ler.</Text>
      </Card>
    </Pressable>
  );
}
