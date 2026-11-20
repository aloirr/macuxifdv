/**
 * Carteira: busca e filtros locais (funcionam sem sinal).
 * Filtro padrão (R-20261115-072200): o campo de busca fica na tela (exceção à regra "todo filtro no botão de filtro", com o Catálogo;
 * R-20261120-062210) e procura por código, CNPJ, razão social ou nome fantasia; as situações ficam na folha "Filtrar"; cada situação aplicada vira etiqueta removível. A
 * carteira vazia mostra só "Sua carteira está vazia." (RD-0501, RD-0504). Regras no domain (`filtro-padrao.ts`).
 */
import { BotaoFiltro, CabecalhoTela, CampoBusca, Chip, ChipEstado, EstadoVazio, EtiquetaFiltro, colors, Icon, radius, type as t } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactElement, type SetStateAction } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import type { CustomerSummary } from '../../contracts';
import {
  dataLocal,
  ROTULO_BUSCA_CLIENTE,
  ROTULO_SITUACAO_CLIENTE,
  situacaoDoCliente,
  situacaoNaLinha,
  subtituloDaCarteira,
  textoUltimaVisita,
  textoVerClientes,
  type SituacaoDoCliente,
} from '../../domain';
import { FolhaFiltrar, GrupoFiltro } from '../components/folha-filtrar';
import { fusoDe } from '../lib/estado';
import { listarClientesLocais, type ItemClienteLocal } from '../lib/cliente360-local';
import { useClientesLocais, type ClientesLocais } from '../lib/usar-clientes-locais';
import { CUSTOMER_FILTERS, filterCustomers, type CustomerFilter } from '../lib/carteira';
import { abrirCliente } from '../lib/navegacao';
import { useCore } from '../lib/usar-core';

/** Situação da folha; `garante` é a situação da linha que o filtro já assegura (RD-0500: a tag dela sai da linha). */
interface Situacao<F extends string> {
  id: F;
  label: string;
  garante?: SituacaoDoCliente;
}

const SITUACOES_FASE_M: ReadonlyArray<Situacao<CustomerFilter>> = CUSTOMER_FILTERS.map((f) => (f.id === 'overdue' ? { ...f, garante: 'devendo' } : f));

export function TelaClientes() {
  const core = useCore();
  const customers = core.estado.clientes;
  const params = useLocalSearchParams<{ filter?: string }>();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<CustomerFilter[]>([]);

  useEffect(() => {
    const f = params.filter;
    if (f && CUSTOMER_FILTERS.some((x) => x.id === f)) setFilters([f as CustomerFilter]);
  }, [params.filter]);

  const { dados: locais, hoje } = useClientesLocais();
  const list = useMemo(() => filterCustomers(customers, query, filters), [customers, query, filters]);

  // com o pull de `cliente` no aparelho, a lista vem das linhas locais (offline, T-0017); senão, a carga antiga da Fase M
  if (locais.pronto) return <ListaLocal dados={locais} hoje={hoje} />;

  return (
    <Carteira
      total={customers.length}
      itens={list}
      chave={(c) => c.id}
      contar={(fs) => filterCustomers(customers, query, fs).length}
      situacoes={SITUACOES_FASE_M}
      filtros={filters}
      setFiltros={setFilters}
      query={query}
      setQuery={setQuery}
      linha={(item, first, last, garantidas) => <CustomerRow c={item} first={first} last={last} garantidas={garantidas} />}
    />
  );
}

type FiltroLocal = 'vencidos' | 'sem_compra' | 'bloqueados';
const FILTROS_LOCAIS: ReadonlyArray<Situacao<FiltroLocal>> = [
  { id: 'vencidos', label: 'Devendo', garante: 'devendo' },
  { id: 'sem_compra', label: 'Sem compra 45+ dias' },
  { id: 'bloqueados', label: 'Bloqueados', garante: 'bloqueado' },
];

/** Lista de Clientes do aparelho (Cliente 360 offline, T-0017). */
function ListaLocal({ dados, hoje }: { dados: ClientesLocais; hoje: string }) {
  const core = useCore();
  const [query, setQuery] = useState('');
  const [filtros, setFiltros] = useState<FiltroLocal[]>([]);
  // RN-CORE-47: o check-in feito agora no aparelho já vale (antes do sync); o resumo do servidor traz o de qualquer vendedor
  const fuso = fusoDe(core.estado.me);
  const doAparelho = useMemo(() => core.estado.visitas.map((v) => ({ cliente_id: v.customer_id, ultima_visita_data: dataLocal(new Date(v.checkin_at), fuso) })), [core.estado.visitas, fuso]);
  const doServidor = useMemo(() => dados.resumosVisita.flatMap((r) => (r.ultima_visita_em ? [{ cliente_id: r.cliente_id, ultima_visita_data: dataLocal(r.ultima_visita_em, fuso) }] : [])), [dados.resumosVisita, fuso]);
  const listar = useCallback(
    (fs: readonly FiltroLocal[]) =>
      listarClientesLocais({ ...dados, ultimasVisitas: [...doServidor, ...doAparelho] }, hoje, {
        q: query,
        comVencidos: fs.includes('vencidos') || undefined,
        bloqueado: fs.includes('bloqueados') || undefined,
        semCompraHa: fs.includes('sem_compra') ? 45 : undefined,
      }),
    [dados, doServidor, doAparelho, hoje, query],
  );
  const lista = useMemo(() => listar(filtros), [listar, filtros]);
  const total = dados.clientes.filter((c) => c.deleted_at === null).length;
  return (
    <Carteira
      testID="clientes-locais"
      total={total}
      itens={lista}
      chave={(c) => c.id}
      contar={(fs) => listar(fs).length}
      situacoes={FILTROS_LOCAIS}
      filtros={filtros}
      setFiltros={setFiltros}
      query={query}
      setQuery={setQuery}
      linha={(item, first, last, garantidas) => <LinhaLocal c={item} hoje={hoje} first={first} last={last} garantidas={garantidas} />}
    />
  );
}

/** O miolo da tela: faixa, busca + filtro, etiquetas, lista e a folha "Filtrar" (igual nas duas fontes da carteira). */
function Carteira<F extends string, T>({
  total,
  itens,
  chave,
  contar,
  situacoes,
  filtros,
  setFiltros,
  query,
  setQuery,
  linha,
  testID,
}: {
  total: number;
  itens: readonly T[];
  chave: (item: T) => string;
  /** Quantos clientes a lista teria com estes filtros (o "Ver N clientes" acompanha a escolha). */
  contar: (filtros: F[]) => number;
  situacoes: ReadonlyArray<Situacao<F>>;
  filtros: F[];
  setFiltros: Dispatch<SetStateAction<F[]>>;
  query: string;
  setQuery: (q: string) => void;
  linha: (item: T, first: boolean, last: boolean, garantidas: readonly SituacaoDoCliente[]) => ReactElement;
  testID?: string;
}) {
  const core = useCore();
  const [folhaAberta, setFolhaAberta] = useState(false);
  const [rascunho, setRascunho] = useState<F[]>([]);
  const garantidas = situacoes.flatMap((s) => (s.garante && filtros.includes(s.id) ? [s.garante] : []));
  const alternar = (id: F) => setRascunho((fs) => (fs.includes(id) ? fs.filter((x) => x !== id) : [...fs, id]));
  const vazia = total === 0;
  return (
    <View style={{ flex: 1, backgroundColor: colors.ground }} testID={testID}>
      <CabecalhoTela
        titulo="Clientes"
        subtitulo={subtituloDaCarteira(itens.length, total)}
      />
      {vazia ? null : (
        <View style={styles.top}>
          <View style={styles.linhaBusca}>
            <View style={{ flex: 1 }}>
              <CampoBusca testID="customer-search" valor={query} onChange={setQuery} onLimpar={() => setQuery('')} rotuloLimpar="Limpar a busca" rotuloAcessivel="Buscar cliente" placeholder={ROTULO_BUSCA_CLIENTE} />
            </View>
            <BotaoFiltro
              testID="clientes-filtro"
              contagem={filtros.length}
              rotulo="Filtrar"
              onPress={() => {
                setRascunho(filtros);
                setFolhaAberta(true);
              }}
            />
          </View>
          {filtros.length > 0 ? (
            <View style={styles.etiquetas} testID="clientes-etiquetas">
              {situacoes
                .filter((s) => filtros.includes(s.id))
                .map((s) => (
                  <EtiquetaFiltro key={s.id} testID={`filter-${s.id}`} texto={s.label} rotuloRemover={`Remover filtro ${s.label}`} onRemover={() => setFiltros((fs) => fs.filter((x) => x !== s.id))} />
                ))}
            </View>
          ) : null}
        </View>
      )}
      <FlatList
        data={itens}
        keyExtractor={chave}
        refreshing={core.sincronizando}
        onRefresh={core.sincronizar}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[{ paddingHorizontal: 20, paddingBottom: 20 }, vazia && { paddingTop: 12 }]}
        ListEmptyComponent={
          vazia ? (
            <EstadoVazio testID="clientes-carteira-vazia" icone="users" titulo="Sua carteira está vazia." />
          ) : (
            <EstadoVazio testID="clientes-vazio" icone="search" titulo="Nenhum cliente com esses filtros." />
          )
        }
        renderItem={({ item, index }) => linha(item, index === 0, index === itens.length - 1, garantidas)}
      />
      <FolhaFiltrar
        testID="clientes-folha"
        visivel={folhaAberta}
        onFechar={() => setFolhaAberta(false)}
        titulo="Filtrar"
        rotuloFechar="Fechar o filtro"
        limpar={{ rotulo: 'Limpar', onPress: () => setRascunho([]), desligado: rascunho.length === 0 }}
        ver={{
          rotulo: textoVerClientes(contar(rascunho)),
          onPress: () => {
            setFiltros(rascunho);
            setFolhaAberta(false);
          },
        }}>
        <GrupoFiltro rotulo="Situação">
          <View style={styles.chips}>
            {situacoes.map((s) => (
              <Chip key={s.id} testID={`clientes-folha-${s.id}`} label={s.label} active={rascunho.includes(s.id)} onPress={() => alternar(s.id)} />
            ))}
          </View>
        </GrupoFiltro>
      </FolhaFiltrar>
    </View>
  );
}

const TOM_SITUACAO: Record<SituacaoDoCliente, 'erro' | 'sucesso' | 'neutro'> = { bloqueado: 'erro', devendo: 'erro', pre_cadastro: 'neutro', em_dia: 'sucesso' };

/**
 * RN-CORE-47: nome, uma tag de situação, a última visita e a seta. Nada mais na linha. RD-0500: a tag que o filtro marcado já
 * garante sai (`situacaoNaLinha`).
 */
function LinhaCliente({ id, nome, situacao: daLinha, garantidas, visita, first, last }: { id: string; nome: string; situacao: SituacaoDoCliente; garantidas: readonly SituacaoDoCliente[]; visita: string | null; first: boolean; last: boolean }) {
  const situacao = situacaoNaLinha(daLinha, garantidas);
  const rotulo = situacao ? ROTULO_SITUACAO_CLIENTE[situacao] : null;
  const leitura = [nome, rotulo, visita].filter(Boolean).join(', ');
  return (
    <Pressable
      testID={`customer-${nome}`}
      accessibilityRole="button"
      accessibilityLabel={leitura}
      onPress={() => abrirCliente(id, 'Clientes')}
      style={({ pressed }) => [styles.row, first && styles.rowFirst, last && styles.rowLast, !last && styles.divider, pressed && { backgroundColor: colors.ground }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={t.bodyStrong} numberOfLines={1}>
          {nome}
        </Text>
        {visita ? (
          <Text style={t.sub} numberOfLines={1}>
            {visita}
          </Text>
        ) : null}
      </View>
      {situacao && rotulo ? <ChipEstado pequeno texto={rotulo} tom={TOM_SITUACAO[situacao]} icone={situacao === 'bloqueado' ? 'lock' : undefined} /> : null}
      <Icon name="chevron" size={16} color={colors.ink3} />
    </Pressable>
  );
}

function LinhaLocal({ c, hoje, first, last, garantidas }: { c: ItemClienteLocal; hoje: string; first: boolean; last: boolean; garantidas: readonly SituacaoDoCliente[] }) {
  return (
    <LinhaCliente
      id={c.id}
      nome={c.nome_fantasia?.trim() || c.razao_social}
      situacao={situacaoDoCliente(c)}
      garantidas={garantidas}
      visita={textoUltimaVisita(c.ultima_visita, hoje)}
      first={first}
      last={last}
    />
  );
}

/** Carga antiga (Fase M): o resumo não traz check-in nem bloqueio, então a linha não mostra a última visita. */
function CustomerRow({ c, first, last, garantidas }: { c: CustomerSummary; first: boolean; last: boolean; garantidas: readonly SituacaoDoCliente[] }) {
  return (
    <LinhaCliente
      id={c.id}
      nome={c.trade_name}
      situacao={situacaoDoCliente({ bloqueado: false, vencidos_qtd: c.overdue_count, external_id: c.erp_code })}
      garantidas={garantidas}
      visita={null}
      first={first}
      last={last}
    />
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, gap: 4 },
  linhaBusca: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  etiquetas: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 14, backgroundColor: colors.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: colors.line },
  rowFirst: { borderTopWidth: 1, borderTopLeftRadius: radius.cartao, borderTopRightRadius: radius.cartao },
  rowLast: { borderBottomWidth: 1, borderBottomLeftRadius: radius.cartao, borderBottomRightRadius: radius.cartao },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
