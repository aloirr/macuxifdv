/**
 * T-0150 (spec docs/design/pedido-v4.md §1 e §2): tabelas do detalhe do pedido/orçamento e do Resumo do Novo pedido.
 *  - `TabelaRotuloValor`: Pagamento/Entrega (Cliente, Venda) em cartão, rótulo 14 ink2 numa coluna de 92 dp;
 *  - `TabelaDeItens`: Código · Emb. · Qtd · Valor tabela · Desc./Acrésc. · Total, números sem "R$". Larguras: o Código pelo conteúdo
 *    (`larguraDoCodigo`, 48 a 96 dp); as colunas numéricas dividem o resto por peso (30/26/48/40/54), flexBasis 0, à direita,
 *    com `adjustsFontSizeToFit` (valor grande encolhe em vez de quebrar); gap 4 e padding 8, iguais no cabeçalho e nas linhas;
 *  - `CartaoDeTotais`: Tabela · linha líquida (% sobre a tabela) · Total. Sem texto de regra: tudo vem de funções puras.
 * Números em fonte do sistema com algarismos tabulares.
 */
import { Balao, BotaoEditar, colors, fonte } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ROTULO_VALOR_FINAL } from '../../domain/apresentacao-totais';

import type { LinhaDeItemEmTabela } from '../lib/detalhe-pedido';
import { larguraDoCodigo } from '../lib/tabela-itens';

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
  const larguraCodigo = larguraDoCodigo(itens.map((l) => l.codigo));
  return (
    <View style={s.cartao} testID={testID}>
      <View style={s.cabecalho}>
        <Text style={[s.cab, { width: larguraCodigo }]} numberOfLines={1}>
          Código
        </Text>
        <View style={s.restoDoCabecalho}>
          <Text style={[s.cab, s.dir, s.colEmb]} numberOfLines={1}>
            Emb.
          </Text>
          <Text style={[s.cab, s.dir, s.colQtd]} numberOfLines={1}>
            Qtd
          </Text>
          <Text style={[s.cab, s.dir, s.colTabela]}>Valor tabela</Text>
          <Text style={[s.cab, s.dir, s.colAjuste]}>Desc./ Acrésc.</Text>
          <Text style={[s.cab, s.dir, s.colTotal]} numberOfLines={1}>
            Total
          </Text>
        </View>
        {aoTocarLinha ? <View style={s.colLapis} /> : null}
      </View>
      {itens.map((l) => (
        <View key={l.key} style={s.traco}>
          <View style={s.linhaItem}>
            <Balao testID={`codigo-${l.codigo}`} texto={l.nomeComMarca} rotuloAcessivel={`${l.codigo}, ${l.nomeComMarca}`} tamanhoFonte={14} style={[s.colCodigo, { width: larguraCodigo }]}>
              <Text style={s.codigoLink} numberOfLines={1}>{l.codigo}</Text>
            </Balao>
            <Pressable accessibilityRole={aoTocarLinha ? 'button' : undefined} accessibilityLabel={`${l.codigo}, ${l.emb} ${l.fator}, quantidade ${l.qtd}, valor de tabela ${l.valorTabela}, ajuste ${l.ajuste}, total ${l.total}${aoTocarLinha ? '. Toque para editar.' : ''}`} disabled={!aoTocarLinha} onPress={() => aoTocarLinha?.(l.key)} style={s.restoDaLinha} testID={`linha-${l.codigo}`}>
              <View style={s.colEmb}>
                <Text style={[s.emb, s.dir]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                  {l.emb}
                </Text>
                {l.fator ? (
                  <Text style={[s.fator, s.dir]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                    {l.fator}
                  </Text>
                ) : null}
              </View>
              <Text style={[s.num, s.dir, s.colQtd]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {l.qtd}
              </Text>
              <Text style={[s.num, s.dir, s.colTabela]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {l.valorTabela}
              </Text>
              <Text style={[s.num, s.dir, s.colAjuste, l.ajuste === '0,0%' && { color: colors.ink2 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {l.ajuste}
              </Text>
              <Text style={[s.num, s.total, s.dir, s.colTotal]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>
                {l.total}
              </Text>
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
  rotulo: { width: 92, ...fonte.body, fontSize: 14, color: colors.ink2 },
  complemento: { ...fonte.body, fontSize: 12, lineHeight: 16, color: colors.ink2 },
  valor: { ...fonte.body, fontSize: 14, lineHeight: 19, color: colors.ink },
  cabecalho: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 6, alignItems: 'flex-end' },
  restoDoCabecalho: { flex: 1, flexDirection: 'row', gap: 4, alignItems: 'flex-end' },
  cab: { ...fonte.semibold, fontSize: 12, color: colors.ink2 },
  linhaItem: { flexDirection: 'row', gap: 4, paddingHorizontal: 8, alignItems: 'center', minHeight: 44 },
  restoDaLinha: { flex: 1, flexDirection: 'row', gap: 4, alignItems: 'center', minHeight: 44, paddingVertical: 8 },
  colCodigo: { minHeight: 44, justifyContent: 'center' },
  colEmb: { flexGrow: 30, flexShrink: 1, flexBasis: 0, minWidth: 0, alignItems: 'flex-end' },
  colQtd: { flexGrow: 26, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  colTabela: { flexGrow: 48, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  colAjuste: { flexGrow: 40, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  colTotal: { flexGrow: 54, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  colLapis: { width: 32 },
  dir: { textAlign: 'right' },
  codigoLink: { ...fonte.mono, fontSize: 12, color: colors.accentInk, textDecorationLine: 'underline' },
  emb: { ...fonte.body, fontSize: 12, color: colors.ink },
  fator: { ...fonte.body, fontSize: 12, color: colors.ink2 },
  num: { ...fonte.body, fontSize: 12, color: colors.ink, fontVariant: ['tabular-nums'] },
  total: { ...fonte.bold, fontSize: 14 },
  linhaTot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, minHeight: 48 },
  rotuloTot: { ...fonte.body, fontSize: 14, color: colors.ink2 },
  valorTot: { ...fonte.semibold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },
  rotuloTotal: { ...fonte.semibold, fontSize: 16, color: colors.ink },
  valorTotal: { ...fonte.bold, fontSize: 22, color: colors.ink, fontVariant: ['tabular-nums'] },
});
