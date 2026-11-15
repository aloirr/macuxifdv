/**
 * Itens do Vendedor na ficha do cliente (slots `cliente.abas` e `cliente.acoes` do Core, ADR 0003):
 * "Sugestão de mix" e "Últimos pedidos" (registrados no index.ts, junto do botão "Novo pedido").
 * Lê do aparelho (offline-first); com sinal atualiza em segundo plano. O Core entrega o título da seção.
 */
import { formatBRL0 } from '@macuxi/comum';
import type { ContextoCliente } from '@macuxi/core/contracts';
import { Badge, Card, colors, fonte, Icon, radius, relativeWhen, type as t } from '@macuxi/ui/mobile';
import { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { statusBadge } from '../lib/order-status';
import { mergeOrders, rascunhoVazio, somarAoRascunho, ultimosPedidosDoCliente } from '../lib/pedidos';
import { irParaPedido } from '../rotas';
import { useVendedor } from '../state/use-vendedor';
import { AvisoRapido, useAviso } from './aviso';

export function AbaMix({ contexto }: { contexto: ContextoCliente }) {
  const app = useVendedor();
  const { aviso, mostrar } = useAviso();
  const { carregarFicha, carregado } = app;
  const id = contexto.clienteId;
  useEffect(() => {
    if (carregado) void carregarFicha(id);
  }, [carregado, carregarFicha, id]);

  const mix = app.dados.mix[id] ?? [];
  const rascunho = app.dados.rascunhos[id] ?? rascunhoVazio(id);

  const adicionar = (productId: string, descricao: string) => {
    void app.atualizarRascunho(id, id, (r) => somarAoRascunho(r, productId));
    mostrar(`${descricao} adicionado ao pedido`);
  };

  return (
    <Card testID="mix-sugestao">
      {mix.length === 0 ? (
        <Text style={[t.sub, { padding: 14 }]}>{app.offline ? 'Sugestões disponíveis após sincronizar com sinal.' : 'Sem sugestões para este cliente.'}</Text>
      ) : (
        <Text style={[t.small, { paddingHorizontal: 14, paddingTop: 10 }]}>Compra em clientes parecidos</Text>
      )}
      {mix.map((m, i) => {
        const qtd = rascunho.lines[m.product.id] ?? 0;
        return (
          <View key={m.product.id} style={[styles.linha, i < mix.length - 1 && styles.divisor]}>
            <View style={{ flex: 1, gap: 1 }}>
              <Text style={t.bodyStrong} numberOfLines={1}>
                {m.product.description}
              </Text>
              <Text style={t.small} numberOfLines={1}>
                {qtd > 0 ? `No pedido: ${qtd} ${m.product.unit.toLowerCase()} · ` : ''}
                {m.reason}
              </Text>
            </View>
            <Pressable
              testID={`mix-add-${m.product.erp_code}`}
              accessibilityRole="button"
              accessibilityLabel={`Adicionar ${m.product.description} ao pedido`}
              onPress={() => adicionar(m.product.id, m.product.description)}
              style={({ pressed }) => [styles.mais, qtd > 0 && { backgroundColor: colors.successBg }, pressed && { opacity: 0.7 }]}>
              <Icon name={qtd > 0 ? 'check' : 'plus'} size={18} color={qtd > 0 ? colors.success : colors.ink} />
            </Pressable>
          </View>
        );
      })}
      <AvisoRapido aviso={aviso} />
    </Card>
  );
}

export function AbaUltimosPedidos({ contexto }: { contexto: ContextoCliente }) {
  const app = useVendedor();
  const { carregarFicha, carregado, vendedor, dados, fila, tz } = app;
  const id = contexto.clienteId;
  useEffect(() => {
    if (carregado) void carregarFicha(id);
  }, [carregado, carregarFicha, id]);

  const ultimos = useMemo(() => {
    const doServidor = [...(dados.ultimos[id] ?? []), ...dados.pedidos.filter((o) => o.customer_id === id)];
    const unicos = [...new Map(doServidor.map((o) => [o.id, o])).values()];
    const naFila = fila.filter((f) => f.payload.customer_id === id);
    const lista = vendedor
      ? mergeOrders(unicos, naFila, { id: vendedor.id, name: vendedor.name, branch_id: vendedor.branch_id })
      : unicos.map((o) => ({ ...o, local: false, local_error: '' }));
    return ultimosPedidosDoCliente(id, lista);
  }, [dados.ultimos, dados.pedidos, fila, vendedor, id]);

  if (ultimos.length === 0) {
    return (
      <Card testID="ultimos-pedidos">
        <Text style={[t.sub, { padding: 14 }]}>Nenhum pedido recente deste cliente no aparelho.</Text>
      </Card>
    );
  }
  return (
    <Card testID="ultimos-pedidos">
      {ultimos.map((o, i) => {
        const b = statusBadge(o.status);
        return (
          <Pressable
            key={o.id}
            accessibilityRole="button"
            accessibilityLabel={`Abrir pedido ${o.number || 'no aparelho'}`}
            onPress={() => irParaPedido(o.id)}
            style={[styles.linha, { minHeight: 52 }, i < ultimos.length - 1 && styles.divisor]}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={t.small}>
                <Text style={{ ...fonte.mono }}>{o.number || 'no aparelho'}</Text> · {relativeWhen(o.received_at, new Date(), tz)}
              </Text>
              <Badge label={b.label} fg={b.fg} bg={b.bg} />
            </View>
            <Text style={t.bodyStrong}>{formatBRL0(o.total_cents)}</Text>
          </Pressable>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, paddingRight: 10, paddingLeft: 14 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  mais: { width: 48, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
});
