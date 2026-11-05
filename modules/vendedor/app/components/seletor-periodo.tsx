/**
 * Período da lista de Pedidos (T-0077, RF-VEN-05): seletor Dia | Mês | Ano, valor com ‹ › e folha com calendário (Dia) ou
 * lista de meses/anos. Marca os dias que têm pedido. Toda a conta de datas está em `domain/busca-periodo`.
 */
import { Button, colors, Folha, type as t } from '@macuxi/ui/mobile';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { deslocarPeriodo, mesesDoPeriodo, nomeDoMes, periodoDe, rotuloDoPeriodo, type Periodo, type TipoPeriodo } from '../../domain/busca-periodo';

const TIPOS: Array<{ id: TipoPeriodo; rotulo: string }> = [
  { id: 'dia', rotulo: 'Dia' },
  { id: 'mes', rotulo: 'Mês' },
  { id: 'ano', rotulo: 'Ano' },
];

/** Células do mês (AAAA-MM) em semanas de domingo a sábado; `null` = dia de fora do mês. */
export function semanasDoMes(mes: string): Array<Array<string | null>> {
  const [a, m] = mes.split('-').map(Number) as [number, number];
  const primeiro = new Date(Date.UTC(a, m - 1, 1)).getUTCDay();
  const total = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const celulas: Array<string | null> = Array(primeiro).fill(null);
  for (let d = 1; d <= total; d++) celulas.push(`${mes}-${String(d).padStart(2, '0')}`);
  while (celulas.length % 7 !== 0) celulas.push(null);
  const semanas: Array<Array<string | null>> = [];
  for (let i = 0; i < celulas.length; i += 7) semanas.push(celulas.slice(i, i + 7));
  return semanas;
}

export function SeletorDePeriodo({
  periodo,
  onChange,
  hoje,
  diasComPedido,
  anosDisponiveis,
}: {
  periodo: Periodo;
  onChange: (p: Periodo) => void;
  /** instante atual e fuso, para o "Hoje" e o padrão ao trocar de tipo */
  hoje: { agora: Date; tz: string };
  /** AAAA-MM-DD com pedido no mês exibido pelo calendário */
  diasComPedido: (mes: string) => string[];
  anosDisponiveis: string[];
}) {
  const [aberto, setAberto] = useState(false);
  const [escolhido, setEscolhido] = useState<Periodo>(periodo);
  const [mesVisto, setMesVisto] = useState(periodo.tipo === 'ano' ? `${periodo.valor}-01` : periodo.valor.slice(0, 7));
  useEffect(() => {
    setEscolhido(periodo);
    if (periodo.tipo !== 'ano') setMesVisto(periodo.valor.slice(0, 7));
  }, [periodo]);

  const trocarTipo = (tipo: TipoPeriodo) => {
    if (tipo === periodo.tipo) return;
    const hojeDoTipo = periodoDe(tipo, hoje.agora, hoje.tz);
    if (hojeDoTipo.valor.startsWith(periodo.valor) || periodo.valor.startsWith(hojeDoTipo.valor)) {
      onChange(hojeDoTipo);
      return;
    }
    const ref = periodo.tipo === 'ano' ? `${periodo.valor}-01-01` : periodo.tipo === 'mes' ? `${periodo.valor}-01` : periodo.valor;
    onChange({ tipo, valor: tipo === 'dia' ? ref : tipo === 'mes' ? ref.slice(0, 7) : ref.slice(0, 4) });
  };

  const pontos = new Set(diasComPedido(mesVisto));
  const [av, mv] = mesVisto.split('-').map(Number) as [number, number];
  const mesDeslocado = (passo: number) => setMesVisto(deslocarPeriodo({ tipo: 'mes', valor: mesVisto }, passo).valor);

  return (
    <View style={{ gap: 10 }}>
      <View style={s.tipos} accessibilityRole="tablist">
        {TIPOS.map((x) => (
          <Pressable
            key={x.id}
            testID={`periodo-${x.id}`}
            accessibilityRole="tab"
            accessibilityState={{ selected: periodo.tipo === x.id }}
            onPress={() => trocarTipo(x.id)}
            style={[s.tipo, periodo.tipo === x.id && s.tipoAtivo]}>
            <Text style={[t.bodyStrong, { color: periodo.tipo === x.id ? colors.ink : colors.ink3 }]}>{x.rotulo}</Text>
          </Pressable>
        ))}
      </View>

      <View style={s.valor}>
        <Pressable testID="periodo-anterior" accessibilityRole="button" accessibilityLabel="Período anterior" onPress={() => onChange(deslocarPeriodo(periodo, -1))} style={s.seta}>
          <Text style={s.setaTexto}>‹</Text>
        </Pressable>
        <Pressable
          testID="periodo-valor"
          accessibilityRole="button"
          accessibilityLabel={`Período ${rotuloDoPeriodo(periodo)}. Toque para escolher`}
          onPress={() => setAberto(true)}
          style={{ flex: 1, minHeight: 48, justifyContent: 'center' }}>
          <Text style={[t.bodyStrong, { textAlign: 'center' }]}>{rotuloDoPeriodo(periodo)}</Text>
        </Pressable>
        <Pressable testID="periodo-proximo" accessibilityRole="button" accessibilityLabel="Próximo período" onPress={() => onChange(deslocarPeriodo(periodo, 1))} style={s.seta}>
          <Text style={s.setaTexto}>›</Text>
        </Pressable>
      </View>

      <Folha
        visivel={aberto}
        onFechar={() => setAberto(false)}
        rotuloFechar="Fechar a escolha do período"
        titulo={periodo.tipo === 'dia' ? `${nomeDoMes(mv)} ${av}` : periodo.tipo === 'mes' ? `Meses de ${periodo.valor.slice(0, 4)}` : 'Escolha o ano'}
        testID="periodo-folha">
        {periodo.tipo === 'dia' ? (
          <View style={{ gap: 6 }}>
            <View style={s.linhaMes}>
              <Pressable accessibilityRole="button" accessibilityLabel="Mês anterior" onPress={() => mesDeslocado(-1)} style={s.seta}>
                <Text style={s.setaTexto}>‹</Text>
              </Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel="Próximo mês" onPress={() => mesDeslocado(1)} style={s.seta}>
                <Text style={s.setaTexto}>›</Text>
              </Pressable>
            </View>
            <View style={s.semana}>
              {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, i) => (
                <Text key={i} style={[t.small, s.celula, { color: colors.ink3 }]}>
                  {d}
                </Text>
              ))}
            </View>
            {semanasDoMes(mesVisto).map((sem, i) => (
              <View key={i} style={s.semana}>
                {sem.map((d, j) =>
                  d ? (
                    <Pressable
                      key={d}
                      testID={`dia-${d}`}
                      accessibilityRole="button"
                      accessibilityLabel={rotuloDoPeriodo({ tipo: 'dia', valor: d })}
                      onPress={() => setEscolhido({ tipo: 'dia', valor: d })}
                      style={[s.celula, s.dia, escolhido.valor === d && s.diaAtivo]}>
                      <Text style={[t.body, escolhido.valor === d && { color: colors.surface, fontWeight: '700' }]}>{Number(d.slice(8))}</Text>
                      {pontos.has(d) ? <View style={s.ponto} /> : null}
                    </Pressable>
                  ) : (
                    <View key={`v${j}`} style={s.celula} />
                  ),
                )}
              </View>
            ))}
            <Text style={t.small}>● dia com pedido</Text>
            <View style={s.acoes}>
              <Pressable
                testID="periodo-hoje"
                accessibilityRole="button"
                accessibilityLabel="Ir para hoje"
                style={s.hoje}
                onPress={() => {
                  onChange(periodoDe('dia', hoje.agora, hoje.tz));
                  setAberto(false);
                }}>
                <Text style={[t.bodyStrong, { color: colors.accentInk }]}>Hoje</Text>
              </Pressable>
              <Button
                testID="periodo-aplicar"
                label="Aplicar"
                variant="accent"
                height={52}
                style={{ flex: 2 }}
                onPress={() => {
                  onChange(escolhido);
                  setAberto(false);
                }}
              />
            </View>
          </View>
        ) : (
          <View style={s.grade}>
            {(periodo.tipo === 'mes' ? mesesDoPeriodo(periodo.valor.slice(0, 4)) : anosDisponiveis).map((v) => (
              <Pressable
                key={v}
                testID={`opcao-${v}`}
                accessibilityRole="button"
                onPress={() => {
                  onChange({ tipo: periodo.tipo, valor: v });
                  setAberto(false);
                }}
                style={[s.opcao, periodo.valor === v && s.diaAtivo]}>
                <Text style={[t.bodyStrong, periodo.valor === v && { color: colors.surface }]}>{periodo.tipo === 'mes' ? nomeDoMes(Number(v.slice(5))) : v}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Folha>
    </View>
  );
}

const s = StyleSheet.create({
  tipos: { flexDirection: 'row', backgroundColor: colors.neutralBg, borderRadius: 14, padding: 4 },
  tipo: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  tipoAtivo: { backgroundColor: colors.surface },
  valor: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 14, borderWidth: 1, borderColor: colors.lineStrong },
  seta: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  setaTexto: { fontSize: 26, color: colors.accentInk },
  linhaMes: { flexDirection: 'row', justifyContent: 'flex-end' },
  semana: { flexDirection: 'row' },
  celula: { flex: 1, textAlign: 'center', alignItems: 'center', justifyContent: 'center' },
  dia: { height: 48, borderRadius: 12 },
  diaAtivo: { backgroundColor: colors.ink },
  ponto: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.accentInk, position: 'absolute', bottom: 6 },
  acoes: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  hoje: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center' },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  opcao: { minWidth: '30%', flexGrow: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: colors.lineStrong },
});
