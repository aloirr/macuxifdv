/**
 * Lição (RF-TRE-02, RN-TRE-04): conteúdo, cronômetro do tempo na tela e o tempo mínimo do domain. "Concluir" só
 * habilita ao atingir o mínimo; lição com quiz ainda não aprovado vira "Fazer o quiz" (RN-TRE-02). Concluir grava no
 * aparelho (fila do motor) e mostra o XP na hora; o servidor revalida tudo ao sincronizar.
 */
import {
  BackLink,
  Banner,
  Botao,
  Cartao,
  ChipEstado,
  colors,
  EstadoVazio,
  Screen,
  Strong,
  type as t,
} from '@macuxi/ui/mobile';
import { useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { Celebracao, conquistasDe, type Conquistas } from '../components/celebracao';
import { textoDoTempo } from '../lib/estado';
import { licaoNaTela } from '../lib/telas';
import { hrefTrilha, hrefTreinar, irParaLicao, irParaQuiz, irParaTrilha } from '../rotas';
import { useTreinamento } from '../state/use-treinamento';

export default function LicaoScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const tr = useTreinamento();
  const tela = useMemo(
    () => (id ? licaoNaTela(tr.trilhas, id, tr.estado, tr.params) : null),
    [id, tr.trilhas, tr.estado, tr.params],
  );
  const inicio = useRef(Date.now());
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [erroMidia, setErroMidia] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [feito, setFeito] = useState<Conquistas | null>(null);

  useEffect(() => {
    inicio.current = Date.now();
    setSegundos(0);
    setFeito(null);
    setErro(null);
    // timer-permitido: contador do tempo mínimo da lição (RN-TRE-04)
    const h = setInterval(() => setSegundos(Math.floor((Date.now() - inicio.current) / 1000)), 1000);
    return () => clearInterval(h);
  }, [id]);

  if (!tela) {
    return (
      <Screen testID="treinar-licao">
        <BackLink label="Treinar" fallback={hrefTreinar()} />
        <EstadoVazio
          icone="file"
          titulo={tr.carregado ? 'Lição não encontrada' : 'Carregando'}
          texto={tr.carregado ? 'Volte e puxe para atualizar.' : undefined}
        />
      </Screen>
    );
  }
  const { licao, trilha } = tela;
  const atingiu = segundos >= tela.tempo_minimo_seg;
  const concluida = tela.status === 'concluida';
  const proxima = tr.listaDeTrilhas.find((x) => x.trilha_id === trilha.id)?.proxima_licao_id ?? null;

  const concluir = async () => {
    setErro(null);
    setSalvando(true);
    try {
      const r = await tr.registrar([
        {
          tipo: 'licao',
          id: tr.novoId(),
          trilha_id: trilha.id,
          licao_id: licao.id,
          tempo_gasto_seg: segundos,
          concluida_em: tr.agora(),
        },
      ]);
      if (!r.ok) setErro(r.mensagem);
      else setFeito(conquistasDe(r.resultados));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Screen testID="treinar-licao">
      <BackLink label={trilha.titulo} fallback={hrefTrilha(trilha.id)} />
      <View style={{ gap: 4 }}>
        <Text style={t.small}>{tela.modulo_titulo}</Text>
        <Text style={t.h1Small}>{licao.titulo}</Text>
      </View>
      {tela.status === 'bloqueada' ? (
        <Banner testID="treinar-licao-bloqueada" tone="warning" icon="lock">
          <Strong>Lição bloqueada.</Strong> Conclua as anteriores.
        </Banner>
      ) : null}

      {licao.midia_url ? (
        <Cartao gap={8}>
          {licao.tipo === 'video' ? <Text style={t.small}>Vídeo: use o Wi-Fi.</Text> : null}
          <Botao
            testID="treinar-licao-midia"
            rotulo={
              licao.tipo === 'video'
                ? 'Assistir ao vídeo'
                : licao.tipo === 'pdf'
                  ? 'Abrir o PDF'
                  : 'Abrir o link'
            }
            icone="file"
            nivel="secundario"
            onPress={() => {
              setErroMidia(null);
              Linking.openURL(licao.midia_url!).catch(() => setErroMidia('Não foi possível abrir o conteúdo. Confira o sinal e tente de novo.'));
            }}
          />
          {erroMidia ? (
            <Text style={[t.small, { color: colors.danger }]} testID="treinar-licao-midia-erro">
              {erroMidia}
            </Text>
          ) : null}
        </Cartao>
      ) : null}
      {licao.texto ? (
        <Cartao>
          <Text style={[t.body, { lineHeight: 21 }]} testID="treinar-licao-texto">
            {licao.texto}
          </Text>
        </Cartao>
      ) : null}

      {feito ? (
        <View style={{ gap: 10 }}>
          <Celebracao c={feito} />
          {proxima && proxima !== licao.id ? (
            <Botao
              testID="treinar-proxima-licao"
              rotulo="Próxima lição"
              seta
              nivel="principal"
              onPress={() => irParaLicao(proxima)}
            />
          ) : (
            <Botao
              testID="treinar-voltar-trilha"
              rotulo="Voltar à trilha"
              nivel="principal"
              onPress={() => irParaTrilha(trilha.id)}
            />
          )}
        </View>
      ) : concluida ? (
        <View style={styles.linha}>
          <ChipEstado texto="Concluída" tom="sucesso" icone="check" />
          {proxima ? (
            <Botao
              testID="treinar-proxima-licao"
              rotulo="Próxima lição"
              seta
              nivel="principal"
              onPress={() => irParaLicao(proxima)}
            />
          ) : null}
        </View>
      ) : tela.status !== 'bloqueada' ? (
        <View style={{ gap: 8 }}>
          <View style={styles.linha}>
            <Text style={t.small} testID="treinar-cronometro">
              Tempo: {textoDoTempo(segundos)}
            </Text>
            <Text style={[t.small, { color: atingiu ? colors.success : colors.ink3 }]}>
              {atingiu ? 'Mínimo atingido' : `Mínimo: ${textoDoTempo(tela.tempo_minimo_seg)}`}
            </Text>
          </View>
          {tela.precisa_quiz ? (
            <Botao
              testID="treinar-fazer-quiz"
              nivel="principal"
              rotulo={
                atingiu ? 'Fazer o quiz' : `Leia por mais ${textoDoTempo(tela.tempo_minimo_seg - segundos)}`
              }
              icone="clipboard"
              desligado={!atingiu}
              onPress={() => irParaQuiz(licao.id, segundos)}
            />
          ) : (
            <Botao
              testID="treinar-concluir"
              nivel="principal"
              rotulo={
                atingiu ? 'Concluir lição' : `Leia por mais ${textoDoTempo(tela.tempo_minimo_seg - segundos)}`
              }
              icone="check"
              desligado={!atingiu}
              ocupado={salvando}
              onPress={() => void concluir()}
            />
          )}
          {erro ? (
            <Text style={[t.small, { color: colors.danger }]} testID="treinar-licao-erro">
              {erro}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
});
