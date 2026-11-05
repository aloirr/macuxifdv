/**
 * Blocos do Início (T-0076, referência R-20261104-164000-alexandre). Só desenho: os dados chegam prontos na `VisaoInicio`
 * do Core (`useInicio()`, RN-CORE-22/RN-CORE-26) e os textos/tons saem de `lib/inicio.ts` (puro, testado). Nenhuma conta
 * de negócio aqui. Visual da T-0072: `Cartao`, `ProgressBar height={6}`, rótulos em caixa alta. Alvos de toque ≥ 48 dp.
 */
import type { MembroAgoraContrato, MetaDoDia, VisaoInicio } from '@macuxi/core/contracts';
import { Cartao, colors, fonts, initials, ProgressBar, type as t } from '@macuxi/ui/mobile';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import {
  COR_DO_PONTO,
  desenhoDaLinha,
  desenhoMetaDeHoje,
  metaPrincipal,
  notaDaEquipe,
  resumoDoMembro,
  ROTULO_INDICADOR,
  seloNovos,
  situacaoDoMembro,
  type ItemRecado,
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

/** Cabeçalho de cartão: rótulo em caixa alta à esquerda e um complemento à direita (selo, "mês 40%"). */
function TopoDoCartao({ rotulo, direita }: { rotulo: string; direita?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <Text style={t.rotulo}>{rotulo}</Text>
      {direita ?? null}
    </View>
  );
}

// ---------- Recados de hoje ----------
export function RecadosDeHoje({ itens, naoLidas, onAbrir, onVerTodos }: { itens: readonly ItemRecado[]; naoLidas: number; onAbrir: (item: ItemRecado) => void; onVerTodos: () => void }) {
  const selo = seloNovos(naoLidas);
  return (
    <Cartao gap={4} testID="inicio.recados">
      <TopoDoCartao
        rotulo="Recados de hoje"
        direita={
          selo ? (
            <View testID="inicio.recados.selo" style={{ backgroundColor: colors.accentSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 }}>
              <Text style={{ fontFamily: fonts.semibold, fontSize: 12, color: colors.accentInk }}>{selo}</Text>
            </View>
          ) : null
        }
      />
      {itens.length === 0 ? (
        <Text style={[t.small, { paddingVertical: 10 }]} testID="inicio.recados.vazio">
          Nenhum recado por enquanto.
        </Text>
      ) : (
        itens.map((r, i) => (
          <Pressable
            key={r.id}
            testID={`inicio.recado.${r.id}`}
            accessibilityRole="button"
            accessibilityLabel={`${r.titulo}${r.apoio ? `. ${r.apoio}` : ''}${r.ponto === 'novo' || r.ponto === 'destaque' ? ', novo' : ''}`}
            onPress={() => onAbrir(r)}
            style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 10, minHeight: 48, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.lineSoft }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, marginTop: 6, backgroundColor: COR_DO_PONTO[r.ponto] }} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={t.bodyStrong} numberOfLines={2}>
                {r.titulo}
              </Text>
              {r.apoio ? (
                <Text style={t.small} numberOfLines={1}>
                  {r.apoio}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))
      )}
      <Pressable testID="inicio.recados.ver-todos" accessibilityRole="link" onPress={onVerTodos} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ fontFamily: fonts.semibold, fontSize: 14, color: colors.accentInk }}>Ver todos</Text>
      </Pressable>
    </Cartao>
  );
}

// ---------- Meta de hoje ----------
/**
 * Cartão "Meta de hoje" (Campo) ou "Meta de hoje da equipe" (Gestão): o indicador principal em destaque (vendas; para o
 * promotor, o primeiro com meta — RN-PRO-01, o Core já filtra) e os demais em linhas compactas.
 */
export function MetaDeHoje({ metas, pronto, equipe, aviso }: { metas: readonly MetaDoDia[]; pronto?: VisaoInicio['meta_hoje']; equipe: boolean; aviso?: string | null }) {
  const rotulo = equipe ? 'Meta de hoje da equipe' : 'Meta de hoje';
  const { principal, outras } = metaPrincipal(metas, pronto?.indicador);
  if (!principal) {
    return (
      <Cartao gap={8} testID="inicio.meta.vazio">
        <TopoDoCartao rotulo={rotulo} />
        <Text style={t.small}>{aviso ?? 'Nenhuma meta cadastrada para este mês.'}</Text>
      </Cartao>
    );
  }
  const d = desenhoMetaDeHoje(principal, pronto?.indicador === principal.indicador ? pronto : null);
  const nota = equipe ? notaDaEquipe(principal) : null;
  return (
    <Cartao gap={8} testID="inicio.meta" tom={d.verde ? 'sucesso' : 'padrao'}>
      <TopoDoCartao rotulo={principal.indicador === 'venda_cents' ? rotulo : `${rotulo} · ${ROTULO_INDICADOR[principal.indicador]}`} direita={<Text style={t.sub} testID="inicio.meta.mes">{d.mes}</Text>} />
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ fontFamily: fonts.display, fontSize: 30, color: d.verde ? colors.success : colors.ink, fontVariant: ['tabular-nums'] }} numberOfLines={1} testID="inicio.meta.valor">
          {d.valor}
        </Text>
        {d.de ? (
          <Text style={t.sub} numberOfLines={1}>
            {d.de}
          </Text>
        ) : null}
      </View>
      <ProgressBar pct={d.pct} color={d.corBarra} track={d.trilho} height={6} />
      <Text style={[t.sub, d.verde ? { color: colors.success } : null]} testID="inicio.meta.apoio">
        {d.apoio}
      </Text>
      {nota ? <Text style={t.small}>{nota}</Text> : null}
      {aviso ? (
        <Text style={[t.small, { color: colors.warningInk }]} testID="inicio.meta.aviso">
          {aviso}
        </Text>
      ) : null}
      {outras.map((m) => {
        const l = desenhoDaLinha(m);
        return (
          <View key={m.indicador} testID={`inicio.meta.${m.indicador}`} style={{ paddingTop: 8, gap: 4, borderTopWidth: 1, borderTopColor: colors.lineSoft }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
              <Text style={t.bodyStrong}>{l.rotulo}</Text>
              <Text style={[t.body, { color: l.verde ? colors.success : colors.ink2, fontVariant: ['tabular-nums'] }]} numberOfLines={1}>
                {l.valor}
              </Text>
            </View>
            <ProgressBar pct={l.pct} color={l.verde ? colors.success : colors.accent} track={l.verde ? colors.successTrack : colors.lineSoft} height={4} />
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
                <Text style={{ fontFamily: fonts.bold, fontSize: 13, color: colors.neutralInk }}>{initials(m.nome)}</Text>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={t.bodyStrong} numberOfLines={1}>
                  {m.nome}
                </Text>
                <Text style={{ fontFamily: fonts.body, fontSize: 12, color: s.cor }} numberOfLines={1}>
                  {s.texto}
                </Text>
              </View>
              <Text style={{ fontFamily: fonts.medium, fontSize: 13, color: colors.ink, fontVariant: ['tabular-nums'] }}>{resumo}</Text>
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
