/**
 * Aba Treinar (RF-TRE-02/03): nível e XP, sequência de dias, medalhas e trilhas (obrigatórias pendentes primeiro).
 * "Continuar" abre a próxima lição em 2 toques (aba → Continuar). Tudo do aparelho: funciona sem sinal.
 */
import { SePode } from '@macuxi/platform-sdk/react';
import {
  Badge,
  Banner,
  Button,
  Card,
  colors,
  Empty,
  Icon,
  ProgressBar,
  Screen,
  Strong,
  SyncStamp,
  type as t,
} from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { rotuloDoPrazo } from '../lib/estado';
import type { TrilhaDaLista } from '../lib/telas';
import { irParaLicao, irParaRanking, irParaTrilha } from '../rotas';
import { useTreinamento } from '../state/use-treinamento';

export default function TreinarScreen() {
  const tr = useTreinamento();
  const { jornada } = tr;
  const nivel = jornada.nivel;

  return (
    <Screen
      testID="treinar"
      refreshing={tr.auto.puxando}
      onRefresh={tr.auto.puxar}
    >
      <View style={styles.header}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={t.h1}>Treinar</Text>
          <Text style={t.sub}>
            {jornada.obrigatorias_pendentes > 0
              ? jornada.obrigatorias_pendentes === 1
                ? '1 trilha obrigatória para fazer'
                : `${jornada.obrigatorias_pendentes} trilhas obrigatórias para fazer`
              : 'Aprenda um pouco todo dia'}
          </Text>
        </View>
        <SyncStamp at={tr.sincronizadoEm} offline={tr.offline} tz={tr.tz} />
      </View>

      {tr.naFila > 0 ? (
        <Banner testID="treinar-fila">
          <Strong>
            {tr.naFila === 1 ? '1 atividade no aparelho.' : `${tr.naFila} atividades no aparelho.`}
          </Strong>{' '}
          {tr.offline ? 'Sobem sozinhas quando o sinal voltar.' : 'Enviando…'}
        </Banner>
      ) : null}
      {tr.recusadas.length > 0 ? (
        <Banner testID="treinar-recusadas" tone="danger" icon="alert">
          <Strong>
            O servidor não aceitou{' '}
            {tr.recusadas.length === 1 ? '1 atividade' : `${tr.recusadas.length} atividades`}:
          </Strong>{' '}
          {tr.recusadas[0]!.mensagem}
        </Banner>
      ) : null}

      <Card testID="treinar-nivel" style={styles.cardNivel}>
        <View style={styles.linha}>
          <Text style={[t.h2, { color: '#FFFFFF' }]}>Nível {nivel.nivel}</Text>
          <Text style={[t.bodyStrong, { color: colors.darkMuted }]}>{jornada.xp_total} XP</Text>
        </View>
        <ProgressBar pct={nivel.progresso_pct} track={colors.darkTrack} color={colors.accentLight} />
        <Text style={[t.small, { color: colors.darkMuted }]}>
          {nivel.nivel_maximo
            ? 'Nível máximo alcançado!'
            : `Faltam ${nivel.xp_faltante} XP para o nível ${nivel.nivel + 1}`}
        </Text>
      </Card>

      <View style={styles.kpis}>
        <Card
          testID="treinar-sequencia"
          style={[styles.kpi, jornada.streak.em_risco && { borderColor: colors.warning }]}
        >
          <Text style={t.label}>Sequência</Text>
          <Text style={t.number}>
            {jornada.streak.dias} {jornada.streak.dias === 1 ? 'dia' : 'dias'}
          </Text>
          <Text style={[t.small, jornada.streak.em_risco && { color: colors.warning }]}>
            {jornada.streak.em_risco
              ? 'Faça uma lição hoje para não perder'
              : jornada.streak.ativa_hoje
                ? 'Hoje já conta'
                : 'Comece hoje'}
          </Text>
        </Card>
        <Card testID="treinar-xp-hoje" style={styles.kpi}>
          <Text style={t.label}>XP de hoje</Text>
          <Text style={t.number}>{jornada.xp_hoje}</Text>
          <Text style={t.small}>
            Recorde: {jornada.streak.maior} {jornada.streak.maior === 1 ? 'dia' : 'dias'}
          </Text>
        </Card>
      </View>

      <View style={styles.medalhas} testID="treinar-medalhas">
        {jornada.medalhas.map((m) => (
          <Badge
            key={m.codigo}
            label={m.nome}
            tone={m.conquistada_em ? 'success' : 'neutral'}
            style={!m.conquistada_em && { opacity: 0.6 }}
          />
        ))}
      </View>

      <View style={styles.linha}>
        <Text style={t.h2}>Trilhas</Text>
        <SePode acao="ranking.ver">
          <Button
            testID="treinar-abrir-ranking"
            label="Ranking"
            icon="target"
            variant="outline"
            height={48}
            onPress={irParaRanking}
            style={{ paddingHorizontal: 14 }}
          />
        </SePode>
      </View>
      <Card style={{ overflow: 'hidden' }}>
        {tr.listaDeTrilhas.length === 0 ? (
          <Empty
            text={
              tr.carregado
                ? 'Nenhuma trilha para você agora. Puxe para atualizar quando tiver sinal.'
                : 'Carregando as trilhas do aparelho…'
            }
          />
        ) : null}
        {tr.listaDeTrilhas.map((tl, i) => (
          <LinhaTrilha key={tl.trilha_id} t={tl} ultima={i === tr.listaDeTrilhas.length - 1} />
        ))}
      </Card>
      {tr.erroSync && !tr.sincronizando ? (
        <Text style={[t.small, { textAlign: 'center', color: colors.danger }]}>{tr.erroSync}</Text>
      ) : null}
      <Text style={[t.small, { textAlign: 'center' }]}>{tr.auto.rodape}</Text>
    </Screen>
  );
}

function LinhaTrilha({ t: tl, ultima }: { t: TrilhaDaLista; ultima: boolean }) {
  const prazo = rotuloDoPrazo(tl);
  return (
    <View style={[styles.trilha, !ultima && styles.divisor]}>
      <Pressable
        testID={`treinar-trilha-${tl.trilha_id}`}
        accessibilityRole="button"
        accessibilityLabel={`Abrir a trilha ${tl.titulo}`}
        onPress={() => irParaTrilha(tl.trilha_id)}
        style={({ pressed }) => [{ gap: 6, minHeight: 48 }, pressed && { opacity: 0.7 }]}
      >
        <View style={styles.linha}>
          <Text style={[t.bodyStrong, { flex: 1 }]} numberOfLines={2}>
            {tl.titulo}
          </Text>
          {tl.concluida ? (
            <Badge label="Concluída" tone="success" />
          ) : tl.obrigatoria ? (
            <Badge label="Obrigatória" tone={tl.atrasada ? 'danger' : 'accent'} />
          ) : null}
        </View>
        <ProgressBar pct={tl.progresso_pct} />
        <Text style={[t.small, tl.atrasada && { color: colors.danger }]}>
          {tl.licoes_concluidas} de {tl.licoes_total} {tl.licoes_total === 1 ? 'lição' : 'lições'}{prazo ? ` · ${prazo}` : ''}
        </Text>
      </Pressable>
      {tl.proxima_licao_id ? (
        <Button
          testID={`treinar-continuar-${tl.trilha_id}`}
          label={tl.licoes_concluidas === 0 ? 'Começar' : 'Continuar'}
          icon="chevron"
          variant="accent"
          height={48}
          onPress={() => irParaLicao(tl.proxima_licao_id!)}
        />
      ) : !tl.concluida ? (
        <View style={styles.linha}>
          <Icon name="lock" size={14} color={colors.ink3} />
          <Text style={t.small}>Abra a trilha para ver o que falta.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  cardNivel: { padding: 16, gap: 10, backgroundColor: colors.ink, borderColor: colors.ink },
  kpis: { flexDirection: 'row', gap: 10 },
  kpi: { flex: 1, padding: 14, gap: 4 },
  medalhas: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  trilha: { padding: 14, gap: 10 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
