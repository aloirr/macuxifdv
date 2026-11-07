/**
 * Peças do novo pedido de distribuidora em 3 abas (T-0061/T-0071): Itens, Detalhes e Resumo. Componentes locais do Vendedor
 * (se o engenheiro-apps promover algum para `packages/ui`, trocamos). Alvos de toque ≥ 48 dp; só lê e escreve o rascunho
 * do aparelho (offline-first). O cálculo e as regras vêm de `lib/novo-pedido.ts` (domain de preço), nada é calculado aqui.
 */
import { Banner, Botao, colors, fonts, Icon, radius, type as t } from '@macuxi/ui/mobile';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { limitarDesconto, PASSO_DESCONTO_PCT } from '../../domain/quantidade';
import { centsParaCampo } from '../lib/novo-pedido';
import { textoAposMudancaDoValor, valorPendentePct, valorPendenteReais } from '../lib/valor-pendente';

// ---------- campos ----------
/** Alvo de toque do −/+: botão visual de 32 dp com 8 dp de folga em cima/embaixo e 6 dp dos lados (44 × 48 dp, ≥ 44 dp). */

function Passo({ icone, rotulo, onPress, desligado, testID }: { icone: 'plus' | 'minus'; rotulo: string; onPress: () => void; desligado?: boolean; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={rotulo} accessibilityState={{ disabled: Boolean(desligado) }} disabled={desligado} onPress={onPress} style={({ pressed }) => [s.passoAlvo, pressed && { opacity: 0.6 }]}>
      <View style={[s.passo, desligado && s.passoDesligado]}>
      <Icon name={icone} size={16} color={desligado ? colors.ink3 : colors.ink} strokeWidth={2.2} />
      </View>
    </Pressable>
  );
}

function fmtPct(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: n % 1 === 0 ? 0 : 1, maximumFractionDigits: 2 });
}

/** Percentual com − e + de 48 dp e digitação direta. O que está digitado vale a cada número válido (V2). */
export function CampoPct({ valor, onChange, rotulo, testID, maximo }: { valor: number; onChange: (n: number) => void; rotulo: string; testID: string; maximo?: number }) {
  const teto = maximo ?? 100;
  const [texto, setTexto] = useState(fmtPct(valor));
  const focado = useRef(false);
  useEffect(() => setTexto((atual) => textoAposMudancaDoValor({ texto: atual, valor, focado: focado.current, pendente: (x) => valorPendentePct(x, teto), formatar: fmtPct })), [valor, teto]);
  const aplicar = (n: number) => onChange(Math.min(teto, limitarDesconto(n)));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Passo icone="minus" rotulo={`Diminuir ${rotulo}`} desligado={valor <= 0} onPress={() => aplicar(valor - PASSO_DESCONTO_PCT)} testID={`${testID}-menos`} />
      <View style={s.pctBox}>
        <TextInput
          testID={testID}
          value={texto}
          onChangeText={(v) => {
            setTexto(v);
            const n = valorPendentePct(v, teto);
            if (n !== null && n !== valor) onChange(n);
          }}
          onFocus={() => {
            focado.current = true;
          }}
          onBlur={() => {
            focado.current = false;
            const n = valorPendentePct(texto, teto) ?? 0;
            setTexto(fmtPct(n));
            if (n !== valor) onChange(n);
          }}
          keyboardType="decimal-pad"
          returnKeyType="done"
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

/** Valor em R$ (centavos) com − e + de 48 dp e digitação direta. `maximo` em centavos (o desconto não passa do preço). Vale a cada número válido (V2). */
export function CampoReais({ valor, onChange, rotulo, testID, maximo, passo = 10 }: { valor: number; onChange: (cents: number) => void; rotulo: string; testID: string; maximo?: number; passo?: number }) {
  const [texto, setTexto] = useState(centsParaCampo(valor));
  const focado = useRef(false);
  useEffect(() => setTexto((atual) => textoAposMudancaDoValor({ texto: atual, valor, focado: focado.current, pendente: (x) => valorPendenteReais(x, maximo), formatar: centsParaCampo })), [valor, maximo]);
  const aplicar = (c: number) => onChange(Math.max(0, maximo === undefined ? c : Math.min(maximo, c)));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Passo icone="minus" rotulo={`Diminuir ${rotulo}`} desligado={valor <= 0} onPress={() => aplicar(valor - passo)} testID={`${testID}-menos`} />
      <View style={s.pctBox}>
        <Text style={s.reaisPrefixo}>R$</Text>
        <TextInput
          testID={testID}
          value={texto}
          onChangeText={(v) => {
            setTexto(v);
            const n = valorPendenteReais(v, maximo);
            if (n !== null && n !== valor) onChange(n);
          }}
          onFocus={() => {
            focado.current = true;
          }}
          onBlur={() => {
            focado.current = false;
            const n = valorPendenteReais(texto, maximo) ?? 0;
            setTexto(centsParaCampo(n));
            if (n !== valor) onChange(n);
          }}
          keyboardType="decimal-pad"
          returnKeyType="done"
          accessibilityLabel={`${rotulo} em reais`}
          style={s.pctInput}
          selectTextOnFocus
        />
      </View>
      <Passo icone="plus" rotulo={`Aumentar ${rotulo}`} desligado={maximo !== undefined && valor >= maximo} onPress={() => aplicar(valor + passo)} testID={`${testID}-mais`} />
    </View>
  );
}

/**
 * T-0084 (RN-VEN-19): caixa por item "Incluir aplicação no orçamento" (alvo de 48 dp). Marcada pelo padrão do tenant; vale
 * item a item. O texto sai da linha da aplicação mostrada no item (2 linhas).
 */
export function CaixaAplicacao({ marcada, onPress, nome, testID }: { marcada: boolean; onPress: () => void; nome: string; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityLabel={`Incluir aplicação no orçamento: ${nome}`}
      accessibilityState={{ checked: marcada }}
      onPress={onPress}
      style={({ pressed }) => [s.caixaAplicacao, pressed && { opacity: 0.6 }]}>
      <View style={[s.caixa, marcada && s.caixaMarcada]}>{marcada ? <Icon name="check" size={16} color={colors.surface} strokeWidth={2.6} /> : null}</View>
      <Text style={t.small}>Incluir aplicação no orçamento</Text>
    </Pressable>
  );
}

/** Aviso do que falta (aparece acima do rodapé quando o botão está desligado por regra). */
export function PendenciasDoPedido({ erros, freteAviso, onIrPara }: { erros: string[]; freteAviso: string | null; onIrPara: () => void }) {
  if (erros.length === 0 && !freteAviso) return null;
  return (
    <View style={{ gap: 8 }} testID="pendencias-pedido">
      <Banner icon="alert" tone="danger">
        {erros.length > 0 ? <Text>{erros.join(' ')} </Text> : null}
        {freteAviso ? <Text>{freteAviso}</Text> : null}
      </Banner>
      {freteAviso ? <Botao testID="pendencia-corrigir-frete" nivel="neutro" rotulo="Corrigir frete" onPress={onIrPara} /> : null}
    </View>
  );
}


const s = StyleSheet.create({
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  produto: { gap: 8, paddingVertical: 12, paddingHorizontal: 14 },
  passoDesligado: { backgroundColor: colors.ground, borderColor: colors.line },
  /** alvo de toque 44 × 48 dp dentro do pai (no Android o hitSlop não passa dos limites do pai); o visual de 32 dp fica por dentro */
  passoAlvo: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  passo: { width: 32, height: 32, borderRadius: 8, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  qtd: { width: 52, height: 48, textAlign: 'center', fontFamily: fonts.bold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'], padding: 0 },
  caixaAplicacao: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  caixa: { width: 24, height: 24, borderRadius: 6, borderWidth: 1.5, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  caixaMarcada: { backgroundColor: colors.accentInk, borderColor: colors.accentInk },
  linkAjuste: { minHeight: 48, justifyContent: 'center', paddingRight: 8 },
  ajuste: { gap: 8, padding: 10, borderRadius: radius.md, backgroundColor: colors.ground },
  pctBox: { flex: 1, height: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  pctInput: { flex: 1, minWidth: 0, height: 46, textAlign: 'right', fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink, padding: 0 },
  reaisPrefixo: { fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink2, marginRight: 4 },
  pctSufixo: { flex: 1, fontFamily: fonts.displayBold, fontSize: 18, color: colors.ink2, marginLeft: 2 },
});
