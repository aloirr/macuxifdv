/**
 * Peças visuais de "Recados e tarefas" (T-0170 §7.2): a caixa de marcar da tarefa, o ícone redondo do recado e a tag à direita.
 * Só tokens e componentes de `@macuxi/ui/mobile` (marca v1 pelos tokens). Quem decide o estado de cada peça é
 * `linhas-recados-e-tarefas.ts` (puro, testado).
 */
import { ALVO_TOQUE, colors, fonts, Icon, Pressionavel, radius, space, type as t, type IconName } from '@macuxi/ui/mobile';
import { StyleSheet, Text, View } from 'react-native';

import type { CaixaTarefa, IconeDoBalao, IconeLinha } from './linhas-recados-e-tarefas';

const ICONE: Record<IconeLinha, { nome: IconName; cor: string; fundo: string }> = {
  recado: { nome: 'chat', cor: colors.accentInk, fundo: colors.accentSoft },
  // MC-0012: o tipo "pedido" não é situação; verde só para a tarefa feita (marca v1 §3)
  pedido: { nome: 'check', cor: colors.accentInk, fundo: colors.accentSoft },
  aviso: { nome: 'bell', cor: colors.neutralInk, fundo: colors.neutralBg },
};

const ICONE_BALAO: Record<IconeDoBalao, { nome: IconName; cor: string; fundo: string }> = {
  recado: { nome: 'chat', cor: colors.accentInk, fundo: colors.accentSoft },
  tarefa: { nome: 'check', cor: colors.neutralInk, fundo: colors.neutralBg },
  vencida: { nome: 'alert', cor: colors.danger, fundo: colors.dangerBg },
  ok: { nome: 'check', cor: colors.success, fundo: colors.successBg },
};

/** Ícone redondo do balão: balão de conversa (recado), check (tarefa), alerta (vencida) e ok (tudo em dia). */
export function IconeDoBalaoRedondo({ icone, tamanho = 36 }: { icone: IconeDoBalao; tamanho?: number }) {
  const i = ICONE_BALAO[icone];
  return (
    <View style={[s.icone, { width: tamanho, height: tamanho, borderRadius: tamanho / 2, backgroundColor: i.fundo }]} importantForAccessibility="no-hide-descendants">
      <Icon name={i.nome} size={tamanho / 2} color={i.cor} strokeWidth={2} />
    </View>
  );
}

export function IconeRecado({ icone, tamanho = 40 }: { icone: IconeLinha; tamanho?: number }) {
  const i = ICONE[icone];
  return (
    <View style={[s.icone, { width: tamanho, height: tamanho, borderRadius: tamanho / 2, backgroundColor: i.fundo }]} importantForAccessibility="no-hide-descendants">
      <Icon name={i.nome} size={tamanho / 2} color={i.cor} strokeWidth={2} />
    </View>
  );
}

/** A caixa de marcar (24 dp) dentro de um alvo de 48 dp. Sem `onPress`, é só desenho. */
export function CaixaDeMarcar({ estado, onPress, rotulo, testID }: { estado: CaixaTarefa; onPress?: () => void; rotulo?: string; testID?: string }) {
  const caixa = (
    <View style={[s.caixa, estado === 'feita' && s.caixaFeita, estado === 'bloqueada' && s.caixaBloqueada]}>
      {estado === 'feita' ? <Icon name="check" size={16} color={colors.surface} strokeWidth={3} /> : null}
    </View>
  );
  if (!onPress || estado === 'bloqueada') return <View style={s.alvo}>{caixa}</View>;
  return (
    <Pressionavel testID={testID} accessibilityRole="checkbox" accessibilityState={{ checked: estado === 'feita' }} accessibilityLabel={rotulo} onPress={onPress} style={s.alvo}>
      {caixa}
    </Pressionavel>
  );
}

/** A tag à direita: "• hoje" em laranja quando é novo ou não lido; senão, só o texto. */
export function Tag({ texto, destaque }: { texto: string; destaque: boolean }) {
  return (
    <View style={s.tag} importantForAccessibility="no-hide-descendants">
      {destaque ? <View style={s.pontoTag} /> : null}
      <Text style={destaque ? s.tagDestaque : t.small}>{texto}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  icone: { alignItems: 'center', justifyContent: 'center' },
  alvo: { width: ALVO_TOQUE, height: ALVO_TOQUE, alignItems: 'center', justifyContent: 'center', marginLeft: -space.md, marginTop: -space.md },
  caixa: { width: 24, height: 24, borderRadius: radius.sm - 2, borderWidth: 2, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  caixaFeita: { backgroundColor: colors.success, borderColor: colors.success },
  caixaBloqueada: { backgroundColor: colors.lineSoft, borderColor: colors.line },
  tag: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  pontoTag: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent },
  tagDestaque: { fontFamily: fonts.semibold, fontSize: 12, color: colors.accentInk },
});
