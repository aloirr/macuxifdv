/**
 * Peças do novo pedido de distribuidora em 3 abas (T-0061): Itens, Condições e Entrega/Resumo. Componentes locais do Vendedor
 * (se o engenheiro-apps promover algum para `packages/ui`, trocamos). Alvos de toque ≥ 48 dp; só lê e escreve o rascunho
 * do aparelho (offline-first). O cálculo e as regras vêm de `lib/novo-pedido.ts` (domain de preço), nada é calculado aqui.
 */
import { formatBRL } from '@macuxi/comum';
import type { Product } from '@macuxi/catalogo/contracts';
import { Badge, Banner, Card, ChipEstado, colors, fonts, Icon, radius, Segmentado, Strong, type as t } from '@macuxi/ui/mobile';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { limitarDesconto, PASSO_DESCONTO_PCT } from '../../domain/quantidade';
import { rotuloMedida } from '../../domain/preco-pedido';
import type { Rascunho } from '../lib/pedidos';
import {
  alternarUnidade,
  centsParaCampo,
  chaveDaLinha,
  reaisParaCents,
  trocarModoDoAjuste,
  unidadesDoProduto,
  type Ajuste,
  type CalculoPedido,
  type UnidadeDaTela,
} from '../lib/novo-pedido';
import { parsePct } from '../lib/catalog';
import { textoEquivalente, textoPrecoDaLinha } from '../lib/textos-pedido';

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

/** Valor em R$ (centavos) com − e + de 48 dp e digitação direta. `maximo` em centavos (o desconto não passa do preço). */
export function CampoReais({ valor, onChange, rotulo, testID, maximo, passo = 10 }: { valor: number; onChange: (cents: number) => void; rotulo: string; testID: string; maximo?: number; passo?: number }) {
  const [texto, setTexto] = useState(centsParaCampo(valor));
  useEffect(() => setTexto(centsParaCampo(valor)), [valor]);
  const aplicar = (c: number) => onChange(Math.max(0, maximo === undefined ? c : Math.min(maximo, c)));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Passo icone="minus" rotulo={`Diminuir ${rotulo}`} desligado={valor <= 0} onPress={() => aplicar(valor - passo)} testID={`${testID}-menos`} />
      <View style={s.pctBox}>
        <Text style={s.reaisPrefixo}>R$</Text>
        <TextInput
          testID={testID}
          value={texto}
          onChangeText={setTexto}
          onBlur={() => aplicar(reaisParaCents(texto))}
          onSubmitEditing={() => aplicar(reaisParaCents(texto))}
          keyboardType="decimal-pad"
          accessibilityLabel={`${rotulo} em reais`}
          style={s.pctInput}
          selectTextOnFocus
        />
      </View>
      <Passo icone="plus" rotulo={`Aumentar ${rotulo}`} desligado={maximo !== undefined && valor >= maximo} onPress={() => aplicar(valor + passo)} testID={`${testID}-mais`} />
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
            linha={linha ?? null}
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

function MedidaDoItem({
  p,
  rotulo,
  preco,
  qtd,
  linha,
  totalLinha,
  ajuste,
  onQtd,
  onAjuste,
  somenteLeitura,
  comRotulo,
}: {
  p: Product;
  rotulo: string;
  preco: number | null;
  qtd: number;
  linha: CalculoPedido['linhas'][number] | null;
  totalLinha: number | null;
  ajuste: Ajuste;
  onQtd: (q: number) => void;
  onAjuste: (a: Ajuste) => void;
  somenteLeitura?: boolean;
  comRotulo: boolean;
}) {
  const [texto, setTexto] = useState(String(qtd));
  const modo: 'pct' | 'valor' = ajuste.em === 'valor' ? 'valor' : 'pct';
  const sentido: 'desconto' | 'acrescimo' = modo === 'valor' ? ((ajuste.acrescimo_cents ?? 0) > 0 ? 'acrescimo' : 'desconto') : (ajuste.acrescimo_pct ?? 0) > 0 ? 'acrescimo' : 'desconto';
  const valorPct = sentido === 'acrescimo' ? (ajuste.acrescimo_pct ?? 0) : (ajuste.desconto_pct ?? 0);
  const valorCents = sentido === 'acrescimo' ? (ajuste.acrescimo_cents ?? 0) : (ajuste.desconto_cents ?? 0);
  const temAjuste = (modo === 'valor' ? valorCents : valorPct) > 0;
  const [aberto, setAberto] = useState(temAjuste);
  useEffect(() => setTexto(String(qtd)), [qtd]);
  const k = p.erp_code + (comRotulo ? `-${rotulo.split(' ')[0]}` : '');
  const gravar = (s2: 'desconto' | 'acrescimo', m: 'pct' | 'valor', v: number): Ajuste =>
    m === 'valor' ? { em: 'valor', ...(s2 === 'acrescimo' ? { acrescimo_cents: v } : { desconto_cents: v }) } : { em: 'pct', ...(s2 === 'acrescimo' ? { acrescimo_pct: v } : { desconto_pct: v }) };
  const tetoDesconto = sentido === 'desconto' && modo === 'valor' && preco !== null ? preco : undefined;
  const eq = linha ? textoEquivalente(linha) : '';
  const nome = `${p.description} ${rotulo}`;
  return (
    <View style={{ gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <ChipEstado testID={`medida-${k}`} texto={rotulo} pequeno />
          <Text style={t.smallStrong} numberOfLines={1} testID={`preco-${k}`}>
            {preco === null ? '' : linha && qtd > 0 ? textoPrecoDaLinha(linha) : formatBRL(preco)}
          </Text>
        </View>
        {somenteLeitura ? (
          <Text style={[t.bodyStrong, { fontFamily: fonts.bold }]}>{qtd}</Text>
        ) : (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Passo icone="minus" rotulo={`Diminuir ${nome}`} desligado={qtd <= 0} onPress={() => onQtd(qtd - 1)} testID={`dec-${k}`} />
            <TextInput
              testID={`qty-${k}`}
              value={texto}
              onChangeText={(v) => setTexto(v.replace(/\D/g, ''))}
              onBlur={() => onQtd(Number(texto || 0))}
              onSubmitEditing={() => onQtd(Number(texto || 0))}
              keyboardType="number-pad"
              selectTextOnFocus
              accessibilityLabel={`Quantidade de ${nome}`}
              style={s.qtd}
            />
            <Passo icone="plus" rotulo={`Aumentar ${nome}`} desligado={preco === null} onPress={() => onQtd(qtd + 1)} testID={`inc-${k}`} />
          </View>
        )}
      </View>
      {qtd > 0 ? (
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            {somenteLeitura ? (
              <Text style={t.small}>{temAjuste ? `${sentido === 'acrescimo' ? 'Acréscimo' : 'Desconto'} ${eq}`.trim() : ''}</Text>
            ) : (
              <Pressable testID={`ajuste-${k}`} accessibilityRole="button" accessibilityLabel={`Desconto ou acréscimo do item ${nome}`} onPress={() => setAberto((a) => !a)} style={s.linkAjuste}>
                <Text style={[t.smallStrong, { color: colors.accentInk }]} testID={`equivalente-${k}`}>
                  {temAjuste ? eq || (sentido === 'acrescimo' ? 'Acréscimo' : 'Desconto') : '+ desconto'}
                </Text>
              </Pressable>
            )}
            {totalLinha !== null ? (
              <Text style={[t.bodyStrong, { fontVariant: ['tabular-nums'] }]} testID={`total-${k}`}>
                {formatBRL(totalLinha)}
              </Text>
            ) : null}
          </View>
          {aberto && !somenteLeitura ? (
            <View style={s.ajuste} testID={`ajuste-painel-${k}`}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Segmentado
                  testID={`ajuste-tipo-${k}`}
                  rotuloAcessivel="Desconto ou acréscimo do item"
                  compacto
                  style={{ flex: 1 }}
                  valor={sentido}
                  opcoes={[
                    { id: 'desconto', rotulo: 'Desc.', rotuloAcessivel: 'Desconto' },
                    { id: 'acrescimo', rotulo: 'Acrésc.', rotuloAcessivel: 'Acréscimo' },
                  ]}
                  onChange={(novo) => onAjuste(gravar(novo, modo, modo === 'valor' ? valorCents : valorPct))}
                />
                <Segmentado
                  testID={`ajuste-modo-${k}`}
                  rotuloAcessivel="Ajuste em porcentagem ou em reais"
                  compacto
                  style={{ flex: 1 }}
                  valor={modo}
                  opcoes={[
                    { id: 'pct', rotulo: '%', rotuloAcessivel: 'Porcentagem' },
                    { id: 'valor', rotulo: 'R$', rotuloAcessivel: 'Reais por unidade' },
                  ]}
                  onChange={(novo) => onAjuste(trocarModoDoAjuste(ajuste, novo, linha?.equivalente ?? null))}
                />
              </View>
              {modo === 'valor' ? (
                <CampoReais valor={valorCents} maximo={tetoDesconto} rotulo={sentido === 'acrescimo' ? 'acréscimo do item' : 'desconto do item'} testID={`ajuste-valor-${k}`} onChange={(n) => onAjuste(gravar(sentido, 'valor', n))} />
              ) : (
                <CampoPct valor={valorPct} rotulo={sentido === 'acrescimo' ? 'acréscimo do item' : 'desconto do item'} testID={`ajuste-pct-${k}`} onChange={(n) => onAjuste(gravar(sentido, 'pct', n))} />
              )}
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
  reaisPrefixo: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink2, marginRight: 4 },
  pctSufixo: { flex: 1, fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink2, marginLeft: 2 },
  segmento: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  segItem: { flexGrow: 1, minWidth: 72, paddingHorizontal: 10, height: 48, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segTexto: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink },
  opcao: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface },
  opcaoOn: { borderColor: colors.success, backgroundColor: colors.successBg },
  texto: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, paddingHorizontal: 12, fontFamily: fonts.body, fontSize: 15, color: colors.ink },
});
