/**
 * T-0133 (RN-VEN-30, RF-VEN-05): histórico do pedido/orçamento em tags, no Campo e no Gestão (o BKO usa os componentes de
 * mesmo nome do kit web). Spec: docs/design/pedido-v2.md §5.
 * - `TagHistorico`: tag de status com data e hora curtas ("Salvo · 08/11 10:35") e, em Rejeitado e Cancelado, o motivo
 *   numa linha só, logo abaixo;
 * - `HistoricoEmTags`: as tags em ordem de acontecimento, quebrando linha; a tag com motivo ocupa a linha inteira.
 * Rótulos, tons e leitura vêm de `tagsDoHistorico` (../comum/historico.ts). Nenhum texto fixo. Cor sempre com texto
 * (tons do `ChipEstado`: o destaque é `accentInk` no `accentSoft`, 6,27:1).
 */
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { leituraDoHistorico, type TagDoHistorico } from '../comum/historico';
import { ChipEstado } from './base';
import { colors, fonts } from './theme';

export function TagHistorico({ tag, testID }: { tag: TagDoHistorico; testID?: string }) {
  const id = testID ?? `historico-${tag.id}`;
  return (
    <View testID={id} style={tag.motivo ? s.comMotivo : s.tag} accessible accessibilityLabel={tag.leitura}>
      <ChipEstado texto={tag.texto} tom={tag.tom} pequeno style={s.chip} rotuloAcessivel={tag.leitura} />
      {tag.motivo ? (
        <Text testID={`${id}-motivo`} style={s.motivo} numberOfLines={1}>
          {tag.motivo}
        </Text>
      ) : null}
    </View>
  );
}

export function HistoricoEmTags({
  tags,
  titulo,
  style,
  testID = 'historico',
}: {
  /** `tagsDoHistorico(eventos, { tipo, tz, agora })`: já em ordem e sem os status que não têm tag. */
  tags: ReadonlyArray<TagDoHistorico>;
  /** Título da seção, só para o TalkBack ler "Histórico: 3 etapas" (o título visível é o `RotuloSecao` da tela). */
  titulo: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  if (tags.length === 0) return null;
  return (
    <View testID={testID} style={[s.lista, style]} accessibilityLabel={leituraDoHistorico(titulo, tags.length)}>
      {tags.map((t) => (
        <TagHistorico key={t.id} tag={t} testID={`${testID}-${t.id}`} />
      ))}
    </View>
  );
}

const s = StyleSheet.create({
  lista: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', gap: 6 },
  tag: { maxWidth: '100%' },
  // a tag com motivo ocupa a linha inteira: o motivo fica logo abaixo dela, sem misturar com a próxima tag
  comMotivo: { width: '100%', gap: 3 },
  chip: { alignSelf: 'flex-start', maxWidth: '100%' },
  // 13/18 ink2 (6,9:1 no fundo): o motivo é lido, não é decoração
  motivo: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.ink2, paddingLeft: 2 },
});
