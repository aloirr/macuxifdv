/**
 * Quiz da lição (RN-TRE-02): marcar alternativas (múltipla quando houver várias corretas), enviar e ver na hora a
 * correção do domain por questão, a nota e se passou. A tentativa vai para a fila do aparelho; se aprovada, a conclusão
 * da lição vai junto, logo atrás (o servidor aplica na ordem e recorrige, RN-TRE-04).
 */
import { BackLink, Badge, Button, Card, colors, Empty, Icon, Screen, type as t } from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { CorrecaoQuiz } from '../../domain';
import { Celebracao, conquistasDe, type Conquistas } from '../components/celebracao';
import { licaoNaTela, marcarAlternativa, questoesDaTela } from '../lib/telas';
import { hrefLicao, hrefTreinar, irParaLicao, irParaTrilha } from '../rotas';
import { useTreinamento } from '../state/use-treinamento';

interface Retorno {
  correcao: CorrecaoQuiz;
  aprovada: boolean;
  licao_concluida: boolean;
  conquistas: Conquistas;
  aviso: string | null;
}

export default function QuizScreen() {
  const { licao: licaoId, tempo } = useLocalSearchParams<{ licao?: string; tempo?: string }>();
  const tr = useTreinamento();
  const tela = useMemo(
    () => (licaoId ? licaoNaTela(tr.trilhas, licaoId, tr.estado, tr.params) : null),
    [licaoId, tr.trilhas, tr.estado, tr.params],
  );
  const questoes = useMemo(() => (tela ? questoesDaTela(tela.licao) : []), [tela]);
  const [marcadas, setMarcadas] = useState<Record<string, string[]>>({});
  const [retorno, setRetorno] = useState<Retorno | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  if (!tela || !tela.licao.quiz) {
    return (
      <Screen testID="treinar-quiz">
        <BackLink label="Treinar" fallback={hrefTreinar()} />
        <Empty
          text={
            tr.carregado ? 'Quiz não encontrado no aparelho. Volte e puxe para atualizar.' : 'Carregando…'
          }
        />
      </Screen>
    );
  }
  const { licao, trilha } = tela;
  const quiz = licao.quiz!;
  const respondidas = questoes.filter((q) => (marcadas[q.id] ?? []).length > 0).length;
  const proxima = tr.listaDeTrilhas.find((x) => x.trilha_id === trilha.id)?.proxima_licao_id ?? null;
  const acertou = (questaoId: string) =>
    retorno?.correcao.por_questao.find((p) => p.questao_id === questaoId)?.correta ?? null;

  const enviar = async () => {
    setErro(null);
    setEnviando(true);
    try {
      const agora = tr.agora();
      const respostas = questoes.map((q) => ({ questao_id: q.id, alternativa_ids: marcadas[q.id] ?? [] }));
      const r = await tr.registrar(
        [
          { tipo: 'quiz', id: tr.novoId(), quiz_id: quiz.id, realizada_em: agora, respostas },
          {
            tipo: 'licao',
            id: tr.novoId(),
            trilha_id: trilha.id,
            licao_id: licao.id,
            tempo_gasto_seg: Math.max(0, Number(tempo) || 0),
            concluida_em: agora,
          },
        ],
        { ultimaOpcional: true },
      );
      if (!r.ok) return setErro(r.mensagem);
      const q = r.resultados[0]!.resultado;
      if (q.status !== 'aceito' || !q.correcao || !q.tentativa)
        return setErro('Não foi possível corrigir o quiz. Atualize o app e tente de novo.');
      const rl = r.resultados[1]?.resultado;
      const licaoOk = Boolean(rl && rl.status !== 'rejeitado');
      setRetorno({
        correcao: q.correcao,
        aprovada: q.tentativa.aprovada,
        licao_concluida: licaoOk,
        conquistas: conquistasDe(r.resultados),
        aviso: q.tentativa.aprovada && !licaoOk ? r.mensagem : null,
      });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Screen testID="treinar-quiz">
      <BackLink label={licao.titulo} fallback={hrefLicao(licao.id)} />
      <View style={{ gap: 4 }}>
        <Text style={t.small}>Quiz · nota mínima {tr.params.nota_minima_pct}%</Text>
        <Text style={t.h1Small}>{licao.titulo}</Text>
      </View>

      {questoes.map((q, qi) => {
        const certo = acertou(q.id);
        return (
          <Card
            key={q.id}
            testID={`treinar-questao-${q.id}`}
            style={[
              styles.questao,
              certo === true && { borderColor: colors.success },
              certo === false && { borderColor: colors.danger },
            ]}
          >
            <View style={styles.linha}>
              <Text style={[t.bodyStrong, { flex: 1 }]}>
                {qi + 1}. {q.enunciado}
              </Text>
              {certo === null ? null : (
                <Badge label={certo ? 'Certa' : 'Errada'} tone={certo ? 'success' : 'danger'} />
              )}
            </View>
            {q.multipla ? <Text style={t.small}>Marque todas as corretas.</Text> : null}
            {q.alternativas.map((a) => {
              const marcada = (marcadas[q.id] ?? []).includes(a.id);
              return (
                <Pressable
                  key={a.id}
                  testID={`treinar-alternativa-${a.id}`}
                  accessibilityRole={q.multipla ? 'checkbox' : 'radio'}
                  accessibilityState={{ checked: marcada, disabled: retorno !== null }}
                  disabled={retorno !== null}
                  onPress={() => setMarcadas((m) => marcarAlternativa(m, q, a.id))}
                  style={({ pressed }) => [
                    styles.alternativa,
                    marcada && styles.marcada,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Icon
                    name={marcada ? 'check' : q.multipla ? 'minus' : 'chevron'}
                    size={16}
                    color={marcada ? colors.accentInk : colors.ink3}
                  />
                  <Text style={[t.body, { flex: 1 }]}>{a.texto}</Text>
                </Pressable>
              );
            })}
          </Card>
        );
      })}

      {retorno ? (
        <View style={{ gap: 10 }}>
          <Card
            testID="treinar-quiz-resultado"
            style={[
              styles.resultado,
              { backgroundColor: retorno.aprovada ? colors.successBg : colors.dangerBg },
            ]}
          >
            <Text style={t.h2}>
              {retorno.aprovada ? 'Aprovado!' : 'Ainda não foi desta vez'} · {retorno.correcao.nota_pct}%
            </Text>
            <Text style={t.body}>
              {retorno.correcao.acertos} de {retorno.correcao.total} certas.{' '}
              {retorno.aprovada
                ? retorno.licao_concluida
                  ? 'Lição concluída.'
                  : ''
                : 'Revise a lição e tente de novo.'}
            </Text>
            {retorno.aviso ? <Text style={[t.small, { color: colors.warning }]}>{retorno.aviso}</Text> : null}
          </Card>
          <Celebracao c={retorno.conquistas} />
          {retorno.aprovada ? (
            proxima ? (
              <Button
                testID="treinar-proxima-licao"
                label="Próxima lição"
                icon="chevron"
                height={52}
                onPress={() => irParaLicao(proxima)}
              />
            ) : (
              <Button
                testID="treinar-voltar-trilha"
                label="Voltar à trilha"
                variant="outline"
                height={52}
                onPress={() => irParaTrilha(trilha.id)}
              />
            )
          ) : (
            <Button
              testID="treinar-quiz-de-novo"
              label="Tentar de novo"
              variant="outline"
              height={52}
              onPress={() => {
                setRetorno(null);
                setMarcadas({});
              }}
            />
          )}
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Button
            testID="treinar-quiz-enviar"
            label={
              respondidas < questoes.length
                ? `Enviar (${respondidas} de ${questoes.length} respondidas)`
                : 'Enviar respostas'
            }
            icon="send"
            height={52}
            disabled={respondidas === 0}
            loading={enviando}
            onPress={() => void enviar()}
          />
          {respondidas > 0 && respondidas < questoes.length ? (
            <Text style={t.small}>Questão em branco conta como errada e não mantém a sequência de dias.</Text>
          ) : null}
          {erro ? (
            <Text style={[t.small, { color: colors.danger }]} testID="treinar-quiz-erro">
              {erro}
            </Text>
          ) : null}
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  questao: { padding: 14, gap: 8 },
  alternativa: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 48,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
  },
  marcada: { borderColor: colors.accent, backgroundColor: colors.accentTint },
  resultado: { padding: 14, gap: 6, borderWidth: 0 },
});
