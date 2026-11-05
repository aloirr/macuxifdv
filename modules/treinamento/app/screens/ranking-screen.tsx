/**
 * Ranking (RF-TRE-04, RN-TRE-03): calculado no servidor, visível só dentro do tenant. Online busca e guarda no
 * armazenamento do módulo; sem sinal mostra o último guardado com o horário (ou pede conexão).
 */
import { ehSemConexao } from '@macuxi/platform-sdk';
import { useHttp } from '@macuxi/platform-sdk/react';
import {
  BackLink,
  Cartao,
  Chip,
  ChipEstado,
  colors,
  EstadoVazio,
  fonts,
  formatHHMM,
  LinhaChips,
  Screen,
  space,
  type as t,
} from '@macuxi/ui/mobile';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { RankingResposta, ROTAS_TREINAMENTO, type LinhaRankingContrato } from '../../contracts';
import { chaveDoRanking } from '../lib/estado';
import { hrefTreinar } from '../rotas';
import { useTreinamento } from '../state/use-treinamento';

const PERIODOS = [
  { id: 'semanal', rotulo: 'Semana' },
  { id: 'mensal', rotulo: 'Mês' },
  { id: 'acumulado', rotulo: 'Geral' },
] as const;
const ESCOPOS = [
  { id: 'geral', rotulo: 'Empresa' },
  { id: 'equipe', rotulo: 'Minha equipe' },
  { id: 'regional', rotulo: 'Minha regional' },
] as const;

type Periodo = (typeof PERIODOS)[number]['id'];
type Escopo = (typeof ESCOPOS)[number]['id'];

export default function RankingScreen() {
  const tr = useTreinamento();
  const http = useHttp();
  const arm = useMemo(() => tr.motor?.armazenamentoDoModulo('treinamento') ?? null, [tr.motor]);
  const [periodo, setPeriodo] = useState<Periodo>('semanal');
  const [escopo, setEscopo] = useState<Escopo>('geral');
  const [dados, setDados] = useState<RankingResposta | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);

  const carregar = useCallback(async () => {
    const chave = chaveDoRanking(periodo, escopo);
    setCarregando(true);
    setAviso(null);
    const guardado = arm ? RankingResposta.safeParse(await arm.ler(chave)) : null;
    if (guardado?.success) setDados(guardado.data);
    else setDados(null);
    try {
      const r = RankingResposta.parse(await http.get(ROTAS_TREINAMENTO.ranking, { periodo, escopo }));
      setDados(r);
      if (arm) await arm.gravar(chave, r);
    } catch (e) {
      if (ehSemConexao(e))
        setAviso(
          guardado?.success
            ? `Sem sinal: ranking guardado às ${formatHHMM(guardado.data.calculado_em, tr.tz)}.`
            : 'Ranking precisa de conexão; conecte e puxe para atualizar.',
        );
      else
        setAviso(
          (e as { message?: string } | null)?.message ||
            'Não foi possível carregar o ranking. Puxe para tentar de novo.',
        );
    } finally {
      setCarregando(false);
    }
  }, [arm, http, periodo, escopo, tr.tz]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  return (
    <Screen testID="treinar-ranking" refreshing={carregando} onRefresh={() => void carregar()}>
      <BackLink label="Treinar" fallback={hrefTreinar()} />
      <Text style={t.h1}>Ranking</Text>
      <LinhaChips>
        {PERIODOS.map((p) => (
          <Chip
            key={p.id}
            testID={`ranking-periodo-${p.id}`}
            label={p.rotulo}
            active={periodo === p.id}
            onPress={() => setPeriodo(p.id)}
          />
        ))}
      </LinhaChips>
      <LinhaChips>
        {ESCOPOS.map((x) => (
          <Chip
            key={x.id}
            testID={`ranking-escopo-${x.id}`}
            label={x.rotulo}
            active={escopo === x.id}
            onPress={() => setEscopo(x.id)}
          />
        ))}
      </LinhaChips>
      {aviso ? (
        <Text style={[t.small, { color: colors.warning }]} testID="ranking-aviso">
          {aviso}
        </Text>
      ) : null}
      {dados?.minha_linha ? (
        <Cartao testID="ranking-minha-posicao" tom="escuro" gap={space.xs}>
          <Text style={[t.label, { color: colors.darkMuted }]}>Sua posição</Text>
          <Text style={[t.h2, { color: colors.surface }]}>
            {dados.minha_linha.posicao}º · {dados.minha_linha.pontos} XP
          </Text>
        </Cartao>
      ) : null}
      <Cartao preenchimento={0} style={{ overflow: 'hidden' }}>
        {!dados || dados.linhas.length === 0 ? (
          <EstadoVazio
            icone="target"
            titulo={carregando ? 'Carregando' : 'Ninguém pontuou ainda'}
            texto={carregando ? undefined : 'Conclua uma lição para entrar.'}
          />
        ) : null}
        {dados?.linhas.map((l, i) => (
          <Linha key={l.usuario_id} l={l} ultima={i === dados.linhas.length - 1} />
        ))}
      </Cartao>
      {dados ? (
        <Text style={[t.small, { textAlign: 'center' }]}>
          Atualizado às {formatHHMM(dados.calculado_em, tr.tz)}
        </Text>
      ) : null}
    </Screen>
  );
}

function Linha({ l, ultima }: { l: LinhaRankingContrato; ultima: boolean }) {
  return (
    <View
      testID={`ranking-linha-${l.posicao}`}
      style={[styles.linha, !ultima && styles.divisor, l.eu && { backgroundColor: colors.accentTint }]}
    >
      <Text style={[styles.posicao, l.posicao <= 3 && { color: colors.accent }]}>{l.posicao}º</Text>
      <View style={{ flex: 1 }}>
        <Text style={t.bodyStrong} numberOfLines={1}>
          {l.nome}
        </Text>
        <Text style={t.small}>
          {l.trilhas_concluidas === 1 ? '1 trilha concluída' : `${l.trilhas_concluidas} trilhas concluídas`}
        </Text>
      </View>
      {l.eu ? <ChipEstado texto="Você" tom="destaque" pequeno /> : null}
      <Text style={t.bodyStrong}>{l.pontos} XP</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 56,
  },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  posicao: { width: 36, fontFamily: fonts.displayBold, fontSize: 16, color: colors.ink2 },
});
