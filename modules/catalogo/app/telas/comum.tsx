/**
 * Peças das telas do Catálogo: cartão do produto, selo de estoque e botões da extensão `produto.acoes` (o Vendedor
 * registra "Adicionar ao pedido" com `acao: 'pedido.criar'`; o shell já esconde do promotor — RN-PRO-01, regra 7).
 */
import { useExtensoes } from '@macuxi/platform-sdk/react';
import { Badge, Button, Card, colors, fonts, type as t, type IconName } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { AcaoProduto, ContextoProduto, ItemVitrine } from '../../contracts';
import { rotuloEstoque, rotuloPreco, subtituloProduto } from '../lib/apresentacao';

/** Itens do slot `produto.acoes` visíveis ao usuário (módulo efetivo, perfil e ação). */
export function useAcoesProduto(): { id: string; payload: AcaoProduto }[] {
  return useExtensoes<AcaoProduto>('produto.acoes').map((e) => ({ id: e.id, payload: e.payload }));
}

export function contextoDoProduto(item: ItemVitrine, clienteId: string | null): ContextoProduto {
  return { produtoId: item.id, sku: item.erp_code, nomeProduto: item.description, clienteId, vendavel: item.price ? item.price.sellable : null };
}

export function BotoesAcao({ item, clienteId, compacto = false }: { item: ItemVitrine; clienteId: string | null; compacto?: boolean }) {
  const acoes = useAcoesProduto();
  if (acoes.length === 0) return null;
  const ctx = contextoDoProduto(item, clienteId);
  return (
    <View style={[s.acoes, compacto && s.acoesCompactas]}>
      {acoes.map((a) => (
        <Button
          key={a.id}
          testID={`${a.payload.testID}-${item.erp_code}`}
          label={a.payload.rotulo}
          icon={a.payload.icone as IconName | undefined}
          variant={a.payload.destaque ? 'accent' : 'outline'}
          height={48}
          onPress={() => a.payload.abrir(ctx)}
          style={compacto ? s.botaoCompacto : undefined}
        />
      ))}
    </View>
  );
}

export function CartaoProduto({ item, agora, fuso, clienteId, onPress }: { item: ItemVitrine; agora: string; fuso: string; clienteId: string | null; onPress: () => void }) {
  const preco = rotuloPreco(item);
  const estoque = rotuloEstoque(item, agora, fuso);
  return (
    <Card testID={`catalogo-item-${item.erp_code}`} style={s.card}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Abrir ${item.description}`} onPress={onPress} style={({ pressed }) => [s.toque, pressed && { opacity: 0.7 }]}>
        <View style={s.linha}>
          <Text style={[t.title16, s.nome]} numberOfLines={2}>
            {item.description}
          </Text>
          {item.is_campaign ? <Badge label="Destaque" tone="accent" /> : null}
        </View>
        <Text style={t.small}>{subtituloProduto(item)}</Text>
        {preco ? (
          <View style={s.linha}>
            <Text style={[preco.vendavel ? s.preco : s.semPreco]} testID={`catalogo-preco-${item.erp_code}`}>
              {preco.texto}
            </Text>
            {preco.riscado ? <Text style={s.riscado}>{preco.riscado}</Text> : null}
          </View>
        ) : null}
        {estoque ? (
          <View style={s.linha}>
            <Badge label={estoque.texto} tone={estoque.tom} />
            <Text style={[t.small, estoque.desatualizado && { color: colors.warning }]}>{estoque.detalhe}</Text>
          </View>
        ) : null}
      </Pressable>
      <BotoesAcao item={item} clienteId={clienteId} compacto />
    </Card>
  );
}

const s = StyleSheet.create({
  card: { padding: 14, gap: 10 },
  toque: { gap: 6, minHeight: 48 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  nome: { flex: 1 },
  preco: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink },
  semPreco: { fontFamily: fonts.medium, fontSize: 13, color: colors.ink2 },
  riscado: { fontFamily: fonts.body, fontSize: 13, color: colors.ink3, textDecorationLine: 'line-through' },
  acoes: { gap: 8 },
  acoesCompactas: { flexDirection: 'row', flexWrap: 'wrap' },
  botaoCompacto: { flexGrow: 1 },
});
