/**
 * T-0088 A1 (desenho docs/desenho/T-0088.md §6, linha do engenheiro-apps): a ligação do shell com os armazenamentos do
 * aparelho, com a regra do SDK (`criarArmazenamentosDoAparelho`) de verdade, o `SistemaSqlite` do shell
 * (`criarSistemaSqlite`) sobre uma pasta temporária e o driver `node:sqlite` no lugar do expo-sqlite:
 * escolha do armazenamento (tabela do §4), uma instância por arquivo, logout que fecha e reabre, troca de usuário,
 * bloqueio que apaga os bancos de todos os usuários pela regex do SDK e remoção do AsyncStorage antigo só depois do
 * marcador concluído e de 1 sync completo. Mais as funções puras do Diagnóstico e da tela de preparo.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  criarArmazenamentosDoAparelho,
  MODULOS,
  type ArmazenamentoSync,
  type DriverSqlite,
  type EspelhoArmazenamento,
  type MarcadorPassagem,
  type ModuloId,
} from '@macuxi/platform-sdk';
import { afterAll, describe, expect, it } from 'vitest';

import {
  AVISO_PREPARO,
  agendarSemPressa,
  criarSistemaSqlite,
  forcarAsyncStorage,
  fraseDaPassagem,
  linhasDoArmazenamento,
  mensagemParaSuporte,
  opcoesDoAdaptador,
  percentualDaPassagem,
  resumoDaAbertura,
  TEXTO_ERRO_ARMAZENAMENTO,
  TEXTO_ERRO_DE_NOVO,
  TEXTO_MOTIVO_RESERVA,
  TEXTO_PREPARO,
  type PastaSqlite,
} from './armazenamento-aparelho';

/** Driver `node:sqlite` carregado pelo NOME (o typecheck do app não puxa `node:sqlite` para o grafo; T-0008 P3). */
async function driverNode(caminho: string): Promise<DriverSqlite> {
  const nome = '@macuxi/platform-sdk/sqlite-node';
  const m = (await import(/* @vite-ignore */ nome)) as { criarDriverNode(caminho?: string): DriverSqlite };
  return m.criarDriverNode(caminho);
}

const raiz = mkdtempSync(join(tmpdir(), 'macuxi-armazenamento-'));
afterAll(() => rmSync(raiz, { recursive: true, force: true }));
let pastas = 0;

/** A pasta dos bancos do aparelho, como o `services/sqlite-expo.ts` monta com o expo-sqlite. */
function pastaNode(): PastaSqlite & { dir: string } {
  const dir = join(raiz, `aparelho-${++pastas}`);
  return {
    dir,
    abrir: async (arquivo) => {
      mkdirSync(dir, { recursive: true });
      return driverNode(join(dir, arquivo));
    },
    nomes: () => readdirSync(dir),
    apagar: async (arquivo) => {
      if (!existsSync(join(dir, arquivo))) throw new Error('banco inexistente');
      for (const s of ['', '-wal', '-shm', '-journal']) rmSync(join(dir, arquivo + s), { force: true });
    },
  };
}

/** AsyncStorage de um usuário em memória (o adaptador `macuxi:u:<id>:` do shell, origem da passagem). */
function asyncStorageEmMemoria(
  inicial: Record<string, unknown> = {},
): ArmazenamentoSync & { dados: Map<string, unknown> } {
  const dados = new Map<string, unknown>(Object.entries(inicial));
  return {
    dados,
    ler: async <T>(k: string) => (dados.has(k) ? (structuredClone(dados.get(k)) as T) : null),
    gravar: async (k, v) => void dados.set(k, structuredClone(v)),
    remover: async (k) => void dados.delete(k),
    chaves: async (p) => [...dados.keys()].filter((k) => k.startsWith(p)),
  };
}

function espelhoEmMemoria() {
  let e: EspelhoArmazenamento | null = null;
  return { ler: async () => e, gravar: async (x: EspelhoArmazenamento) => void (e = x), atual: () => e };
}

/** Shell mínimo (sem módulo com migração): o adaptador só precisa das entidades para as tabelas `ent_<e>`. */
const SHELL = {
  migracoesAparelho: {},
  registroSync: {
    entidadesAtivas: (modulos: readonly ModuloId[]) =>
      [
        { nome: 'cliente', modulo: 'core' as const },
        { nome: 'produto', modulo: 'core' as const },
        { nome: 'pedido', modulo: 'vendedor' as const },
      ].filter((e) => modulos.includes(e.modulo)),
  },
  indicesBusca: [],
};

const ANA = '0b6f8a2e-1c3d-4e5f-8a9b-0c1d2e3f4a5b';
const BETO = '7d1e2f3a-4b5c-4d6e-9f0a-1b2c3d4e5f6a';
const TENANT = 'f0e1d2c3-b4a5-4697-8879-6a5b4c3d2e1f';
const OUTRO_TENANT = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** AsyncStorage antigo de quem atualiza o APK: 3 pedidos e 1 visita na fila, um rascunho e o pull. */
const ORIGEM_COM_FILA = () =>
  asyncStorageEmMemoria({
    'sync:fila': [
      {
        id: '00000000-0000-4000-8000-000000000001',
        modulo: 'vendedor',
        entidade: 'pedido',
        situacao: 'pendente',
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        modulo: 'vendedor',
        entidade: 'pedido',
        situacao: 'pendente',
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        modulo: 'vendedor',
        entidade: 'pedido',
        situacao: 'pendente',
      },
      {
        id: '00000000-0000-4000-8000-000000000004',
        modulo: 'core',
        entidade: 'visita',
        situacao: 'pendente',
      },
    ],
    'mod:vendedor:rascunhos': [
      { id: 'r-1', cliente_id: 'c-1', itens: [{ produto_id: 'p-1', quantidade: 2 }] },
    ],
    'sync:modulos': ['core', 'catalogo', 'vendedor'],
    'ent:cliente': { 'c-1': { id: 'c-1', updated_at: '2026-11-06T10:00:00.000Z', nome: 'Loja 1' } },
    'sync:cursor:cliente': '2026-11-06T10:00:00.000Z|c-1',
    'sync:sincronizado_em': '2026-11-06T10:00:01.000Z',
    'sync:lease': { dono: 'segundo-plano:1', expira_em: '2026-11-06T10:02:00.000Z' },
  });

function montar(o: { sqliteDisponivel?: boolean; forcar?: boolean; agora?: () => Date } = {}) {
  const pasta = pastaNode();
  const erros: string[] = [];
  const registrarErro = (m: string) => erros.push(m);
  const aparelho = criarArmazenamentosDoAparelho({
    sistema: criarSistemaSqlite(pasta, registrarErro),
    sqliteDisponivel: o.sqliteDisponivel ?? true,
    forcarAsyncStorage: o.forcar ?? false,
    opcoes: opcoesDoAdaptador(SHELL, registrarErro),
    registrarErro,
    ...(o.agora ? { agora: o.agora } : {}),
  });
  return { pasta, erros, aparelho };
}

describe(
  'T-0088: armazenamento do usuário no shell (regra do SDK + sistema do shell + node:sqlite)',
  { timeout: 60_000 },
  () => {
    it('escolha do §4: sem SQLite no APK, sessão sem id de usuário e a trava do build = AsyncStorage; a demonstração vai para o SQLite', async () => {
      const semSqlite = montar({ sqliteDisponivel: false });
      const a = asyncStorageEmMemoria();
      expect(
        await semSqlite.aparelho.abrir({
          usuarioId: ANA,
          tenantId: TENANT,
          asyncStorage: a,
          espelho: espelhoEmMemoria(),
        }),
      ).toMatchObject({
        tipo: 'asyncstorage',
        motivo: 'sem_sqlite',
      });
      // reserva `ids_invalidos` (adendo §10 do desenho): só a sessão sem id de usuário, que não tem arquivo próprio
      const semId = montar();
      const vazio = await semId.aparelho.abrir({
        usuarioId: '',
        tenantId: null,
        asyncStorage: a,
        espelho: espelhoEmMemoria(),
      });
      expect(vazio).toMatchObject({ tipo: 'asyncstorage', motivo: 'ids_invalidos' });
      if (vazio.tipo === 'asyncstorage') expect(vazio.armazenamento).toBe(a);
      const forcado = montar({ forcar: forcarAsyncStorage('asyncstorage') });
      expect(
        await forcado.aparelho.abrir({
          usuarioId: ANA,
          tenantId: TENANT,
          asyncStorage: a,
          espelho: espelhoEmMemoria(),
        }),
      ).toMatchObject({
        tipo: 'asyncstorage',
        motivo: 'forcado',
      });
      // nenhum arquivo foi criado nos três casos de reserva
      expect(
        existsSync(semSqlite.pasta.dir) || existsSync(semId.pasta.dir) || existsSync(forcado.pasta.dir),
      ).toBe(false);

      // demonstração (id fora do formato de UUID, sem tenant): SQLite com o hash do id no nome, nunca o id cru
      const { aparelho, pasta } = montar();
      const demo = await aparelho.abrir({
        usuarioId: 'u-vend-01',
        tenantId: null,
        asyncStorage: asyncStorageEmMemoria(),
        espelho: espelhoEmMemoria(),
      });
      expect(demo.tipo).toBe('sqlite');
      if (demo.tipo !== 'sqlite') return;
      expect(demo.arquivo).toMatch(/^macuxi-u-h[0-9a-f]{32}-t-demo.db$/);
      expect(demo.arquivo).not.toContain('u-vend-01');
      expect(readdirSync(pasta.dir)).toContain(demo.arquivo);
      expect(demo.armazenamento).not.toBe(a);
      await aparelho.fecharTodos();
    });

    it('1ª abertura passa a fila, os rascunhos e o pull para o SQLite do usuário e tenant; o lease não vai junto', async () => {
      const { aparelho, pasta, erros } = montar();
      const origem = ORIGEM_COM_FILA();
      const espelho = espelhoEmMemoria();
      const progresso: string[] = [];
      const r = await aparelho.abrir({
        usuarioId: ANA,
        tenantId: TENANT,
        asyncStorage: origem,
        espelho,
        aoProgredir: (p) => progresso.push(p.grupo),
      });
      expect(r.tipo).toBe('sqlite');
      if (r.tipo !== 'sqlite') return;
      expect(r.arquivo).toBe(`macuxi-u-${ANA}-t-${TENANT}.db`);
      expect(readdirSync(pasta.dir)).toContain(r.arquivo);
      expect(r.passagem).toMatchObject({ estado: 'concluida', tentativas: 1, pull: 'copiado' });
      expect((await r.armazenamento.ler<{ id: string }[]>('sync:fila'))!.map((i) => i.id.slice(-1))).toEqual([
        '1',
        '2',
        '3',
        '4',
      ]);
      expect(await r.armazenamento.ler('mod:vendedor:rascunhos')).toEqual(
        origem.dados.get('mod:vendedor:rascunhos'),
      );
      expect(await r.armazenamento.ler('sync:lease')).toBeNull();
      expect(await r.armazenamento.linhas!.contar('cliente')).toBe(1);
      expect(espelho.atual()).toMatchObject({ arquivo: r.arquivo });
      // sem sync depois da passagem, o AsyncStorage antigo fica (a fila só sai do SQLite depois do push)
      expect(r.origemApagada).toBe(false);
      expect(origem.dados.has('sync:fila')).toBe(true);
      expect(new Set(progresso)).toEqual(new Set(['A', 'B', 'C']));
      expect(erros).toEqual([]);
      await aparelho.fecharTodos();
    });

    it('uma instância por arquivo: app, lease e tarefa em segundo plano abrindo juntos recebem a mesma; a passagem roda uma vez', async () => {
      const { aparelho } = montar();
      const origem = ORIGEM_COM_FILA();
      const espelho = espelhoEmMemoria();
      const u = { usuarioId: ANA, tenantId: TENANT, asyncStorage: origem, espelho };
      const [app, lease, tarefa] = await Promise.all([
        aparelho.abrir(u),
        aparelho.abrir(u),
        aparelho.abrir(u),
      ]);
      expect(app.tipo).toBe('sqlite');
      if (app.tipo !== 'sqlite' || lease.tipo !== 'sqlite' || tarefa.tipo !== 'sqlite')
        throw new Error('esperava sqlite');
      expect(lease.armazenamento).toBe(app.armazenamento);
      expect(tarefa.armazenamento).toBe(app.armazenamento);
      expect(app.passagem.tentativas).toBe(1);
      expect(aparelho.abertos()).toEqual([app.arquivo]);
      await aparelho.fecharTodos();
    });

    it('logout fecha sem apagar: o próximo login do mesmo usuário e tenant reabre o mesmo arquivo com a fila, sem recopiar', async () => {
      const { aparelho, pasta } = montar();
      const origem = ORIGEM_COM_FILA();
      const espelho = espelhoEmMemoria();
      const u = { usuarioId: ANA, tenantId: TENANT, asyncStorage: origem, espelho };
      const r1 = await aparelho.abrir(u);
      if (r1.tipo !== 'sqlite') throw new Error('esperava sqlite');
      await r1.armazenamento.gravar('mod:vendedor:rascunhos', [{ id: 'r-2' }]);
      await aparelho.fechar(r1.arquivo);
      expect(aparelho.abertos()).toEqual([]);
      expect(readdirSync(pasta.dir)).toContain(r1.arquivo);
      const r2 = await aparelho.abrir(u);
      if (r2.tipo !== 'sqlite') throw new Error('esperava sqlite');
      expect(r2.armazenamento).not.toBe(r1.armazenamento);
      expect(r2.passagem.tentativas).toBe(1);
      expect(await r2.armazenamento.ler('mod:vendedor:rascunhos')).toEqual([{ id: 'r-2' }]);
      expect(await r2.armazenamento.ler<unknown[]>('sync:fila')).toHaveLength(4);
      await aparelho.fecharTodos();
    });

    it('troca de usuário e de tenant no mesmo aparelho: cada um no próprio arquivo, com a própria fila', async () => {
      const { aparelho, pasta } = montar();
      const ana = await aparelho.abrir({
        usuarioId: ANA,
        tenantId: TENANT,
        asyncStorage: ORIGEM_COM_FILA(),
        espelho: espelhoEmMemoria(),
      });
      if (ana.tipo !== 'sqlite') throw new Error('esperava sqlite');
      await aparelho.fechar(ana.arquivo);
      const beto = await aparelho.abrir({
        usuarioId: BETO,
        tenantId: TENANT,
        asyncStorage: asyncStorageEmMemoria(),
        espelho: espelhoEmMemoria(),
      });
      const anaOutro = await aparelho.abrir({
        usuarioId: ANA,
        tenantId: OUTRO_TENANT,
        asyncStorage: asyncStorageEmMemoria(),
        espelho: espelhoEmMemoria(),
      });
      if (beto.tipo !== 'sqlite' || anaOutro.tipo !== 'sqlite') throw new Error('esperava sqlite');
      expect(new Set([ana.arquivo, beto.arquivo, anaOutro.arquivo]).size).toBe(3);
      expect(await beto.armazenamento.ler('sync:fila')).toBeNull();
      expect(await anaOutro.armazenamento.ler('sync:fila')).toBeNull();
      expect(
        readdirSync(pasta.dir)
          .filter((n) => n.endsWith('.db'))
          .sort(),
      ).toEqual([ana.arquivo, beto.arquivo, anaOutro.arquivo].sort());
      await aparelho.fecharTodos();
    });

    it('bloqueio do aparelho (RN-CORE-15): fecha tudo e apaga os bancos de TODOS os usuários; o de medição e outros ficam', async () => {
      const { aparelho, pasta } = montar();
      const ana = await aparelho.abrir({
        usuarioId: ANA,
        tenantId: TENANT,
        asyncStorage: ORIGEM_COM_FILA(),
        espelho: espelhoEmMemoria(),
      });
      const beto = await aparelho.abrir({
        usuarioId: BETO,
        tenantId: null,
        asyncStorage: asyncStorageEmMemoria(),
        espelho: espelhoEmMemoria(),
      });
      if (ana.tipo !== 'sqlite' || beto.tipo !== 'sqlite') throw new Error('esperava sqlite');
      expect(beto.arquivo).toBe(`macuxi-u-${BETO}-t-demo.db`);
      await aparelho.fechar(beto.arquivo);
      writeFileSync(join(pasta.dir, 'macuxi-diagnostico-carga.db'), '');
      writeFileSync(join(pasta.dir, 'outro.db'), '');
      const apagados = await aparelho.apagarTodos();
      expect(apagados).toEqual([ana.arquivo, beto.arquivo].sort());
      expect(aparelho.abertos()).toEqual([]);
      expect(readdirSync(pasta.dir).sort()).toEqual(['macuxi-diagnostico-carga.db', 'outro.db']);
    });

    it('remoção do AsyncStorage antigo só com o marcador concluído e 1 sync completo depois dele (ou 7 dias)', async () => {
      let agora = new Date('2026-11-07T12:00:00.000Z');
      const { aparelho } = montar({ agora: () => agora });
      const origem = ORIGEM_COM_FILA();
      const espelho = espelhoEmMemoria();
      const u = { usuarioId: ANA, tenantId: TENANT, asyncStorage: origem, espelho };
      const r1 = await aparelho.abrir(u);
      if (r1.tipo !== 'sqlite') throw new Error('esperava sqlite');
      expect(r1.origemApagada).toBe(false);
      // o motor sincronizou depois da passagem (a fila foi enviada); a remoção roda na próxima abertura
      agora = new Date('2026-11-07T12:05:00.000Z');
      await r1.armazenamento.gravar('sync:sincronizado_em', agora.toISOString());
      await aparelho.fechar(r1.arquivo);
      const r2 = await aparelho.abrir(u);
      if (r2.tipo !== 'sqlite') throw new Error('esperava sqlite');
      expect(r2.origemApagada).toBe(true);
      expect(origem.dados.size).toBe(0);
      // e o SQLite segue com tudo (o espelho impede voltar ao AsyncStorage)
      expect(await r2.armazenamento.ler<unknown[]>('sync:fila')).toHaveLength(4);
      expect(espelho.atual()?.arquivo).toBe(r2.arquivo);
      await aparelho.fecharTodos();
    });

    it('com o espelho gravado e sem SQLite no APK: erro com "Tentar de novo", nunca o AsyncStorage antigo', async () => {
      const { aparelho } = montar({ sqliteDisponivel: false, forcar: true });
      const espelho = espelhoEmMemoria();
      await espelho.gravar({ arquivo: `macuxi-u-${ANA}-t-${TENANT}.db`, desde: '2026-11-07T12:00:00.000Z' });
      const r = await aparelho.abrir({
        usuarioId: ANA,
        tenantId: TENANT,
        asyncStorage: ORIGEM_COM_FILA(),
        espelho,
      });
      expect(r.tipo).toBe('erro');
      expect(linhasDoArmazenamento(resumoDaAbertura(r), (x) => x)[0]).toBe(
        `Armazenamento: SQLite com erro (macuxi-u-${ANA}-t-${TENANT}.db)`,
      );
    });
  },
);

describe('T-0088: peças puras do shell', () => {
  it('trava do build: só "asyncstorage" (sem diferença de caixa e espaços) força a reserva', () => {
    expect(forcarAsyncStorage('asyncstorage')).toBe(true);
    expect(forcarAsyncStorage(' AsyncStorage ')).toBe(true);
    for (const v of [undefined, null, '', 'sqlite', 'async']) expect(forcarAsyncStorage(v)).toBe(false);
  });

  it('opções do adaptador iguais no motor e na medição: todas as entidades, índices do shell e a busca que não espera o L-1', () => {
    const log = (m: string) => void m;
    const o = opcoesDoAdaptador(SHELL, log);
    expect(o.buscaSemEsperarIndexacao).toBe(true);
    expect(o.registrarErro).toBe(log);
    expect(o.entidades).toEqual(SHELL.registroSync.entidadesAtivas(MODULOS));
    expect(o.entidades!.map((e) => e.nome)).toEqual(['cliente', 'produto', 'pedido']);
    expect(o.indicesBusca).toBe(SHELL.indicesBusca);
  });

  it('sistema do shell: listar sem pasta = nenhum banco; apagar que falha registra e não interrompe', async () => {
    const erros: string[] = [];
    const apagados: string[] = [];
    const s = criarSistemaSqlite(
      {
        abrir: async () => {
          throw new Error('não usado');
        },
        nomes: () => {
          throw new Error('pasta inexistente');
        },
        apagar: async (a) => {
          if (a === 'ruim.db') throw new Error('arquivo ocupado');
          apagados.push(a);
        },
      },
      (m) => erros.push(m),
    );
    expect(await s.listar()).toEqual([]);
    await s.apagar('ruim.db');
    await s.apagar('bom.db');
    expect(apagados).toEqual(['bom.db']);
    expect(erros).toEqual(['apagar o banco local ruim.db falhou: arquivo ocupado']);
  });

  it('Diagnóstico: SQLite com o marcador, AsyncStorage (reserva) com o motivo, e antes de abrir', () => {
    const passagem: MarcadorPassagem = {
      versao: 1,
      estado: 'concluida',
      tentativas: 2,
      iniciada_em: '2026-11-07T12:00:00.000Z',
      concluida_em: '2026-11-07T12:00:03.000Z',
      pull: 'refazer',
      contagens: { a: 2, b: 1, c: 0, linhas: 0 },
    };
    expect(
      linhasDoArmazenamento(
        { tipo: 'sqlite', arquivo: 'macuxi-u-x-t-demo.db', passagem, origemApagada: false },
        () => '07/11 08:00',
      ),
    ).toEqual([
      'Armazenamento: SQLite (macuxi-u-x-t-demo.db)',
      '  passagem do AsyncStorage: concluída em 07/11 08:00 · tentativa 2 · dados de consulta baixados de novo',
      '  copiado: fila e rascunhos 2 · estado 1 · consulta 0 (0 linhas)',
      '  dados antigos do AsyncStorage: guardados até o 1º sync completo (ou 7 dias)',
    ]);
    expect(linhasDoArmazenamento({ tipo: 'asyncstorage', motivo: 'sem_sqlite' }, String)).toEqual([
      `Armazenamento: AsyncStorage (reserva) · ${TEXTO_MOTIVO_RESERVA.sem_sqlite}`,
    ]);
    expect(
      linhasDoArmazenamento(
        { tipo: 'asyncstorage', motivo: 'passagem_abortada', detalhe: 'conferencia: fila diferente' },
        String,
      )[1],
    ).toBe('  conferencia: fila diferente');
    expect(linhasDoArmazenamento(null, String)).toEqual(['Armazenamento: ainda não aberto nesta sessão']);
    // o resumo não leva a instância do armazenamento (vai para o estado do React)
    const a = asyncStorageEmMemoria();
    expect(resumoDaAbertura({ tipo: 'asyncstorage', motivo: 'forcado', armazenamento: a })).toEqual({
      tipo: 'asyncstorage',
      motivo: 'forcado',
    });
  });

  it('barra da tela de preparo: fila e estado até 20 %, dados de consulta o resto; frase sem nome técnico', () => {
    expect(percentualDaPassagem(null)).toBe(0);
    expect(percentualDaPassagem({ grupo: 'A', feitos: 0, total: 3 })).toBe(0);
    expect(percentualDaPassagem({ grupo: 'A', feitos: 3, total: 3 })).toBe(10);
    expect(percentualDaPassagem({ grupo: 'B', feitos: 0, total: 0 })).toBe(20);
    expect(percentualDaPassagem({ grupo: 'C', feitos: 5, total: 10 })).toBe(60);
    expect(percentualDaPassagem({ grupo: 'C', feitos: 12, total: 10 })).toBe(100);
    expect(fraseDaPassagem(null)).toBe('Copiando o que você registrou no aparelho');
    expect(fraseDaPassagem({ grupo: 'C', feitos: 1, total: 4 })).toBe('Copiando produtos e clientes');
    for (const g of ['A', 'B', 'C'] as const)
      expect(fraseDaPassagem({ grupo: g, feitos: 0, total: 1 })).not.toMatch(
        /sync|ent_|mod:|AsyncStorage|SQLite/,
      );
  });

  it('textos servem a todos os perfis (o promotor não faz pedido, RN-PRO-01) e dizem que nada se perde se o app fechar', () => {
    const textos = [
      TEXTO_PREPARO,
      AVISO_PREPARO,
      TEXTO_ERRO_ARMAZENAMENTO,
      TEXTO_ERRO_DE_NOVO,
      ...(['A', 'B', 'C'] as const).map((g) => fraseDaPassagem({ grupo: g, feitos: 0, total: 1 })),
    ];
    for (const x of textos) expect(x).not.toMatch(/pedido|tabela|visita|rascunho/i);
    expect(AVISO_PREPARO).toContain('nada se perde');
    expect(TEXTO_MOTIVO_RESERVA.ids_invalidos).toBe('sessão sem id de usuário');
  });

  it('detalhe para o suporte: título e detalhe técnico, com e-mail e documento mascarados; o nome do arquivo fica', () => {
    const arquivo = 'macuxi-u-3f2a9c1e-0b7d-4c55-9a1e-6d2f8b4c7a10-t-demo.db';
    const m = mensagemParaSuporte(
      `abrir ${arquivo} falhou (ana@loja.com.br, CPF 123.456.789-09, tel (95) 99123-4567)`,
    );
    expect(m.split('\n')[0]).toBe('Macuxi FDV · Não foi possível abrir os dados do aparelho');
    expect(m).toContain(arquivo);
    expect(m).not.toMatch(/ana@|123\.456|99123/);
    expect(m).toContain('[e-mail]');
    expect(m).toContain('[cpf]');
    expect(m).toContain('[telefone]');
  });

  it('finalizar da busca agendado quando a tela fica livre (requestIdleCallback), ou num setTimeout 0', () => {
    const chamadas: string[] = [];
    const ocioso = { requestIdleCallback: (f: () => void) => (chamadas.push('ocioso'), f()) };
    agendarSemPressa(() => chamadas.push('rodou'), ocioso);
    const semOcioso = { setTimeout: (f: () => void, ms: number) => (chamadas.push(`timeout ${ms}`), f()) };
    agendarSemPressa(() => chamadas.push('rodou'), semOcioso);
    expect(chamadas).toEqual(['ocioso', 'rodou', 'timeout 0', 'rodou']);
  });
});
