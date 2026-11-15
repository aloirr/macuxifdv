/**
 * Rascunhos (RN-VEN-38/39, T-0141 F; spec docs/design/pedido-v3.md §F.2 e §F.3). O pedido que o vendedor deixa sem enviar e sem
 * salvar como orçamento fica aqui por 24 h depois da última alteração. Lê só do aparelho (vale offline, sem aviso de sinal);
 * tocar numa linha retoma o pedido na aba em que parou. Sem ação de apagar na lista: Descartar fica dentro do pedido.
 * T-0171 (RD-0214): duas linhas, cliente + total e um único fato + o selo "Some em".
 */
import { formatBRL } from '@macuxi/comum';
import { colors, EstadoVazio, fonte, Icon, Pressionavel, radius, Screen, Selo } from '@macuxi/ui/mobile';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TEXTOS_RASCUNHOS, type LinhaDeRascunho } from '../lib/rascunhos-lista';
import { hrefPedidos, irParaNovoPedido, irParaPedidos } from '../rotas';
import { useVendedor } from '../state/use-vendedor';

/** Leitura da linha para o TalkBack: "Atacadinho, R$ 69,96, Alterado hoje às 05:51. Some em 2 h." */
function leituraDaLinha(l: LinhaDeRascunho): string {
  const total = l.total_cents === null ? '' : `, ${formatBRL(l.total_cents)}`;
  return `${l.cliente}${total}, ${l.fato}.${l.someEm ? ` ${l.someEm}.` : ''}`;
}

export default function RascunhosScreen() {
  const app = useVendedor();
  const [agora, setAgora] = useState(() => new Date());
  const [puxando, setPuxando] = useState(false);
  // ao focar, relê o aparelho e renova o relógio (o "Some em" depende dele)
  useFocusEffect(
    useCallback(() => {
      setAgora(new Date());
      void app.recarregar();
    }, []),
  );
  const leitura = useMemo((): { estado: 'carregando' } | { estado: 'erro' } | { estado: 'ok'; linhas: LinhaDeRascunho[] } => {
    if (!app.carregado) return { estado: 'carregando' };
    try {
      return { estado: 'ok', linhas: app.rascunhosDaLista(agora) };
    } catch {
      return { estado: 'erro' };
    }
  }, [app.carregado, app.rascunhosDaLista, agora]);

  const puxar = async () => {
    setPuxando(true);
    setAgora(new Date());
    try {
      await app.recarregar();
    } finally {
      setPuxando(false);
    }
  };

  return (
    <Screen
      testID="rascunhos"
      refreshing={puxando}
      onRefresh={() => void puxar()}
      cabecalho={{
        titulo: TEXTOS_RASCUNHOS.titulo,
        voltar: { label: TEXTOS_RASCUNHOS.voltar, fallback: hrefPedidos(), testID: 'rascunhos-voltar' },
      }}
    >
      {leitura.estado === 'carregando' ? (
        <View style={s.cartao} testID="rascunhos-carregando" accessibilityState={{ busy: true }}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[s.linha, i > 0 && s.traco]}>
              <View style={[s.esqueleto, { width: '60%', height: 16 }]} />
              <View style={[s.esqueleto, { width: '40%', height: 12 }]} />
            </View>
          ))}
        </View>
      ) : leitura.estado === 'erro' ? (
        <EstadoVazio testID="rascunhos-erro" icone="alert" titulo={TEXTOS_RASCUNHOS.erro.titulo} texto={TEXTOS_RASCUNHOS.erro.apoio} />
      ) : leitura.linhas.length === 0 ? (
        <EstadoVazio
          testID="rascunhos-vazio"
          icone="edit"
          titulo={TEXTOS_RASCUNHOS.vazio.titulo}
          texto={TEXTOS_RASCUNHOS.vazio.apoio}
          acao={{ rotulo: TEXTOS_RASCUNHOS.vazio.acao, onPress: irParaPedidos, testID: 'rascunhos-voltar-pedidos' }}
        />
      ) : (
        <View style={s.cartao} testID="rascunhos-lista">
          {leitura.linhas.map((l, i) => (
            <Pressionavel
              key={l.chave}
              testID={`rascunho-${l.chave}`}
              accessibilityRole="button"
              accessibilityLabel={leituraDaLinha(l)}
              accessibilityHint={l.foraDaCarteira ? undefined : TEXTOS_RASCUNHOS.dica}
              accessibilityState={{ disabled: l.foraDaCarteira }}
              disabled={l.foraDaCarteira}
              onPress={() => irParaNovoPedido(l.edicao_de ? { customerId: l.customer_id, editId: l.edicao_de } : { customerId: l.customer_id })}
              style={[s.linha, i > 0 && s.traco]}>
              <View style={s.l1}>
                <Text style={[s.cliente, l.foraDaCarteira && s.apagado]} numberOfLines={2}>
                  {l.cliente}
                </Text>
                {l.total_cents !== null ? <Text style={[s.total, l.foraDaCarteira && s.apagado]}>{formatBRL(l.total_cents)}</Text> : null}
              </View>
              <View style={s.l2}>
                <Text style={[s.fato, l.foraDaCarteira && s.apagado]} numberOfLines={1}>
                  {l.fato}
                </Text>
                {l.someEm ? <Selo texto={l.someEm} tom="aviso" tamanho="p" testID={`rascunho-${l.chave}-some-em`} /> : null}
                {l.foraDaCarteira ? null : (
                  <View style={s.seta}>
                    <Icon name="chevron" size={16} color={colors.ink3} />
                  </View>
                )}
              </View>
            </Pressionavel>
          ))}
        </View>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  cartao: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  linha: { minHeight: 72, paddingVertical: 12, paddingHorizontal: 14, gap: 3 },
  traco: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  l1: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 },
  cliente: { flex: 1, minWidth: 0, ...fonte.semibold, fontSize: 16, color: colors.ink },
  total: { ...fonte.bold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },
  l2: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  fato: { flexShrink: 1, minWidth: 0, ...fonte.body, fontSize: 14, color: colors.ink2 },
  seta: { marginLeft: 'auto' },
  apagado: { color: colors.ink3 },
  esqueleto: { borderRadius: 6, backgroundColor: colors.lineSoft },
});
