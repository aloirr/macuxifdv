/**
 * T-0148 (docs/design/pedido-v4.md §3): o popup do item, de baixo para cima. Descrição, "código · Estoque n EMB", Alertas do item,
 * Embalagem (as do cadastro), Quantidade e Desc./Acrésc. lado a lado, Totais do item e o botão principal. Reaberto: "Salvar item"
 * e "Remover do pedido". O estado é LOCAL: o pedido só recalcula ao confirmar (30 itens sem engasgo); a prévia usa um cálculo de
 * uma linha só. Com alerta, o botão continua: o item entra e o pedido só sai como orçamento (RN-VEN-11, RN-VEN-20).
 */
import { formatBRL } from '@macuxi/comum';
import type { Product } from '@macuxi/catalogo/contracts';
import { Botao, colors, fonts, Folha, larguraSegmentadoCompacto, Passo, Segmentado } from '@macuxi/ui/mobile';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { textoDoAlertaNoItem } from '../../domain/alertas-pedido';
import { descontoMaximoDoItemPct, rotuloMedida } from '../../domain/preco-pedido';
import { linhaLiquidaDosTotais } from '../lib/detalhe-pedido';
import { alertasDoItem, chavesDoProduto, estadoInicialDoItem, ROTULOS_DO_POPUP, subtituloDoPopup, type EstadoDoItem } from '../lib/item-popup';
import { alternarAplicacao, type Ajuste, type CalculoPedido, type ProdutoComMinimo, type UnidadeDaTela } from '../lib/novo-pedido';
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
  onConfirmar: (estado: Pick<EstadoDoItem, 'idx' | 'qtd' | 'ajuste'>) => void;
  onRemover: () => void;
  onFechar: () => void;
}

export function FolhaDoItem({ produto: p, medidas, lines, ajustes, previa, onConfirmar, onRemover, onFechar }: PropsFolhaDoItem) {
  const inicial = estadoInicialDoItem(p.id, medidas, lines, ajustes);
  const [idx, setIdx] = useState(inicial.idx);
  const [qtd, setQtd] = useState(inicial.qtd);
  const [ajuste, setAjuste] = useState<Ajuste>(inicial.ajuste);
  const medida = medidas[idx] ?? medidas[0]!;
  const chave = chavesDoProduto(p.id, medidas)[idx] ?? p.id;
  const calc = qtd > 0 ? previa({ [chave]: qtd }, { [chave]: ajuste }) : null;
  const linha = calc?.linhas[0] ?? null;
  const minimo = (p as ProdutoComMinimo).preco_minimo_base_cents ?? null;
  const maximoPct = linha && minimo !== null ? descontoMaximoDoItemPct(linha.preco_tabela_cents, minimo * medida.fator) : null;
  const alertas = alertasDoItem({ erp_code: p.erp_code, unidade_base: p.unit, estoque_base: p.stock_total, quantidade_base: qtd * medida.fator, acima_do_maximo: (calc?.acima_do_maximo.length ?? 0) > 0, maximo_pct: maximoPct });
  const acima = alertas.some((a) => a.tipo === 'maximo');
  const nome = `${p.description} ${rotuloMedida(medida.unidade, medida.fator)}`;
  const tabelaTotal = linha ? linha.preco_tabela_cents * qtd : 0;
  const liquida = linha ? linhaLiquidaDosTotais({ subtotal_cents: tabelaTotal, total_cents: linha.total_cents }) : null;
  return (
    <Folha visivel onFechar={onFechar} rotuloFechar="Fechar" fechar={{ rotulo: 'Fechar', testID: 'popup-item-fechar' }} evitarTeclado testID="popup-item">
      <View style={{ gap: 12 }}>
        <View style={{ gap: 2 }}>
          <Text style={s.titulo} numberOfLines={2}>
            {p.description}
          </Text>
          <Text style={s.sub}>{subtituloDoPopup(p.erp_code, p.stock_total, p.unit)}</Text>
        </View>
        <AreaAlertas alertas={alertas} texto={textoDoAlertaNoItem} testID="popup-item-alertas" />
        {medidas.length > 1 ? (
          <View style={{ gap: 6 }}>
            <Text style={s.rotulo}>EMBALAGEM</Text>
            <Segmentado
              testID="popup-item-embalagem"
              rotuloAcessivel={`Embalagem de ${p.description}`}
              style={{ alignSelf: 'flex-start', width: Math.max(larguraSegmentadoCompacto(medidas.length), 56 * medidas.length) }}
              valor={String(idx)}
              opcoes={medidas.map((x, i) => ({ id: String(i), rotulo: i === 0 ? x.unidade : rotuloMedida(x.unidade, x.fator), rotuloAcessivel: `Embalagem ${rotuloMedida(x.unidade, x.fator)}`, testID: `popup-item-embalagem-${x.unidade}` }))}
              onChange={(novo) => setIdx(Number(novo))}
            />
          </View>
        ) : null}
        <View style={s.linhaDupla}>
          <View style={{ gap: 6 }}>
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
                medida={medida.unidade}
                equivalente={linha?.equivalente ?? null}
                onAjuste={(aj) => setAjuste({ ...aj, ...(ajuste.aplicacao_marcada !== undefined ? { aplicacao_marcada: ajuste.aplicacao_marcada } : {}), ...(ajuste.aplicacao_retrato ? { aplicacao_retrato: ajuste.aplicacao_retrato } : {}) })}
              />
            </View>
          </View>
        </View>
        {p.applications ? <CaixaAplicacao testID="popup-item-aplicacao" marcada={Boolean(linha?.aplicacao_marcada)} onPress={() => setAjuste(alternarAplicacao(ajuste, Boolean(linha?.aplicacao_marcada)))} nome={nome} /> : null}
        {linha ? (
          <View style={s.totais} testID="popup-item-totais">
            <View style={s.linhaTot}>
              <Text style={s.totRotulo}>Tabela</Text>
              <Text style={s.totValor}>{`${qtd} × ${formatBRL(linha.preco_tabela_cents)}`}</Text>
            </View>
            {liquida ? (
              <View style={s.linhaTot}>
                <Text style={s.totRotulo}>{liquida.rotulo}</Text>
                <Text style={s.totValor}>{liquida.valor}</Text>
              </View>
            ) : null}
            <View style={[s.linhaTot, s.totalDoItem]}>
              <Text style={s.totRotuloForte}>Total do item</Text>
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
  titulo: { fontFamily: fonts.display, fontSize: 18, color: colors.ink },
  sub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.ink2 },
  rotulo: { fontFamily: fonts.semibold, fontSize: 12, letterSpacing: 0.6, color: colors.ink2 },
  linhaDupla: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  bordaDeAlerta: { borderWidth: 2, borderColor: colors.danger, borderRadius: 14 },
  totais: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 4 },
  linhaTot: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 36 },
  totalDoItem: { borderTopWidth: 1, borderTopColor: colors.line },
  totRotulo: { fontFamily: fonts.body, fontSize: 14, color: colors.ink2 },
  totRotuloForte: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink },
  totValor: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] },
  totTotal: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
});
