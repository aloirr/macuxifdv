/**
 * T-0150 (spec docs/design/pedido-v4.md §1 e §2): tabelas do detalhe do pedido/orçamento e do Resumo do Novo pedido.
 *  - `TabelaRotuloValor`: Pagamento/Entrega (Cliente, Venda) em cartão, rótulo 13 ink2 numa coluna de 92 dp;
 *  - `TabelaDeItens`: Produto · Qtd · Preço unit. · Desc./Acrésc. · Total, larguras fixas 40/48/58/56 dp, números sem "R$";
 *  - `CartaoDeTotais`: Tabela · linha líquida (% sobre a tabela) · Total. Sem texto de regra: tudo vem de funções puras.
 * Números em IBM Plex Sans tabular (abaixo de 15 px o 6 do Archivo parece 8).
 */
import { Balao, BotaoEditar, colors, fonts } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ROTULO_VALOR_FINAL } from '../../domain/apresentacao-totais';

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

/**
 * T-0165 (docs/design/pedido-v4.md §5.4): Código · Emb. · Qtd · Valor tabela · Desc./Acrésc. · Total. O código é link: o toque abre o
 * balão com "nome - marca" logo abaixo da linha (um por vez; outro toque fecha). `aoTocarLinha` (Resumo) abre a folha do item pelo resto da linha e pelo lápis (T-0165), depois do Total.
 */
export function TabelaDeItens({ itens, testID = 'tabela-itens', aoTocarLinha }: { itens: ReadonlyArray<LinhaDeItemEmTabela & { key: string }>; testID?: string; aoTocarLinha?: (key: string) => void }) {
  return (
    <View style={s.cartao} testID={testID}>
      <View style={s.cabecalho}>
        <Text style={[s.cab, s.colCodigo]}>Código</Text>
        <Text style={[s.cab, s.colEmb]}>Emb.</Text>
        <Text style={[s.cab, s.dir, s.colQtd]}>Qtd</Text>
        <Text style={[s.cab, s.dir, s.colTabela]}>Valor tabela</Text>
        <Text style={[s.cab, s.dir, s.colAjuste]}>Desc./ Acrésc.</Text>
        <Text style={[s.cab, s.dir, s.colTotal]}>Total</Text>
        {aoTocarLinha ? <View style={s.colLapis} /> : null}
      </View>
      {itens.map((l) => (
        <View key={l.key} style={s.traco}>
          <View style={s.linhaItem}>
            <Balao testID={`codigo-${l.codigo}`} texto={l.nomeComMarca} rotuloAcessivel={`${l.codigo}, ${l.nomeComMarca}`} tamanhoFonte={14} style={s.colCodigo}>
              <Text style={s.codigoLink}>{l.codigo}</Text>
            </Balao>
            <Pressable accessibilityRole={aoTocarLinha ? 'button' : undefined} accessibilityLabel={`${l.codigo}, ${l.emb} ${l.fator}, quantidade ${l.qtd}, valor de tabela ${l.valorTabela}, ajuste ${l.ajuste}, total ${l.total}${aoTocarLinha ? '. Toque para editar.' : ''}`} disabled={!aoTocarLinha} onPress={() => aoTocarLinha?.(l.key)} style={s.restoDaLinha} testID={`linha-${l.codigo}`}>
              <View style={s.colEmb}>
                <Text style={s.emb}>{l.emb}</Text>
                {l.fator ? <Text style={s.fator}>{l.fator}</Text> : null}
              </View>
              <Text style={[s.num, s.dir, s.colQtd]}>{l.qtd}</Text>
              <Text style={[s.num, s.dir, s.colTabela]}>{l.valorTabela}</Text>
              <Text style={[s.num, s.dir, s.colAjuste, l.ajuste === '0,0%' && { color: colors.ink2 }]}>{l.ajuste}</Text>
              <Text style={[s.num, s.total, s.dir, s.colTotal]}>{l.total}</Text>
            </Pressable>
            {aoTocarLinha ? (
              <BotaoEditar testID={`editar-${l.codigo}`} item={l.codigo} tamanho="tabela" onPress={() => aoTocarLinha(l.key)} />
            ) : null}
          </View>
        </View>
      ))}
    </View>
  );
}

/** §5.1: sem ajuste uma linha só, o "Valor final"; com ajuste, Valor de tabela, Desconto (%), Desconto (R$) e o Valor final. */
export function CartaoDeTotais({ linhas, total, testIDTotal }: { linhas: ReadonlyArray<{ id: string; rotulo: string; valor: string }>; total: string; testIDTotal?: string }) {
  return (
    <View style={s.cartao} testID="detalhe-total">
      {linhas.map((l, i) => (
        <View key={l.id} style={[s.linhaTot, i > 0 && s.traco]}>
          <Text style={s.rotuloTot}>{l.rotulo}</Text>
          <Text style={s.valorTot}>{l.valor}</Text>
        </View>
      ))}
      <View style={[s.linhaTot, linhas.length > 0 && s.tracoForte]}>
        <Text style={s.rotuloTotal}>{ROTULO_VALOR_FINAL}</Text>
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
  cabecalho: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 6, alignItems: 'flex-end' },
  cab: { fontFamily: fonts.semibold, fontSize: 11, color: colors.ink2 },
  linhaItem: { flexDirection: 'row', gap: 6, paddingHorizontal: 10, alignItems: 'center', minHeight: 44 },
  restoDaLinha: { flexDirection: 'row', gap: 6, alignItems: 'center', minHeight: 44, paddingVertical: 8 },
  colCodigo: { flex: 1, minHeight: 44, justifyContent: 'center' },
  colEmb: { width: 40 },
  colQtd: { width: 30 },
  colTabela: { width: 50 },
  colAjuste: { width: 54 },
  colTotal: { width: 56 },
  colLapis: { width: 32 },
  dir: { textAlign: 'right' },
  codigoLink: { fontFamily: fonts.mono, fontSize: 12, color: colors.accentInk, textDecorationLine: 'underline' },
  emb: { fontFamily: fonts.body, fontSize: 12, color: colors.ink },
  fator: { fontFamily: fonts.body, fontSize: 10.5, color: colors.ink2 },
  num: { fontFamily: fonts.body, fontSize: 12, color: colors.ink, fontVariant: ['tabular-nums'] },
  total: { fontFamily: fonts.bold, fontSize: 13 },
  linhaTot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, minHeight: 48 },
  rotuloTot: { fontFamily: fonts.body, fontSize: 14, color: colors.ink2 },
  valorTot: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink, fontVariant: ['tabular-nums'] },
  rotuloTotal: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  valorTotal: { fontFamily: fonts.displayBold, fontSize: 20, color: colors.ink, fontVariant: ['tabular-nums'] },
});
