/**
 * Filtro de período da lista de Pedidos, modelo A (T-0090; referência
 * docs/produto/referencias/R-20261106-064752-alexandre-filtro-periodo.png; spec docs/design/pedidos-filtro-periodo.md):
 * - `BotaoFiltro`: o funil ao lado da busca (48 × 48 dp), com selo laranja do número de filtros ativos;
 * - `EtiquetaFiltro`: a etiqueta do filtro ativo ("Este mês ✕"); tocar remove;
 * - `FolhaPeriodo`: a folha "Período" sobre a `Folha` do kit: atalhos (tocar aplica e fecha), "Escolher dia, mês ou ano ›"
 *   com as abas Dia (calendário), Mês (grade com ‹ ano ›) e Ano, e o "Limpar". O Gestão passa o filtro de vendedor em `extra`.
 * Nenhum texto fixo (rótulos por props; nomes de mês e iniciais da semana de `periodo.ts`). Sem regra: o módulo diz qual
 * período cada atalho vale e filtra a lista. Datas civis já no fuso do tenant.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Botao } from './base';
import { ALVO_TOQUE } from './componentes';
import { Folha } from './folha';
import { Segmentado } from './formulario';
import { Icon } from './icon';
import { Pressionavel } from './movimento-rn';
import {
  anosAte,
  celulaMarcada,
  depoisDeHoje,
  estadoAoAbrirFolha,
  eventoDaFolha,
  gradeDoMes,
  INICIAIS_SEMANA,
  leituraDoBotaoFiltro,
  leituraDoDia,
  leituraDoMes,
  MESES_ABREVIADOS,
  mesesDoAno,
  textoDoSelo,
  tituloDoMes,
  type EscolhaPeriodo,
  type EstadoFolhaPeriodo,
  type EventoFolhaPeriodo,
} from './periodo';
import { colors, fonts, radius } from './theme';

// ---------- BotaoFiltro ----------
export function BotaoFiltro({ contagem, onPress, rotulo, testID = 'filtro' }: { contagem: number; onPress: () => void; /** "Filtrar" (o leitor lê "Filtrar, 1 filtro ativo"). */ rotulo: string; testID?: string }) {
  const selo = textoDoSelo(contagem);
  return (
    <Pressionavel testID={testID} accessibilityRole="button" accessibilityLabel={leituraDoBotaoFiltro(rotulo, contagem)} onPress={onPress} style={[s.botao, selo ? s.botaoAtivo : null]}>
      <Icon name="filtro" size={20} color={colors.ink} strokeWidth={2} />
      {selo ? (
        <View style={s.selo} testID={`${testID}-selo`} importantForAccessibility="no-hide-descendants">
          <Text style={s.seloTexto}>{selo}</Text>
        </View>
      ) : null}
    </Pressionavel>
  );
}

// ---------- EtiquetaFiltro ----------
const ALTURA_ETIQUETA = 32;
/** Alvo de toque da etiqueta removível (a pílula de 32 dp fica centrada nele). */
const ALVO_ETIQUETA = 44;

export function EtiquetaFiltro({
  texto,
  onRemover,
  rotuloRemover,
  testID = 'etiqueta',
}: {
  /** "Este mês", "Seg, 02/11/2026", "Aprovados". */
  texto: string;
  /** Sem `onRemover`, a etiqueta é só leitura (sem ✕). */
  onRemover?: () => void;
  /** Leitura do toque ("Remover filtro Este mês"). */
  rotuloRemover?: string;
  testID?: string;
}) {
  if (!onRemover) {
    return (
      <View style={s.etiqueta} testID={testID} accessible accessibilityLabel={texto}>
        <Text style={s.etiquetaTexto} numberOfLines={1}>
          {texto}
        </Text>
      </View>
    );
  }
  // pílula de 32 dp dentro de um alvo de 44 dp (sem folga de toque: no Android ela não passa da borda do pai)
  return (
    <Pressionavel testID={testID} accessibilityRole="button" accessibilityLabel={rotuloRemover ?? texto} onPress={onRemover} style={s.etiquetaAlvo}>
      <View style={s.etiqueta}>
        <Text style={s.etiquetaTexto} numberOfLines={1}>
          {texto}
        </Text>
        <Icon name="close" size={14} color={colors.accentInk} strokeWidth={2.6} />
      </View>
    </Pressionavel>
  );
}

// ---------- FolhaPeriodo ----------
export interface AtalhoPeriodo {
  id: string;
  /** "Hoje", "Ontem", "Esta semana", "Este mês", "Mês passado", "Este ano". */
  rotulo: string;
  testID?: string;
}

export interface TextosFolhaPeriodo {
  /** "Período". */
  titulo: string;
  /** Leitura do fundo (toque fora fecha): "Fechar o filtro". */
  fechar: string;
  /** "Escolher dia, mês ou ano". */
  escolher: string;
  /** Volta da parte Dia/Mês/Ano aos atalhos: "Atalhos". */
  voltar: string;
  /** Abas: "Dia", "Mês", "Ano". */
  dia: string;
  mes: string;
  ano: string;
  /** Leitura das setas: "Mês anterior", "Próximo mês", "Ano anterior", "Próximo ano". */
  mesAnterior: string;
  proximoMes: string;
  anoAnterior: string;
  proximoAno: string;
  /** "Limpar" (volta ao padrão, Este mês). */
  limpar: string;
  /** Leitura extra do dia com pedido no calendário: "tem pedido". */
  diaComPedido?: string;
}

export function FolhaPeriodo({
  visivel,
  onFechar,
  textos,
  atalhos,
  atalhoAtivo,
  onAtalho,
  escolha,
  onEscolher,
  onLimpar,
  limparDesligado,
  hoje,
  anos,
  diasMarcados,
  ajuda,
  extra,
  testID = 'periodo',
}: {
  visivel: boolean;
  onFechar: () => void;
  textos: TextosFolhaPeriodo;
  atalhos: ReadonlyArray<AtalhoPeriodo>;
  /** Atalho em vigor (com ✓); null quando vale um dia, mês ou ano escolhido. */
  atalhoAtivo: string | null;
  /** Tocar no atalho: o kit chama `onAtalho` e depois `onFechar`. */
  onAtalho: (id: string) => void;
  /** Dia, mês ou ano em vigor; null quando vale um atalho. Com escolha, a folha abre direto em Dia/Mês/Ano. */
  escolha: EscolhaPeriodo | null;
  /** Tocar no dia, mês ou ano: o kit chama `onEscolher` e depois `onFechar`. */
  onEscolher: (e: EscolhaPeriodo) => void;
  /** "Limpar": volta ao padrão (Este mês). A folha fica aberta. */
  onLimpar: () => void;
  /** Já está no padrão: "Limpar" sem toque. */
  limparDesligado?: boolean;
  /** Hoje (AAAA-MM-DD, no fuso do tenant): dias, meses e anos depois dele ficam sem toque. */
  hoje: string;
  /** Anos da aba Ano (padrão: os 5 últimos). */
  anos?: ReadonlyArray<string>;
  /** Dias (AAAA-MM-DD) com pedido, marcados com um ponto no calendário. */
  diasMarcados?: ReadonlyArray<string>;
  /** Linha curta embaixo da parte Dia/Mês/Ano (ex.: o aviso do servidor fora dos 90 dias do aparelho). */
  ajuda?: string | null;
  /** Gestão: filtro de vendedor, embaixo dos atalhos. */
  extra?: ReactNode;
  testID?: string;
}) {
  const [estado, setEstado] = useState<EstadoFolhaPeriodo>(() => estadoAoAbrirFolha(escolha, hoje));
  // ao abrir, volta ao estado da escolha em vigor (só na abertura: depende só de `visivel`)
  useEffect(() => {
    if (visivel) setEstado(estadoAoAbrirFolha(escolha, hoje));
  }, [visivel]);
  // cada toque passa por `eventoDaFolha` (puro, testado): aqui só se executa o resultado
  const tocar = (evento: EventoFolhaPeriodo) => {
    const r = eventoDaFolha(estado, evento, hoje);
    setEstado(r.estado);
    if (r.atalho !== undefined) onAtalho(r.atalho);
    if (r.escolha) onEscolher(r.escolha);
    if (r.limpar) onLimpar();
    if (r.fechar) onFechar();
  };
  const escolher = (e: EscolhaPeriodo) => tocar({ tipo: 'celula', escolha: e });
  const { modo, aba, mesVisto, anoVisto } = estado;
  const listaDeAnos = anos ?? anosAte(hoje.slice(0, 4));
  const marcados = new Set(diasMarcados ?? []);

  return (
    <Folha visivel={visivel} onFechar={onFechar} rotuloFechar={textos.fechar} titulo={textos.titulo} rolavel testID={testID}>
      {modo === 'atalhos' ? (
        <View testID={`${testID}-atalhos`}>
          <View accessibilityRole="radiogroup" accessibilityLabel={textos.titulo}>
            {atalhos.map((a, i) => {
              const on = a.id === atalhoAtivo;
              return (
                <Pressionavel
                  key={a.id}
                  testID={a.testID ?? `${testID}-${a.id}`}
                  accessibilityRole="radio"
                  accessibilityLabel={a.rotulo}
                  accessibilityState={{ checked: on }}
                  escala={false}
                  onPress={() => tocar({ tipo: 'atalho', id: a.id })}
                  style={[s.atalho, i > 0 && s.divisor]}>
                  <Text style={[s.atalhoTexto, on && s.atalhoTextoOn]}>{a.rotulo}</Text>
                  {on ? <Icon name="check" size={18} color={colors.accent} strokeWidth={2.6} /> : null}
                </Pressionavel>
              );
            })}
          </View>
          <Pressionavel
            testID={`${testID}-escolher`}
            accessibilityRole="button"
            accessibilityLabel={textos.escolher}
            escala={false}
            onPress={() => tocar({ tipo: 'abrirEscolha' })}
            style={[s.atalho, s.divisor]}>
            <Text style={s.escolherTexto}>{textos.escolher}</Text>
            <Icon name="chevron" size={18} color={colors.accentInk} strokeWidth={2.4} />
          </Pressionavel>
          {extra ? <View style={s.extra}>{extra}</View> : null}
        </View>
      ) : (
        <View style={s.escolher} testID={`${testID}-escolha`}>
          <Pressionavel testID={`${testID}-voltar`} accessibilityRole="button" accessibilityLabel={textos.voltar} escala={false} onPress={() => tocar({ tipo: 'voltar' })} style={s.voltar}>
            <Icon name="back" size={16} color={colors.ink2} strokeWidth={2.4} />
            <Text style={s.voltarTexto}>{textos.voltar}</Text>
          </Pressionavel>
          <Segmentado
            opcoes={[
              { id: 'dia', rotulo: textos.dia, testID: `${testID}-aba-dia` },
              { id: 'mes', rotulo: textos.mes, testID: `${testID}-aba-mes` },
              { id: 'ano', rotulo: textos.ano, testID: `${testID}-aba-ano` },
            ]}
            valor={aba}
            onChange={(nova) => tocar({ tipo: 'aba', aba: nova })}
            compacto
            testID={`${testID}-abas`}
          />
          {aba === 'dia' ? (
            <View testID={`${testID}-dia`} style={s.bloco}>
              <Navegador
                titulo={tituloDoMes(mesVisto)}
                rotuloAnterior={textos.mesAnterior}
                rotuloProximo={textos.proximoMes}
                onAnterior={() => tocar({ tipo: 'mesVisto', passo: -1 })}
                onProximo={() => tocar({ tipo: 'mesVisto', passo: 1 })}
                proximoDesligado={mesVisto >= hoje.slice(0, 7)}
                testID={`${testID}-mes-visto`}
              />
              <View style={s.semana} importantForAccessibility="no-hide-descendants">
                {INICIAIS_SEMANA.map((d, i) => (
                  <Text key={i} style={s.semanaTexto}>
                    {d}
                  </Text>
                ))}
              </View>
              {gradeDoMes(mesVisto).map((semana, i) => (
                <View key={i} style={s.semana}>
                  {semana.map((dia, j) => {
                    if (!dia) return <View key={j} style={s.diaVazio} />;
                    const cel: EscolhaPeriodo = { tipo: 'dia', valor: dia };
                    const on = celulaMarcada(cel, escolha);
                    const off = depoisDeHoje(cel, hoje);
                    const temPedido = marcados.has(dia);
                    const leitura = temPedido && textos.diaComPedido ? `${leituraDoDia(dia)}, ${textos.diaComPedido}` : leituraDoDia(dia);
                    return (
                      <Pressionavel
                        key={j}
                        testID={`${testID}-dia-${dia}`}
                        accessibilityRole="button"
                        accessibilityLabel={leitura}
                        accessibilityState={{ selected: on, disabled: off }}
                        disabled={off}
                        escala={false}
                        onPress={() => escolher(cel)}
                        style={[s.dia, dia === hoje && s.diaHoje, on && s.celulaOn]}>
                        <Text style={[s.diaTexto, on && s.celulaTextoOn, off && s.celulaTextoOff]}>{Number(dia.slice(8, 10))}</Text>
                        {temPedido ? <View style={[s.ponto, on && s.pontoOn]} /> : null}
                      </Pressionavel>
                    );
                  })}
                </View>
              ))}
            </View>
          ) : aba === 'mes' ? (
            <View testID={`${testID}-mes`} style={s.bloco}>
              <Navegador
                titulo={anoVisto}
                rotuloAnterior={textos.anoAnterior}
                rotuloProximo={textos.proximoAno}
                onAnterior={() => tocar({ tipo: 'anoVisto', passo: -1 })}
                onProximo={() => tocar({ tipo: 'anoVisto', passo: 1 })}
                proximoDesligado={anoVisto >= hoje.slice(0, 4)}
                testID={`${testID}-ano-visto`}
              />
              <Grade
                celulas={mesesDoAno(anoVisto).map((m) => ({ cel: { tipo: 'mes' as const, valor: m }, rotulo: MESES_ABREVIADOS[Number(m.slice(5, 7)) - 1] ?? m, leitura: leituraDoMes(m) }))}
                escolha={escolha}
                hoje={hoje}
                onEscolher={escolher}
                testID={`${testID}-mes`}
              />
            </View>
          ) : (
            <View testID={`${testID}-ano`} style={s.bloco}>
              <Grade celulas={listaDeAnos.map((a) => ({ cel: { tipo: 'ano' as const, valor: a }, rotulo: a, leitura: a }))} escolha={escolha} hoje={hoje} onEscolher={escolher} testID={`${testID}-ano`} />
            </View>
          )}
          {ajuda ? <Text style={s.ajuda}>{ajuda}</Text> : null}
        </View>
      )}
      <Botao nivel="neutro" rotulo={textos.limpar} onPress={() => tocar({ tipo: 'limpar' })} desligado={limparDesligado} testID={`${testID}-limpar`} />
    </Folha>
  );
}

function Navegador({
  titulo,
  rotuloAnterior,
  rotuloProximo,
  onAnterior,
  onProximo,
  proximoDesligado,
  testID,
}: {
  titulo: string;
  rotuloAnterior: string;
  rotuloProximo: string;
  onAnterior: () => void;
  onProximo: () => void;
  proximoDesligado?: boolean;
  testID: string;
}) {
  return (
    <View style={s.navegador}>
      <Pressionavel testID={`${testID}-anterior`} accessibilityRole="button" accessibilityLabel={rotuloAnterior} onPress={onAnterior} style={s.seta}>
        <Icon name="back" size={20} color={colors.ink} strokeWidth={2.4} />
      </Pressionavel>
      <Text style={s.navegadorTitulo} testID={testID} accessibilityRole="header">
        {titulo}
      </Text>
      <Pressionavel
        testID={`${testID}-proximo`}
        accessibilityRole="button"
        accessibilityLabel={rotuloProximo}
        accessibilityState={{ disabled: Boolean(proximoDesligado) }}
        disabled={proximoDesligado}
        onPress={onProximo}
        style={[s.seta, proximoDesligado && s.desligado]}>
        <Icon name="chevron" size={20} color={colors.ink} strokeWidth={2.4} />
      </Pressionavel>
    </View>
  );
}

function Grade({
  celulas,
  escolha,
  hoje,
  onEscolher,
  testID,
}: {
  celulas: ReadonlyArray<{ cel: EscolhaPeriodo; rotulo: string; leitura: string }>;
  escolha: EscolhaPeriodo | null;
  hoje: string;
  onEscolher: (e: EscolhaPeriodo) => void;
  testID: string;
}) {
  return (
    <View style={s.grade}>
      {celulas.map(({ cel, rotulo, leitura }) => {
        const on = celulaMarcada(cel, escolha);
        const off = depoisDeHoje(cel, hoje);
        return (
          <Pressionavel
            key={cel.valor}
            testID={`${testID}-${cel.valor}`}
            accessibilityRole="button"
            accessibilityLabel={leitura}
            accessibilityState={{ selected: on, disabled: off }}
            disabled={off}
            escala={false}
            onPress={() => onEscolher(cel)}
            style={[s.celula, on && s.celulaOn, off && s.celulaOff]}>
            <Text style={[s.celulaTexto, on && s.celulaTextoOn, off && s.celulaTextoOff]}>{rotulo}</Text>
          </Pressionavel>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  desligado: { opacity: 0.45 },
  // .fbtn
  botao: { width: ALVO_TOQUE, height: ALVO_TOQUE, borderRadius: 11, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  botaoAtivo: { borderColor: colors.ink, borderWidth: 1.5 },
  selo: { position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, backgroundColor: colors.grafico, borderWidth: 2, borderColor: colors.ground, alignItems: 'center', justifyContent: 'center' },
  seloTexto: { fontFamily: fonts.bold, fontSize: 11, color: colors.onAccent, fontVariant: ['tabular-nums'] },
  // .tag
  etiquetaAlvo: { alignSelf: 'flex-start', minHeight: ALVO_ETIQUETA, justifyContent: 'center' },
  etiqueta: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, height: ALTURA_ETIQUETA, paddingHorizontal: 12, borderRadius: radius.pilula, backgroundColor: colors.accentSoft },
  etiquetaTexto: { fontFamily: fonts.bold, fontSize: 13, color: colors.accentInk },
  // .opt
  atalho: { minHeight: ALVO_TOQUE, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 2 },
  divisor: { borderTopWidth: 1, borderTopColor: colors.line },
  atalhoTexto: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  atalhoTextoOn: { fontFamily: fonts.bold },
  escolherTexto: { fontFamily: fonts.bold, fontSize: 15, color: colors.accentInk },
  extra: { marginTop: 8, gap: 8 },
  // Dia / Mês / Ano
  escolher: { gap: 10 },
  voltar: { alignSelf: 'flex-start', minHeight: ALVO_TOQUE, paddingRight: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  voltarTexto: { fontFamily: fonts.semibold, fontSize: 14, color: colors.ink2 },
  bloco: { gap: 4 },
  navegador: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  navegadorTitulo: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink },
  seta: { width: ALVO_TOQUE, height: ALVO_TOQUE, alignItems: 'center', justifyContent: 'center' },
  semana: { flexDirection: 'row', justifyContent: 'space-between' },
  semanaTexto: { flex: 1, textAlign: 'center', fontFamily: fonts.semibold, fontSize: 11, color: colors.ink3 },
  diaVazio: { flex: 1, height: 44 },
  dia: { flex: 1, height: 44, marginHorizontal: 1, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  diaHoje: { borderWidth: 1.5, borderColor: colors.accent },
  diaTexto: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink, fontVariant: ['tabular-nums'] },
  ponto: { position: 'absolute', bottom: 5, width: 4, height: 4, borderRadius: 2, backgroundColor: colors.accent },
  pontoOn: { backgroundColor: colors.surface },
  grade: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  celula: { width: '23.5%', height: ALVO_TOQUE, borderRadius: 9, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  celulaOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  celulaOff: { backgroundColor: colors.ground, borderColor: colors.lineSoft },
  celulaTexto: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink },
  celulaTextoOn: { fontFamily: fonts.bold, color: colors.surface },
  celulaTextoOff: { color: colors.inkDisabled },
  ajuda: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, color: colors.ink2 },
});
