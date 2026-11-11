/**
 * T-0150 (spec docs/design/pedido-v4.md §1 e §2): tabelas do detalhe do pedido/orçamento e do Resumo do Novo pedido.
 *  - `TabelaRotuloValor`: Pagamento/Entrega (Cliente, Venda) em cartão, rótulo 13 ink2 numa coluna de 92 dp;
 *  - `TabelaDeItens`: Produto · Qtd · Preço unit. · Desc./Acrésc. · Total, larguras fixas 40/48/58/56 dp, números sem "R$";
 *  - `CartaoDeTotais`: Tabela · linha líquida (% sobre a tabela) · Total. Sem texto de regra: tudo vem de funções puras.
 * Números em IBM Plex Sans tabular (abaixo de 15 px o 6 do Archivo parece 8).
 */
import { colors, fonts } from '@macuxi/ui/mobile';
import { StyleSheet, Text, View } from 'react-native';

import type { LinhaDeItemEmTabela } from '../lib/detalhe-pedido';

export function TabelaRotuloValor({ linhas, testID }: { linhas: ReadonlyArray<{ rotulo: string; valor: string; testID?: string; complemento?: string; testIDComplemento?: string }>; testID?: string }) {
  return (
    <View style={s.cartao} testID={testID}>
      {linhas.map((l, i) => (
        <View key={l.rotulo} style={[s.linhaRV, i > 0 && s.traco]} accessible accessibilityLabel={`${l.rotulo}: ${l.valor}${l.complemento ? `. ${l.complemento}` : ''}`}>
          <Text style={s.rotulo}>{l.rotulo}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.valor} testID={l.testID}>
              {l.valor || '—'}
            </Text>
            {l.complemento ? (
              <Text style={s.complemento} testID={l.testIDComplemento}>
                {l.complemento}
              </Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function TabelaDeItens({ itens, testID = 'tabela-itens' }: { itens: ReadonlyArray<LinhaDeItemEmTabela & { key: string }>; testID?: string }) {
  return (
    <View style={s.cartao} testID={testID}>
      <View style={s.cabecalho}>
        <Text style={[s.cab, s.colProduto]}>Produto</Text>
        <Text style={[s.cab, s.dir, s.colQtd]}>Qtd</Text>
        <Text style={[s.cab, s.dir, s.colPreco]}>Preço unit.</Text>
        <Text style={[s.cab, s.dir, s.colAjuste]}>Desc./ Acrésc.</Text>
        <Text style={[s.cab, s.dir, s.colTotal]}>Total</Text>
      </View>
      {itens.map((l) => (
        <View key={l.key} style={[s.linhaItem, s.traco]} accessible accessibilityLabel={`${l.descricao}, ${l.qtd}, preço ${l.preco}, ajuste ${l.ajuste}, total ${l.total}`}>
          <View style={s.colProduto}>
            <Text style={s.produto} numberOfLines={2}>
              {l.descricao}
            </Text>
            <Text style={s.codigo}>{l.codigo}</Text>
          </View>
          <Text style={[s.num, s.dir, s.colQtd]}>{l.qtd}</Text>
          <Text style={[s.num, s.dir, s.colPreco]}>{l.preco}</Text>
          <Text style={[s.num, s.dir, s.colAjuste]}>{l.ajuste}</Text>
          <Text style={[s.num, s.total, s.dir, s.colTotal]}>{l.total}</Text>
        </View>
      ))}
    </View>
  );
}

export function CartaoDeTotais({ tabela, liquida, total, testIDTotal }: { tabela: string; liquida: { rotulo: string; valor: string } | null; total: string; testIDTotal?: string }) {
  return (
    <View style={s.cartao} testID="detalhe-total">
      <View style={s.linhaTot}>
        <Text style={s.rotuloTot}>Tabela</Text>
        <Text style={s.valorTot}>{tabela}</Text>
      </View>
      {liquida ? (
        <View style={[s.linhaTot, s.traco]}>
          <Text style={s.rotuloTot}>{liquida.rotulo}</Text>
          <Text style={s.valorTot}>{liquida.valor}</Text>
        </View>
      ) : null}
      <View style={[s.linhaTot, s.tracoForte]}>
        <Text style={s.rotuloTotal}>Total</Text>
        <Text style={s.valorTotal} testID={testIDTotal}>
          {total}
        </Text>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  cartao: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  traco: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  tracoForte: { borderTopWidth: 1, borderTopColor: colors.line },
  linhaRV: { flexDirection: 'row', gap: 12, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44 },
  rotulo: { width: 92, fontFamily: fonts.body, fontSize: 13, color: colors.ink2 },
  complemento: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.ink2 },
  valor: { fontFamily: fonts.body, fontSize: 14, lineHeight: 19, color: colors.ink },
  cabecalho: { flexDirection: 'row', gap: 4, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 6, alignItems: 'flex-end' },
  cab: { fontFamily: fonts.semibold, fontSize: 11, color: colors.ink2 },
  linhaItem: { flexDirection: 'row', gap: 4, paddingHorizontal: 10, paddingVertical: 10, alignItems: 'flex-start' },
  colProduto: { flex: 1 },
  colQtd: { width: 40 },
  colPreco: { width: 48 },
  colAjuste: { width: 58 },
  colTotal: { width: 56 },
  dir: { textAlign: 'right' },
  produto: { fontFamily: fonts.semibold, fontSize: 12.5, lineHeight: 16, color: colors.ink },
  codigo: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.ink2, marginTop: 2 },
  num: { fontFamily: fonts.body, fontSize: 12, color: colors.ink, fontVariant: ['tabular-nums'] },
  total: { fontFamily: fonts.bold, fontSize: 13 },
  linhaTot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, minHeight: 48 },
  rotuloTot: { fontFamily: fonts.body, fontSize: 14, color: colors.ink2 },
  valorTot: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  rotuloTotal: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  valorTotal: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink, fontVariant: ['tabular-nums'] },
});
