/**
 * Aba "Pesquisas" (RF-PES-03): pesquisas avulsas disponíveis agora para o usuário, offline. As já respondidas no período
 * aparecem em "Respondidas" (com o dia em que voltam, RN-PES-02) e as que pedem cliente em "Na ficha do cliente".
 * A obrigatória do checkout não aparece aqui: ela é etapa da visita (`visita.etapas_checkout`).
 * Visual T-0072 (docs/design/componentes.md): cartões tocáveis, estados vazios; sem principal.
 * T-0171 (RD-0212): a linha diz um fato só. Disponível: título + perguntas (a descrição fica na tela de responder).
 * Respondida: título + "Volta em". Na ficha: só o título (o rótulo da seção já diz a situação).
 */
import { Cartao, ChipEstado, colors, EstadoVazio, Icon, Loading, RotuloSecao, Screen, type as t, useAtualizacaoAutomatica } from '@macuxi/ui/mobile';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { dataBr } from '../lib/entrada';
import { irParaResponder } from '../rotas';
import { usePesquisa } from '../state/use-pesquisa';

const perguntas = (n: number) => (n === 1 ? '1 pergunta' : `${n} perguntas`);

export default function PesquisasScreen() {
  const { carregado, oferta, pendentesNaFila, offline, usuario, fuso } = usePesquisa();
  /** RN-CORE-23: puxar = Sincronizar pelo agendador do app (trava de 30 s); o hook relê o retrato a cada sincronização. */
  const auto = useAtualizacaoAutomatica({ tz: fuso });
  const { disponiveis, indisponiveis } = useMemo(() => oferta({ cliente_id: null, visita_id: null }), [oferta]);
  // RN-PES-02: "FREQUENCIA" = já respondida no período; o resto mostrado aqui pede um cliente (CLIENTE_FORA_DO_PUBLICO)
  const respondidas = indisponiveis.filter((d) => d.motivo === 'FREQUENCIA');
  const doCliente = indisponiveis.filter((d) => d.motivo !== 'FREQUENCIA');
  const semNada = disponiveis.length === 0 && indisponiveis.length === 0;

  return (
    <Screen testID="pesquisas" refreshing={auto.puxando} onRefresh={auto.puxar}>
      <View style={estilos.topo}>
        <Text style={[t.h1, { flex: 1 }]}>Pesquisas</Text>
        {pendentesNaFila > 0 ? (
          <ChipEstado
            testID="pesquisas.fila"
            tom={offline ? 'aviso' : 'neutro'}
            icone={offline ? 'wifiOff' : 'sync'}
            texto={`${pendentesNaFila} na fila`}
            rotuloAcessivel={`${pendentesNaFila === 1 ? '1 resposta' : `${pendentesNaFila} respostas`} na fila${offline ? ', sem sinal' : ', enviando'}`}
          />
        ) : null}
      </View>

      {!carregado ? <Loading /> : null}
      {carregado && !usuario?.perfil ? <EstadoVazio icone="user" titulo="Entre com seu usuário" testID="pesquisas.sem-usuario" /> : null}
      {carregado && usuario?.perfil && semNada ? (
        <Cartao preenchimento={0}>
          <EstadoVazio icone="clipboard" titulo="Nenhuma pesquisa agora" texto="Puxe para baixo para sincronizar." testID="pesquisas.vazio" />
        </Cartao>
      ) : null}

      {disponiveis.length > 0 ? <RotuloSecao texto={`Para responder · ${disponiveis.length}`} testID="pesquisas.secao-disponiveis" /> : null}
      {disponiveis.map((d, i) => {
        const n = d.versao.perguntas.length;
        return (
          <Cartao
            key={d.questionario_id}
            testID={`pesquisas.disponivel-${i + 1}`}
            onPress={() => irParaResponder({ questionario: d.questionario_id })}
            rotuloAcessivel={`Responder ${d.titulo}, ${perguntas(n)}`}
            gap={4}>
            <View style={estilos.linha}>
              <Text style={[estilos.titulo, { flex: 1 }]} numberOfLines={2}>
                {d.titulo}
              </Text>
              <Icon name="chevron" size={18} color={colors.ink3} />
            </View>
            <Text style={t.small} testID={`pesquisas.responder-${i + 1}`}>
              {perguntas(n)}
            </Text>
          </Cartao>
        );
      })}

      {respondidas.length > 0 ? <RotuloSecao texto={`Respondidas · ${respondidas.length}`} testID="pesquisas.secao-respondidas" /> : null}
      {respondidas.length > 0 ? (
        <Cartao preenchimento={0} style={{ overflow: 'hidden' }}>
          {respondidas.map((d, i) => (
            <View key={d.questionario_id} testID={`pesquisas.respondida-${i + 1}`} style={[estilos.item, i < respondidas.length - 1 && estilos.divisor]}>
              <Text style={estilos.titulo} numberOfLines={2}>
                {d.titulo}
              </Text>
              {d.liberada_em ? <Text style={t.small}>Volta em {dataBr(d.liberada_em)}</Text> : null}
            </View>
          ))}
        </Cartao>
      ) : null}

      {doCliente.length > 0 ? <RotuloSecao texto="Na ficha do cliente" testID="pesquisas.secao-cliente" /> : null}
      {doCliente.length > 0 ? (
        <Cartao preenchimento={0} style={{ overflow: 'hidden' }}>
          {doCliente.map((d, i) => (
            <View key={d.questionario_id} testID={`pesquisas.indisponivel-${i + 1}`} style={[estilos.item, i < doCliente.length - 1 && estilos.divisor]}>
              <Text style={estilos.titulo} numberOfLines={2}>
                {d.titulo}
              </Text>
            </View>
          ))}
        </Cartao>
      ) : null}

      <Text style={[t.small, { textAlign: 'center' }]}>{auto.rodape}</Text>
    </Screen>
  );
}

const estilos = StyleSheet.create({
  topo: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  titulo: { ...t.bodyStrong, fontSize: 15 },
  item: { gap: 4, paddingVertical: 12, paddingHorizontal: 14 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
