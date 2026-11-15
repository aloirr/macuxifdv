/**
 * T-0148 e T-0165 (docs/design/pedido-v4.md §5.2): a folha do item, de baixo para cima. "Nome - marca" na linha do ✕, só o código embaixo,
 * Alertas do item, Embalagem (as do cadastro, da largura da Quantidade) com o ESTOQUE à direita (só o número, na embalagem marcada; laranja de
 * 1 a 9 com "Risco de ruptura"), Quantidade e Desc./Acrésc. lado a lado (sem o equivalente ao lado: o cartão já mostra), Totais fixos (mesma regra do Resumo: as quatro linhas desde a abertura, zeros sem ajuste) e o botão principal. Reaberto (T-0165, lápis Editar):
 * "Salvar alteração" e "Remover item" (texto vermelho). O estado é LOCAL: o pedido só recalcula ao confirmar; a prévia usa um cálculo de uma linha só.
 * Com alerta, o botão continua: o item entra e o pedido só sai como orçamento (RN-VEN-11, RN-VEN-20). RD-0177: o máximo não repete na área do item: borda no campo e "Máx. 10,0%" embaixo.
 */
import { formatBRL } from '@macuxi/comum';
import type { Product } from '@macuxi/catalogo/contracts';
import { Botao, colors, fonts, Folha, Icon, Passo, Segmentado } from '@macuxi/ui/mobile';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { textoDoAlertaNoItem, textoDoMaximo } from '../../domain/alertas-pedido';
import { linhasDosTotais, ROTULO_VALOR_FINAL } from '../../domain/apresentacao-totais';
import type { AjusteGeral } from '../../domain/desconto-geral';
import { descontoMaximoDoItemPct, rotuloMedida } from '../../domain/preco-pedido';
import { nomeComMarca } from '../lib/detalhe-pedido';
import { alertasDoItem, chavesDoProduto, estadoInicialDoItem, estoqueNaEmbalagem, numeroDoEstoque, riscoDeRuptura, ROTULOS_DO_POPUP, TEXTO_RISCO_DE_RUPTURA, type EstadoDoItem } from '../lib/item-popup';
import { alternarAplicacao, minimoDoProdutoNoPrazo, type Ajuste, type CalculoPedido, type ProdutoComMinimo, type UnidadeDaTela } from '../lib/novo-pedido';
import { AreaAlertas } from './area-alertas';
import { AjusteDoItem } from './novo-pedido-itens';
import { CaixaAplicacao } from './novo-pedido';

export interface PropsFolhaDoItem {
  produto: Product;
  medidas: UnidadeDaTela[];
  lines: Record<string, number>;
  ajustes: Record<string, Ajuste>;
  /** cálculo de UMA linha (a do popup), sem o ajuste do pedido: a prévia dos totais do item */
  previa: (lines: Record<string, number>, ajustes: Record<string, Ajuste>) => CalculoPedido | null;
  /** o último Desc./Acrésc. geral aplicado: o item novo entra com ele */
  geral?: AjusteGeral | null;
  /** RN-VEN-43: % do prazo do pedido em bp (o máximo do item parte da tabela ajustada); ausente = 0 */
  percentualAjusteBp?: number;
  onConfirmar: (estado: Pick<EstadoDoItem, 'idx' | 'qtd' | 'ajuste'>) => void;
  onRemover: () => void;
  onFechar: () => void;
}

export function FolhaDoItem({ produto: p, medidas, lines, ajustes, previa, geral = null, percentualAjusteBp = 0, onConfirmar, onRemover, onFechar }: PropsFolhaDoItem) {
  const inicial = estadoInicialDoItem(p.id, medidas, lines, ajustes, geral);
  const [idx, setIdx] = useState(inicial.idx);
  const [qtd, setQtd] = useState(inicial.qtd);
  const [ajuste, setAjuste] = useState<Ajuste>(inicial.ajuste);
  const [larguraQtd, setLarguraQtd] = useState<number | undefined>(undefined);
  const medida = medidas[idx] ?? medidas[0]!;
  const chave = chavesDoProduto(p.id, medidas)[idx] ?? p.id;
  const calc = qtd > 0 ? previa({ [chave]: qtd }, { [chave]: ajuste }) : null;
  const linha = calc?.linhas[0] ?? null;
  const minimo = minimoDoProdutoNoPrazo(p as ProdutoComMinimo, percentualAjusteBp);
  const maximoPct = linha && minimo !== null ? descontoMaximoDoItemPct(linha.preco_tabela_cents, minimo * medida.fator) : null;
  const alertas = alertasDoItem({ erp_code: p.erp_code, unidade_base: p.unit, estoque_base: p.stock_total, quantidade_base: qtd * medida.fator, acima_do_maximo: (calc?.acima_do_maximo.length ?? 0) > 0, maximo_pct: maximoPct });
  const acima = alertas.some((a) => a.tipo === 'maximo');
  const nome = `${p.description} ${rotuloMedida(medida.unidade, medida.fator)}`;
  const tabelaTotal = linha ? linha.preco_tabela_cents * qtd : 0;
  const linhasTot = linha ? linhasDosTotais({ subtotal_cents: tabelaTotal, total_cents: linha.total_cents }, { fixas: true }) : [];
  const estoque = estoqueNaEmbalagem(p.stock_total, medida.fator);
  const risco = riscoDeRuptura(estoque);
  return (
    <Folha visivel onFechar={onFechar} rotuloFechar="Fechar" titulo={nomeComMarca(p.description, p.brand)} fechar={{ rotulo: 'Fechar', testID: 'popup-item-fechar' }} evitarTeclado testID="popup-item">
      <View style={{ gap: 12 }}>
        <Text style={s.sub} testID="popup-item-codigo">
          {p.erp_code}
        </Text>
        <AreaAlertas alertas={alertas.filter((a) => a.tipo !== 'maximo')} texto={textoDoAlertaNoItem} testID="popup-item-alertas" />
        <View style={s.linhaDupla}>
          <View style={{ gap: 6 }}>
            <Text style={s.rotulo}>EMBALAGEM</Text>
            <Segmentado
              testID="popup-item-embalagem"
              rotuloAcessivel={`Embalagem de ${p.description}`}
              style={larguraQtd !== undefined && medidas.length > 1 ? { width: larguraQtd } : { alignSelf: 'flex-start' }}
              valor={String(idx)}
              opcoes={medidas.map((x, i) => ({ id: String(i), rotulo: i === 0 ? x.unidade : rotuloMedida(x.unidade, x.fator), rotuloAcessivel: `Embalagem ${rotuloMedida(x.unidade, x.fator)}`, testID: `popup-item-embalagem-${x.unidade}` }))}
              onChange={(novo) => setIdx(Number(novo))}
            />
          </View>
          <View style={s.colunaEstoque}>
            <Text style={[s.rotulo, { textAlign: 'right' }]}>ESTOQUE</Text>
            <View style={[s.caixaEstoque, risco && s.caixaEstoqueRisco]} testID="popup-item-estoque" accessible accessibilityLabel={`Estoque ${numeroDoEstoque(estoque)} ${medida.unidade}${risco ? `. ${TEXTO_RISCO_DE_RUPTURA}` : ''}`}>
              <Text style={[s.numeroEstoque, risco && { color: colors.accentInk }]}>{numeroDoEstoque(estoque)}</Text>
            </View>
            {risco ? (
              <View style={s.risco} testID="popup-item-risco">
                <Icon name="alert" size={14} color={colors.accentInk} />
                <Text style={s.riscoTexto}>{TEXTO_RISCO_DE_RUPTURA}</Text>
              </View>
            ) : null}
          </View>
        </View>
        <View style={s.linhaDupla}>
          <View style={{ gap: 6 }} onLayout={(e) => setLarguraQtd(e.nativeEvent.layout.width)}>
            <Text style={s.rotulo}>QUANTIDADE</Text>
            <Passo editavel valor={qtd} min={1} onChange={setQtd} rotulo={`Quantidade de ${nome}`} rotuloDiminuir={`Diminuir ${nome}`} rotuloAumentar={`Aumentar ${nome}`} desligadoAumentar={p.price_cents === null} testID="popup-item-qtd" />
          </View>
          <View style={{ gap: 6, flex: 1 }}>
            <Text style={s.rotulo}>DESC./ACRÉSC.</Text>
            <View style={acima ? s.bordaDeAlerta : undefined}>
              <AjusteDoItem
                k={`popup-${p.erp_code}`}
                nome={nome}
                p={p}
                ajuste={ajuste}
                equivalente={linha?.equivalente ?? null}
                onAjuste={(aj) => setAjuste({ ...aj, ...(ajuste.aplicacao_marcada !== undefined ? { aplicacao_marcada: ajuste.aplicacao_marcada } : {}), ...(ajuste.aplicacao_retrato ? { aplicacao_retrato: ajuste.aplicacao_retrato } : {}) })}
              />
            </View>
            {acima && maximoPct !== null ? (
              <Text style={s.maximo} testID="popup-item-maximo">
                {textoDoMaximo(maximoPct)}
              </Text>
            ) : null}
          </View>
        </View>
        {p.applications ? <CaixaAplicacao testID="popup-item-aplicacao" marcada={Boolean(linha?.aplicacao_marcada)} onPress={() => setAjuste(alternarAplicacao(ajuste, Boolean(linha?.aplicacao_marcada)))} nome={nome} /> : null}
        {linha ? (
          <View style={s.totais} testID="popup-item-totais">
            {linhasTot.map((l) => (
              <View key={l.id} style={s.linhaTot}>
                <Text style={s.totRotulo}>{l.rotulo}</Text>
                <Text style={s.totValor}>{l.valor}</Text>
              </View>
            ))}
            <View style={[s.linhaTot, s.totalDoItem]}>
              <Text style={s.totRotuloForte}>{ROTULO_VALOR_FINAL}</Text>
              <Text style={s.totTotal} testID="popup-item-total">
                {formatBRL(linha.total_cents)}
              </Text>
            </View>
          </View>
        ) : null}
        <Botao testID="popup-item-confirmar" nivel="principal" rotulo={inicial.reabrindo ? ROTULOS_DO_POPUP.salvar : ROTULOS_DO_POPUP.adicionar} desligado={qtd < 1 || p.price_cents === null} onPress={() => onConfirmar({ idx, qtd, ajuste })} />
        {inicial.reabrindo ? (
          <Pressable testID="popup-item-remover" accessibilityRole="button" accessibilityLabel={ROTULOS_DO_POPUP.remover} onPress={onRemover} style={s.remover}>
            <Text style={s.removerTexto}>{ROTULOS_DO_POPUP.remover}</Text>
          </Pressable>
        ) : null}
      </View>
    </Folha>
  );
}

const s = StyleSheet.create({
  remover: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  removerTexto: { fontFamily: fonts.semibold, fontSize: 15, color: colors.danger },
  sub: { fontFamily: fonts.mono, fontSize: 12.5, color: colors.ink2 },
  colunaEstoque: { alignItems: 'flex-end', gap: 6 },
  caixaEstoque: { width: 84, height: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  caixaEstoqueRisco: { backgroundColor: colors.accentSoft, borderColor: colors.accentInk },
  numeroEstoque: { fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },
  risco: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  riscoTexto: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.accentInk },
  rotulo: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.6, color: colors.ink2 },
  linhaDupla: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', justifyContent: 'space-between' },
  maximo: { fontFamily: fonts.semibold, fontSize: 12.5, color: colors.danger },
  bordaDeAlerta: { borderWidth: 2, borderColor: colors.danger, borderRadius: 14 },
  totais: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  linhaTot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36 },
  totalDoItem: { borderTopWidth: 1, borderTopColor: colors.line },
  totRotulo: { fontFamily: fonts.body, fontSize: 14, color: colors.ink2 },
  totRotuloForte: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  totValor: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] },
  totTotal: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
});
