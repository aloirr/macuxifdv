/**
 * Aba Equipe do Macuxi Gestão (RF-GES-01): quem está em visita, em rota ou sem check-in, vendas e cobertura do dia, por
 * pessoa e (gerente) por equipe. Lê do cache do aparelho, atualizado pelo motor de sync (RN-CORE-23); puxar = Sincronizar.
 * Toque na pessoa = ficha (RF-GES-02/10). Escopo e números vêm prontos da API/domain (RN-CORE-04).
 */
import { formatBRL0 } from '@macuxi/comum';
import { relogioReal } from '@macuxi/comum/relogio';
import { Banner, Botao, Cartao, ChipEstado, colors, EstadoVazio, Loading, Screen, SyncStamp, type as t } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ResumoEquipe } from '../../contracts';
import { fracao } from '../lib/apresentacao';
import { contarParados, linhasAgora, type LinhaAgora } from '../lib/equipe-agora';
import { contagem, pct } from '../lib/formato';
import { irParaMembro, irParaRanking } from '../rotas';
import { useGestor } from '../state/use-gestor';

const relogio = relogioReal();

export default function EquipeScreen() {
  const g = useGestor();
  if (!g.carregado) return <Loading />;
  const v = g.visao;
  // RN-CORE-26: o "parado" depende do relógio de agora; a regra é do domain, aqui só se aplica e ordena
  const linhas = v ? linhasAgora(v, relogio.agora().toISOString()) : [];
  return (
    <Screen
      testID="gestor-equipe"
      refreshing={g.auto.puxando}
      onRefresh={g.auto.puxar}>
      <View style={styles.cabecalho}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={t.h1}>Equipe</Text>
          <SyncStamp at={g.sincronizado_em} offline={g.offline} tz={g.tz} />
        </View>
        <Botao testID="gestor-abrir-ranking" rotulo="Ranking" icone="target" onPress={irParaRanking} />
      </View>
      {g.erro ? <Banner tone="danger">{g.erro}</Banner> : null}
      {!v ? (
        <EstadoVazio
          icone="users"
          titulo="Sem dados da equipe ainda"
          texto={g.offline ? 'Conecte-se à internet e puxe para baixo para sincronizar.' : 'Puxe para baixo para sincronizar.'}
        />
      ) : null}
      {v ? <Resumo r={v.resumo} linhas={linhas} /> : null}
      {v && v.equipes.length > 0 ? (
        <Cartao testID="gestor-equipes" preenchimento={0}>
          {v.equipes.map((e, i) => (
            <View key={e.gestor_id} style={[styles.linha, { minHeight: 48, paddingHorizontal: 14 }]}>
              <Text style={[t.bodyStrong, { flex: 1 }]}>{v.gestores[i]?.nome ?? 'Equipe'}</Text>
              <Text style={t.small}>
                {contagem(e.membros, 'pessoa', 'pessoas')} · {e.vendas_cents === null ? '—' : formatBRL0(e.vendas_cents)}
              </Text>
            </View>
          ))}
        </Cartao>
      ) : null}
      {v ? (
        <Cartao preenchimento={0} style={{ overflow: 'hidden' }}>
          {linhas.length === 0 ? <EstadoVazio titulo="Ninguém na sua equipe ainda" texto="Quando houver vendedores ou promotores sob você, eles aparecem aqui." /> : null}
          {linhas.map((l, i) => (
            <LinhaMembro key={l.m.membro.id} l={l} ultimo={i === linhas.length - 1} />
          ))}
        </Cartao>
      ) : null}
    </Screen>
  );
}

function Resumo({ r, linhas }: { r: ResumoEquipe; linhas: readonly LinhaAgora[] }) {
  const parados = contarParados(linhas);
  const n = (s: LinhaAgora['status']) => linhas.filter((l) => l.status === s).length;
  return (
    <Cartao testID="gestor-resumo" gap={8} preenchimento={14}>
      <View style={styles.linha}>
        <Indicador rotulo="Em visita" valor={String(n('em_visita'))} cor={colors.success} />
        <Indicador rotulo="Em rota" valor={String(n('em_rota'))} cor={colors.accentInk} />
      </View>
      <View style={styles.linha}>
        <Indicador rotulo="Parados" valor={String(parados)} cor={parados > 0 ? colors.warningInk : undefined} />
        <Indicador rotulo="Sem check-in" valor={String(n('sem_checkin'))} cor={colors.warningInk} />
      </View>
      <View style={styles.linha}>
        <Indicador rotulo="Vendas hoje" valor={r.vendas_cents === null ? '—' : formatBRL0(r.vendas_cents)} />
        <Indicador rotulo="Visitas" valor={fracao(r.visitas_realizadas, r.visitas_planejadas)} />
        <Indicador rotulo="Cobertura" valor={r.cobertura_pct === null ? '—' : pct(Math.round(r.cobertura_pct))} />
      </View>
      {r.atingimento_pct !== null ? <Text style={t.small}>Meta do mês: {pct(Math.round(r.atingimento_pct))} atingido</Text> : null}
    </Cartao>
  );
}

function Indicador({ rotulo, valor, cor }: { rotulo: string; valor: string; cor?: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={[t.h2, cor ? { color: cor } : null]}>{valor}</Text>
      <Text style={t.small}>{rotulo}</Text>
    </View>
  );
}

function LinhaMembro({ l, ultimo }: { l: LinhaAgora; ultimo: boolean }) {
  const { m } = l;
  const p = m.painel;
  const detalhe =
    m.membro.perfil === 'promotor'
      ? `Promotor · ${p.trade ? contagem(p.trade.lojas_visitadas, 'loja', 'lojas') : contagem(p.visitas.realizadas, 'visita', 'visitas')}`
      : `${fracao(p.visitas.realizadas, p.visitas.planejadas)} ${(p.visitas.planejadas > 0 ? p.visitas.planejadas : p.visitas.realizadas) === 1 ? 'visita' : 'visitas'} · ${p.vendas ? formatBRL0(p.vendas.vendas_cents) : '—'}`;
  return (
    <Pressable
      testID={`gestor-membro-${m.membro.id}`}
      accessibilityRole="button"
      accessibilityLabel={`${m.membro.nome}, ${l.label}${l.detalhe ? `. ${l.detalhe}` : ''}`}
      onPress={() => irParaMembro(m.membro.id)}
      style={({ pressed }) => [styles.membro, !ultimo && styles.divisor, pressed && { backgroundColor: colors.ground }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={t.bodyStrong} numberOfLines={1}>
          {m.membro.nome}
        </Text>
        <Text style={t.small} numberOfLines={1}>
          {detalhe}
        </Text>
        {l.detalhe ? (
          <Text style={[t.small, { color: l.status === 'parado' ? colors.warningInk : colors.ink2 }]} numberOfLines={1}>
            {l.detalhe}
          </Text>
        ) : null}
      </View>
      <ChipEstado texto={l.label} tom={l.tom} pequeno />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  cabecalho: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  linha: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  membro: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingVertical: 10, paddingHorizontal: 14 },
  divisor: { borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
});
