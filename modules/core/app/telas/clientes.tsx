/**
 * Carteira: busca e filtros locais (funcionam sem sinal).
 */
import { formatBRL0 } from '@macuxi/comum';
import { Badge, Chip, EtiquetaCadastroIncompleto, colors, daysAgoLabel, fonts, Icon, radius, SyncStamp, type as t } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { CustomerSummary } from '../../contracts';
import { listarClientesLocais, type ItemClienteLocal } from '../lib/cliente360-local';
import { useClientesLocais, type ClientesLocais } from '../lib/usar-clientes-locais';
import { CUSTOMER_FILTERS, filterCustomers, type CustomerFilter } from '../lib/carteira';
import { abrirCliente } from '../lib/navegacao';
import { useCore } from '../lib/usar-core';

export function TelaClientes() {
  const core = useCore();
  const { tz } = core;
  const cache = { customers: core.estado.clientes, synced_at: core.estado.sincronizadoEm };
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ filter?: string }>();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<CustomerFilter[]>([]);

  useEffect(() => {
    const f = params.filter;
    if (f && CUSTOMER_FILTERS.some((x) => x.id === f)) setFilters([f as CustomerFilter]);
  }, [params.filter]);

  const { dados: locais, hoje } = useClientesLocais();
  const list = useMemo(() => filterCustomers(cache.customers, query, filters), [cache.customers, query, filters]);
  const toggle = (id: CustomerFilter) => setFilters((fs) => (fs.includes(id) ? fs.filter((x) => x !== id) : [...fs, id]));

  // com o pull de `cliente` no aparelho, a lista vem das linhas locais (offline, T-0017); senão, a carga antiga da Fase M
  if (locais.pronto) return <ListaLocal dados={locais} hoje={hoje} />;

  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }}>
      <View style={[styles.top, { paddingTop: Math.max(28, insets.top + 16) }]}>
        <View style={styles.header}>
          <View style={{ gap: 2, flex: 1 }}>
            <Text style={t.h1}>Clientes</Text>
            <Text style={t.sub}>
              {list.length === cache.customers.length ? `${cache.customers.length} na carteira` : `${list.length} de ${cache.customers.length} na carteira`}
            </Text>
          </View>
          <SyncStamp at={cache.synced_at} offline={false} tz={tz} />
        </View>
        <View style={styles.search}>
          <Icon name="search" size={18} color={colors.ink2} />
          <TextInput
            testID="customer-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Nome, código, bairro ou CNPJ"
            placeholderTextColor={colors.ink3}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Buscar cliente"
          />
          {query ? (
            <Pressable accessibilityLabel="Limpar busca" onPress={() => setQuery('')} hitSlop={12}>
              <Icon name="close" size={16} color={colors.ink2} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}>
          {CUSTOMER_FILTERS.map((f) => (
            <Chip key={f.id} testID={`filter-${f.id}`} label={f.label} active={filters.includes(f.id)} onPress={() => toggle(f.id)} />
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={list}
        keyExtractor={(c) => c.id}
        refreshing={core.sincronizando}
        onRefresh={core.sincronizar}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
        ListEmptyComponent={<Text style={[t.sub, { padding: 14 }]}>Nenhum cliente com esses filtros.</Text>}
        renderItem={({ item, index }) => <CustomerRow c={item} first={index === 0} last={index === list.length - 1} />}
      />
    </View>
  );
}

type FiltroLocal = 'vencidos' | 'sem_compra' | 'bloqueados';
const FILTROS_LOCAIS: Array<{ id: FiltroLocal; label: string }> = [
  { id: 'vencidos', label: 'Com título vencido' },
  { id: 'sem_compra', label: 'Sem compra 45+ dias' },
  { id: 'bloqueados', label: 'Bloqueados' },
];

/** Lista de Clientes do aparelho (Cliente 360 offline, T-0017): busca por nome, fantasia, documento e cidade. */
function ListaLocal({ dados, hoje }: { dados: ClientesLocais; hoje: string }) {
  const core = useCore();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [filtros, setFiltros] = useState<FiltroLocal[]>([]);
  const alternar = (id: FiltroLocal) => setFiltros((fs) => (fs.includes(id) ? fs.filter((x) => x !== id) : [...fs, id]));
  const lista = useMemo(
    () =>
      listarClientesLocais(dados, hoje, {
        q: query,
        comVencidos: filtros.includes('vencidos') || undefined,
        bloqueado: filtros.includes('bloqueados') || undefined,
        semCompraHa: filtros.includes('sem_compra') ? 45 : undefined,
      }),
    [dados, hoje, query, filtros],
  );
  const total = dados.clientes.filter((c) => c.deleted_at === null).length;
  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }} testID="clientes-locais">
      <View style={[styles.top, { paddingTop: Math.max(28, insets.top + 16) }]}>
        <View style={styles.header}>
          <View style={{ gap: 2, flex: 1 }}>
            <Text style={t.h1}>Clientes</Text>
            <Text style={t.sub}>{lista.length === total ? `${total} na carteira` : `${lista.length} de ${total} na carteira`}</Text>
          </View>
          <SyncStamp at={core.estado.sincronizadoEm} offline={false} tz={core.tz} />
        </View>
        <View style={styles.search}>
          <Icon name="search" size={18} color={colors.ink2} />
          <TextInput
            testID="customer-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Nome, documento ou cidade"
            placeholderTextColor={colors.ink3}
            style={styles.searchInput}
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel="Buscar cliente"
          />
          {query ? (
            <Pressable accessibilityLabel="Limpar busca" onPress={() => setQuery('')} hitSlop={12}>
              <Icon name="close" size={16} color={colors.ink2} />
            </Pressable>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -20 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 20 }}>
          {FILTROS_LOCAIS.map((f) => (
            <Chip key={f.id} testID={`filter-${f.id}`} label={f.label} active={filtros.includes(f.id)} onPress={() => alternar(f.id)} />
          ))}
        </ScrollView>
      </View>
      <FlatList
        data={lista}
        keyExtractor={(c) => c.id}
        refreshing={core.sincronizando}
        onRefresh={core.sincronizar}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}
        ListEmptyComponent={<Text style={[t.sub, { padding: 14 }]}>Nenhum cliente com esses filtros. Limpe a busca ou os filtros para ver a carteira toda.</Text>}
        renderItem={({ item, index }) => <LinhaLocal c={item} first={index === 0} last={index === lista.length - 1} />}
      />
    </View>
  );
}

function LinhaLocal({ c, first, last }: { c: ItemClienteLocal; first: boolean; last: boolean }) {
  const nome = c.nome_fantasia?.trim() || c.razao_social;
  const semCompra = c.dias_sem_compra === null || c.dias_sem_compra >= 45;
  return (
    <Pressable
      testID={`customer-${nome}`}
      accessibilityRole="button"
      onPress={() => abrirCliente(c.id, 'Clientes')}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, last && styles.rowLast, !last && styles.divider, pressed && { backgroundColor: colors.ground }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={t.bodyStrong} numberOfLines={1}>
          {nome}
        </Text>
        <Text style={t.small} numberOfLines={1}>
          {[c.cidade, c.segmento].filter(Boolean).join(' · ') || 'Sem cidade informada'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          {c.bloqueado ? <Badge label="Bloqueado" tone="danger" /> : null}
          {c.cadastro_incompleto ? <EtiquetaCadastroIncompleto /> : null}
          {c.vencidos_qtd > 0 ? <Badge label={`${c.vencidos_qtd} vencido${c.vencidos_qtd > 1 ? 's' : ''}`} tone="danger" /> : null}
          {semCompra ? <Badge label={c.dias_sem_compra === null ? 'nunca comprou' : `${c.dias_sem_compra} dias sem compra`} tone="warning" /> : null}
        </View>
      </View>
      <Icon name="chevron" size={16} color={colors.ink3} />
    </Pressable>
  );
}

function CustomerRow({ c, first, last }: { c: CustomerSummary; first: boolean; last: boolean }) {
  const idle = c.days_since_purchase === null || c.days_since_purchase >= 45;
  return (
    <Pressable
      testID={`customer-${c.trade_name}`}
      accessibilityRole="button"
      onPress={() => abrirCliente(c.id, 'Clientes')}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, last && styles.rowLast, !last && styles.divider, pressed && { backgroundColor: colors.ground }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={t.bodyStrong} numberOfLines={1}>
          {c.trade_name}
        </Text>
        <Text style={t.small} numberOfLines={1}>
          {c.district} · compra média {formatBRL0(c.avg_monthly_cents)}
        </Text>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
          <Badge label={`Curva ${c.abc_curve}`} tone={c.abc_curve === 'A' ? 'accent' : 'neutral'} />
          {c.overdue_count > 0 ? <Badge label={`${c.overdue_count} vencido${c.overdue_count > 1 ? 's' : ''}`} tone="danger" /> : null}
          {idle ? <Badge label={c.days_since_purchase === null ? 'nunca comprou' : `${c.days_since_purchase} dias sem compra`} tone="warning" /> : null}
          {!idle && !c.positivated_this_month ? <Badge label="não positivado" tone="warning" /> : null}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
        <Text style={t.small}>{daysAgoLabel(c.days_since_purchase)}</Text>
        <Icon name="chevron" size={16} color={colors.ink3} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 20, paddingBottom: 12, gap: 12 },
  header: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 46, paddingHorizontal: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md },
  searchInput: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 15, color: colors.ink, height: 44 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line },
  rowFirst: { borderTopWidth: 1, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  rowLast: { borderBottomWidth: 1, borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
