/**
 * Peças de valor e estado (T-0071, fatia 4; medidas da referência do Novo pedido: `.foot`, `.line`, `.okbox`, `.tag`,
 * `.pill`):
 * - `RodapeTotal`: rodapé fixo com rótulo + valor em destaque + botão (ex.: "Total dos itens" · R$ 383,63 · [Avançar ›]);
 * - `LinhaValor`: linha rótulo ··· valor (itens compactos, Tabela, Descontos, Total);
 * - `BlocoTotais`: cartão com as linhas e a linha final em destaque, com espaço para a `Faixa` abaixo;
 * - `Faixa`: faixa de estado ok/aviso/erro ("4,6% · dentro da alçada");
 * - `Selo`: etiqueta curta (tons sucesso, aviso, erro, roxo, neutro, destaque).
 * Os valores chegam já formatados (dinheiro a partir de centavos, % no domain); nenhum texto fixo no componente.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { ALVO_TOQUE } from './componentes';
import { Icon, type IconName } from './icon';
import { colors, fonts, radius } from './theme';

// ---------- RodapeTotal ----------
export function RodapeTotal({
  rotulo,
  valor,
  acao,
  respiroInferior = 0,
  testID = 'rodape-total',
}: {
  /** Ex.: "Total dos itens". */
  rotulo: string;
  /** Valor formatado (ex.: "R$ 383,63"). */
  valor: string;
  /** Botão à direita (ex.: "Avançar"); `seta` desenha o › depois do rótulo. */
  acao: { rotulo: string; onPress: () => void; seta?: boolean; desligado?: boolean; ocupado?: boolean; testID?: string };
  /** Área segura de baixo, quando o rodapé encosta na borda da tela (sem barra de abas abaixo). */
  respiroInferior?: number;
  testID?: string;
}) {
  const off = Boolean(acao.desligado || acao.ocupado);
  return (
    <View style={[s.rodape, { paddingBottom: 10 + respiroInferior }]} testID={testID}>
      <View style={s.rodapeValor} accessible accessibilityLabel={`${rotulo}: ${valor}`}>
        <Text style={s.rodapeRotulo} numberOfLines={1}>
          {rotulo}
        </Text>
        <Text style={s.rodapeNumero} numberOfLines={1} testID={`${testID}-valor`}>
          {valor}
        </Text>
      </View>
      <Pressable
        testID={acao.testID ?? `${testID}-acao`}
        accessibilityRole="button"
        accessibilityLabel={acao.rotulo}
        accessibilityState={{ disabled: off, busy: Boolean(acao.ocupado) }}
        disabled={off}
        onPress={acao.onPress}
        style={({ pressed }) => [s.rodapeBotao, off && s.desligado, pressed && s.pressionado]}>
        {acao.ocupado ? <ActivityIndicator color={colors.surface} size="small" /> : null}
        <Text style={s.rodapeBotaoTexto} numberOfLines={1}>
          {acao.rotulo}
        </Text>
        {acao.seta ? <Icon name="chevron" size={16} color={colors.surface} strokeWidth={2.4} /> : null}
      </Pressable>
    </View>
  );
}

// ---------- LinhaValor ----------
export function LinhaValor({
  rotulo,
  valor,
  forte,
  destaque,
  tomValor,
  divisor,
  testID,
}: {
  rotulo: string;
  /** Formatado (ex.: "R$ 51,03", "− R$ 18,51"). */
  valor: string;
  /** Valor em negrito (itens compactos). */
  forte?: boolean;
  /** Linha final em destaque (Total): rótulo 15 e valor 19, em negrito. */
  destaque?: boolean;
  /** Cor do valor: `sucesso` para o equivalente do desconto, `erro` para o que passa do limite. */
  tomValor?: 'sucesso' | 'erro';
  /** Traço acima da linha (separa o Total). */
  divisor?: boolean;
  testID?: string;
}) {
  const cor = tomValor === 'sucesso' ? colors.success : tomValor === 'erro' ? colors.danger : colors.ink;
  return (
    <View style={[s.linha, divisor && s.linhaDivisor]} testID={testID} accessible accessibilityLabel={`${rotulo}: ${valor}`}>
      <Text style={[s.linhaRotulo, destaque && s.linhaRotuloDestaque]} numberOfLines={2}>
        {rotulo}
      </Text>
      <Text style={[s.linhaValor, (forte || destaque) && s.linhaValorForte, destaque && s.linhaValorDestaque, { color: cor }]} numberOfLines={1} testID={testID ? `${testID}-valor` : undefined}>
        {valor}
      </Text>
    </View>
  );
}

// ---------- BlocoTotais ----------
export interface LinhaTotal {
  id: string;
  rotulo: string;
  valor: string;
  forte?: boolean;
}

export function BlocoTotais({
  linhas,
  total,
  children,
  style,
  testID = 'totais',
}: {
  /** Linhas acima do total (ex.: Tabela, Descontos). */
  linhas: readonly LinhaTotal[];
  /** Linha final em destaque (ex.: Total · R$ 379,79). */
  total: { rotulo: string; valor: string };
  /** Abaixo do total (ex.: a `Faixa` da alçada). */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[s.bloco, style]} testID={testID}>
      {linhas.map((l) => (
        <LinhaValor key={l.id} rotulo={l.rotulo} valor={l.valor} forte={l.forte} testID={`${testID}-${l.id}`} />
      ))}
      <LinhaValor rotulo={total.rotulo} valor={total.valor} destaque divisor={linhas.length > 0} testID={`${testID}-total`} />
      {children ? <View style={s.blocoExtra}>{children}</View> : null}
    </View>
  );
}

// ---------- Faixa ----------
export type TomFaixa = 'ok' | 'aviso' | 'erro';

const TOM_FAIXA: Record<TomFaixa, { fg: string; bg: string; icone: IconName }> = {
  ok: { fg: colors.success, bg: colors.successBg, icone: 'check' },
  aviso: { fg: colors.warningInk, bg: colors.warningBg, icone: 'alert' },
  erro: { fg: colors.danger, bg: colors.dangerBg, icone: 'alert' },
};

export function Faixa({
  tom,
  texto,
  icone,
  testID = 'faixa',
}: {
  tom: TomFaixa;
  /** Texto curto, sem o ✓ (o ícone já vem do tom). Ex.: "4,6% · dentro da alçada". */
  texto: string;
  /** Troca o ícone do tom; `null` esconde. */
  icone?: IconName | null;
  testID?: string;
}) {
  const c = TOM_FAIXA[tom];
  const nomeIcone = icone === undefined ? c.icone : icone;
  return (
    <View style={[s.faixa, { backgroundColor: c.bg }]} testID={testID} accessibilityLiveRegion="polite" accessibilityRole={tom === 'erro' ? 'alert' : 'text'}>
      {nomeIcone ? <Icon name={nomeIcone} size={15} color={c.fg} strokeWidth={2.4} /> : null}
      <Text style={[s.faixaTexto, { color: c.fg }]}>{texto}</Text>
    </View>
  );
}

// ---------- Selo ----------
export type TomSelo = 'sucesso' | 'aviso' | 'erro' | 'roxo' | 'neutro' | 'destaque';

const TOM_SELO: Record<TomSelo, { fg: string; bg: string }> = {
  sucesso: { fg: colors.success, bg: colors.successBg },
  aviso: { fg: colors.warning, bg: colors.warningBg },
  erro: { fg: colors.danger, bg: colors.dangerBg },
  roxo: { fg: colors.violet, bg: colors.violetBg },
  neutro: { fg: colors.neutralInk, bg: colors.neutralBg },
  destaque: { fg: colors.accentInk, bg: colors.accentSoft },
};

export function Selo({
  texto,
  tom = 'neutro',
  tamanho = 'p',
  pilula,
  rotuloAcessivel,
  style,
  testID,
}: {
  /** Ex.: "−5%", "Orçamento · até 10/11", "Vencido". */
  texto: string;
  tom?: TomSelo;
  /** `p` (11, em linha de lista) ou `m` (12, no alto da tela). */
  tamanho?: 'p' | 'm';
  /** Cantos totalmente redondos (`.pill` da referência). */
  pilula?: boolean;
  /** Leitura completa quando o texto é abreviado (ex.: "−5%" → "5% mais barato"). */
  rotuloAcessivel?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const c = TOM_SELO[tom];
  return (
    <View style={[s.selo, tamanho === 'm' && s.seloM, pilula && s.seloPilula, { backgroundColor: c.bg }, style]} testID={testID} accessible accessibilityLabel={rotuloAcessivel ?? texto}>
      <Text style={[s.seloTexto, tamanho === 'm' && s.seloTextoM, { color: c.fg }]} numberOfLines={1}>
        {texto}
      </Text>
    </View>
  );
}

const s = StyleSheet.create({
  pressionado: { opacity: 0.7 },
  desligado: { opacity: 0.45 },
  // .foot
  rodape: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingTop: 10, paddingHorizontal: 14, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.line },
  rodapeValor: { flexShrink: 1, minWidth: 0 },
  rodapeRotulo: { fontFamily: fonts.body, fontSize: 12, color: colors.ink2 },
  rodapeNumero: { fontFamily: fonts.display, fontSize: 18, color: colors.ink, fontVariant: ['tabular-nums'] },
  rodapeBotao: { minHeight: ALVO_TOQUE, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 22, borderRadius: radius.md, backgroundColor: colors.accent },
  rodapeBotaoTexto: { fontFamily: fonts.bold, fontSize: 14, color: colors.surface },
  // .line
  linha: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, paddingVertical: 3 },
  linhaDivisor: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 4, paddingTop: 7 },
  linhaRotulo: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 13, color: colors.ink },
  linhaRotuloDestaque: { fontFamily: fonts.bold, fontSize: 15 },
  linhaValor: { fontFamily: fonts.body, fontSize: 13, fontVariant: ['tabular-nums'] },
  linhaValorForte: { fontFamily: fonts.bold },
  linhaValorDestaque: { fontFamily: fonts.display, fontSize: 19 },
  // card dos totais
  bloco: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, paddingVertical: 11, paddingHorizontal: 12 },
  blocoExtra: { marginTop: 7 },
  // .okbox
  faixa: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 9 },
  faixaTexto: { flex: 1, fontFamily: fonts.semibold, fontSize: 12.5 },
  // .tag / .pill
  selo: { alignSelf: 'flex-start', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  seloM: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  seloPilula: { borderRadius: 999 },
  seloTexto: { fontFamily: fonts.bold, fontSize: 11 },
  seloTextoM: { fontSize: 12 },
});
