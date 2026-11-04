/**
 * Peças do novo pedido de distribuidora em 3 abas (T-0061): Itens, Condições e Entrega/Resumo. Componentes locais do Vendedor
 * (se o engenheiro-apps promover algum para `packages/ui`, trocamos). Alvos de toque ≥ 48 dp; só lê e escreve o rascunho
 * do aparelho (offline-first). O cálculo e as regras vêm de `lib/novo-pedido.ts` (domain de preço), nada é calculado aqui.
 */
import { formatBRL, formatPct } from '@macuxi/comum';
import type { Product } from '@macuxi/catalogo/contracts';
import { Badge, Banner, Card, colors, fonts, Icon, radius, Strong, type as t } from '@macuxi/ui/mobile';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { limitarDesconto, PASSO_DESCONTO_PCT } from '../../domain/quantidade';
import { rotuloMedida } from '../../domain/preco-pedido';
import type { Rascunho } from '../lib/pedidos';
import {
  alternarUnidade,
  chaveDaLinha,
  unidadesDoProduto,
  type Ajuste,
  type CalculoPedido,
  type UnidadeDaTela,
} from '../lib/novo-pedido';
import { parsePct } from '../lib/catalog';

// ---------- campos ----------
function Passo({ icone, rotulo, onPress, desligado, testID }: { icone: 'plus' | 'minus'; rotulo: string; onPress: () => void; desligado?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={rotulo} disabled={desligado} onPress={onPress} style={({ pressed }) => [s.passo, desligado && { opacity: 0.4 }, pressed && { opacity: 0.6 }]}>
      <Icon name={icone} size={16} color={colors.ink} strokeWidth={2.2} />
    </Pressable>
  );
}

function fmtPct(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: n % 1 === 0 ? 0 : 1, maximumFractionDigits: 2 });
}

/** Percentual com − e + de 48 dp e digitação direta. */
export function CampoPct({ valor, onChange, rotulo, testID, maximo }: { valor: number; onChange: (n: number) => void; rotulo: string; testID: string; maximo?: number }) {
  const [texto, setTexto] = useState(fmtPct(valor));
  useEffect(() => setTexto(fmtPct(valor)), [valor]);
  const aplicar = (n: number) => onChange(Math.min(maximo ?? 100, limitarDesconto(n)));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Passo icone="minus" rotulo={`Diminuir ${rotulo}`} desligado={valor <= 0} onPress={() => aplicar(valor - PASSO_DESCONTO_PCT)} testID={`${testID}-menos`} />
      <View style={s.pctBox}>
        <TextInput
          testID={testID}
          value={texto}
          onChangeText={setTexto}
          onBlur={() => aplicar(parsePct(texto))}
          onSubmitEditing={() => aplicar(parsePct(texto))}
          keyboardType="decimal-pad"
          accessibilityLabel={`${rotulo} em porcentagem`}
          style={s.pctInput}
          selectTextOnFocus
        />
        <Text style={s.pctSufixo}>%</Text>
      </View>
      <Passo icone="plus" rotulo={`Aumentar ${rotulo}`} onPress={() => aplicar(valor + PASSO_DESCONTO_PCT)} testID={`${testID}-mais`} />
    </View>
  );
}

export function Segmentos<T extends string>({ opcoes, valor, onChange, testID }: { opcoes: Array<{ id: T; rotulo: string }>; valor: T; onChange: (id: T) => void; testID: string }) {
  return (
    <View style={s.segmento}>
      {opcoes.map((o) => {
        const on = o.id === valor;
        return (
          <Pressable key={o.id} testID={`${testID}-${o.id}`} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => onChange(o.id)} style={[s.segItem, on && s.segOn]}>
            <Text style={[s.segTexto, on && { color: colors.surface }]}>{o.rotulo}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ---------- aba Itens ----------
export interface PropsAbaItens {
  rascunho: Rascunho;
  catalogo: readonly Product[];
  resultados: readonly Product[] | null;
  unidades: readonly UnidadeDaTela[];
  calculo: CalculoPedido;
  onLinhas: (lines: Record<string, number>, ajustes: Record<string, Ajuste>) => void;
  somenteLeitura?: boolean;
}

export function ListaDeItens({ produtos, rascunho, unidades, calculo, onLinhas, somenteLeitura }: { produtos: readonly Product[] } & Omit<PropsAbaItens, 'catalogo' | 'resultados'>) {
  const ajustes = rascunho.ajustes ?? {};
  const setQtd = (chave: string, q: number) => {
    const n = Math.max(0, Math.trunc(q));
    const lines = { ...rascunho.lines };
    if (n > 0) lines[chave] = n;
    else delete lines[chave];
    const novos = { ...ajustes };
    if (n === 0) delete novos[chave];
    onLinhas(lines, novos);
  };
  const setAjuste = (chave: string, aj: Ajuste) => onLinhas(rascunho.lines, { ...ajustes, [chave]: aj });
  return (
    <Card>
      {produtos.map((p, i) => (
        <LinhaDoProduto key={p.id} p={p} medidas={unidadesDoProduto(p.id, unidades, p.unit)} lines={rascunho.lines} ajustes={ajustes} calculo={calculo} ultimo={i === produtos.length - 1} onQtd={setQtd} onAjuste={setAjuste} somenteLeitura={somenteLeitura} />
      ))}
    </Card>
  );
}

function LinhaDoProduto({
  p,
  medidas,
  lines,
  ajustes,
  calculo,
  ultimo,
  onQtd,
  onAjuste,
  somenteLeitura,
}: {
  p: Product;
  medidas: UnidadeDaTela[];
  lines: Record<string, number>;
  ajustes: Record<string, Ajuste>;
  calculo: CalculoPedido;
  ultimo: boolean;
  onQtd: (chave: string, q: number) => void;
  onAjuste: (chave: string, a: Ajuste) => void;
  somenteLeitura?: boolean;
}) {
  const semPreco = p.price_cents === null;
  return (
    <View style={[s.produto, !ultimo && s.divisor]} testID={`product-${p.erp_code}`}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text style={t.mono}>{p.erp_code}</Text>
          <Text style={t.bodyStrong}>{p.description}</Text>
          {p.applications ? <Text style={t.small}>{p.applications}</Text> : null}
        </View>
        {p.is_campaign ? <Badge label="Campanha" tone="accent" /> : null}
      </View>
      {semPreco ? (
        <Text style={[t.smallStrong, { color: colors.danger }]} testID={`sem-preco-${p.erp_code}`}>
          Sem preço para este cliente
        </Text>
      ) : null}
      {medidas.map((m, idx) => {
        const chave = chaveDaLinha(p.id, idx === 0 ? null : m.unidade);
        const qtd = lines[chave] ?? 0;
        const linha = calculo.linhas.find((l) => l.chave === chave);
        const precoMedida = semPreco ? null : (p.price_cents ?? 0) * m.fator;
        return (
          <MedidaDoItem
            key={chave}
            p={p}
            rotulo={rotuloMedida(m.unidade, m.fator)}
            preco={precoMedida}
            qtd={qtd}
            totalLinha={linha?.total_cents ?? null}
            ajuste={ajustes[chave] ?? {}}
            onQtd={(q) => onQtd(chave, q)}
            onAjuste={(a) => onAjuste(chave, a)}
            somenteLeitura={somenteLeitura}
            comRotulo={medidas.length > 1}
          />
        );
      })}
    </View>
  );
}

function MedidaDoItem({ p, rotulo, preco, qtd, totalLinha, ajuste, onQtd, onAjuste, somenteLeitura, comRotulo }: { p: Product; rotulo: string; preco: number | null; qtd: number; totalLinha: number | null; ajuste: Ajuste; onQtd: (q: number) => void; onAjuste: (a: Ajuste) => void; somenteLeitura?: boolean; comRotulo: boolean }) {
  const [texto, setTexto] = useState(String(qtd));
  const [aberto, setAberto] = useState(Boolean((ajuste.desconto_pct ?? 0) > 0 || (ajuste.acrescimo_pct ?? 0) > 0));
  useEffect(() => setTexto(String(qtd)), [qtd]);
  const tipo: 'desconto' | 'acrescimo' = (ajuste.acrescimo_pct ?? 0) > 0 ? 'acrescimo' : 'desconto';
  const valor = tipo === 'acrescimo' ? (ajuste.acrescimo_pct ?? 0) : (ajuste.desconto_pct ?? 0);
  const k = p.erp_code + (comRotulo ? `-${rotulo.split(' ')[0]}` : '');
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={t.smallStrong} numberOfLines={1}>
            {comRotulo ? rotulo : 'Quantidade'}
            {preco !== null ? ` · ${formatBRL(preco)}` : ''}
          </Text>
        </View>
        {somenteLeitura ? (
          <Text style={[t.bodyStrong, { fontFamily: fonts.bold }]}>{qtd}</Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Passo icone="minus" rotulo={`Diminuir ${p.description} ${rotulo}`} desligado={qtd <= 0} onPress={() => onQtd(qtd - 1)} testID={`dec-${k}`} />
            <TextInput
              testID={`qty-${k}`}
              value={texto}
              onChangeText={(v) => setTexto(v.replace(/\D/g, ''))}
              onBlur={() => onQtd(Number(texto || 0))}
              onSubmitEditing={() => onQtd(Number(texto || 0))}
              keyboardType="number-pad"
              selectTextOnFocus
              accessibilityLabel={`Quantidade de ${p.description} em ${rotulo}`}
              style={s.qtd}
            />
            <Passo icone="plus" rotulo={`Aumentar ${p.description} ${rotulo}`} desligado={preco === null} onPress={() => onQtd(qtd + 1)} testID={`inc-${k}`} />
          </View>
        )}
      </View>
      {qtd > 0 ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {somenteLeitura ? (
              <Text style={t.small}>{valor > 0 ? `${tipo === 'acrescimo' ? 'Acréscimo' : 'Desconto'} de ${formatPct(valor)}` : ''}</Text>
            ) : (
              <Pressable testID={`ajuste-${k}`} accessibilityRole="button" accessibilityLabel={`Desconto ou acréscimo do item ${p.description}`} onPress={() => setAberto((a) => !a)} style={s.linkAjuste}>
                <Text style={[t.smallStrong, { color: colors.accentInk }]}>{valor > 0 ? `${tipo === 'acrescimo' ? 'Acréscimo' : 'Desconto'} ${formatPct(valor)}` : 'Desconto ou acréscimo'}</Text>
              </Pressable>
            )}
            {totalLinha !== null ? <Text style={[t.bodyStrong, { fontVariant: ['tabular-nums'] }]}>{formatBRL(totalLinha)}</Text> : null}
          </View>
          {aberto && !somenteLeitura ? (
            <View style={s.ajuste} testID={`ajuste-painel-${k}`}>
              <Segmentos
                testID={`ajuste-tipo-${k}`}
                valor={tipo}
                opcoes={[
                  { id: 'desconto', rotulo: 'Desconto' },
                  { id: 'acrescimo', rotulo: 'Acréscimo' },
                ]}
                onChange={(novo) => onAjuste(novo === 'acrescimo' ? { acrescimo_pct: valor } : { desconto_pct: valor })}
              />
              <CampoPct valor={valor} rotulo={tipo === 'acrescimo' ? 'acréscimo do item' : 'desconto do item'} testID={`ajuste-pct-${k}`} onChange={(n) => onAjuste(tipo === 'acrescimo' ? { acrescimo_pct: n } : { desconto_pct: n })} />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** Aviso do que falta (aparece acima do rodapé quando o botão está desligado por regra). */
export function PendenciasDoPedido({ erros, freteAviso, onIrPara }: { erros: string[]; freteAviso: string | null; onIrPara: () => void }) {
  if (erros.length === 0 && !freteAviso) return null;
  return (
    <Banner icon="alert" tone="danger" testID="pendencias-pedido">
      {erros.length > 0 ? <Text>{erros.join(' ')} </Text> : null}
      {freteAviso ? (
        <Text onPress={onIrPara}>
          <Strong>{freteAviso}</Strong> Toque aqui para corrigir.
        </Text>
      ) : null}
    </Banner>
  );
}

export { alternarUnidade };

const s = StyleSheet.create({
  abas: { flexDirection: 'row', backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.line },
  aba: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4, borderBottomWidth: 3, borderBottomColor: 'transparent', paddingHorizontal: 4 },
  abaOn: { borderBottomColor: colors.accent },
  abaTexto: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  ponto: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  produto: { gap: 8, paddingVertical: 12, paddingHorizontal: 14 },
  passo: { width: 48, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  qtd: { width: 52, height: 48, textAlign: 'center', fontFamily: fonts.bold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'], padding: 0 },
  linkAjuste: { minHeight: 48, justifyContent: 'center', paddingRight: 8 },
  ajuste: { gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.ground },
  pctBox: { flex: 1, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  pctInput: { flex: 1, minWidth: 0, height: 46, textAlign: 'right', fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, padding: 0 },
  pctSufixo: { flex: 1, fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink2, marginLeft: 2 },
  segmento: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segItem: { flexGrow: 1, minWidth: 72, paddingHorizontal: 10, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segTexto: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  opcao: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  opcaoOn: { borderColor: colors.success, backgroundColor: colors.successBg },
  texto: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
});
