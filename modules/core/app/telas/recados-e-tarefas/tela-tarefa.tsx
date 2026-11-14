/**
 * Detalhe da tarefa (T-0170; desenho `docs/desenho/tarefas-consultor.md` §7.2; RN-CORE-TAR-04, 05, 06 e 11). Offline.
 * - simples: "Marcar como feita"; foto: "Tirar foto" (até 5) e "Concluir com n fotos"; pesquisa: "Responder pesquisa" (a tela da
 *   Pesquisa conclui a tarefa pela resposta, RN-CORE-TAR-03);
 * - observação opcional; "Desmarcar" só enquanto a conclusão não subiu (D4);
 * - o cliente abre o Cliente 360 só se estiver na carteira (RN-CORE-TAR-04).
 * A rota é do shell; ele passa `tarefaId` e, quando houver, `responderPesquisa` (consulta da Pesquisa, N-H).
 */
import { Botao, Cartao, colors, EstadoVazio, fonts, Icon, Pressionavel, radius, Screen, space, type as t } from '@macuxi/ui/mobile';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { TAREFA_FOTOS_MAX, TAREFA_OBSERVACAO_MAX } from '../../../contracts/tarefa';
import { capturarFotoFachada } from '../../lib/foto-fachada';
import { abrirCliente } from '../../lib/navegacao';
import { useCore } from '../../lib/usar-core';
import { detalheDaTarefa, rotuloConcluirComFotos, type ItemDaTela } from './linhas-recados-e-tarefas';
import { useRecadosETarefas } from './usar-recados-e-tarefas';

export interface PropsTelaTarefa {
  tarefaId: string;
  /** Abre a resposta da Pesquisa com o questionário e o cliente da tarefa; sem ela, o botão fica desligado. */
  responderPesquisa?: (p: { questionarioId: string; clienteId: string | null; tarefaId: string }) => void;
  /** Câmera do shell (padrão: a mesma captura registrada para o Core); devolve o id da foto ou null. */
  tirarFoto?: () => Promise<string | null>;
  /** Rota da lista "Recados e tarefas" (o voltar sem histórico), definida pelo shell. */
  rotaDaLista?: string;
}

export function TelaTarefa({ tarefaId, responderPesquisa, tirarFoto = capturarFotoFachada, rotaDaLista = '/' }: PropsTelaTarefa) {
  const r = useRecadosETarefas();
  const core = useCore();
  const [fotos, setFotos] = useState<string[]>([]);
  const [observacao, setObservacao] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const item = r.itens.find((i): i is Extract<ItemDaTela, { tipo: 'tarefa' }> => i.tipo === 'tarefa' && i.id === tarefaId) ?? null;
  const carteira = useMemo(() => new Set(core.estado.clientes.map((c) => c.id)), [core.estado.clientes]);
  const d = item ? detalheDaTarefa(item, { ...r.contexto, naCarteira: (id) => carteira.has(id), fotosMax: TAREFA_FOTOS_MAX }) : null;

  if (!item || !d) {
    return (
      <Screen testID="tarefa.tela" cabecalho={{ titulo: 'Tarefa', voltar: { label: 'Recados e tarefas', fallback: rotaDaLista, testID: 'tarefa-voltar' } }}>
        {r.carregado ? <EstadoVazio testID="tarefa-nao-encontrada" icone="inbox" titulo="Tarefa não encontrada" /> : null}
      </Screen>
    );
  }

  const agir = async (fn: () => Promise<unknown>) => {
    setOcupado(true);
    try {
      await fn();
    } finally {
      setOcupado(false);
    }
  };
  const concluir = () => agir(() => r.concluir(item.id, { fotoIds: fotos, observacao }));
  const foto = () =>
    agir(async () => {
      const id = await tirarFoto();
      if (id) setFotos((f) => (f.length < d.fotosMax ? [...f, id] : f));
    });
  const corApoio = d.tomDoApoio === 'atrasada' ? colors.danger : d.tomDoApoio === 'apagado' ? colors.ink3 : colors.ink2;

  return (
    <Screen testID="tarefa.tela" cabecalho={{ titulo: d.titulo, voltar: { label: 'Recados e tarefas', fallback: rotaDaLista, testID: 'tarefa-voltar' } }}>
      <Text style={[t.body, { color: corApoio }]} testID="tarefa-apoio">
        {d.apoio}
      </Text>

      {d.descricao || d.cliente ? (
        <Cartao gap={space.md}>
          {d.descricao ? <Text style={t.body}>{d.descricao}</Text> : null}
          {d.cliente ? (
            d.cliente.abre ? (
              <Pressionavel testID="tarefa-cliente" accessibilityRole="link" accessibilityLabel={`Abrir ${d.cliente.nome}`} onPress={() => abrirCliente(d.cliente!.id, 'tarefa')} style={s.cliente}>
                <Icon name="users" size={18} color={colors.ink2} />
                <Text style={[t.bodyStrong, { flex: 1 }]}>{d.cliente.nome}</Text>
                <Icon name="chevron" size={18} color={colors.ink} />
              </Pressionavel>
            ) : (
              <View style={s.cliente} testID="tarefa-cliente">
                <Icon name="users" size={18} color={colors.ink2} />
                <Text style={[t.bodyStrong, { flex: 1 }]}>{d.cliente.nome}</Text>
              </View>
            )
          ) : null}
        </Cartao>
      ) : null}

      {d.acao?.tipo === 'foto' && fotos.length > 0 ? (
        <Text style={t.sub} testID="tarefa-fotos">
          {fotos.length === 1 ? '1 foto' : `${fotos.length} fotos`} de até {d.fotosMax}
        </Text>
      ) : null}

      {d.acao && d.acao.tipo !== 'pesquisa' ? (
        <TextInput
          testID="tarefa-observacao"
          value={observacao}
          onChangeText={setObservacao}
          placeholder="Observação (opcional)"
          placeholderTextColor={colors.ink3}
          maxLength={TAREFA_OBSERVACAO_MAX}
          multiline
          accessibilityLabel="Observação, opcional"
          style={s.observacao}
        />
      ) : null}

      {d.acao?.tipo === 'marcar' ? <Botao testID="tarefa-marcar" nivel="principal" rotulo={d.acao.rotulo} icone="check" ocupado={ocupado} onPress={() => void concluir()} /> : null}
      {d.acao?.tipo === 'foto' ? (
        <View style={{ gap: space.sm }}>
          {fotos.length > 0 ? <Botao testID="tarefa-concluir-fotos" nivel="principal" rotulo={rotuloConcluirComFotos(fotos.length)} ocupado={ocupado} onPress={() => void concluir()} /> : null}
          <Botao testID="tarefa-foto" nivel={fotos.length > 0 ? 'secundario' : 'principal'} rotulo={d.acao.rotulo} icone="camera" desligado={fotos.length >= d.fotosMax || ocupado} onPress={() => void foto()} />
        </View>
      ) : null}
      {d.acao?.tipo === 'pesquisa' ? (
        <Botao
          testID="tarefa-pesquisa"
          nivel="principal"
          rotulo={d.acao.rotulo}
          desligado={!responderPesquisa || !item.tarefa.questionario_id}
          onPress={() => responderPesquisa?.({ questionarioId: item.tarefa.questionario_id!, clienteId: item.tarefa.cliente_id, tarefaId: item.id })}
        />
      ) : null}
      {d.podeDesmarcar ? <Botao testID="tarefa-desmarcar" nivel="neutro" rotulo="Desmarcar" ocupado={ocupado} onPress={() => void agir(() => r.desmarcar(item.id))} /> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  cliente: { flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 48 },
  observacao: {
    minHeight: 80,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.ink,
    textAlignVertical: 'top',
  },
});
