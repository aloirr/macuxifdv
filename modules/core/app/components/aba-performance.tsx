/**
 * Aba Performance da ficha do cliente (RN-CORE-50): visitas (total e última), prazo médio, curvas ABC (RN-CORE-49), últimos
 * itens comprados e a sugestão de mix (extensão `cliente.abas` id `mix`, montada pela tela). Visitas: resumo do servidor
 * (`cliente_visita_resumo`) quando sincronizado, senão o que o aparelho tem. Seção sem dado não aparece.
 */
import { formatBRL } from '@macuxi/comum';
import { Badge, Card, SectionHeader, colors, type as t } from '@macuxi/ui/mobile';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { CurvaDoCliente, ItemComprado, ResumoVisitas } from '../../domain';

const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export interface DadosPerformance {
  visitas: ResumoVisitas | null;
  /** Nome de quem fez a última visita ("Você" ou o vendedor); nulo = não se sabe. */
  quemVisitou: string | null;
  prazoMedio: number | null;
  curvas: readonly CurvaDoCliente[];
  itens: readonly (ItemComprado & { data_local: string })[];
}

export function AbaPerformance({ dados, mix }: { dados: DadosPerformance; mix?: ReactNode }) {
  const { visitas, quemVisitou, prazoMedio, curvas, itens } = dados;
  return (
    <View style={{ gap: 14 }} testID="cliente-performance">
      {visitas && visitas.total > 0 ? (
        <View style={styles.grid} testID="cliente-visitas">
          <Stat label="Visitas" value={String(visitas.total)} />
          <Stat label="Última visita" value={visitas.ultima_data ? dataBr(visitas.ultima_data) : '—'} sub={quemVisitou} />
        </View>
      ) : visitas?.ultima_data ? (
        <View style={styles.grid} testID="cliente-visitas">
          <Stat label="Última visita" value={dataBr(visitas.ultima_data)} sub={quemVisitou} />
        </View>
      ) : null}
      {prazoMedio !== null ? (
        <View style={styles.grid} testID="cliente-prazo-medio">
          <Stat label="Prazo médio" value={`${prazoMedio} dias`} />
        </View>
      ) : null}
      {curvas.length > 0 ? (
        <View style={{ gap: 8 }} testID="cliente-curvas">
          <SectionHeader title="Curvas" />
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {curvas.map((c) => (
              <Badge key={c.dimensao} label={c.rotulo} tone={c.curva === 'A' ? 'accent' : c.curva === 'C' ? 'warning' : 'neutral'} />
            ))}
          </View>
        </View>
      ) : null}
      {itens.length > 0 ? (
        <View style={{ gap: 8 }} testID="cliente-ultimos-itens">
          <SectionHeader title="Últimos itens comprados" />
          <Card>
            {itens.map((i, n) => (
              <View key={i.produto_id} style={[styles.row, n < itens.length - 1 && styles.divider]}>
                <View style={{ flex: 1, gap: 1 }}>
                  <Text style={t.bodyStrong} numberOfLines={2}>
                    {i.produto_nome ?? 'Produto'}
                  </Text>
                  <Text style={t.small}>
                    {i.quantidade} {i.unidade ?? 'un'} · {dataBr(i.data_local)}
                  </Text>
                </View>
                <Text style={t.bodyStrong}>{formatBRL(i.preco_unitario_cents)}</Text>
              </View>
            ))}
          </Card>
        </View>
      ) : null}
      {mix}
    </View>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string | null }) {
  return (
    <View style={styles.stat}>
      <Text style={t.small}>{label}</Text>
      <Text style={t.number} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      {sub ? <Text style={t.small}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: { flexBasis: '48%', flexGrow: 1, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingRight: 14, paddingLeft: 14, minHeight: 48 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
