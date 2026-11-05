/**
 * Celebração discreta (RN-TRE-06): nível novo e medalha nova depois de concluir lição ou quiz. Sem animação longa:
 * um cartão com o que mudou e o próximo passo.
 */
import { Cartao, colors, Icon, type as t } from '@macuxi/ui/mobile';
import { StyleSheet, Text, View } from 'react-native';
import type { ResultadoAtividade } from '../../domain';

export interface Conquistas {
  xp: number;
  nivel: number | null;
  medalhas: string[];
}

/** Soma o que as atividades aceitas renderam (XP, nível novo, medalhas novas). */
export function conquistasDe(resultados: readonly { resultado: ResultadoAtividade }[]): Conquistas {
  let xp = 0;
  let nivel: number | null = null;
  const medalhas: string[] = [];
  for (const { resultado: r } of resultados) {
    if (r.status !== 'aceito') continue;
    xp += r.xp_ganho;
    if (r.nivel_depois > r.nivel_antes) nivel = r.nivel_depois;
    medalhas.push(...r.conquistas.map((c) => c.nome));
  }
  return { xp, nivel, medalhas };
}

export function Celebracao({ c, testID = 'treinar-celebracao' }: { c: Conquistas; testID?: string }) {
  if (c.xp === 0 && c.nivel === null && c.medalhas.length === 0) return null;
  return (
    <Cartao testID={testID} tom="sucesso" gap={6}>
      <View style={styles.linha}>
        <Icon name="check" size={18} color={colors.success} />
        <Text style={t.bodyStrong}>{c.xp > 0 ? `+${c.xp} XP` : 'Atividade registrada'}</Text>
      </View>
      {c.nivel !== null ? (
        <Text style={t.body}>Nível {c.nivel} alcançado.</Text>
      ) : null}
      {c.medalhas.map((m) => (
        <Text key={m} style={t.body}>
          Medalha nova: {m}
        </Text>
      ))}
    </Cartao>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
