/**
 * RD-2355 (T-0186): as tabelas da ficha no kit, unificando a ficha do Cliente 360 (modulo-core) e o detalhe do pedido e o Resumo
 * (modulo-vendedor). Cartão (`surface`, borda `line`, raio 12), fio `lineSoft` entre as linhas, cabeçalho 12/600 em `ink2`.
 *  - `TabelaRotuloValor`: pares rótulo 14 `ink2` (coluna de `larguraRotulo`) e valor 16; o `complemento` é a 2ª linha do valor
 *    (texto 12 `ink2`) ou um elemento à direita do valor (ex.: `BotaoCelula`).
 *  - `TabelaDados`: colunas com cabeçalho, linhas de no mínimo 48 dp, faixas de grupo, linha tocável e linha em perigo.
 *    Células: `CelulaTexto` (principal e 2ª linha) e `BotaoCelula` (ícone com alvo de 48 dp). Números sem "R$", à direita e tabulares.
 * Medidas e regras em `tabela-ficha.ts` (puro).
 */
import { isValidElement, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { VALOR_SEM_DADO } from './componentes';
import { Icon, type IconName } from './icon';
import {
  alinhamentoDaColuna,
  alinharDaColuna,
  estiloDaColuna,
  folgaDoBotaoCelula,
  fonteNumerica,
  larguraDoRotulo,
  leituraDoRotuloValor,
  TABELA_FICHA,
  type ColunaTabela,
} from './tabela-ficha';
import { colors, fonte } from './theme';

export interface LinhaRotuloValor {
  rotulo: string;
  valor: string;
  /** Texto: 2ª linha do valor (12 `ink2`). Elemento: fica à direita do valor. */
  complemento?: ReactNode;
  /** Valor em vermelho (`danger`), sempre com o texto que diz o porquê. */
  perigo?: boolean;
  /** testID do valor. */
  testID?: string;
  testIDComplemento?: string;
  /** Substitui a leitura padrão do TalkBack ("rótulo: valor. complemento"). */
  rotuloAcessivel?: string;
}

export function TabelaRotuloValor({
  linhas,
  larguraRotulo,
  alinharValor = 'dir',
  testID,
}: {
  linhas: readonly LinhaRotuloValor[];
  /** dp da coluna do rótulo; padrão 136 (ficha do cliente). O detalhe do pedido usa 92. */
  larguraRotulo?: number;
  /** `dir` (padrão, ficha do cliente) ou `esq` (texto longo: cliente, endereço, observação). */
  alinharValor?: 'esq' | 'dir';
  testID?: string;
}) {
  const largura = larguraDoRotulo(larguraRotulo);
  const textoAlinhado = alinharValor === 'dir' ? s.dir : null;
  return (
    <View style={s.cartao} testID={testID}>
      {linhas.map((l, i) => {
        const complementoTexto = typeof l.complemento === 'string' || typeof l.complemento === 'number' ? String(l.complemento) : null;
        const complementoElemento = isValidElement(l.complemento) ? l.complemento : null;
        return (
          <View
            key={l.rotulo}
            style={[s.linhaRV, i > 0 && s.traco]}
            accessible={!complementoElemento}
            accessibilityLabel={l.rotuloAcessivel ?? leituraDoRotuloValor(l.rotulo, l.valor, complementoTexto)}>
            <Text style={[s.rotulo, { width: largura }]}>{l.rotulo}</Text>
            <View style={[s.valorCaixa, { alignItems: alinharValor === 'dir' ? 'flex-end' : 'flex-start' }]}>
              <Text style={[s.valor, textoAlinhado, l.perigo && s.perigoTexto, !l.valor.trim() && s.semDado]} testID={l.testID}>
                {l.valor.trim() ? l.valor : VALOR_SEM_DADO}
              </Text>
              {complementoTexto ? (
                <Text style={[s.complemento, textoAlinhado]} testID={l.testIDComplemento}>
                  {complementoTexto}
                </Text>
              ) : null}
            </View>
            {complementoElemento}
          </View>
        );
      })}
    </View>
  );
}

export type LinhaTabela =
  | { tipo: 'faixa'; key: string; texto: string }
  | {
      tipo: 'linha';
      key: string;
      /** Uma célula por coluna, na ordem. */
      celulas: readonly ReactNode[];
      onPress?: () => void;
      /** Fundo `dangerBg` e fio vermelho à esquerda (ex.: NF em atraso). */
      perigo?: boolean;
      /** Leitura da linha inteira no TalkBack. */
      rotulo?: string;
      testID?: string;
    };

export function TabelaDados({ colunas, linhas, testID }: { colunas: readonly ColunaTabela[]; linhas: readonly LinhaTabela[]; testID?: string }) {
  return (
    <View style={s.cartao} testID={testID}>
      <View style={s.cabecalho}>
        {colunas.map((c) => (
          <Text key={c.id} style={[s.cab, estiloDaColuna(c), { textAlign: alinhamentoDaColuna(alinharDaColuna(c)).textAlign }]}>
            {c.titulo}
          </Text>
        ))}
      </View>
      {linhas.map((l) =>
        l.tipo === 'faixa' ? (
          <View key={l.key} style={[s.faixa, s.traco]}>
            <Text style={s.faixaTexto} accessibilityRole="header">
              {l.texto}
            </Text>
          </View>
        ) : (
          <Pressable
            key={l.key}
            testID={l.testID}
            disabled={!l.onPress}
            accessibilityRole={l.onPress ? 'button' : undefined}
            accessibilityLabel={l.rotulo}
            accessible={Boolean(l.rotulo)}
            onPress={l.onPress}
            style={({ pressed }) => [s.linha, s.traco, l.perigo && s.perigoLinha, pressed && s.tocado]}>
            {colunas.map((c, i) => (
              <View key={c.id} style={[estiloDaColuna(c), { alignItems: alinhamentoDaColuna(alinharDaColuna(c)).alignItems }]}>
                {l.celulas[i]}
              </View>
            ))}
          </Pressable>
        ),
      )}
    </View>
  );
}

/**
 * Célula de texto: principal 14/600 (ou 12/400 com `pequeno`) e, quando houver, a 2ª linha 12 `ink2` (ou vermelha). `dir` = número:
 * à direita e tabular. `encolher` = uma linha só, o valor grande encolhe até 80% em vez de quebrar (colunas numéricas do pedido).
 */
export function CelulaTexto({
  principal,
  segunda,
  perigoSegunda,
  segundaCodigo,
  dir,
  mono,
  sublinhado,
  mudo,
  pequeno,
  encolher,
  testID,
}: {
  principal: string;
  segunda?: string | null;
  perigoSegunda?: boolean;
  /** 2ª linha é um código (produto): mono 12, sublinhado, `accentInk`. */
  segundaCodigo?: boolean;
  dir?: boolean;
  mono?: boolean;
  sublinhado?: boolean;
  /** Principal em `ink2` (ex.: ajuste "0,0%"). */
  mudo?: boolean;
  pequeno?: boolean;
  encolher?: boolean;
  testID?: string;
}) {
  const umaLinha = encolher ? ({ numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.8 } as const) : null;
  return (
    <View style={[s.celula, { alignItems: dir ? 'flex-end' : 'flex-start' }]}>
      <Text style={[pequeno ? s.principalPequeno : s.principal, fonteNumerica(dir), dir && s.dir, mono && s.mono, sublinhado && s.link, mudo && s.mudo]} testID={testID} {...umaLinha}>
        {principal}
      </Text>
      {segunda ? (
        <Text style={[s.segunda, fonteNumerica(dir), dir && s.dir, perigoSegunda && s.perigoTexto, segundaCodigo && [s.mono, s.link]]} {...umaLinha}>
          {segunda}
        </Text>
      ) : null}
    </View>
  );
}

/** Botão de ícone da célula (ligar, WhatsApp, mapa, abrir): alvo de 48 dp, ícone 20; desligado em `ink3`. */
export function BotaoCelula({ icone, rotulo, onPress, desligado, testID }: { icone: IconName; rotulo: string; onPress?: () => void; desligado?: boolean; testID?: string }) {
  const f = folgaDoBotaoCelula();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityState={{ disabled: Boolean(desligado) }}
      disabled={desligado || !onPress}
      onPress={onPress}
      hitSlop={f}
      style={({ pressed }) => [s.botao, pressed && s.tocado]}>
      <Icon name={icone} size={TABELA_FICHA.botao.icone} color={desligado ? colors.ink3 : colors.ink} strokeWidth={1.9} />
    </Pressable>
  );
}

const T = TABELA_FICHA;

const s = StyleSheet.create({
  cartao: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1, borderRadius: T.raio, overflow: 'hidden' },
  traco: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  linhaRV: { flexDirection: 'row', alignItems: 'center', gap: T.gapRotuloValor, paddingHorizontal: T.paddingLateralRotuloValor, paddingVertical: 10, minHeight: T.alturaLinha },
  rotulo: { ...fonte.body, fontSize: T.fonte.rotulo, lineHeight: 19, color: colors.ink2 },
  valorCaixa: { flex: 1, minWidth: 0 },
  valor: { ...fonte.body, fontSize: T.fonte.valor, lineHeight: 21, color: colors.ink, fontVariant: ['tabular-nums'] },
  complemento: { ...fonte.body, fontSize: T.fonte.segunda, lineHeight: 16, color: colors.ink2 },
  semDado: { color: colors.ink3 },
  cabecalho: { flexDirection: 'row', gap: T.gapColunas, paddingHorizontal: T.paddingLateral, paddingTop: 10, paddingBottom: 6, alignItems: 'flex-end' },
  cab: { ...fonte.semibold, fontSize: T.fonte.cabecalho, lineHeight: 16, color: colors.ink2 },
  faixa: { paddingHorizontal: T.paddingLateral, paddingVertical: 6, backgroundColor: colors.ground },
  faixaTexto: { ...fonte.semibold, fontSize: T.fonte.cabecalho, letterSpacing: 0.6, color: colors.ink2 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: T.gapColunas, paddingHorizontal: T.paddingLateral, paddingVertical: 6, minHeight: T.alturaLinha },
  perigoLinha: { backgroundColor: colors.dangerBg, borderLeftWidth: T.fioPerigo, borderLeftColor: colors.danger },
  perigoTexto: { color: colors.danger },
  tocado: { opacity: 0.7 },
  celula: { maxWidth: '100%' },
  principal: { ...fonte.semibold, fontSize: T.fonte.celula, lineHeight: 19, color: colors.ink },
  principalPequeno: { ...fonte.body, fontSize: T.fonte.celulaPequena, lineHeight: 16, color: colors.ink },
  segunda: { ...fonte.body, fontSize: T.fonte.segunda, lineHeight: 16, color: colors.ink2 },
  dir: { textAlign: 'right' },
  mono: { ...fonte.mono, fontSize: 12 },
  link: { color: colors.accentInk, textDecorationLine: 'underline' },
  mudo: { color: colors.ink2 },
  botao: { width: T.botao.lado, height: T.botao.lado, alignItems: 'center', justifyContent: 'center' },
});
