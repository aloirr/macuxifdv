/**
 * Slots de extensão que o SHELL renderiza (os demais — `cliente.abas`, `cliente.acoes`,
 * `visita.etapas_checkout` — são renderizados pelas telas do Core). Contrato dos payloads em
 * `modules/core/contracts/extensoes.ts` (`CardInicio`, `ItemMenu`). O shell já recebe só os itens de módulos
 * efetivos, do perfil e com a ação permitida (ADR 0004); módulo desativado = item some, sem erro (RN-CORE-03).
 */
import type { CardInicio, ItemMenu } from '@macuxi/core/contracts';
import { useExtensoes } from '@macuxi/platform-sdk/react';
import { Card, colors, Icon, SectionHeader, type as t } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import type { ComponentType } from 'react';
import { Pressable, Text, View } from 'react-native';

import type { AbaShell } from '@/lib/abas';
import { abrirAba } from '@/lib/historico-telas';
import { ordenarCards } from '@/lib/inicio';

/**
 * Slot `inicio.cards`: cards dos módulos no Início, em largura total, por `ordem` (menor primeiro; ausente = 100; empate =
 * ordem do registro). Cards lado a lado (Orçamentos | A faturar) são desenhados pelo próprio módulo dentro de um card.
 * O shell só monta: os itens já vêm filtrados por módulo efetivo, perfil e ação (ADR 0004). Sem Vendedor, sem Orçamentos
 * e A faturar; sem Gestor, sem "Pedidos para aprovar"; o promotor não recebe card de pedido (RN-PRO-01).
 */
export function CardsDoInicio() {
  const cards = ordenarCards(useExtensoes<CardInicio<ComponentType>>('inicio.cards'));
  if (cards.length === 0) return null;
  return (
    <View style={{ gap: 12 }} testID="inicio-cards">
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

/**
 * Menu do Perfil: as páginas que não couberam na barra do Gestão (`paginas`, Mc161 A, R-20261119-212852; vazio no Campo),
 * com o rótulo e o ícone da página, e depois os atalhos do slot `menu.itens` dos módulos (`/m/<caminho>`).
 */
export function ItensDoMenu({ paginas = [] }: { paginas?: readonly AbaShell[] }) {
  const itens = useExtensoes<ItemMenu>('menu.itens');
  if (itens.length === 0 && paginas.length === 0) return null;
  const linha = { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14 } as const;
  return (
    <View style={{ gap: 8 }} testID="menu-itens">
      <SectionHeader title="Mais" />
      <Card>
        {paginas.map((aba) => (
          <Pressable
            key={aba.href}
            testID={aba.testID.replace(/^tab-/, 'perfil-')}
            accessibilityRole="button"
            accessibilityLabel={aba.label}
            onPress={() => router.navigate(abrirAba(aba.href, false) as never)}
            style={linha}>
            <Icon name={aba.icon} size={20} color={colors.ink2} />
            <Text style={[t.bodyStrong, { flex: 1 }]}>{aba.label}</Text>
            <Icon name="chevron" size={16} />
          </Pressable>
        ))}
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
