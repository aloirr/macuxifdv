/**
 * Aba "Pesquisas" (RF-PES-03): pesquisas avulsas disponíveis agora para o usuário, offline. As que pedem cliente ou já
 * foram respondidas no período aparecem como indisponíveis, com o motivo e quando voltam (RN-PES-02).
 * A obrigatória do checkout não aparece aqui: ela é etapa da visita (`visita.etapas_checkout`).
 */
import { Banner, Button, Card, Empty, Loading, Screen, Strong, type as t, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { useMemo } from 'react';
import { Text, View } from 'react-native';
import { dataBr } from '../lib/entrada';
import { irParaResponder } from '../rotas';
import { usePesquisa } from '../state/use-pesquisa';

export default function PesquisasScreen() {
  const { carregado, oferta, pendentesNaFila, offline, usuario, fuso } = usePesquisa();
  /** RN-CORE-23: puxar = Sincronizar pelo agendador do app (trava de 30 s); o hook relê o retrato a cada sincronização. */
  const auto = useAtualizacaoAutomatica({ tz: fuso });
  const { disponiveis, indisponiveis } = useMemo(() => oferta({ cliente_id: null, visita_id: null }), [oferta]);

  return (
    <Screen testID="pesquisas" refreshing={auto.puxando} onRefresh={auto.puxar}>
      <View style={{ gap: 2 }}>
        <Text style={t.h1}>Pesquisas</Text>
        <Text style={t.sub}>Responda mesmo sem sinal: a resposta fica no aparelho e vai sozinha quando a conexão voltar.</Text>
      </View>

      {pendentesNaFila > 0 ? (
        <Banner testID="pesquisas.fila">
          <Strong>{pendentesNaFila === 1 ? '1 resposta na fila do aparelho.' : `${pendentesNaFila} respostas na fila do aparelho.`}</Strong> {offline ? 'Envio automático quando o sinal voltar.' : 'Enviando…'}
        </Banner>
      ) : null}

      {!carregado ? <Loading /> : null}
      {carregado && !usuario?.perfil ? <Empty text="Entre com seu usuário para ver as pesquisas." /> : null}
      {carregado && usuario?.perfil && disponiveis.length === 0 && indisponiveis.length === 0 ? <Empty text="Nenhuma pesquisa disponível agora. Puxe a tela para sincronizar." /> : null}

      {disponiveis.map((d, i) => (
        <Card key={d.questionario_id} testID={`pesquisas.disponivel-${i + 1}`} style={{ padding: 16, gap: 10 }}>
          <Text style={t.title16}>{d.titulo}</Text>
          {d.versao.descricao ? <Text style={t.sub}>{d.versao.descricao}</Text> : null}
          <Text style={t.small}>
            {d.versao.perguntas.length} {d.versao.perguntas.length === 1 ? 'pergunta' : 'perguntas'}
          </Text>
          <Button testID={`pesquisas.responder-${i + 1}`} label="Responder" icon="edit" height={48} onPress={() => irParaResponder({ questionario: d.questionario_id })} />
        </Card>
      ))}

      {indisponiveis.length > 0 ? <Text style={[t.label, { marginTop: 6 }]}>INDISPONÍVEIS AGORA</Text> : null}
      {indisponiveis.map((d, i) => (
        <Card key={d.questionario_id} testID={`pesquisas.indisponivel-${i + 1}`} style={{ padding: 16, gap: 4 }}>
          <Text style={t.bodyStrong}>{d.titulo}</Text>
          <Text style={t.small}>
            {d.mensagem}
            {d.liberada_em ? ` Volta em ${dataBr(d.liberada_em)}.` : ''}
          </Text>
        </Card>
      ))}

      <Text style={[t.small, { textAlign: 'center' }]}>{auto.rodape}</Text>
    </Screen>
  );
}
