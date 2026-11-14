/**
 * Lista do balão do sino, layout B (T-0170; decisão do dono 14/11): até 3 linhas com seta à direita, "novo" só pelo negrito, "Ver todos" sempre.
 * Só o conteúdo: o sino, o balão flutuante (posição, sombra, fundo escurecido) e as rotas são do shell (engenheiro-apps), que
 * passa `onVerTodos` e `abrirTarefa`. Tocar num item marca como lido e abre o recado ou a tarefa.
 */
import { linkInternoNavegavel } from '@macuxi/platform-sdk';
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { ALVO_TOQUE, colors, fonts, Icon, Pressionavel, space } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { linhasDoBalao, type LinhaDoBalao } from './linhas-recados-e-tarefas';
import { IconeDoBalaoRedondo } from './pecas';
import { useRecadosETarefas } from './usar-recados-e-tarefas';

export function BalaoRecadosETarefas({
  onVerTodos,
  abrirTarefa,
  onFechar,
}: {
  onVerTodos: () => void;
  abrirTarefa: (tarefaId: string) => void;
  /** O shell fecha o balão depois do toque. */ onFechar?: () => void;
}) {
  const r = useRecadosETarefas();
  const visao = useVisaoShell();
  const { linhas, vazio } = useMemo(() => linhasDoBalao(r.itens, r.contexto), [r.itens, r.contexto]);

  const abrir = (l: LinhaDoBalao) => {
    const item = r.itens.find((i) => i.id === l.id);
    if (!item) return;
    void r.marcarLido(item);
    onFechar?.();
    if (item.tipo === 'tarefa') return abrirTarefa(item.id);
    const destino = linkInternoNavegavel(item.notificacao.link ?? null, (c) => visao.pagina(c) !== null);
    if (destino) router.navigate(destino as never);
  };

  return (
    <View testID="balao-recados">
      <Text style={s.titulo} accessibilityRole="header">
        Recados e tarefas
      </Text>
      {vazio ? (
        <View style={s.linha} testID="balao-vazio">
          <IconeDoBalaoRedondo icone="ok" />
          <Text style={s.tituloForte}>Tudo em dia</Text>
        </View>
      ) : null}
      {linhas.map((l, n) => (
        <Pressionavel
          key={l.id}
          testID={`balao-item-${l.id}`}
          accessibilityRole="button"
          accessibilityLabel={l.leitura}
          onPress={() => abrir(l)}
          style={[s.linha, n > 0 && s.separada]}
        >
          <IconeDoBalaoRedondo icone={l.icone} />
          <View style={s.textos}>
            <Text style={l.forte ? s.tituloForte : s.tituloNormal} numberOfLines={1}>
              {l.titulo}
            </Text>
            <Text style={l.vencida ? s.apoioVencida : s.apoio} numberOfLines={1}>
              {l.apoio}
            </Text>
          </View>
          <Icon name="chevron" size={20} color={colors.ink2} strokeWidth={2} />
        </Pressionavel>
      ))}
      <Pressionavel
        testID="balao-ver-todos"
        accessibilityRole="button"
        accessibilityLabel="Ver todos os recados e tarefas"
        onPress={() => {
          onFechar?.();
          onVerTodos();
        }}
        style={s.rodape}
      >
        <Text style={s.verTodos}>Ver todos</Text>
        <Icon name="chevron" size={20} color={colors.ink} strokeWidth={2} />
      </Pressionavel>
    </View>
  );
}

const s = StyleSheet.create({
  titulo: {
    fontFamily: fonts.displayBold,
    fontSize: 17,
    color: colors.ink,
    paddingHorizontal: space.lg,
    paddingTop: space.lg,
    paddingBottom: space.sm,
  },
  linha: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    minHeight: 60,
  },
  separada: { borderTopWidth: 1, borderTopColor: colors.line },
  textos: { flex: 1, gap: space.xxs },
  tituloForte: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  tituloNormal: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  apoio: { fontFamily: fonts.body, fontSize: 14, color: colors.ink2 },
  apoioVencida: { fontFamily: fonts.body, fontSize: 14, color: colors.danger },
  rodape: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    minHeight: ALVO_TOQUE,
    paddingHorizontal: space.lg,
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  verTodos: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
});
