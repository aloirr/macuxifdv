/**
 * Peças de valor e estado (T-0071, fatia 4; medidas da referência do Novo pedido: `.foot`, `.line`, `.okbox`, `.tag`,
 * `.pill`):
 * - `RodapeTotal`: rodapé fixo com rótulo + valor em destaque + botão (ex.: "Total dos itens" · R$ 383,63 · [Avançar ›]);
 * - `LinhaValor`: linha rótulo ··· valor (itens compactos, Tabela, Descontos, Total);
 * - `BlocoTotais`: cartão com as linhas e a linha final em destaque, com espaço para a `Faixa` abaixo;
 * - `Faixa`: faixa de estado ok/aviso/erro ("4,6% · dentro da alçada");
 * - `Selo`: etiqueta curta (tons sucesso, aviso, erro, neutro, destaque).
 * Os valores chegam já formatados (dinheiro a partir de centavos, % no domain); nenhum texto fixo no componente.
 */
import type { ReactNode } from 'react';
import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { ehSemDado, leituraDaLinhaDeValor, VALOR_SEM_DADO } from './componentes';
import { Icon, type IconName } from './icon';
import { Pressionavel } from './movimento-rn';
import { ALTURA, BOTAO_DESABILITADO, colors, fonts, radius, TONS_ESTADO, type TomEstado } from './theme';

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
  const corTexto = acao.desligado ? BOTAO_DESABILITADO.texto : colors.onAccent;
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
      <Pressionavel
        testID={acao.testID ?? `${testID}-acao`}
        accessibilityRole="button"
        accessibilityLabel={acao.rotulo}
        accessibilityState={{ disabled: off, busy: Boolean(acao.ocupado) }}
        disabled={off}
        onPress={acao.onPress}
        vibrar
        style={[s.rodapeBotao, acao.desligado && s.rodapeBotaoDesligado]}>
        {acao.ocupado ? <ActivityIndicator color={corTexto} size="small" /> : null}
        <Text style={[s.rodapeBotaoTexto, { color: corTexto }]} numberOfLines={1}>
          {acao.rotulo}
        </Text>
        {acao.seta ? <Icon name="chevron" size={16} color={corTexto} strokeWidth={2.4} /> : null}
      </Pressionavel>
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

// ---------- TabelaValores ----------
export interface LinhaDaTabela {
  id: string;
  /** "Limite", "Disponível", "Prazo médio". */
  rotulo: string;
  /** Já formatado ("R$ 20.000,00", "45 dias"); sem dado: `VALOR_SEM_DADO` ("—"), desenhado em `ink3`. */
  valor: string;
  /** `erro`: disponível negativo (com o sinal "−" no texto); `sucesso`: queda de preço. */
  tom?: 'erro' | 'sucesso';
}

/**
 * Tabela rótulo ··· valor para consulta (T-0141; spec docs/design/pedido-v3.md §A): cartão branco, linhas de 48 dp com traço
 * entre elas, rótulo 14 `ink2` à esquerda e valor em Archivo negrito 17, tabular, à direita. Uso: crédito do cliente na aba
 * Venda (Limite, Disponível, Prazo médio) e os totais da folha "Preços de hoje". `carregando` troca os valores por barras
 * cinza (nada de "R$ 0,00" falso); `rodape` é a linha de atualização abaixo do cartão. Sem texto fixo e sem cálculo.
 */
export function TabelaValores({
  linhas,
  carregando,
  rodape,
  testID = 'tabela-valores',
}: {
  linhas: readonly LinhaDaTabela[];
  carregando?: boolean;
  /** "Atualizado hoje às 05:38" com o ícone `sync` (sem sinal: `wifiOff`). */
  rodape?: { icone?: IconName; texto: string } | null;
  testID?: string;
}) {
  return (
    <View style={s.tabelaBloco} testID={testID}>
      <View style={s.tabela}>
        {linhas.map((l, i) => {
          const semDado = ehSemDado(l.valor);
          const cor = l.tom === 'erro' ? colors.danger : l.tom === 'sucesso' ? colors.success : semDado ? colors.ink3 : colors.ink;
          return (
            <View
              key={l.id}
              style={[s.tabelaLinha, i > 0 && s.tabelaLinhaTraco]}
              accessible
              accessibilityLabel={carregando ? l.rotulo : leituraDaLinhaDeValor(l.rotulo, l.valor)}
              accessibilityState={{ busy: Boolean(carregando) }}
              testID={`${testID}-${l.id}`}>
              <Text style={s.tabelaRotulo}>{l.rotulo}</Text>
              {carregando ? (
                <View style={s.tabelaEsqueleto} />
              ) : (
                <Text style={[s.tabelaValor, { color: cor }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82} testID={`${testID}-${l.id}-valor`}>
                  {semDado ? VALOR_SEM_DADO : l.valor}
                </Text>
              )}
            </View>
          );
        })}
      </View>
      {rodape?.texto ? (
        <View style={s.tabelaRodape} testID={`${testID}-rodape`}>
          {rodape.icone ? <Icon name={rodape.icone} size={13} color={colors.ink2} /> : null}
          <Text style={s.tabelaRodapeTexto}>{rodape.texto}</Text>
        </View>
      ) : null}
    </View>
  );
}

// ---------- LinhaResumo ----------
/**
 * Linha do Resumo (T-0133, RF-VEN-11): rótulo curto em maiúsculas numa coluna fixa à esquerda (VENDA, ITENS, ENTREGA, OBS.)
 * e o conteúdo à direita, quebrando em quantas linhas precisar; `alerta` é uma linha extra no tom de aviso ou erro
 * ("Vai para aprovação (título vencido)"). Só leitura.
 */
export function LinhaResumo({
  rotulo,
  texto,
  linhas,
  alerta,
  marca,
  testID,
}: {
  /** "Venda", "Itens", "Entrega", "Obs." (mostrado em maiúsculas). */
  rotulo: string;
  /** Conteúdo numa linha lógica ("Boleto · 28/56 dias"); vazio = "—" passado pelo módulo. */
  texto?: string;
  /** Várias linhas rótulo ··· valor (itens compactos). */
  linhas?: ReadonlyArray<{ id: string; rotulo: string; valor: string }>;
  alerta?: { tom: 'aviso' | 'erro'; texto: string } | null;
  /** 2ª linha curta em `accentInk` 12/600, sem ícone, abaixo do texto (T-0141: "Editado neste pedido" na linha ENTREGA). */
  marca?: string | null;
  testID?: string;
}) {
  const corAlerta = alerta?.tom === 'erro' ? colors.danger : colors.warningInk;
  return (
    <View style={s.resumo} testID={testID}>
      <Text style={s.resumoRotulo} numberOfLines={1}>
        {rotulo}
      </Text>
      <View style={s.resumoConteudo}>
        {texto ? <Text style={s.resumoTexto}>{texto}</Text> : null}
        {marca ? (
          <Text style={s.resumoMarca} testID={testID ? `${testID}-marca` : undefined}>
            {marca}
          </Text>
        ) : null}
        {linhas?.map((l) => <LinhaValor key={l.id} rotulo={l.rotulo} valor={l.valor} testID={testID ? `${testID}-${l.id}` : undefined} />)}
        {alerta ? (
          <View style={s.resumoAlerta} accessibilityRole={alerta.tom === 'erro' ? 'alert' : 'text'}>
            <Icon name="alert" size={14} color={corAlerta} strokeWidth={2.4} />
            <Text style={[s.resumoAlertaTexto, { color: corAlerta }]}>{alerta.texto}</Text>
          </View>
        ) : null}
      </View>
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
  apoio,
  icone,
  testID = 'faixa',
}: {
  tom: TomFaixa;
  /** Texto curto, sem o ✓ (o ícone já vem do tom). Ex.: "4,6% · dentro da alçada". */
  texto: string;
  /** Segunda linha, sem negrito (T-0133, alerta da aba Venda: "Só à vista ou com aprovação"). */
  apoio?: string | null;
  /** Troca o ícone do tom; `null` esconde. */
  icone?: IconName | null;
  testID?: string;
}) {
  const c = TOM_FAIXA[tom];
  const nomeIcone = icone === undefined ? c.icone : icone;
  return (
    <View style={[s.faixa, { backgroundColor: c.bg }]} testID={testID} accessibilityLiveRegion="polite" accessibilityRole={tom === 'erro' ? 'alert' : 'text'}>
      {nomeIcone ? <Icon name={nomeIcone} size={15} color={c.fg} strokeWidth={2.4} /> : null}
      {apoio ? (
        <View style={s.faixaTextos}>
          <Text style={[s.faixaTexto, { color: c.fg }]}>{texto}</Text>
          <Text style={[s.faixaApoio, { color: c.fg }]}>{apoio}</Text>
        </View>
      ) : (
        <Text style={[s.faixaTexto, { color: c.fg }]}>{texto}</Text>
      )}
    </View>
  );
}

// ---------- Selo ----------
/** Os tons do selo são os do chip de estado (`TONS_ESTADO`), uma tabela só. */
export type TomSelo = TomEstado;

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
  const c = TONS_ESTADO[tom];
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
  /** botão principal do guia (52 dp, raio 14, 16 semibold) */
  rodapeBotao: { minHeight: ALTURA.principal, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 22, borderRadius: radius.botao, backgroundColor: colors.accent },
  rodapeBotaoDesligado: { backgroundColor: BOTAO_DESABILITADO.fundo },
  rodapeBotaoTexto: { fontFamily: fonts.semibold, fontSize: 16, color: colors.onAccent },
  // .line
  linha: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, paddingVertical: 3 },
  linhaDivisor: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: 4, paddingTop: 7 },
  linhaRotulo: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 13, color: colors.ink },
  linhaRotuloDestaque: { fontFamily: fonts.bold, fontSize: 15 },
  linhaValor: { fontFamily: fonts.body, fontSize: 13, fontVariant: ['tabular-nums'] },
  linhaValorForte: { fontFamily: fonts.bold },
  linhaValorDestaque: { fontFamily: fonts.display, fontSize: 19 },
  // TabelaValores (T-0141): ink2 7,6:1 e ink 16,5:1 no branco; danger 7,1:1; success 6,4:1; ink3 5,8:1
  tabelaBloco: { gap: 8 },
  tabela: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, overflow: 'hidden' },
  tabelaLinha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, minHeight: 48, paddingHorizontal: 14, paddingVertical: 8 },
  tabelaLinhaTraco: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  tabelaRotulo: { flex: 1, minWidth: 0, fontFamily: fonts.body, fontSize: 14, color: colors.ink2 },
  tabelaValor: { flexShrink: 0, maxWidth: '70%', textAlign: 'right', fontFamily: fonts.displayBold, fontSize: 17, fontVariant: ['tabular-nums'] },
  tabelaEsqueleto: { width: 72, height: 12, borderRadius: 6, backgroundColor: colors.lineSoft },
  tabelaRodape: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabelaRodapeTexto: { fontFamily: fonts.body, fontSize: 12, color: colors.ink2 },
  // linha do Resumo: coluna do rótulo de 64 dp (cabe "ENTREGA" em 11/bold)
  resumo: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 6 },
  resumoRotulo: { width: 64, paddingTop: 2, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },
  resumoConteudo: { flex: 1, minWidth: 0, gap: 2 },
  resumoMarca: { fontFamily: fonts.semibold, fontSize: 12, color: colors.accentInk },
  resumoTexto: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink },
  resumoAlerta: { flexDirection: 'row', alignItems: 'flex-start', gap: 5, paddingTop: 1 },
  resumoAlertaTexto: { flex: 1, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 18 },
  // card dos totais
  bloco: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, paddingVertical: 11, paddingHorizontal: 12 },
  blocoExtra: { marginTop: 7 },
  // .okbox
  faixa: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 9 },
  faixaTexto: { flex: 1, fontFamily: fonts.semibold, fontSize: 12.5 },
  faixaTextos: { flex: 1, gap: 1 },
  faixaApoio: { fontFamily: fonts.body, fontSize: 12.5 },
  // .tag / .pill
  selo: { alignSelf: 'flex-start', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  seloM: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  seloPilula: { borderRadius: 999 },
  seloTexto: { fontFamily: fonts.bold, fontSize: 11 },
  seloTextoM: { fontSize: 12 },
});
