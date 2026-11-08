/**
 * T-0133 (RN-VEN-18, RF-VEN-11): `DescontoCompacto`, o desconto/acréscimo numa linha só, o MESMO para o item (aba Itens) e
 * para o pedido (Resumo). Spec: docs/design/pedido-v2.md §3.
 *   item:    [− 6 +]  [Desc % ˅][ 5,0 ]  −R$ 1,00/FD
 *   pedido:  DESCONTO DO PEDIDO  [Desc % ˅][ 1,0 ]  −R$ 0,20
 * Usa o `CampoAjuste` (lista Desc %, Desc R$, Acrésc %, Acrésc R$ + valor digitável, sem − e +) e põe o equivalente
 * (`equivalenteDoAjuste`) ao lado, na mesma linha de 44 dp (a altura do `Passo` compacto). Substitui os 4 botões grandes
 * (Desc./Acrésc./%/R$) e o campo com −/+ do desconto do pedido.
 * Nenhum texto fixo (tudo por props). Contraste: o equivalente é `success` (6,4:1 no branco), `ink2` ou `danger`; nada de
 * texto laranja. Sem regra de negócio: o módulo calcula o equivalente e diz se passou do limite (`erro`).
 */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { DESCONTO_COMPACTO, equivalenteDoAjuste, type TomEquivalente, type ValorEquivalente } from './desconto';
import { CampoAjuste } from './suspensa';
import { TIPOS_AJUSTE, type OpcaoLista, type TipoAjuste } from './selecao';
import { colors, fonts } from './theme';

const COR_EQUIVALENTE: Record<TomEquivalente, string> = { sucesso: colors.success, neutro: colors.ink2, erro: colors.danger };

export function DescontoCompacto({
  rotulo,
  tipos = TIPOS_AJUSTE,
  tipo,
  onChangeTipo,
  texto,
  onChangeTexto,
  onConfirmar,
  equivalente,
  medida,
  placeholder,
  rotuloAcessivel,
  rotuloTipo,
  rotuloFechar,
  erro,
  desligado,
  style,
  testID = 'desconto',
}: {
  /** À esquerda, em maiúsculas (pedido: "Desconto do pedido"). No item, sem rótulo: a linha já é do item. */
  rotulo?: string;
  /** Padrão: `TIPOS_AJUSTE` (Desc %, Desc R$, Acrésc %, Acrésc R$). Tipo desabilitado aparece com cadeado e motivo. */
  tipos?: ReadonlyArray<OpcaoLista<TipoAjuste>>;
  tipo: TipoAjuste;
  onChangeTipo: (t: TipoAjuste) => void;
  /** Texto do valor (controlado; sanear com `sanearDecimal`, ler com `lerDecimal`). */
  texto: string;
  onChangeTexto: (t: string) => void;
  onConfirmar?: () => void;
  /** Equivalente calculado pelo domain (cents e %). null/zero = sem equivalente na linha. */
  equivalente: ValorEquivalente | null;
  /** Sigla da medida no item ("FD"): o R$ é por unidade (RN-VEN-18). No pedido, sem medida (sobre o total). */
  medida?: string | null;
  /** Ex.: "0". */
  placeholder: string;
  /** Ex.: "Desconto do pedido" / "Valor do ajuste de Água mineral 1,5 L". */
  rotuloAcessivel: string;
  /** Ex.: "Tipo do ajuste do pedido". */
  rotuloTipo: string;
  /** Ex.: "Fechar a lista". */
  rotuloFechar: string;
  /** Passou do limite (ex.: alçada do vendedor): borda e equivalente vermelhos; o motivo vai em texto perto, pela tela. */
  erro?: boolean;
  desligado?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const eq = equivalenteDoAjuste(tipo, equivalente, { medida, erro });
  return (
    <View style={[s.linha, style]} testID={testID}>
      {rotulo ? (
        <Text style={s.rotulo} numberOfLines={2} accessibilityRole="header">
          {rotulo}
        </Text>
      ) : null}
      <CampoAjuste
        testID={`${testID}-campo`}
        style={rotulo ? s.campoFixo : s.campoLivre}
        tipos={tipos}
        tipo={tipo}
        onChangeTipo={onChangeTipo}
        texto={texto}
        onChangeTexto={onChangeTexto}
        onConfirmar={onConfirmar}
        placeholder={placeholder}
        rotuloAcessivel={rotuloAcessivel}
        rotuloTipo={rotuloTipo}
        rotuloFechar={rotuloFechar}
        erro={erro}
        desligado={desligado}
      />
      {eq ? (
        <Text
          testID={`${testID}-equivalente`}
          style={[s.equivalente, { color: COR_EQUIVALENTE[eq.tom] }]}
          numberOfLines={1}
          accessibilityLabel={eq.leitura}
          accessibilityLiveRegion="polite">
          {eq.texto}
        </Text>
      ) : null}
    </View>
  );
}

const s = StyleSheet.create({
  // uma linha de 44 dp (a do Passo compacto); com fonte grande, o rótulo quebra em 2 linhas e a linha cresce
  linha: { flexDirection: 'row', alignItems: 'center', gap: DESCONTO_COMPACTO.vao, minHeight: DESCONTO_COMPACTO.altura },
  rotulo: { flex: 1, minWidth: 0, fontFamily: fonts.bold, fontSize: 11, lineHeight: 14, letterSpacing: 0.4, textTransform: 'uppercase', color: colors.ink2 },
  campoFixo: { width: DESCONTO_COMPACTO.larguraCampo },
  campoLivre: { flexGrow: 1, flexShrink: 1, minWidth: DESCONTO_COMPACTO.larguraCampo },
  equivalente: { flexShrink: 0, textAlign: 'right', fontFamily: fonts.bold, fontSize: 13, fontVariant: ['tabular-nums'] },
});
