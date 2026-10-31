/**
 * Slots de extensão que o SHELL renderiza (os demais — `cliente.abas`, `cliente.acoes`,
 * `visita.etapas_checkout` — são renderizados pelas telas do Core). Contrato dos payloads em
 * `modules/core/contracts/extensoes.ts` (`CardInicio`, `ItemMenu`). O shell já recebe só os itens de módulos
 * efetivos, do perfil e com a ação permitida (ADR 0004); módulo desativado = item some, sem erro (RN-CORE-03).
 */
import type { CardInicio, ItemMenu } from '@macuxi/core/contracts';
import { useExtensoes } from '@macuxi/platform-sdk/react';
import { Card, Icon, SectionHeader, type as t } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import type { ComponentType } from 'react';
import { Pressable, Text, View } from 'react-native';

/** Slot `inicio.cards`: cards dos módulos na tela Início, na ordem do registro. */
export function CardsDoInicio() {
  const cards = useExtensoes<CardInicio<ComponentType>>('inicio.cards');
  if (cards.length === 0) return null;
  return (
    <View style={{ gap: 10 }} testID="inicio-cards">
      {cards.map(({ modulo, id, payload }) => {
        const Componente = payload.componente;
        return (
          <View key={`${modulo}:${id}`} testID={payload.testID}>
            <Componente />
          </View>
        );
      })}
    </View>
  );
}

/** Slot `menu.itens`: atalhos dos módulos no Perfil (`/m/<caminho>`). */
export function ItensDoMenu() {
  const itens = useExtensoes<ItemMenu>('menu.itens');
  if (itens.length === 0) return null;
  return (
    <View style={{ gap: 8 }} testID="menu-itens">
      <SectionHeader title="Mais" />
      <Card>
        {itens.map(({ modulo, id, payload }) => (
          <Pressable
            key={`${modulo}:${id}`}
            testID={payload.testID}
            accessibilityRole="button"
            onPress={() => router.navigate(`/m/${payload.caminho.replace(/^\/+/, '')}` as never)}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14 }}>
            <Text style={t.bodyStrong}>{payload.rotulo}</Text>
            <Icon name="chevron" size={16} />
          </Pressable>
        ))}
      </Card>
    </View>
  );
}
