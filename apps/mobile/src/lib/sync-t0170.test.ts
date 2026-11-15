/**
 * T-0170 (item 8 do #149): costura do sync no shell mobile, sem React Native. As 6 entidades do Core entram no registro
 * das duas variantes (= tabelas `ent_*` no SQLite), sem duplicar o que o módulo já registra, e passam pelo motor.
 */
import {
  criarArmazenamentoEmMemoria,
  criarMotorSync,
  criarShell,
  definirEntidadeSync,
  type ItemPush,
  type LinhaSync,
  type ModuloShell,
  type PaginaSync,
  type ResultadoItemPush,
  type TransporteSync,
} from '@macuxi/platform-sdk';
import { TarefaSyncSchema } from '@macuxi/core/contracts';
import { describe, expect, it, vi } from 'vitest';

import { opcoesDoAdaptador } from './armazenamento-aparelho';
import { MANIFESTOS_INSTALADOS } from './instalados';
import { comSyncT0170, ENTIDADES_SYNC_T0170, itemTrocaDeAvatar } from './sync-t0170';

// RD-0399: o nome da entidade vem do Core; o índice `@macuxi/core/app` carrega telas (react-native), então o teste usa o
// arquivo puro de onde o índice reexporta a constante.
vi.mock('@macuxi/core/app', async () => {
  const { ENTIDADE_USUARIO_AVATAR } = await import('../../../../modules/core/app/telas/inicio/foto-perfil');
  return { ENTIDADE_USUARIO_AVATAR };
});

const DIRECOES = {
  tarefa: 'pull',
  tarefa_conclusao: 'push',
  frase_dia: 'pull',
  usuario_avatar: 'ambos',
  meta_produtividade: 'pull',
  deslocamento_dia: 'pull',
} as const;
const NOMES = Object.keys(DIRECOES);

const modulos = (): ModuloShell<unknown>[] => MANIFESTOS_INSTALADOS.map((m) => comSyncT0170<unknown>({ manifesto: m }));

const USUARIO = '00000000-0000-4000-8000-0000000000a1';
const TAREFA = TarefaSyncSchema.parse({
  id: '00000000-0000-4000-8000-0000000000b1',
  updated_at: '2026-11-14T12:00:00.000Z',
  deleted_at: null,
  external_id: null,
  tarefa_id: '00000000-0000-4000-8000-0000000000b2',
  usuario_id: USUARIO,
  titulo: 'Conferir a gôndola',
  descricao: null,
  prazo: '2026-11-20',
  tipo: 'simples',
  cliente_id: null,
  cliente_nome: null,
  questionario_id: null,
  autor_nome: 'Ana Lima',
  autor_perfil: 'supervisor',
  concluida_em: null,
  cancelada_em: null,
});

function transporteFalso() {
  const enviados: ItemPush[] = [];
  const t: TransporteSync = {
    async push(itens): Promise<ResultadoItemPush[]> {
      enviados.push(...itens);
      return itens.map((i) => ({ id: i.id, status: 'aceito' as const }));
    },
    async pull(entidade): Promise<PaginaSync<LinhaSync>> {
      return { itens: entidade === 'tarefa' ? [TAREFA] : [], proximo_cursor: null };
    },
  };
  return { t, enviados };
}

describe('T-0170: entidades de sync do Core no shell mobile', () => {
  it.each(['campo', 'gestao'] as const)('variante %s: registra as 6 com a direção certa e cria as tabelas ent_*', (variante) => {
    expect(() => criarShell(variante, modulos())).not.toThrow();
    const shell = criarShell(variante, modulos());
    for (const [nome, direcao] of Object.entries(DIRECOES)) {
      expect(shell.registroSync.entidade(nome)).toMatchObject({ nome, modulo: 'core', direcao });
    }
    const entidades = opcoesDoAdaptador(shell, () => {}).entidades;
    expect(entidades).toEqual(expect.arrayContaining(NOMES.map((nome) => ({ nome, modulo: 'core' }))));
  });

  it('não duplica o que o Core já registra e não mexe nos outros módulos', () => {
    const core = MANIFESTOS_INSTALADOS.find((m) => m.id === 'core')!;
    const tarefaPropria = definirEntidadeSync({ ...ENTIDADES_SYNC_T0170[0]! });
    const comTarefa = comSyncT0170<unknown>({ manifesto: core, entidadesSync: [tarefaPropria] });
    expect(comTarefa.entidadesSync!.filter((e) => e.nome === 'tarefa')).toEqual([tarefaPropria]);
    expect(comTarefa.entidadesSync).toHaveLength(6);
    const lista = MANIFESTOS_INSTALADOS.map((m) => (m.id === 'core' ? comSyncT0170(comTarefa) : comSyncT0170<unknown>({ manifesto: m })));
    expect(() => criarShell('campo', lista)).not.toThrow();

    const catalogo: ModuloShell<unknown> = { manifesto: MANIFESTOS_INSTALADOS.find((m) => m.id === 'catalogo')! };
    expect(comSyncT0170(catalogo)).toBe(catalogo);
  });

  it('motor: puxa a tarefa, envia a conclusão e a troca de avatar, recusa payload inválido e envio de entidade só de pull', async () => {
    const shell = criarShell('campo', modulos());
    const { t, enviados } = transporteFalso();
    const motor = criarMotorSync({ registro: shell.registroSync, armazenamento: criarArmazenamentoEmMemoria(), transporte: t, online: () => true });
    await motor.aplicarModulosAtivos(['core']);

    const conclusao = {
      id: '00000000-0000-4000-8000-0000000000c1',
      tarefa_destinatario_id: TAREFA.id,
      concluida_em: '2026-11-14T13:00:00.000Z',
      foto_ids: [],
      observacao: null,
    };
    await motor.enfileirar({ id: conclusao.id, entidade: 'tarefa_conclusao', payload: conclusao, rotulo: 'Tarefa concluída' });
    const avatar = itemTrocaDeAvatar({
      id: '00000000-0000-4000-8000-0000000000d1',
      usuarioId: USUARIO,
      escolha: { tipo: 'avatar', avatar_codigo: 'f2', arquivo_id: null },
      agora: new Date('2026-11-14T13:05:00.000Z'),
    });
    await motor.enfileirar(avatar);

    await expect(
      motor.enfileirar(
        itemTrocaDeAvatar({
          id: '00000000-0000-4000-8000-0000000000d2',
          usuarioId: USUARIO,
          escolha: { tipo: 'avatar', avatar_codigo: null, arquivo_id: null },
          agora: new Date('2026-11-14T13:06:00.000Z'),
        }),
      ),
    ).rejects.toThrow(/Payload inválido para usuario_avatar/);
    await expect(motor.enfileirar({ id: TAREFA.id, entidade: 'tarefa', payload: TAREFA })).rejects.toThrow(/não aceita envio/);

    expect(await motor.sincronizar()).toBe(true);
    expect(enviados.map((i) => [i.entidade, i.id])).toEqual([
      ['tarefa_conclusao', conclusao.id],
      ['usuario_avatar', avatar.id],
    ]);
    expect(enviados[1]!.payload).toEqual({
      id: avatar.id,
      usuario_id: USUARIO,
      tipo: 'avatar',
      avatar_codigo: 'f2',
      arquivo_id: null,
      alterado_em: '2026-11-14T13:05:00.000Z',
    });
    expect(await motor.linhas('tarefa')).toEqual([TAREFA]);
  });
});
