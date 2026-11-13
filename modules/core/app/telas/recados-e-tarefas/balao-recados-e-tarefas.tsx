/**
 * Lista do balão do sino (T-0170; desenho `docs/desenho/tarefas-consultor.md` §7.2; imagem
 * `2026-11-12-T0170-final-inicio-sino-aberto.png`): recados não lidos e tarefas a fazer, no máximo 5, e "Ver todos".
 * Só o conteúdo: o sino, o balão flutuante (posição, sombra, fundo escurecido) e as rotas são do shell (engenheiro-apps), que
 * passa `onVerTodos` e `abrirTarefa`. Tocar num item marca como lido e abre o recado ou a tarefa.
 */
import { linkInternoNavegavel } from '@macuxi/platform-sdk';
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { colors, fonts, LinkTexto, Pressionavel, space } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { linhasDoBalao, type LinhaDoBalao } from './linhas-recados-e-tarefas';
import { CaixaDeMarcar, IconeRecado } from './pecas';
import { useRecadosETarefas } from './usar-recados-e-tarefas';

export function BalaoRecadosETarefas({ onVerTodos, abrirTarefa, onFechar }: { onVerTodos: () => void; abrirTarefa: (tarefaId: string) => void; /** O shell fecha o balão depois do toque. */ onFechar?: () => void }) {
  const r = useRecadosETarefas();
  const visao = useVisaoShell();
  const linhas = useMemo(() => linhasDoBalao(r.itens, r.contexto), [r.itens, r.contexto]);

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
      {linhas.map((l) => (
        <Pressionavel key={l.id} testID={`balao-item-${l.id}`} accessibilityRole="button" accessibilityLabel={l.leitura} onPress={() => abrir(l)} style={s.linha}>
          {l.caixa ? <CaixaDeMarcar estado={l.caixa} /> : l.icone ? <IconeRecado icone={l.icone} tamanho={28} /> : null}
          <View style={s.textos}>
            <Text style={l.forte ? s.tituloForte : s.tituloNormal} numberOfLines={1}>
              {l.titulo}
            </Text>
            <Text style={s.apoio} numberOfLines={1}>
              {l.apoio}
            </Text>
          </View>
        </Pressionavel>
      ))}
      <View style={s.rodape}>
        <LinkTexto
          testID="balao-ver-todos"
          rotulo="Ver todos"
          rotuloAcessivel="Ver todos os recados e tarefas"
          onPress={() => {
            onFechar?.();
            onVerTodos();
          }}
        />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  titulo: { fontFamily: fonts.displayBold, fontSize: 17, color: colors.ink, paddingHorizontal: space.xl, paddingTop: space.lg, paddingBottom: space.sm },
  linha: { flexDirection: 'row', alignItems: 'center', gap: space.md, paddingHorizontal: space.xl, paddingVertical: space.md, minHeight: 56, borderTopWidth: 1, borderTopColor: colors.line },
  textos: { flex: 1, gap: space.xxs },
  tituloForte: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink },
  tituloNormal: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  apoio: { fontFamily: fonts.body, fontSize: 14, color: colors.ink2 },
  rodape: { alignItems: 'center', borderTopWidth: 1, borderTopColor: colors.line, paddingVertical: space.xs },
});
