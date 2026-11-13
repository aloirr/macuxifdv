/**
 * Mapa da trilha (RF-TRE-01/02): módulos → lições com o status do domain (concluída, liberada, bloqueada).
 * Toque na lição liberada (ou concluída, para rever) abre a lição.
 */
import {
  BackLink,
  Cartao,
  ChipEstado,
  colors,
  EstadoVazio,
  Loading,
  IconTile,
  ProgressBar,
  Screen,
  type as t,
} from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { rotuloDoPrazo } from '../lib/estado';
import { mapaDaTrilha, type LicaoNoMapa } from '../lib/telas';
import { hrefTreinar, irParaLicao } from '../rotas';
import { useTreinamento } from '../state/use-treinamento';

const TIPO: Record<LicaoNoMapa['tipo'], string> = {
  texto: 'Leitura',
  video: 'Vídeo',
  pdf: 'PDF',
  link: 'Link',
};

export default function TrilhaScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const tr = useTreinamento();
  const trilha = tr.trilhas.find((x) => x.id === id) ?? null;
  const resumo = tr.listaDeTrilhas.find((x) => x.trilha_id === id) ?? null;
  const mapa = useMemo(() => (trilha ? mapaDaTrilha(trilha, tr.estado) : []), [trilha, tr.estado]);

  if (!trilha) {
    return (
      <Screen testID="treinar-trilha">
        <BackLink label="Treinar" fallback={hrefTreinar()} />
        {tr.carregado ? (
          <EstadoVazio icone="file" titulo="Trilha não encontrada" texto="Volte e puxe para atualizar." />
        ) : (
          <Loading />
        )}
      </Screen>
    );
  }
  const prazo = resumo ? rotuloDoPrazo(resumo) : null;

  return (
    <Screen testID="treinar-trilha">
      <BackLink label="Treinar" fallback={hrefTreinar()} />
      <View style={{ gap: 4 }}>
        <Text style={t.h1Small}>{trilha.titulo}</Text>
        {trilha.descricao ? <Text style={t.sub}>{trilha.descricao}</Text> : null}
      </View>
      {resumo ? (
        <Cartao gap={8}>
          <View style={styles.linha}>
            <Text style={t.bodyStrong}>
              {resumo.licoes_concluidas} de {resumo.licoes_total}{' '}
              {resumo.licoes_total === 1 ? 'lição' : 'lições'}
            </Text>
            {trilha.status === 'arquivada' ? (
              <ChipEstado texto="Arquivada" tom="neutro" pequeno />
            ) : resumo.concluida ? (
              <ChipEstado texto="Concluída" tom="sucesso" pequeno />
            ) : trilha.obrigatoria ? (
              <ChipEstado
                texto={prazo ?? (resumo.atrasada ? 'Atrasada' : 'Obrigatória')}
                tom={resumo.atrasada ? 'erro' : 'destaque'}
                pequeno
              />
            ) : resumo.licoes_concluidas > 0 ? (
              <ChipEstado texto="Em andamento" tom="aviso" pequeno />
            ) : null}
          </View>
          <ProgressBar pct={resumo.progresso_pct} />
        </Cartao>
      ) : null}

      {mapa.map((m, mi) => (
        <View key={m.id} style={{ gap: 8 }} testID={`treinar-modulo-${m.id}`}>
          <View style={styles.linha}>
            <Text style={t.h2}>
              {mi + 1}. {m.titulo}
            </Text>
            <ChipEstado
              texto={
                m.status === 'concluido'
                  ? 'Concluído'
                  : m.status === 'liberado'
                    ? m.licoes.some((l) => l.status === 'concluida')
                      ? 'Em andamento'
                      : 'Liberado'
                    : 'Bloqueado'
              }
              tom={
                m.status === 'concluido'
                  ? 'sucesso'
                  : m.status === 'liberado'
                    ? m.licoes.some((l) => l.status === 'concluida')
                      ? 'aviso'
                      : 'destaque'
                    : 'neutro'
              }
              pequeno
            />
          </View>
          <Cartao preenchimento={0} style={{ overflow: 'hidden' }}>
            {m.licoes.map((l, li) => {
              const bloqueada = l.status === 'bloqueada';
              return (
                <Pressable
                  key={l.id}
                  testID={`treinar-licao-${l.id}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: bloqueada }}
                  accessibilityLabel={
                    bloqueada ? `${l.titulo}, bloqueada: conclua as anteriores` : `Abrir a lição ${l.titulo}`
                  }
                  disabled={bloqueada}
                  onPress={() => irParaLicao(l.id)}
                  style={({ pressed }) => [
                    styles.licao,
                    li < m.licoes.length - 1 && styles.divisor,
                    pressed && { backgroundColor: colors.ground },
                  ]}
                >
                  <IconTile
                    icon={l.status === 'concluida' ? 'check' : bloqueada ? 'lock' : 'file'}
                    tone={l.status === 'concluida' ? 'success' : bloqueada ? 'neutral' : 'accent'}
                  />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[t.bodyStrong, bloqueada && { color: colors.ink3 }]} numberOfLines={2}>
                      {l.titulo}
                    </Text>
                    <Text style={t.small}>
                      {TIPO[l.tipo]}
                      {l.tem_quiz ? ' · com quiz' : ''}
                    </Text>
                  </View>
                  <ChipEstado
                    texto={l.status === 'concluida' ? 'Concluída' : bloqueada ? 'Bloqueada' : 'Liberada'}
                    tom={l.status === 'concluida' ? 'sucesso' : bloqueada ? 'neutro' : 'destaque'}
                    pequeno
                  />
                </Pressable>
              );
            })}
            {m.licoes.length === 0 ? <EstadoVazio titulo="Módulo sem lições" /> : null}
          </Cartao>
        </View>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  licao: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 56,
  },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
