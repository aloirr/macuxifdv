/**
 * T-0150 (spec docs/design/pedido-v4.md §1 e §2): tabelas do detalhe do pedido/orçamento e do Resumo do Novo pedido.
 *  - `TabelaDeItens`: adaptador da `TabelaDados` do kit; o Código tem largura pelo conteúdo (`larguraDoCodigo`, 48 a 96 dp);
 *  - Pagamento/Entrega (Cliente, Venda) usam a `TabelaRotuloValor` do kit (`TABELA_DO_PEDIDO`);
 *  - `CartaoDeTotais`: Tabela · linha líquida (% sobre a tabela) · Total. Sem texto de regra: tudo vem de funções puras.
 * Números em fonte do sistema com algarismos tabulares.
 */
import { Balao, BotaoEditar, CelulaTexto, colors, fonte, TabelaDados, type ColunaTabela, type LinhaTabela } from '@macuxi/ui/mobile';
import { StyleSheet, Text, View } from 'react-native';

import { ROTULO_VALOR_FINAL } from '../../domain/apresentacao-totais';

import type { LinhaDeItemEmTabela } from '../lib/detalhe-pedido';
import { larguraDoCodigo } from '../lib/tabela-itens';

/** RD-2378: medidas da `TabelaRotuloValor` no pedido (Cliente, Venda, Pagamento, Entrega), num lugar só. */
export const TABELA_DO_PEDIDO = { larguraRotulo: 92, alinharValor: 'esq' } as const;

/**
 * T-0165 (docs/design/pedido-v4.md §5.4): Código · Emb. · Qtd · Valor tabela · Desc./Acrésc. · Total, sobre a `TabelaDados` do kit
 * (RD-2370). O código é link: o toque abre o balão com "nome - marca". `aoTocarLinha` (Resumo) abre a folha do item pela linha e pelo lápis.
 */
export function TabelaDeItens({ itens, testID = 'tabela-itens', aoTocarLinha }: { itens: ReadonlyArray<LinhaDeItemEmTabela & { key: string }>; testID?: string; aoTocarLinha?: (key: string) => void }) {
  const colunas: ColunaTabela[] = [
    { id: 'codigo', titulo: 'Código', largura: larguraDoCodigo(itens.map((l) => l.codigo)) },
    { id: 'emb', titulo: 'Emb.', peso: 30, numerica: true },
    { id: 'qtd', titulo: 'Qtd', peso: 26, numerica: true },
    { id: 'tabela', titulo: 'Valor tabela', peso: 48, numerica: true },
    { id: 'ajuste', titulo: 'Desc./ Acrésc.', peso: 40, numerica: true },
    { id: 'total', titulo: 'Total', peso: 54, numerica: true },
    ...(aoTocarLinha ? [{ id: 'editar', titulo: '', largura: 32 }] : []),
  ];
  const linhas: LinhaTabela[] = itens.map((l) => ({
    tipo: 'linha',
    key: l.key,
    testID: `linha-${l.codigo}`,
    onPress: aoTocarLinha ? () => aoTocarLinha(l.key) : undefined,
    rotulo: `${l.codigo}, ${l.emb} ${l.fator}, quantidade ${l.qtd}, valor de tabela ${l.valorTabela}, ajuste ${l.ajuste}, total ${l.total}${aoTocarLinha ? '. Toque para editar.' : ''}`,
    celulas: [
      <Balao key="codigo" testID={`codigo-${l.codigo}`} texto={l.nomeComMarca} rotuloAcessivel={`${l.codigo}, ${l.nomeComMarca}`} tamanhoFonte={14}>
        <CelulaTexto principal={l.codigo} mono sublinhado pequeno />
      </Balao>,
      <CelulaTexto key="emb" principal={l.emb} segunda={l.fator} dir pequeno encolher />,
      <CelulaTexto key="qtd" principal={l.qtd} dir pequeno encolher />,
      <CelulaTexto key="tabela" principal={l.valorTabela} dir pequeno encolher />,
      <CelulaTexto key="ajuste" principal={l.ajuste} dir pequeno encolher mudo={l.ajuste === '0,0%'} />,
      <CelulaTexto key="total" principal={l.total} dir encolher />,
      ...(aoTocarLinha ? [<BotaoEditar key="editar" testID={`editar-${l.codigo}`} item={l.codigo} tamanho="tabela" onPress={() => aoTocarLinha(l.key)} />] : []),
    ],
  }));
  return <TabelaDados colunas={colunas} linhas={linhas} testID={testID} />;
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
  linhaTot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12, minHeight: 48 },
  rotuloTot: { ...fonte.body, fontSize: 14, color: colors.ink2 },
  valorTot: { ...fonte.semibold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },
  rotuloTotal: { ...fonte.semibold, fontSize: 16, color: colors.ink },
  valorTotal: { ...fonte.semibold, fontSize: 22, color: colors.ink, fontVariant: ['tabular-nums'] },
});
