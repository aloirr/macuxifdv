/**
 * T-0060 (RN-CORE-17): peças do cliente no app (Campo e Gestão), usadas pelas telas do Core (carteira e Cliente 360).
 * Só exibem o que a tela entrega (o Core calcula com `cadastroCompleto`/`observacaoComCadastro`); funcionam offline
 * porque tudo vem do pull do `cliente`.
 */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { blocosDeObservacao, DESCRICAO_CADASTRO_INCOMPLETO, OBSERVACOES_VAZIAS, ROTULO_CADASTRO_INCOMPLETO, TITULO_OBSERVACOES } from '../comum/cadastro';
import { Icon } from './icon';
import { colors, fonte, radius, type as t } from './theme';
import { Badge, Card, SectionHeader } from './ui';

export { blocosDeObservacao, DESCRICAO_CADASTRO_INCOMPLETO, OBSERVACOES_VAZIAS, ROTULO_CADASTRO_INCOMPLETO, TITULO_OBSERVACOES };
export type { BlocosObservacao } from '../comum/cadastro';

/** Etiqueta "Cadastro incompleto" (tom de atenção), na linha do cliente da carteira e no cabeçalho do Cliente 360. */
export function EtiquetaCadastroIncompleto({ style, testID = 'etiqueta-cadastro-incompleto' }: { style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View testID={testID} accessible accessibilityLabel={DESCRICAO_CADASTRO_INCOMPLETO} style={style}>
      <Badge label={ROTULO_CADASTRO_INCOMPLETO} tone="warning" />
    </View>
  );
}

/**
 * Seção Observações do Cliente 360: a linha automática do cadastro incompleto em destaque no topo e, abaixo, o texto do
 * ERP intacto (selecionável). `automatica` = `observacaoComCadastro(null, campos_faltantes)` do Core; `texto` =
 * `observacao` do cliente.
 */
export function ObservacoesCliente({
  automatica,
  texto,
  titulo = TITULO_OBSERVACOES,
  testID = 'observacoes-cliente',
}: {
  automatica?: string | null;
  texto?: string | null;
  titulo?: string;
  testID?: string;
}) {
  const b = blocosDeObservacao(automatica, texto);
  return (
    <View style={{ gap: 8 }} testID={testID}>
      <SectionHeader title={titulo} />
      <Card style={styles.card}>
        {b.automatica ? (
          <View style={styles.automatica} testID={`${testID}-automatica`} accessibilityRole="alert">
            <View style={{ marginTop: 1 }}>
              <Icon name="alert" size={16} color={colors.warningInk} />
            </View>
            <Text style={styles.automaticaTexto}>{b.automatica}</Text>
          </View>
        ) : null}
        {b.texto ? (
          <Text selectable style={[t.body, { color: colors.ink }]} testID={`${testID}-texto`}>
            {b.texto}
          </Text>
        ) : null}
        {b.vazio ? <Text style={[t.small, { color: colors.ink3 }]}>{OBSERVACOES_VAZIAS}</Text> : null}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 14, gap: 10 },
  automatica: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', backgroundColor: colors.warningBg, borderRadius: radius.md, paddingVertical: 9, paddingHorizontal: 10 },
  automaticaTexto: { flex: 1, ...fonte.medium, fontSize: 14, lineHeight: 18, color: colors.warningInk },
});
