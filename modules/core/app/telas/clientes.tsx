/**
 * Carteira: busca e filtros locais (funcionam sem sinal).
 */
import { CabecalhoTela, Chip, ChipEstado, EstadoVazio, colors, fonte, Icon, radius, SeloAtualizacao, type as t } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import type { CustomerSummary } from '../../contracts';
import { dataLocal, ROTULO_SITUACAO_CLIENTE, situacaoDoCliente, textoUltimaVisita, type SituacaoDoCliente } from '../../domain';
import { fusoDe } from '../lib/estado';
import { listarClientesLocais, type ItemClienteLocal } from '../lib/cliente360-local';
import { useClientesLocais, type ClientesLocais } from '../lib/usar-clientes-locais';
import { CUSTOMER_FILTERS, filterCustomers, type CustomerFilter } from '../lib/carteira';
import { abrirCliente } from '../lib/navegacao';
import { useCore } from '../lib/usar-core';

export function TelaClientes() {
  const core = useCore();
  const { tz } = core;
  const cache = { customers: core.estado.clientes, synced_at: core.estado.sincronizadoEm };
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
      <CabecalhoTela
        titulo="Clientes"
        subtitulo={list.length === cache.customers.length ? `${cache.customers.length} na carteira` : `${list.length} de ${cache.customers.length} na carteira`}
        direita={<SeloAtualizacao testID="clientes-selo-sync" semRede={false} onSincronizar={core.sincronizar} atualizadoEm={cache.synced_at} tz={tz} sobreFaixa />}
      />
      <View style={styles.top}>
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
        ListEmptyComponent={<EstadoVazio testID="clientes-vazio" icone="search" titulo="Nenhum cliente com esses filtros" texto="Limpe a busca ou os filtros para ver a carteira toda." />}
        renderItem={({ item, index }) => <CustomerRow c={item} first={index === 0} last={index === list.length - 1} />}
      />
    </View>
  );
}

type FiltroLocal = 'vencidos' | 'sem_compra' | 'bloqueados';
const FILTROS_LOCAIS: Array<{ id: FiltroLocal; label: string }> = [
  { id: 'vencidos', label: 'Devendo' },
  { id: 'sem_compra', label: 'Sem compra 45+ dias' },
  { id: 'bloqueados', label: 'Bloqueados' },
];

/** Lista de Clientes do aparelho (Cliente 360 offline, T-0017): busca por nome, fantasia, documento e cidade. */
function ListaLocal({ dados, hoje }: { dados: ClientesLocais; hoje: string }) {
  const core = useCore();
  const [query, setQuery] = useState('');
  const [filtros, setFiltros] = useState<FiltroLocal[]>([]);
  const alternar = (id: FiltroLocal) => setFiltros((fs) => (fs.includes(id) ? fs.filter((x) => x !== id) : [...fs, id]));
  // RN-CORE-47: o check-in feito agora no aparelho já vale (antes do sync); o resumo do servidor traz o de qualquer vendedor
  const fuso = fusoDe(core.estado.me);
  const doAparelho = useMemo(() => core.estado.visitas.map((v) => ({ cliente_id: v.customer_id, ultima_visita_data: dataLocal(new Date(v.checkin_at), fuso) })), [core.estado.visitas, fuso]);
  const doServidor = useMemo(() => dados.resumosVisita.flatMap((r) => (r.ultima_visita_em ? [{ cliente_id: r.cliente_id, ultima_visita_data: dataLocal(r.ultima_visita_em, fuso) }] : [])), [dados.resumosVisita, fuso]);
  const lista = useMemo(
    () =>
      listarClientesLocais({ ...dados, ultimasVisitas: [...doServidor, ...doAparelho] }, hoje, {
        q: query,
        comVencidos: filtros.includes('vencidos') || undefined,
        bloqueado: filtros.includes('bloqueados') || undefined,
        semCompraHa: filtros.includes('sem_compra') ? 45 : undefined,
      }),
    [dados, doServidor, doAparelho, hoje, query, filtros],
  );
  const total = dados.clientes.filter((c) => c.deleted_at === null).length;
  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }} testID="clientes-locais">
      <CabecalhoTela
        titulo="Clientes"
        subtitulo={lista.length === total ? `${total} na carteira` : `${lista.length} de ${total} na carteira`}
        direita={<SeloAtualizacao testID="clientes-selo-sync" semRede={false} onSincronizar={core.sincronizar} atualizadoEm={core.estado.sincronizadoEm} tz={core.tz} sobreFaixa />}
      />
      <View style={styles.top}>
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
        ListEmptyComponent={<EstadoVazio testID="clientes-vazio" icone="search" titulo="Nenhum cliente com esses filtros" texto="Limpe a busca ou os filtros para ver a carteira toda." />}
        renderItem={({ item, index }) => <LinhaLocal c={item} hoje={hoje} first={index === 0} last={index === lista.length - 1} />}
      />
    </View>
  );
}

const TOM_SITUACAO: Record<SituacaoDoCliente, 'erro' | 'sucesso' | 'neutro'> = { bloqueado: 'erro', devendo: 'erro', pre_cadastro: 'neutro', em_dia: 'sucesso' };

/** RN-CORE-47: nome, uma tag de situação, a última visita e a seta. Nada mais na linha. */
function LinhaCliente({ id, nome, situacao, visita, first, last }: { id: string; nome: string; situacao: SituacaoDoCliente; visita: string | null; first: boolean; last: boolean }) {
  const rotulo = ROTULO_SITUACAO_CLIENTE[situacao];
  return (
    <Pressable
      testID={`customer-${nome}`}
      accessibilityRole="button"
      accessibilityLabel={visita ? `${nome}, ${rotulo}, ${visita}` : `${nome}, ${rotulo}`}
      onPress={() => abrirCliente(id, 'Clientes')}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, last && styles.rowLast, !last && styles.divider, pressed && { backgroundColor: colors.ground }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={t.title16} numberOfLines={1}>
          {nome}
        </Text>
        {visita ? (
          <Text style={t.sub} numberOfLines={1}>
            {visita}
          </Text>
        ) : null}
      </View>
      <ChipEstado pequeno texto={rotulo} tom={TOM_SITUACAO[situacao]} icone={situacao === 'bloqueado' ? 'lock' : undefined} />
      <Icon name="chevron" size={16} color={colors.ink3} />
    </Pressable>
  );
}

function LinhaLocal({ c, hoje, first, last }: { c: ItemClienteLocal; hoje: string; first: boolean; last: boolean }) {
  return (
    <LinhaCliente
      id={c.id}
      nome={c.nome_fantasia?.trim() || c.razao_social}
      situacao={situacaoDoCliente(c)}
      visita={textoUltimaVisita(c.ultima_visita, hoje)}
      first={first}
      last={last}
    />
  );
}

/** Carga antiga (Fase M): o resumo não traz check-in nem bloqueio, então a linha não mostra a última visita. */
function CustomerRow({ c, first, last }: { c: CustomerSummary; first: boolean; last: boolean }) {
  return (
    <LinhaCliente
      id={c.id}
      nome={c.trade_name}
      situacao={situacaoDoCliente({ bloqueado: false, vencidos_qtd: c.overdue_count, external_id: c.erp_code })}
      visita={null}
      first={first}
      last={last}
    />
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 12 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 48, paddingHorizontal: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md },
  searchInput: { flex: 1, minWidth: 0, ...fonte.body, fontSize: 16, color: colors.ink, height: 44 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line },
  rowFirst: { borderTopWidth: 1, borderTopLeftRadius: radius.cartao, borderTopRightRadius: radius.cartao },
  rowLast: { borderBottomWidth: 1, borderBottomLeftRadius: radius.cartao, borderBottomRightRadius: radius.cartao },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
