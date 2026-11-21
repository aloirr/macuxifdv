/**
 * Aba Treinar (RF-TRE-02/03): nível e XP, sequência de dias, medalhas e trilhas (obrigatórias pendentes primeiro).
 * "Continuar" abre a próxima lição em 2 toques (aba → Continuar). Tudo do aparelho: funciona sem sinal.
 */
import { SePode } from '@macuxi/platform-sdk/react';
import {
  Banner,
  Botao,
  Cartao,
  ChipEstado,
  colors,
  EstadoVazio,
  Loading,
  ProgressBar,
  Screen,
  SeloAtualizacao,
  space,
  Strong,
  type as t,
} from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { rotuloDoPrazo } from '../lib/estado';
import { avisoSemSinal, type TrilhaDaLista } from '../lib/telas';
import { irParaLicao, irParaRanking, irParaTrilha } from '../rotas';
import { useTreinamento } from '../state/use-treinamento';

export default function TreinarScreen() {
  const tr = useTreinamento();
  const { jornada } = tr;
  const nivel = jornada.nivel;
  const aviso = avisoSemSinal(tr.offline, tr.mostraHora);
  // Um só botão principal na tela: o da primeira trilha com lição a fazer (a lista já vem com obrigatórias antes).
  const destaque = tr.listaDeTrilhas.find((x) => x.proxima_licao_id)?.trilha_id ?? null;

  return (
    <Screen
      testID="treinar"
      refreshing={tr.auto.puxando}
      onRefresh={tr.auto.puxar}
      cabecalho={{
        titulo: 'Treinar',
        subtitulo:
          jornada.obrigatorias_pendentes > 0
            ? jornada.obrigatorias_pendentes === 1
              ? '1 obrigatória pendente'
              : `${jornada.obrigatorias_pendentes} obrigatórias pendentes`
            : 'Tudo em dia',
        direita: tr.mostraHora ? (
          <SeloAtualizacao
            testID="treinar-selo-sync"
            semRede={tr.offline}
            onSincronizar={tr.auto.puxar}
            atualizadoEm={tr.sincronizadoEm}
            tz={tr.tz}
            sobreFaixa
          />
        ) : undefined,
      }}>
      {aviso ? <Banner testID="treinar-sem-sinal">{aviso}</Banner> : null}
      {tr.recusadas.length > 0 ? (
        <Banner testID="treinar-recusadas" tone="danger" icon="alert">
          <Strong>
            O servidor não aceitou{' '}
            {tr.recusadas.length === 1 ? '1 atividade' : `${tr.recusadas.length} atividades`}:
          </Strong>{' '}
          {tr.recusadas[0]!.mensagem}
        </Banner>
      ) : null}

      <Cartao testID="treinar-nivel" tom="escuro" gap={10}>
        <View style={styles.linha}>
          <Text style={[t.h2, { color: colors.surface }]}>Nível {nivel.nivel}</Text>
          <Text style={[t.bodyStrong, { color: colors.darkMuted }]}>{jornada.xp_total} XP</Text>
        </View>
        <ProgressBar pct={nivel.progresso_pct} track={colors.darkTrack} color={colors.accentLight} />
        <Text style={[t.small, { color: colors.darkMuted }]}>
          {nivel.nivel_maximo
            ? 'Nível máximo alcançado!'
            : `Faltam ${nivel.xp_faltante} XP para o nível ${nivel.nivel + 1}`}
        </Text>
      </Cartao>

      <View style={styles.kpis}>
        <Cartao
          testID="treinar-sequencia"
          gap={space.xs}
          style={[styles.kpi, jornada.streak.em_risco && { borderColor: colors.warning }]}
        >
          <Text style={t.label}>Sequência</Text>
          <Text style={t.number}>
            {jornada.streak.dias} {jornada.streak.dias === 1 ? 'dia' : 'dias'}
          </Text>
          <Text style={[t.small, jornada.streak.em_risco && { color: colors.warning }]}>
            {jornada.streak.em_risco
              ? 'Faça uma lição hoje'
              : jornada.streak.ativa_hoje
                ? 'Hoje já conta'
                : 'Comece hoje'}
          </Text>
        </Cartao>
        <Cartao testID="treinar-xp-hoje" gap={space.xs} style={styles.kpi}>
          <Text style={t.label}>XP de hoje</Text>
          <Text style={t.number}>{jornada.xp_hoje}</Text>
          <Text style={t.small}>
            Recorde: {jornada.streak.maior} {jornada.streak.maior === 1 ? 'dia' : 'dias'}
          </Text>
        </Cartao>
      </View>

      <View style={styles.medalhas} testID="treinar-medalhas">
        {jornada.medalhas.map((m) => (
          <ChipEstado
            key={m.codigo}
            texto={m.conquistada_em ? m.nome : `${m.nome} · a conquistar`}
            tom={m.conquistada_em ? 'sucesso' : 'neutro'}
            icone={m.conquistada_em ? 'check' : 'lock'}
            pequeno
          />
        ))}
      </View>

      <View style={styles.linha}>
        <Text style={t.h2}>Trilhas</Text>
        <SePode acao="ranking.ver">
          <Botao
            testID="treinar-abrir-ranking"
            rotulo="Ranking"
            icone="target"
            nivel="neutro"
            onPress={irParaRanking}
          />
        </SePode>
      </View>
      {tr.listaDeTrilhas.length === 0 ? (
        <Cartao>
          {tr.carregado ? (
            <EstadoVazio icone="file" titulo="Nenhuma trilha agora" texto="Puxe para atualizar com sinal." />
          ) : (
            <Loading />
          )}
        </Cartao>
      ) : (
        <Cartao preenchimento={0} style={{ overflow: 'hidden' }}>
          {tr.listaDeTrilhas.map((tl, i) => (
            <LinhaTrilha
              key={tl.trilha_id}
              t={tl}
              ultima={i === tr.listaDeTrilhas.length - 1}
              principal={tl.trilha_id === destaque}
            />
          ))}
        </Cartao>
      )}
      {tr.erroSync && !tr.sincronizando ? (
        <Text style={[t.small, { textAlign: 'center', color: colors.danger }]}>{tr.erroSync}</Text>
      ) : null}
    </Screen>
  );
}

function LinhaTrilha({
  t: tl,
  ultima,
  principal,
}: {
  t: TrilhaDaLista;
  ultima: boolean;
  principal: boolean;
}) {
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
            <ChipEstado texto="Concluída" tom="sucesso" pequeno />
          ) : tl.obrigatoria ? (
            <ChipEstado
              texto={prazo ?? (tl.atrasada ? 'Atrasada' : 'Obrigatória')}
              tom={tl.atrasada ? 'erro' : 'destaque'}
              pequeno
            />
          ) : tl.licoes_concluidas > 0 ? (
            <ChipEstado texto="Em andamento" tom="aviso" pequeno />
          ) : null}
        </View>
        <ProgressBar pct={tl.progresso_pct} />
        <Text style={t.small}>
          {tl.licoes_concluidas} de {tl.licoes_total} {tl.licoes_total === 1 ? 'lição' : 'lições'}
        </Text>
      </Pressable>
      {tl.proxima_licao_id ? (
        <Botao
          testID={`treinar-continuar-${tl.trilha_id}`}
          rotulo={tl.licoes_concluidas === 0 ? 'Começar' : 'Continuar'}
          seta
          nivel={principal ? 'principal' : 'secundario'}
          onPress={() => irParaLicao(tl.proxima_licao_id!)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  kpis: { flexDirection: 'row', gap: 10 },
  kpi: { flex: 1 },
  medalhas: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  trilha: { padding: space.md + 2, gap: 10 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
