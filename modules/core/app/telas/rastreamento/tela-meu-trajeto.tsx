/**
 * "Meu trajeto" (T-0156; spec §3; RN-CORE-13, RN-CORE-46): o dia do próprio vendedor ou promotor, nunca de outra pessoa
 * (`core.trajeto.ver_proprio`). Hoje lê os pontos do aparelho (funciona sem sinal) e, sem eles, o servidor; dias anteriores vêm do servidor
 * (`GET /v1/core/trajeto`, até 90 dias). Km pelo `metrosDoTrajeto`, o mesmo número do `core.deslocamento_dia`. Horas no fuso do tenant.
 * O botão "Contestar este dia" fica de fora: depende de entidade nova e de decisão do dono do produto (P1 do spec).
 * testIDs: `meu-trajeto.tela|dia|dia-anterior|dia-proximo|mapa|km|linha.<n>|vazio|sem-sinal|erro`.
 */
import { ehSemConexao } from '@macuxi/platform-sdk';
import { useHttp, useMotorSync } from '@macuxi/platform-sdk/react';
import { Botao, Cartao, colors, EstadoVazio, fonte, Icon, Loading, Screen, type as t } from '@macuxi/ui/mobile';
import { localIsoDate } from '@macuxi/comum/fuso';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TrajetoRespostaSchema, ENTIDADE_PAUSA_TRAJETO, type PontoDoTrajeto } from '../../../contracts';
import { pontosLocaisDoDia } from '../../lib/pontos-locais';
import { deslocarDia, diaAnteriorPermitido, resumoDoDia, rotuloDoDia, type PausaDoDia } from '../../lib/rastreamento-local';
import { useRastreamento } from '../../lib/usar-rastreamento';
import { MapaTrajeto } from './mapa-trajeto';

type Visao =
  | { tipo: 'carregando' }
  | { tipo: 'dia'; pontos: PontoDoTrajeto[]; pausas: PausaDoDia[] }
  | { tipo: 'sem_sinal' }
  | { tipo: 'erro' };

export function TelaMeuTrajeto() {
  const http = useHttp();
  const { estado } = useMotorSync();
  const r = useRastreamento();
  const fuso = r.fuso;
  const agora = new Date().toISOString();
  const hoje = localIsoDate(agora, fuso);
  const [data, setData] = useState<string | null>(null);
  const [visao, setVisao] = useState<Visao>({ tipo: 'carregando' });
  const dia = data ?? hoje;
  const ehHoje = dia === hoje;

  const carregar = useCallback(async () => {
    setVisao({ tipo: 'carregando' });
    try {
      // hoje: os pontos do aparelho primeiro (offline); o servidor só se o aparelho não tem nenhum
      const locais = ehHoje ? await pontosLocaisDoDia(dia, fuso) : null;
      if (locais && locais.length > 0) return setVisao({ tipo: 'dia', pontos: locais, pausas: [] });
      const resp = TrajetoRespostaSchema.parse(await http.get<unknown>('/core/trajeto', { data: dia }));
      setVisao({ tipo: 'dia', pontos: resp.usuario.pontos, pausas: resp.usuario.pausas });
    } catch (e) {
      setVisao(ehSemConexao(e) ? { tipo: 'sem_sinal' } : { tipo: 'erro' });
    }
  }, [dia, ehHoje, fuso, http]);

  useEffect(() => {
    void carregar();
  }, [carregar, estado.sincronizado_em]);

  // pausas de hoje que ainda estão no aparelho: as da fila (fechadas) e a em curso
  const pausasLocais = useMemo<PausaDoDia[]>(() => {
    if (!ehHoje) return [];
    const daFila = estado.fila
      .filter((i) => i.entidade === ENTIDADE_PAUSA_TRAJETO)
      .map((i) => i.payload as { inicio: string; fim: string | null })
      .filter((p) => localIsoDate(p.inicio, fuso) === dia);
    return [...daFila, ...(r.pausa ? [{ inicio: r.pausa.inicio, fim: null }] : [])];
  }, [ehHoje, estado.fila, r.pausa, dia, fuso]);

  const pausas = useMemo(() => {
    if (visao.tipo !== 'dia') return [];
    const todas = [...visao.pausas];
    for (const p of pausasLocais) if (!todas.some((x) => x.inicio === p.inicio)) todas.push(p);
    return todas.sort((a, b) => Date.parse(a.inicio) - Date.parse(b.inicio));
  }, [visao, pausasLocais]);

  const resumo = visao.tipo === 'dia' && visao.pontos.length > 0 ? resumoDoDia({ pontos: visao.pontos, pausas, hoje: ehHoje, agora, fuso }) : null;

  return (
    <Screen testID="meu-trajeto.tela" cabecalho={{ titulo: 'Meu trajeto', voltar: { label: 'Perfil', fallback: '/profile' } }}>
      <View style={styles.dia}>
        <Pressable accessibilityRole="button" accessibilityLabel="Dia anterior" disabled={!diaAnteriorPermitido(dia, hoje)} onPress={() => setData(deslocarDia(dia, -1))} style={[styles.seta, !diaAnteriorPermitido(dia, hoje) && styles.desligada]} testID="meu-trajeto.dia-anterior">
          <View style={styles.voltar}>
            <Icon name="chevron" size={20} color={colors.ink} />
          </View>
        </Pressable>
        <Text style={t.bodyStrong} accessibilityLiveRegion="polite" testID="meu-trajeto.dia">
          {rotuloDoDia(dia, hoje)}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Próximo dia" disabled={ehHoje} onPress={() => setData(deslocarDia(dia, 1))} style={[styles.seta, ehHoje && styles.desligada]} testID="meu-trajeto.dia-proximo">
          <Icon name="chevron" size={20} color={colors.ink} />
        </Pressable>
      </View>

      {visao.tipo === 'carregando' ? <Loading embutido testID="meu-trajeto.carregando" /> : null}
      {visao.tipo === 'sem_sinal' ? <EstadoVazio icone="wifiOff" titulo="Sem sinal" texto="Os dias anteriores aparecem com sinal. O de hoje está no aparelho." testID="meu-trajeto.sem-sinal" /> : null}
      {visao.tipo === 'erro' ? <EstadoVazio icone="alert" titulo="Não deu para carregar o dia" acao={{ rotulo: 'Tentar de novo', onPress: () => void carregar(), testID: 'meu-trajeto.tentar-de-novo' }} testID="meu-trajeto.erro" /> : null}
      {visao.tipo === 'dia' && !resumo ? <EstadoVazio icone="pin" titulo="Nada registrado neste dia" testID="meu-trajeto.vazio" /> : null}

      {visao.tipo === 'dia' && resumo ? (
        <>
          <MapaDoDia pontos={visao.pontos} pausas={pausas} ehHoje={ehHoje} km={resumo.km} titulo={resumo.titulo} linhas={resumo.linhas.map((l) => l.texto)} />
          <Cartao preenchimento={4}>
            <View style={styles.resumo}>
              <Text style={t.sub}>{resumo.titulo}</Text>
              <Text style={styles.km} testID="meu-trajeto.km">
                {resumo.km}
              </Text>
            </View>
            {resumo.linhas.map((l, i) => (
              <View key={i} style={styles.linha} testID={`meu-trajeto.linha.${i}`}>
                <View style={[styles.marca, l.tipo === 'inicio' ? styles.marcaVazia : l.tipo === 'pausa' ? styles.marcaPausa : styles.marcaCheia]} />
                <Text style={t.body}>{l.texto}</Text>
              </View>
            ))}
          </Cartao>
        </>
      ) : null}
      {visao.tipo === 'erro' || visao.tipo === 'sem_sinal' ? <Botao rotulo="Atualizar" onPress={() => void carregar()} testID="meu-trajeto.atualizar" /> : null}
    </Screen>
  );
}


function MapaDoDia({ pontos, pausas, ehHoje, km, titulo, linhas }: { pontos: PontoDoTrajeto[]; pausas: PausaDoDia[]; ehHoje: boolean; km: string; titulo: string; linhas: string[] }) {
  const falado = `${ehHoje ? 'Trajeto de hoje' : 'Trajeto do dia'}: ${km}${titulo === 'Km até agora' ? ' até agora' : ''}${linhas.length > 0 ? `, ${linhas.map((l) => l.toLowerCase().replace('–', ' a ')).join(', ')}` : ''}`;
  return <MapaTrajeto pontos={pontos} pausas={pausas} ultimoDeHoje={ehHoje} leitura={falado} />;
}

const styles = StyleSheet.create({
  dia: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  seta: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  desligada: { opacity: 0.35 },
  voltar: { transform: [{ rotate: '180deg' }] },
  resumo: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 },
  km: { ...fonte.bold, fontSize: 28, color: colors.ink, fontVariant: ['tabular-nums'] },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44, paddingHorizontal: 12 },
  marca: { width: 12, height: 12, borderRadius: 6 },
  marcaVazia: { borderWidth: 3, borderColor: colors.faixa, backgroundColor: colors.surface },
  marcaCheia: { backgroundColor: colors.faixa },
  marcaPausa: { borderWidth: 2, borderColor: colors.ink3, borderStyle: 'dashed', backgroundColor: colors.surface },
});
