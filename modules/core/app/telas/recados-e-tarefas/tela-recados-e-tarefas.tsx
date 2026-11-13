/**
 * "Recados e tarefas" do app Campo (T-0170; desenho `docs/desenho/tarefas-consultor.md` §7.2; imagem
 * `2026-11-12-T0170-final-recados-e-tarefas.png`). Lista única, offline, com o filtro Todos · Recados · Tarefas.
 * RD-0211: a linha do recado não tem o chip "Não lida" nem "Leitura não enviada"; o não lido é o negrito e o ponto da tag.
 * Tocar no recado marca como lido e segue o link interno; tocar na tarefa abre o detalhe (rota do shell, `abrirTarefa`); a caixa
 * da tarefa simples marca e desmarca ali mesmo (D4: só enquanto não sincronizou).
 */
import { linkInternoNavegavel } from '@macuxi/platform-sdk';
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { colors, EstadoVazio, fonts, Icon, Pressionavel, radius, Screen, Segmentado, space, type as t } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { filtrarItens, linhaDoItem, OPCOES_FILTRO, type FiltroRecados, type ItemDaTela, type LinhaDaLista } from './linhas-recados-e-tarefas';
import { CaixaDeMarcar, IconeRecado, Tag } from './pecas';
import { useRecadosETarefas } from './usar-recados-e-tarefas';

const VAZIO: Record<FiltroRecados, string> = {
  todos: 'Nenhum recado ou tarefa',
  recados: 'Nenhum recado',
  tarefas: 'Nenhuma tarefa',
};

export function TelaRecadosETarefas({ abrirTarefa, filtroInicial = 'todos' }: { abrirTarefa: (tarefaId: string) => void; filtroInicial?: FiltroRecados }) {
  const r = useRecadosETarefas();
  const visao = useVisaoShell();
  const [filtro, setFiltro] = useState<FiltroRecados>(filtroInicial);
  const visiveis = useMemo(() => filtrarItens(r.itens, filtro), [r.itens, filtro]);

  const abrir = (item: ItemDaTela) => {
    void r.marcarLido(item);
    if (item.tipo === 'tarefa') return abrirTarefa(item.id);
    const destino = linkInternoNavegavel(item.notificacao.link ?? null, (c) => visao.pagina(c) !== null);
    if (destino) router.navigate(destino as never);
  };
  const tocarNaCaixa = (item: ItemDaTela) => {
    if (item.tipo !== 'tarefa') return;
    if (item.conclusao_pendente) return void r.desmarcar(item.id);
    if (item.tarefa.tipo === 'simples') return void r.concluir(item.id);
    abrir(item); // foto e pesquisa concluem no detalhe
  };

  return (
    <Screen testID="recados.tela">
      <Pressionavel testID="recados-voltar" accessibilityRole="button" accessibilityLabel="Voltar" onPress={() => (router.canGoBack() ? router.back() : router.navigate('/' as never))} style={s.titulo}>
        <Icon name="back" size={22} color={colors.ink} strokeWidth={2.4} />
        <Text style={t.h1} accessibilityRole="header">
          Recados e tarefas
        </Text>
      </Pressionavel>

      <Segmentado testID="recados-filtro" opcoes={OPCOES_FILTRO} valor={filtro} onChange={setFiltro} rotuloAcessivel="Mostrar" />

      {r.carregado && visiveis.length === 0 ? (
        <EstadoVazio testID="recados-vazio" icone="inbox" titulo={VAZIO[filtro]} />
      ) : visiveis.length > 0 ? (
        <View style={s.lista} testID="recados-lista">
          {visiveis.map((item, i) => (
            <Linha key={item.id} linha={linhaDoItem(item, r.contexto)} primeira={i === 0} onPress={() => abrir(item)} onCaixa={() => tocarNaCaixa(item)} />
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function Linha({ linha: l, primeira, onPress, onCaixa }: { linha: LinhaDaLista; primeira: boolean; onPress: () => void; onCaixa: () => void }) {
  const corApoio = l.tomDoApoio === 'atrasada' ? colors.danger : l.tomDoApoio === 'apagado' ? colors.ink3 : colors.ink2;
  return (
    <Pressionavel testID={`recados-item-${l.id}`} accessibilityRole="button" accessibilityLabel={l.leitura} onPress={onPress} style={[s.linha, !primeira && s.divisor]}>
      {l.caixa ? (
        <CaixaDeMarcar estado={l.caixa} onPress={onCaixa} rotulo={l.caixa === 'feita' ? `Desmarcar ${l.titulo}` : `Marcar ${l.titulo} como feita`} testID={`recados-caixa-${l.id}`} />
      ) : l.icone ? (
        <IconeRecado icone={l.icone} />
      ) : null}
      <View style={s.textos}>
        <Text style={[l.forte ? s.tituloForte : s.tituloNormal, l.riscado && s.riscado]} numberOfLines={2}>
          {l.titulo}
        </Text>
        <Text style={[s.apoio, { color: corApoio }]} numberOfLines={l.linhasDoApoio}>
          {l.apoio}
        </Text>
      </View>
      <Tag texto={l.tag.texto} destaque={l.tag.destaque} />
    </Pressionavel>
  );
}

const s = StyleSheet.create({
  titulo: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48, alignSelf: 'flex-start' },
  lista: { backgroundColor: colors.surface, borderRadius: radius.secao, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  linha: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.lg, minHeight: 56 },
  divisor: { borderTopWidth: 1, borderTopColor: colors.line },
  textos: { flex: 1, gap: space.xxs },
  tituloForte: { fontFamily: fonts.semibold, fontSize: 16, color: colors.ink },
  tituloNormal: { fontFamily: fonts.body, fontSize: 16, color: colors.ink },
  riscado: { textDecorationLine: 'line-through', color: colors.ink3 },
  apoio: { fontFamily: fonts.body, fontSize: 14 },
});
