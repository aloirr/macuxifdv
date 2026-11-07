/// <reference types="node" />
/**
 * Passagem AsyncStorage → SQLite e armazenamentos do aparelho (desenho T-0088 §2, §3 e §4), com `node:sqlite` em
 * ARQUIVO (como no aparelho): passagem completa, falha em cada grupo, "app morto" no meio com reentrada, fila preservada
 * (cada UUID chega uma vez e na ordem), dois usuários e dois tenants no mesmo aparelho, logout e bloqueio.
 */
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { afterAll, describe, expect, it } from 'vitest';
import { defineModule } from '../manifesto';
import { criarArmazenamentoEmMemoria, criarMotorSync, type ArmazenamentoSync } from '../motor-sync';
import { criarServidorSyncSimulado } from '../sync-simulado';
import { criarRegistroSync, definirEntidadeSync, type LinhaSync } from '../sync';
import { criarArmazenamentosDoAparelho, escolherArmazenamento, type EspelhoArmazenamento, type GuardaEspelho, type SistemaSqlite } from './aparelho';
import { criarArmazenamentoSqlite, TAMANHO_LOTE_GRAVACAO, type ArmazenamentoSqlite } from './armazenamento';
import { arquivoDoUsuario } from './arquivo';
import { criarDriverNode } from './driver-node';
import {
  apagarOrigemSePossivel,
  grupoDaChave,
  MARCADOR_PASSAGEM,
  passarDoAsyncStorage,
  podeApagarOrigem,
  type MarcadorPassagem,
} from './passagem';

const PASTA = mkdtempSync(join(tmpdir(), 'macuxi-passagem-'));
afterAll(() => rmSync(PASTA, { recursive: true, force: true }));
let seq = 0;
/** Pasta nova por teste (o SQLite em arquivo, como no aparelho). */
const pasta = () => {
  const p = join(PASTA, String(++seq));
  mkdirSync(p);
  return p;
};
const sistemaNode = (dir: string): SistemaSqlite & { aberturas: string[] } => {
  const aberturas: string[] = [];
  return {
    aberturas,
    async abrir(a) {
      aberturas.push(a);
      return criarDriverNode(join(dir, a));
    },
    listar: async () => readdirSync(dir),
    async apagar(a) {
      for (const s of ['', '-wal', '-shm', '-journal']) rmSync(join(dir, a + s), { force: true });
    },
  };
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U1 = uuid(9001);
const U2 = uuid(9002);
const T1 = uuid(7001);
const T2 = uuid(7002);
const AGORA = new Date('2026-11-06T12:00:00Z'); // hora-fixa-ok: relógio injetado, nunca comparado ao relógio real

interface Cliente extends LinhaSync {
  nome: string;
}
const cliente = (n: number): Cliente => ({
  id: uuid(n),
  updated_at: new Date(AGORA.getTime() - 86_400_000 + n).toISOString(),
  deleted_at: null,
  nome: `Cliente ${n}`,
});

/** Itens de fila no formato do motor (o que importa aqui: `id` e a ordem). */
const item = (n: number) => ({ id: uuid(n), entidade: 'pedido', modulo: 'vendedor', payload: { total_cents: 100 * n } });
const RASCUNHOS = [{ id: uuid(500), cliente_id: uuid(1), itens: [{ produto_id: 'p1', qtd: 3 }], obs: 'entregar às 8h' }];

/** Origem como o AsyncStorage do usuário de hoje: as chaves do motor com `ent:<e>` (mapa id → linha). */
async function origemCompleta(nClientes = 1200): Promise<ArmazenamentoSync> {
  const o = criarArmazenamentoEmMemoria();
  await o.gravar('sync:fila', [item(1), item(2), item(3)]);
  await o.gravar('sync:aceitos', [{ ...item(4), aceito_em: AGORA.toISOString() }]);
  await o.gravar('sync:arquivos', [{ id: uuid(600), caminho: 'file:///foto.jpg' }]);
  await o.gravar('mod:vendedor:rascunhos', RASCUNHOS);
  await o.gravar('mod:catalogo:exibicao', { modo: 'grade' });
  await o.gravar('sync:modulos', ['core', 'vendedor']);
  await o.gravar('sync:parametros', { vendedor: { desconto_max: 10 } });
  await o.gravar('sync:geracao_base', 'g1');
  await o.gravar('sync:lease', { dono: 'tarefa', ate: AGORA.toISOString() });
  const clientes = Array.from({ length: nClientes }, (_, k) => cliente(k + 1));
  await o.gravar('ent:cliente', Object.fromEntries(clientes.map((c) => [c.id, c])));
  await o.gravar('sync:cursor:cliente', 'cursor-cliente');
  await o.gravar('sync:cursor:visita', 'cursor-visita'); // entidade sem linha: o cursor também passa
  await o.gravar('sync:escopo:cliente', 'v3');
  await o.gravar('sync:sincronizado_em', new Date(AGORA.getTime() - 3_600_000).toISOString());
  return o;
}

const ENTIDADES = [
  { nome: 'cliente', modulo: 'core' },
  { nome: 'visita', modulo: 'core' },
  { nome: 'pedido', modulo: 'vendedor' },
] as const;
const abrirSqlite = (arquivo: string) => criarArmazenamentoSqlite(criarDriverNode(arquivo), { entidades: ENTIDADES, agora: () => AGORA });

/** Envolve o destino para injetar falhas (os métodos do adaptador são fechamentos: copiar é seguro). */
function comFalha(a: ArmazenamentoSqlite, f: { aplicar?: (n: number) => boolean; gravar?: (k: string) => boolean; ler?: (k: string, v: unknown) => unknown; transacao?: () => boolean }): ArmazenamentoSqlite {
  let n = 0;
  return {
    ...a,
    async gravar(k, v) {
      if (f.gravar?.(k)) throw new Error(`falha injetada ao gravar ${k}`);
      return a.gravar(k, v);
    },
    async ler<T>(k: string) {
      const v = await a.ler<T>(k);
      return (f.ler ? f.ler(k, v) : v) as T | null;
    },
    async emTransacao(fn) {
      if (f.transacao?.()) throw new Error('falha injetada na transação');
      return a.emTransacao(fn);
    },
    linhas: {
      ...a.linhas,
      async aplicar(e, l, c) {
        if (f.aplicar?.(++n)) throw new Error('falha injetada no lote');
        return a.linhas.aplicar(e, l, c);
      },
    },
  };
}

async function conferirAeB(origem: ArmazenamentoSync, destino: ArmazenamentoSync) {
  for (const k of ['sync:fila', 'sync:aceitos', 'sync:arquivos', 'mod:vendedor:rascunhos', 'mod:catalogo:exibicao', 'sync:modulos', 'sync:parametros', 'sync:geracao_base'])
    expect(await destino.ler(k), k).toEqual(await origem.ler(k));
}

describe('grupos de chaves da passagem (T-0088 §2)', () => {
  it.each([
    ['sync:fila', 'A'],
    ['sync:aceitos', 'A'],
    ['sync:arquivos', 'A'],
    ['mod:vendedor:rascunhos', 'A'],
    ['sync:modulos', 'B'],
    ['sync:parametros', 'B'],
    ['sync:limpeza_pendente', 'B'],
    ['sync:geracao_base', 'B'],
    ['chave_nova_de_um_modulo', 'B'],
    ['ent:produto', 'C'],
    ['sync:cursor:produto', 'C'],
    ['sync:escopo:cliente', 'C'],
    ['sync:ressinc:cliente', 'C'],
    ['sync:carga', 'C'],
    ['sync:novidades', 'C'],
    ['sync:sincronizado_em', 'C'],
    ['sync:lease', 'fora'],
    ['_migracao:asyncstorage', 'fora'],
    ['_busca:catalogo.produtos:sujo', 'fora'],
  ] as const)('%s → %s', (chave, grupo) => expect(grupoDaChave(chave)).toBe(grupo));
});

describe('passagem AsyncStorage → SQLite (T-0088 §2)', { timeout: 60_000 }, () => {
  it('completa: fila, aceitos, arquivos e rascunhos iguais; linhas em lotes com o cursor; lease fora; concluída nunca recopia', async () => {
    const arquivo = join(pasta(), 'a.db');
    const origem = await origemCompleta();
    const destino = abrirSqlite(arquivo);
    const progresso: string[] = [];
    const r = await passarDoAsyncStorage({ origem, destino, agora: () => AGORA, aoProgredir: (p) => progresso.push(`${p.grupo}:${p.feitos}/${p.total}`) });
    expect(r).toMatchObject({ desfecho: 'concluida', jaConcluida: false });
    if (r.desfecho !== 'concluida') return;
    expect(r.marcador).toMatchObject({ estado: 'concluida', tentativas: 1, pull: 'copiado', contagens: { a: 5, b: 3, linhas: 1200 } });
    await conferirAeB(origem, destino);
    expect(await destino.linhas.contar('cliente')).toBe(1200);
    expect((await destino.linhas.porIds<Cliente>('cliente', [uuid(1), uuid(1200)])).map((c) => c.nome)).toEqual(['Cliente 1', 'Cliente 1200']);
    expect(await destino.ler('sync:cursor:cliente')).toBe('cursor-cliente');
    expect(await destino.ler('sync:cursor:visita')).toBe('cursor-visita');
    expect(await destino.ler('sync:escopo:cliente')).toBe('v3');
    expect(await destino.ler('sync:sincronizado_em')).toBe(await origem.ler('sync:sincronizado_em'));
    expect(await destino.ler('sync:lease')).toBeNull();
    expect(progresso[0]).toBe('A:0/5');
    expect(progresso.at(-1)).toMatch(/^C:(\d+)\/\1$/);
    expect(Math.ceil(1200 / TAMANHO_LOTE_GRAVACAO)).toBe(3);

    // concluída: a origem muda (o app antigo ainda a tem), mas nada é copiado de novo
    await origem.gravar('sync:fila', [item(99)]);
    const outra = await passarDoAsyncStorage({ origem, destino, agora: () => AGORA });
    expect(outra).toMatchObject({ desfecho: 'concluida', jaConcluida: true });
    expect((await destino.ler<{ id: string }[]>('sync:fila'))!.map((i) => i.id)).toEqual([uuid(1), uuid(2), uuid(3)]);
    await destino.fechar();
    // o marcador sobrevive ao fechar e reabrir o arquivo
    const reaberto = abrirSqlite(arquivo);
    expect((await reaberto.ler<MarcadorPassagem>(MARCADOR_PASSAGEM))!.estado).toBe('concluida');
    await reaberto.fechar();
  });

  it('instalação nova (origem vazia): concluída com contagens zero', async () => {
    const destino = abrirSqlite(join(pasta(), 'a.db'));
    const r = await passarDoAsyncStorage({ origem: criarArmazenamentoEmMemoria(), destino, agora: () => AGORA });
    expect(r).toMatchObject({ desfecho: 'concluida', marcador: { contagens: { a: 0, b: 0, c: 0, linhas: 0 }, pull: 'copiado' } });
    await destino.fechar();
  });

  it('falha no grupo A (exceção ao gravar a fila): aborta com o marcador copiando; a próxima tentativa recomeça e converge', async () => {
    const arquivo = join(pasta(), 'a.db');
    const origem = await origemCompleta(10);
    const a = abrirSqlite(arquivo);
    const r = await passarDoAsyncStorage({ origem, destino: comFalha(a, { gravar: (k) => k === 'sync:fila' }), agora: () => AGORA });
    expect(r).toMatchObject({ desfecho: 'abortada', etapa: 'copia' });
    expect((await a.ler<MarcadorPassagem>(MARCADOR_PASSAGEM))!.estado).toBe('copiando');
    // a origem está intacta (a sessão segue nela)
    expect((await origem.ler<{ id: string }[]>('sync:fila'))!).toHaveLength(3);
    const de_novo = await passarDoAsyncStorage({ origem, destino: a, agora: () => AGORA });
    expect(de_novo).toMatchObject({ desfecho: 'concluida', marcador: { tentativas: 2, pull: 'copiado' } });
    await conferirAeB(origem, a);
    expect(await a.linhas.contar('cliente')).toBe(10);
    await a.fechar();
  });

  it('fila divergente na conferência (item a menos ou fora de ordem): aborta; nada é dado por passado', async () => {
    const origem = await origemCompleta(10);
    const casos: Array<(v: unknown) => unknown> = [
      (v) => (v as unknown[]).slice(0, 2),
      (v) => [...(v as unknown[])].reverse(),
      (v) => [...(v as unknown[]), item(77)],
    ];
    for (const mexer of casos) {
      const a = abrirSqlite(join(pasta(), 'a.db'));
      const r = await passarDoAsyncStorage({
        origem,
        destino: comFalha(a, { ler: (k, v) => (k === 'sync:fila' && v ? mexer(v) : v) }),
        agora: () => AGORA,
      });
      expect(r).toMatchObject({ desfecho: 'abortada', etapa: 'conferencia' });
      expect((await a.ler<MarcadorPassagem>(MARCADOR_PASSAGEM))!.estado).toBe('copiando');
      await a.fechar();
    }
    // rascunho diferente também aborta (mesmo JSON exigido)
    const a = abrirSqlite(join(pasta(), 'a.db'));
    const r = await passarDoAsyncStorage({
      origem,
      destino: comFalha(a, { ler: (k, v) => (k === 'mod:vendedor:rascunhos' ? [] : v) }),
      agora: () => AGORA,
    });
    expect(r).toMatchObject({ desfecho: 'abortada', etapa: 'conferencia' });
    await a.fechar();
  });

  it('falha no grupo C: os dados do pull saem, a fila e os rascunhos ficam e o marcador pede o pull de novo', async () => {
    const origem = await origemCompleta(1200);
    const a = abrirSqlite(join(pasta(), 'a.db'));
    const r = await passarDoAsyncStorage({ origem, destino: comFalha(a, { aplicar: (n) => n === 2 }), agora: () => AGORA });
    expect(r).toMatchObject({ desfecho: 'concluida', marcador: { pull: 'refazer', contagens: { a: 5, b: 3, c: 0, linhas: 0 } } });
    await conferirAeB(origem, a);
    expect(await a.linhas.contar('cliente')).toBe(0);
    for (const k of ['sync:cursor:cliente', 'sync:cursor:visita', 'sync:escopo:cliente', 'sync:sincronizado_em']) expect(await a.ler(k), k).toBeNull();
    await a.fechar();
  });

  it('"app morto" no meio do grupo C (nem a limpeza roda): aborta; ao reabrir o arquivo, recomeça do zero sem duplicar', async () => {
    const arquivo = join(pasta(), 'a.db');
    const origem = await origemCompleta(1200);
    const a = abrirSqlite(arquivo);
    let morto = false;
    const r = await passarDoAsyncStorage({
      origem,
      destino: comFalha(a, {
        aplicar: (n) => (morto ||= n === 2),
        transacao: () => morto,
        gravar: () => morto,
      }),
      agora: () => AGORA,
    });
    expect(r).toMatchObject({ desfecho: 'abortada', etapa: 'dados' });
    // o 1º lote ficou no arquivo (o processo "morreu"), com o marcador copiando e sem cursor
    expect(await a.linhas.contar('cliente')).toBe(TAMANHO_LOTE_GRAVACAO);
    expect(await a.ler('sync:cursor:cliente')).toBeNull();
    await a.fechar();

    const b = abrirSqlite(arquivo);
    const de_novo = await passarDoAsyncStorage({ origem, destino: b, agora: () => AGORA });
    expect(de_novo).toMatchObject({ desfecho: 'concluida', marcador: { tentativas: 2, pull: 'copiado', contagens: { linhas: 1200 } } });
    expect(await b.linhas.contar('cliente')).toBe(1200);
    expect((await b.ler<{ id: string }[]>('sync:fila'))!.map((i) => i.id)).toEqual([uuid(1), uuid(2), uuid(3)]);
    await conferirAeB(origem, b);
    await b.fechar();
  });

  it('fila preservada: pedidos e visita feitos offline no AsyncStorage saem do SQLite uma vez cada e na ordem', async () => {
    const registro = criarRegistroSync([
      defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['cliente', 'visita'] }),
      defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], sync: ['pedido'] }),
    ]);
    registro.registrar(definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({ nome: z.string() }) }));
    registro.registrar(definirEntidadeSync({ nome: 'visita', modulo: 'core', direcao: 'ambos', conflito: 'somente_insercao', schema: z.object({ cliente_id: z.string() }) }));
    registro.registrar(
      definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: z.object({ total_cents: z.number().int() }) }),
    );
    const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core', 'vendedor'], linhas: { cliente: [cliente(1), cliente(2)] } });
    // hoje: motor sobre o AsyncStorage, carteira puxada, depois 3 pedidos e 1 visita sem sinal e um rascunho
    const origem = criarArmazenamentoEmMemoria();
    const antigo = criarMotorSync({ registro, armazenamento: origem, transporte: servidor, agora: () => AGORA });
    await antigo.aplicarModulosAtivos(['core', 'vendedor']);
    expect(await antigo.sincronizar()).toBe(true);
    servidor.online = false;
    for (const n of [11, 12, 13]) await antigo.enfileirar({ id: uuid(n), entidade: 'pedido', payload: { total_cents: n * 100 } });
    await antigo.enfileirar({ id: uuid(14), entidade: 'visita', payload: { cliente_id: uuid(1) } });
    await antigo.enviar();
    await origem.gravar('mod:vendedor:rascunhos', RASCUNHOS);
    const filaAntes = antigo.estado().fila.map((i) => i.id);
    expect(filaAntes).toEqual([uuid(11), uuid(12), uuid(13), uuid(14)]);

    // APK novo: passagem e motor sobre o SQLite, abrindo sem sinal
    const arquivo = join(pasta(), 'a.db');
    const destino = abrirSqlite(arquivo);
    expect(await passarDoAsyncStorage({ origem, destino, agora: () => AGORA })).toMatchObject({ desfecho: 'concluida' });
    const novo = criarMotorSync({ registro, armazenamento: destino, transporte: servidor, agora: () => AGORA });
    await novo.carregar();
    expect(novo.estado().fila.map((i) => i.id)).toEqual(filaAntes);
    expect(novo.estado().fila.map((i) => i.tentativas)).toEqual([1, 1, 1, 1]);
    expect((await novo.linhas('cliente')).map((c) => c.id).sort()).toEqual([uuid(1), uuid(2)]);
    expect(await destino.ler('mod:vendedor:rascunhos')).toEqual(RASCUNHOS);

    // volta o sinal: cada UUID chega uma vez, na ordem; reenvio não duplica
    servidor.online = true;
    expect(await novo.sincronizar()).toBe(true);
    expect([...servidor.recebidos.keys()]).toEqual(filaAntes);
    expect(novo.estado().fila).toEqual([]);
    await novo.enviar();
    expect(servidor.recebidos.size).toBe(4);
    // depois do sync completo, a origem pode sair (e sai uma vez só)
    // o relógio do motor é fixo (sincronizado_em = concluida_em): ainda não sai; com um sync depois, sai
    expect(await apagarOrigemSePossivel({ origem, destino, agora: () => AGORA })).toBe(false);
    await destino.gravar('sync:sincronizado_em', new Date(AGORA.getTime() + 60_000).toISOString());
    expect(await apagarOrigemSePossivel({ origem, destino, agora: () => AGORA })).toBe(true);
    expect(await origem.chaves('')).toEqual([]);
    await destino.fechar();
  });

  it('a origem só sai com concluída e sync completo depois dela, ou 7 dias depois', () => {
    const m: MarcadorPassagem = { versao: 1, estado: 'concluida', tentativas: 1, iniciada_em: AGORA.toISOString(), concluida_em: AGORA.toISOString() };
    const mais = (ms: number) => new Date(AGORA.getTime() + ms);
    expect(podeApagarOrigem(null, mais(1).toISOString(), mais(1))).toBe(false);
    expect(podeApagarOrigem({ ...m, estado: 'copiando' }, mais(1).toISOString(), mais(1))).toBe(false);
    expect(podeApagarOrigem(m, null, mais(1))).toBe(false);
    expect(podeApagarOrigem(m, AGORA.toISOString(), mais(1))).toBe(false); // o sync copiado da origem é de antes
    expect(podeApagarOrigem(m, mais(1).toISOString(), mais(2))).toBe(true);
    expect(podeApagarOrigem(m, null, mais(7 * 86_400_000 - 1))).toBe(false);
    expect(podeApagarOrigem(m, null, mais(7 * 86_400_000))).toBe(true);
  });
});

describe('escolha do armazenamento (T-0088 §4)', () => {
  const esp: EspelhoArmazenamento = { arquivo: 'x.db', desde: AGORA.toISOString() };
  it.each([
    [{ sqliteDisponivel: false, arquivo: 'x.db', espelho: null }, { tipo: 'asyncstorage', motivo: 'sem_sqlite' }],
    [{ sqliteDisponivel: true, arquivo: null, espelho: null }, { tipo: 'asyncstorage', motivo: 'ids_invalidos' }],
    [{ sqliteDisponivel: true, arquivo: 'x.db', forcarAsyncStorage: true, espelho: null }, { tipo: 'asyncstorage', motivo: 'forcado' }],
    [{ sqliteDisponivel: true, arquivo: 'x.db', espelho: null }, { tipo: 'sqlite', arquivo: 'x.db' }],
    // depois da passagem, nunca volta ao AsyncStorage (a trava de emergência não vale)
    [{ sqliteDisponivel: true, arquivo: 'x.db', forcarAsyncStorage: true, espelho: esp }, { tipo: 'sqlite', arquivo: 'x.db' }],
    [{ sqliteDisponivel: false, arquivo: 'x.db', espelho: esp }, { tipo: 'erro' }],
    [{ sqliteDisponivel: true, arquivo: null, espelho: esp }, { tipo: 'erro' }],
  ] as const)('%o → %o', (c, esperado) => expect(escolherArmazenamento(c)).toMatchObject(esperado));
});

describe('armazenamentos do aparelho: dois usuários, logout e bloqueio (T-0088 §1 e §3)', { timeout: 60_000 }, () => {
  const espelhoEmMemoria = (): GuardaEspelho & { valor: EspelhoArmazenamento | null } => {
    const g = {
      valor: null as EspelhoArmazenamento | null,
      ler: async () => g.valor,
      gravar: async (e: EspelhoArmazenamento) => {
        g.valor = e;
      },
    };
    return g;
  };
  const montar = (dir = pasta(), extra: { sistema?: SistemaSqlite; forcarAsyncStorage?: boolean } = {}) => {
    const sistema = sistemaNode(dir);
    const aparelho = criarArmazenamentosDoAparelho({
      sistema: extra.sistema ?? sistema,
      opcoes: { entidades: ENTIDADES, buscaSemEsperarIndexacao: true },
      sqliteDisponivel: true,
      forcarAsyncStorage: extra.forcarAsyncStorage,
      agora: () => AGORA,
    });
    return { dir, sistema, aparelho };
  };

  it('dois usuários e dois tenants: um arquivo e uma fila para cada; a mesma abertura simultânea é uma instância só', async () => {
    const { dir, sistema, aparelho } = montar();
    const o1 = await origemCompleta(5);
    const o2 = criarArmazenamentoEmMemoria();
    await o2.gravar('sync:fila', [item(21)]);
    const e1 = espelhoEmMemoria();
    const e2 = espelhoEmMemoria();
    let leiturasDeChaves = 0;
    const o1Contada: ArmazenamentoSync = { ...o1, chaves: (p) => (leiturasDeChaves++, o1.chaves(p)) };
    const [a, a2, b] = await Promise.all([
      aparelho.abrir({ usuarioId: U1, tenantId: T1, asyncStorage: o1Contada, espelho: e1 }),
      aparelho.abrir({ usuarioId: U1, tenantId: T1, asyncStorage: o1Contada, espelho: e1 }),
      aparelho.abrir({ usuarioId: U2, tenantId: T1, asyncStorage: o2, espelho: e2 }),
    ]);
    if (a.tipo !== 'sqlite' || a2.tipo !== 'sqlite' || b.tipo !== 'sqlite') throw new Error('esperava SQLite');
    expect(a2.armazenamento).toBe(a.armazenamento);
    expect(leiturasDeChaves).toBe(1); // uma passagem só
    expect(sistema.aberturas.filter((x) => x === a.arquivo)).toHaveLength(1);
    expect(a.arquivo).toBe(arquivoDoUsuario({ usuarioId: U1, tenantId: T1 }));
    expect(b.arquivo).not.toBe(a.arquivo);
    expect(e1.valor).toEqual({ arquivo: a.arquivo, desde: AGORA.toISOString() });
    expect((await a.armazenamento.ler<{ id: string }[]>('sync:fila'))!.map((i) => i.id)).toEqual([uuid(1), uuid(2), uuid(3)]);
    expect((await b.armazenamento.ler<{ id: string }[]>('sync:fila'))!.map((i) => i.id)).toEqual([uuid(21)]);
    expect(aparelho.abertos()).toEqual([a.arquivo, b.arquivo].sort());

    // o mesmo usuário em outro tenant (base recriada): outro arquivo, sem copiar a origem de novo (já passou para T1)
    const c = await aparelho.abrir({ usuarioId: U1, tenantId: T2, asyncStorage: o1, espelho: e1 });
    if (c.tipo !== 'sqlite') throw new Error('esperava SQLite');
    expect(c.arquivo).not.toBe(a.arquivo);
    expect(await c.armazenamento.ler('sync:fila')).toBeNull();
    expect(c.passagem.contagens).toEqual({ a: 0, b: 0, c: 0, linhas: 0 });

    // logout: fecha sem apagar; o próximo login reabre o mesmo arquivo com a fila
    await a.armazenamento.fechar();
    expect(aparelho.abertos()).not.toContain(a.arquivo);
    expect(readdirSync(dir)).toContain(a.arquivo);
    const de_novo = await aparelho.abrir({ usuarioId: U1, tenantId: T1, asyncStorage: o1, espelho: e1 });
    if (de_novo.tipo !== 'sqlite') throw new Error('esperava SQLite');
    expect(de_novo.armazenamento).not.toBe(a.armazenamento);
    expect(de_novo.passagem.tentativas).toBe(1); // não recopiou
    expect((await de_novo.armazenamento.ler<{ id: string }[]>('sync:fila'))!.map((i) => i.id)).toEqual([uuid(1), uuid(2), uuid(3)]);
    await aparelho.fecharTodos();
    expect(aparelho.abertos()).toEqual([]);
  });

  it('bloqueio do aparelho (RN-CORE-15): fecha tudo e apaga os bancos de TODOS os usuários; o resto da pasta fica', async () => {
    const { dir, aparelho } = montar();
    writeFileSync(join(dir, 'macuxi-diagnostico-carga.db'), '');
    const a = await aparelho.abrir({ usuarioId: U1, tenantId: T1, asyncStorage: await origemCompleta(3), espelho: espelhoEmMemoria() });
    const b = await aparelho.abrir({ usuarioId: U2, tenantId: T2, asyncStorage: criarArmazenamentoEmMemoria(), espelho: espelhoEmMemoria() });
    if (a.tipo !== 'sqlite' || b.tipo !== 'sqlite') throw new Error('esperava SQLite');
    await b.armazenamento.fechar(); // um deles já deslogado: sai também
    const apagados = await aparelho.apagarTodos();
    expect(apagados).toEqual([a.arquivo, b.arquivo].sort());
    expect(readdirSync(dir)).toEqual(['macuxi-diagnostico-carga.db']);
    expect(aparelho.abertos()).toEqual([]);
  });

  it('sem espelho, falha na abertura ou passagem abortada = reserva no AsyncStorage; com espelho = erro, nunca a reserva', async () => {
    const dir = pasta();
    const quebrado: SistemaSqlite = { ...sistemaNode(dir), abrir: async () => Promise.reject(new Error('disco cheio')) };
    const origem = await origemCompleta(3);
    const e = espelhoEmMemoria();
    const r1 = await montar(dir, { sistema: quebrado }).aparelho.abrir({ usuarioId: U1, tenantId: T1, asyncStorage: origem, espelho: e });
    expect(r1).toMatchObject({ tipo: 'asyncstorage', motivo: 'abertura_falhou' });
    if (r1.tipo === 'asyncstorage') expect(r1.armazenamento).toBe(origem);

    // passagem abortada (origem que falha ao ler a fila): reserva, instância fechada; a próxima abertura tenta de novo
    const { aparelho } = montar(dir);
    const falhaUmaVez = { n: 0 };
    const origemInstavel: ArmazenamentoSync = {
      ...origem,
      ler: async <T,>(k: string) => {
        if (k === 'sync:fila' && falhaUmaVez.n++ === 0) throw new Error('AsyncStorage ocupado');
        return origem.ler<T>(k);
      },
    };
    const r2 = await aparelho.abrir({ usuarioId: U1, tenantId: T1, asyncStorage: origemInstavel, espelho: e });
    expect(r2).toMatchObject({ tipo: 'asyncstorage', motivo: 'passagem_abortada' });
    expect(aparelho.abertos()).toEqual([]);
    expect(e.valor).toBeNull();
    const r3 = await aparelho.abrir({ usuarioId: U1, tenantId: T1, asyncStorage: origemInstavel, espelho: e });
    expect(r3).toMatchObject({ tipo: 'sqlite', passagem: { tentativas: 2 } });
    expect(e.valor).not.toBeNull();
    await aparelho.fecharTodos();

    // já passou (espelho): o arquivo não abre = erro com "Tentar de novo"; a trava de emergência também não volta atrás
    const r4 = await montar(dir, { sistema: quebrado }).aparelho.abrir({ usuarioId: U1, tenantId: T1, asyncStorage: origem, espelho: e });
    expect(r4).toMatchObject({ tipo: 'erro', detalhe: 'disco cheio' });
    const forcado = montar(dir, { forcarAsyncStorage: true }).aparelho;
    const r5 = await forcado.abrir({ usuarioId: U1, tenantId: T1, asyncStorage: origem, espelho: e });
    expect(r5.tipo).toBe('sqlite');
    await forcado.fecharTodos();
    // sem espelho, a trava de emergência deixa no AsyncStorage
    const r6 = await forcado.abrir({ usuarioId: U2, tenantId: T1, asyncStorage: origem, espelho: espelhoEmMemoria() });
    expect(r6).toMatchObject({ tipo: 'asyncstorage', motivo: 'forcado' });
  });

  it('a origem sai na abertura depois de um sync completo (idempotente); antes disso fica', async () => {
    const { aparelho } = montar();
    const origem = await origemCompleta(3);
    const e = espelhoEmMemoria();
    const r = await aparelho.abrir({ usuarioId: U1, tenantId: T1, asyncStorage: origem, espelho: e });
    if (r.tipo !== 'sqlite') throw new Error('esperava SQLite');
    expect(r.origemApagada).toBe(false);
    expect((await origem.chaves('')).length).toBeGreaterThan(0);
    await r.armazenamento.gravar('sync:sincronizado_em', new Date(AGORA.getTime() + 60_000).toISOString());
    await r.armazenamento.fechar();
    const r2 = await aparelho.abrir({ usuarioId: U1, tenantId: T1, asyncStorage: origem, espelho: e });
    expect(r2).toMatchObject({ tipo: 'sqlite', origemApagada: true });
    expect(await origem.chaves('')).toEqual([]);
    if (r2.tipo === 'sqlite') expect((await r2.armazenamento.ler<{ id: string }[]>('sync:fila'))!).toHaveLength(3);
    await aparelho.fecharTodos();
  });
});
