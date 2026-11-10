/**
 * T-0148 (docs/design/pedido-v4.md §3): resultados da busca (descrição, "Estoque n UN", botão Adicionar) e o painel compacto
 * "No pedido". Sem campo de quantidade na linha: o toque abre o popup do item (`FolhaDoItem`). Sem marca de problema: o problema
 * está nos Alertas (RN-VEN-42). Só desenha; textos e regras vêm de `lib/item-popup`.
 */
import { formatBRL } from '@macuxi/comum';
import type { Product } from '@macuxi/catalogo/contracts';
import { Botao, colors, fonts } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { TrechoServeEm } from '../../domain/busca-seletor';
import { painelNoPedido, textoDoEstoque } from '../lib/item-popup';
import { ServeEm } from './novo-pedido-itens';

export function ResultadosDaBusca({ produtos, serveEm, aoAdicionar }: { produtos: readonly Product[]; serveEm?: ReadonlyMap<string, TrechoServeEm>; aoAdicionar: (produtoId: string) => void }) {
  return (
    <View style={s.cartao} testID="resultados-busca">
      {produtos.map((p, i) => {
        const trecho = serveEm?.get(p.id);
        const resumo = (p.applications ?? '').trim();
        return (
          <View key={p.id} style={[s.linha, i > 0 && s.traco]} testID={`product-${p.erp_code}`}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={s.descricao} numberOfLines={2}>
                {p.description}
              </Text>
              <Text style={s.detalhe} numberOfLines={1}>
                <Text style={s.estoque}>{textoDoEstoque(p.stock_total, p.unit)}</Text>
                {resumo && !trecho ? ` · ${resumo}` : ''}
              </Text>
              {trecho ? <ServeEm trecho={trecho} codigo={p.erp_code} /> : null}
              {p.price_cents === null ? (
                <Text style={s.semPreco} testID={`sem-preco-${p.erp_code}`}>
                  Sem preço para este cliente
                </Text>
              ) : null}
            </View>
            <Botao testID={`adicionar-${p.erp_code}`} nivel="secundario" rotulo="Adicionar" rotuloAcessivel={`Adicionar ${p.description}`} desligado={p.price_cents === null} onPress={() => aoAdicionar(p.id)} />
          </View>
        );
      })}
    </View>
  );
}

export interface LinhaDoPainel {
  chave: string;
  produtoId: string;
  descricao: string;
  /** "4 UN" */
  qtd: string;
  total_cents: number;
}

export function PainelNoPedido({ linhas, aberto, aoAlternar, aoAbrirItem }: { linhas: readonly LinhaDoPainel[]; aberto: boolean; aoAlternar: () => void; aoAbrirItem: (produtoId: string) => void }) {
  if (linhas.length === 0) return null;
  const estado = painelNoPedido(linhas.length, aberto);
  return (
    <View style={s.painel} testID="no-pedido">
      <View style={s.painelTopo}>
        <Text style={s.painelTitulo}>NO PEDIDO</Text>
        {estado.link ? (
          <Pressable testID="ver-itens" accessibilityRole="button" accessibilityLabel={estado.link.rotuloAcessivel} onPress={aoAlternar} style={s.link}>
            <Text style={s.linkTexto}>{estado.link.rotulo}</Text>
          </Pressable>
        ) : null}
      </View>
      {estado.mostraLinhas
        ? linhas.map((l) => (
            <Pressable key={l.chave} testID={`no-pedido-${l.produtoId}`} accessibilityRole="button" accessibilityLabel={`${l.descricao}, ${l.qtd}, ${formatBRL(l.total_cents)}. Toque para editar.`} onPress={() => aoAbrirItem(l.produtoId)} style={s.painelLinha}>
              <Text style={s.painelDescricao} numberOfLines={1}>
                {l.descricao}
              </Text>
              <Text style={s.painelQtd}>{l.qtd}</Text>
              <Text style={s.painelValor}>{formatBRL(l.total_cents)}</Text>
            </Pressable>
          ))
        : null}
    </View>
  );
}

const s = StyleSheet.create({
  cartao: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 12, overflow: 'hidden' },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10 },
  traco: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  descricao: { fontFamily: fonts.semibold, fontSize: 15, lineHeight: 20, color: colors.ink },
  detalhe: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink2 },
  estoque: { fontFamily: fonts.semibold, color: colors.ink },
  semPreco: { fontFamily: fonts.semibold, fontSize: 12, color: colors.danger },
  painel: { backgroundColor: '#E7EAE3', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 6 },
  painelTopo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 36 },
  painelTitulo: { fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.6, color: colors.ink2 },
  link: { minHeight: 44, justifyContent: 'center', paddingLeft: 12 },
  linkTexto: { fontFamily: fonts.semibold, fontSize: 13, color: colors.accentInk },
  painelLinha: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  painelDescricao: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.ink },
  painelQtd: { width: 44, fontFamily: fonts.body, fontSize: 13, color: colors.ink2, textAlign: 'right' },
  painelValor: { width: 58, fontFamily: fonts.bold, fontSize: 13, color: colors.ink, textAlign: 'right', fontVariant: ['tabular-nums'] },
});
