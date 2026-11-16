/**
 * Blocos do Início (T-0076, referência R-20261104-164000-alexandre). Só desenho: os dados chegam prontos na `VisaoInicio`
 * do Core (`useInicio()`, RN-CORE-22/RN-CORE-26) e os textos/tons saem de `lib/inicio.ts` (puro, testado). Nenhuma conta
 * de negócio aqui. Visual da T-0072: `Cartao`, `ProgressBar height={6}`, rótulos em caixa alta. Alvos de toque ≥ 48 dp.
 */
import type { MembroAgoraContrato, MetaDoDia, VisaoInicio } from '@macuxi/core/contracts';
import { Cartao, colors, fonte, Icon, initials, ProgressBar, type as t } from '@macuxi/ui/mobile';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  desenhoDaLinha,
  desenhoMetaDoMes,
  metaPrincipal,
  notaDaEquipe,
  resumoDoMembro,
  rotuloDaMeta,
  situacaoDoMembro,
  type MetaHojePronta,
} from '@/lib/inicio';

// ---------- Boas-vindas ----------
export function BoasVindas({ data, saudacao, visitas, onPerfil }: { data: string; saudacao: string; visitas: string | null; onPerfil: () => void }) {
  return (
    <Pressable
      testID="abrir-perfil"
      accessibilityRole="button"
      accessibilityLabel={`${saudacao}. Abrir perfil`}
      onPress={onPerfil}
      style={{ minHeight: 48, justifyContent: 'center', gap: 2 }}>
      <Text style={t.sub} testID="inicio.data">
        {data}
      </Text>
      <Text style={t.saudacao} testID="inicio.saudacao" numberOfLines={1}>
        {saudacao}
      </Text>
      {visitas ? (
        <Text style={t.sub} testID="inicio.visitas">
          {visitas}
        </Text>
      ) : null}
    </Pressable>
  );
}

/** Cabeçalho de cartão: rótulo em caixa alta à esquerda e um complemento à direita (selo, "0,3%"). */
function TopoDoCartao({ rotulo, direita }: { rotulo: string; direita?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <Text style={t.rotulo}>{rotulo}</Text>
      {direita ?? null}
    </View>
  );
}

// ---------- Meta do mês ----------
/**
 * Cartão "Meta do mês" (Campo) ou "Meta do mês da equipe" (Gestão), T-0124/RD-0002 (decisão do gerente
 * R-20261108-161557; substitui o §1.3 da T-0076): realizado do mês de meta do mês, barra e o % uma vez; a última linha é
 * "Meta de hoje R$ X" no dia útil e "Faltam R$ X · R$ Y por dia útil (N dias)" no dia não útil, com números do Core.
 * Os demais indicadores em linhas "x de y" sem barra (RD-0005, RD-0007, RD-0010). O aviso de dado antigo não fica aqui:
 * é único, no bloco Sincronizar (RD-0008). Sem meta: uma frase; sem as vendas na cópia, o cartão some e o aviso explica.
 */
export function MetaDoMes({ metas, pronto, equipe, semVendas = false }: { metas: readonly MetaDoDia[]; pronto: (Pick<NonNullable<VisaoInicio['meta_hoje']>, 'indicador'> & MetaHojePronta) | null; equipe: boolean; semVendas?: boolean }) {
  const { principal, outras } = metaPrincipal(metas, pronto?.indicador);
  if (!principal) {
    if (semVendas) return null;
    return (
      <Cartao gap={8} testID="inicio.meta.vazio">
        <TopoDoCartao rotulo={rotuloDaMeta(equipe)} />
        <Text style={t.small}>Nenhuma meta cadastrada.</Text>
      </Cartao>
    );
  }
  const d = desenhoMetaDoMes(principal, pronto?.indicador === principal.indicador ? pronto : null);
  const nota = equipe ? notaDaEquipe(principal) : null;
  return (
    <Cartao gap={8} testID="inicio.meta" tom={d.verde ? 'sucesso' : 'padrao'}>
      <TopoDoCartao rotulo={rotuloDaMeta(equipe, principal.indicador)} direita={d.mes ? <Text style={t.sub} testID="inicio.meta.mes">{d.mes}</Text> : undefined} />
      <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', columnGap: 6 }}>
        <Text style={{ ...t.number, fontSize: 28, color: d.verde ? colors.success : colors.ink }} numberOfLines={1} testID="inicio.meta.valor">
          {d.valor}
        </Text>
        <Text style={t.sub} numberOfLines={1}>
          {d.de}
        </Text>
      </View>
      <ProgressBar pct={d.pct} color={d.corBarra} track={d.trilho} height={6} />
      {d.apoio ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {d.apoioMarca ? <Icon name="check" size={14} color={colors.success} strokeWidth={2.4} /> : null}
          <Text style={[t.sub, d.apoioVerde ? { color: colors.success } : null]} testID="inicio.meta.apoio">
            {d.apoio}
          </Text>
        </View>
      ) : null}
      {nota ? <Text style={t.small}>{nota}</Text> : null}
      {outras.map((m) => {
        const l = desenhoDaLinha(m);
        return (
          <View key={m.indicador} testID={`inicio.meta.${m.indicador}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.lineSoft }}>
            <Text style={t.bodyStrong}>{l.rotulo}</Text>
            <Text style={[t.body, { color: l.verde ? colors.success : colors.ink2, fontVariant: ['tabular-nums'] }]} numberOfLines={1}>
              {l.valor}
            </Text>
          </View>
        );
      })}
    </Cartao>
  );
}

// ---------- Equipe agora (Gestão) ----------
export function EquipeAgora({ membros, tz, onAbrir }: { membros: readonly MembroAgoraContrato[]; tz: string; onAbrir: ((usuarioId: string) => void) | null }) {
  return (
    <Cartao gap={4} testID="inicio.equipe-agora">
      <TopoDoCartao rotulo="Equipe agora" />
      {membros.length === 0 ? (
        <Text style={[t.small, { paddingVertical: 10 }]} testID="inicio.equipe-agora.vazio">
          Ninguém na equipe ainda.
        </Text>
      ) : (
        membros.map((m, i) => {
          const s = situacaoDoMembro(m, tz, m.cliente_nome);
          const resumo = resumoDoMembro(m);
          const conteudo = (
            <>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.neutralBg, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ ...fonte.bold, fontSize: 14, color: colors.neutralInk }}>{initials(m.nome)}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={t.bodyStrong} numberOfLines={1}>
                  {m.nome}
                </Text>
                <Text style={{ ...fonte.body, fontSize: 12, color: s.cor }} numberOfLines={1}>
                  {s.texto}
                </Text>
              </View>
              <Text style={{ ...fonte.medium, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] }}>{resumo}</Text>
            </>
          );
          const estilo = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, minHeight: 56, paddingVertical: 8, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.lineSoft };
          return onAbrir ? (
            <Pressable key={m.usuario_id} testID={`inicio.membro.${m.usuario_id}`} accessibilityRole="button" accessibilityLabel={`${m.nome}. ${s.texto}. ${resumo}`} onPress={() => onAbrir(m.usuario_id)} style={estilo}>
              {conteudo}
            </Pressable>
          ) : (
            <View key={m.usuario_id} testID={`inicio.membro.${m.usuario_id}`} style={estilo}>
              {conteudo}
            </View>
          );
        })
      )}
    </Cartao>
  );
}
