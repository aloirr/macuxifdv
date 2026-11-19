/**
 * Trajeto do dia da pessoa de campo na ficha (T-0156, tracking §7 e §9). Os pontos são desenhados AQUI, no aparelho, com
 * `desenharTrajeto`: nenhum provedor de mapa recebe o trajeto. Sem a permissão `core.trajeto.ver_equipe` a seção some;
 * sem pontos (o tracking vem desligado de fábrica) mostra só o estado vazio. Nenhuma coordenada vai para log, erro ou telemetria.
 */
import { colors, Cartao, radius, type as t } from '@macuxi/ui/mobile';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import type { TrajetoEquipe } from '../../contracts';
import { desenharTrajeto } from '../../domain/trajeto';

const LARGURA = 320;
const ALTURA = 200;

export function TrajetoDoDia({ usuarioId, tz, buscar }: { usuarioId: string; tz: string; buscar: (id: string) => Promise<{ trajeto: TrajetoEquipe | null; negado: boolean; erro: string | null }> }) {
  const [r, setR] = useState<{ trajeto: TrajetoEquipe | null; negado: boolean; erro: string | null } | null>(null);
  useEffect(() => {
    let vivo = true;
    void buscar(usuarioId).then((x) => vivo && setR(x));
    return () => {
      vivo = false;
    };
  }, [usuarioId, buscar]);
  const d = useMemo(() => (r?.trajeto ? desenharTrajeto(r.trajeto.trajeto.pontos, { largura: LARGURA, altura: ALTURA, margem: 16, fuso: tz }) : null), [r, tz]);

  if (!r || r.negado) return null;
  return (
    <Cartao preenchimento={14} gap={8} testID="gestor-trajeto">
      <Text style={t.h2}>Trajeto do dia</Text>
      {r.erro ? <Text style={t.small}>{r.erro}</Text> : null}
      {d?.vazio ? <Text style={t.body}>Sem trajeto neste dia.</Text> : null}
      {d && !d.vazio && r.trajeto ? (
        <>
          <View accessible accessibilityLabel={`Trajeto do dia com ${d.total} pontos, de ${d.primeiro!.hora} a ${d.ultimo!.hora}`} style={{ borderRadius: radius.secao, overflow: 'hidden', backgroundColor: colors.mapBg, borderWidth: 1, borderColor: colors.mapBorder }}>
            <Svg width="100%" height={ALTURA} viewBox={`0 0 ${LARGURA} ${ALTURA}`}>
              <Polyline points={d.linha.map((p) => `${p.x},${p.y}`).join(' ')} stroke={colors.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
              <Circle cx={d.primeiro!.x} cy={d.primeiro!.y} r={7} fill={colors.surface} stroke={colors.accent} strokeWidth={2} />
              <Circle cx={d.ultimo!.x} cy={d.ultimo!.y} r={16} fill={colors.accent} />
            </Svg>
          </View>
          <Linha rotulo="Primeiro ponto" valor={d.primeiro!.hora} />
          <Linha rotulo="Último ponto" valor={d.ultimo!.hora} />
          <Linha rotulo="Percorrido" valor={`${(r.trajeto.trajeto.metros / 1000).toFixed(1).replace('.', ',')} km`} />
        </>
      ) : null}
    </Cartao>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', minHeight: 24 }}>
      <Text style={t.body}>{rotulo}</Text>
      <Text style={t.bodyStrong}>{valor}</Text>
    </View>
  );
}
