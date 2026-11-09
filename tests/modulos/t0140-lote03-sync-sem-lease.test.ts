/**
 * T-0140 lote 03 — RD-0033 (shell mobile): o `sync:lease` persistido saiu e a `TravaSync` do processo é a ÚNICA porta entre a
 * tarefa sem tela (`macuxi-sync-delta`, ADR 0017) e a sincronização do app. O que este arquivo prova, com o motor de sync REAL
 * do SDK sobre o MESMO SQLite em memória (o app e a tarefa no mesmo processo, como no Android):
 *  L1 sem dupla sincronização: tarefa sem tela rodando → o app espera, relê e só então sincroniza (no máximo 1 requisição de
 *     sync em voo, nunca duas passadas juntas no mesmo arquivo);
 *  L2 o app sincronizando → a tarefa desiste na hora (sem abrir motor) e roda na próxima vez;
 *  L3 sem trava presa depois de erro: cada passo da tarefa que falha (sessão, motor, preparo, sync sem rede, sync que lança,
 *     build novo) solta a trava, e o Sincronizar do app seguinte não espera nada;
 *  L4 processo morto no meio da tarefa: um `sync:lease` velho no armazenamento (APK v1.0.1) não segura nada;
 *  L5 passada cortada que não para: a trava fica com ela no máximo `LIMITE_DA_PASSADA_CORTADA_MS` (2 min) e depois o app segue;
 *  L6 nenhum código de produção do shell lê o lease, e o app segue o protocolo da trava (fonte de `state/plataforma.tsx`).
 * Os unitários do engenheiro-apps (`apps/mobile/src/lib/segundo-plano.test.ts`, `trava-sync.test.ts`) cobrem as regras com motor
 * falso; aqui é a integração com o motor e o armazenamento reais. Sem banco: roda local e no CI. Matriz: docs/testes/T-0140.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { criarRelogio } from '@macuxi/comum/relogio';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import {
  criarArmazenamentoSqlite,
  type ArmazenamentoSync,
  criarMotorSync,
  criarRegistroSync,
  criarServidorSyncSimulado,
  type LinhaSync,
  type MotorSync,
  type ServidorSyncSimulado,
  type TransporteSync,
} from '@macuxi/platform-sdk';
import { criarDriverNode } from '@macuxi/platform-sdk/sqlite-node';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  executarTarefaSegundoPlano,
  LIMITE_DA_PASSADA_CORTADA_MS,
  type DepsTarefaSegundoPlano,
  type MotorSegundoPlano,
} from '../../apps/mobile/src/lib/segundo-plano';
import { criarTravaSync, type TravaSync } from '../../apps/mobile/src/lib/trava-sync';
import { entidadesProduto } from '../../modules/core/app/lib/entidades-produto';

const RAIZ = join(__dirname, '..', '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');
const relogio = criarRelogio();
const CARGA = relogio.relativo({ horas: -3 }).toISOString();
const MUDANCA = relogio.relativo({ horas: -1 }).toISOString();
const P1 = '0e140000-0000-4000-8000-000000000001';
const P2 = '0e140000-0000-4000-8000-000000000002';
const produto = (id: string, nome: string, updated_at = CARGA): LinhaSync =>
  ({ id, updated_at, deleted_at: null, external_id: null, sku: nome.slice(0, 6).toUpperCase(), ean: null, nome, marca: null, categoria: null, unidade: 'UN', ativo: true }) as LinhaSync;

/** Transporte que conta as requisições de sync em voo (as duas passadas no mesmo arquivo = 2 em voo) e pode segurar o pull. */
function transporteContado(servidor: ServidorSyncSimulado) {
  const voo = { agora: 0, maximo: 0, total: 0 };
  let portao: Promise<void> | null = null;
  let abrir: () => void = () => undefined;
  const contar = async <T>(f: () => Promise<T>): Promise<T> => {
    voo.agora++;
    voo.total++;
    voo.maximo = Math.max(voo.maximo, voo.agora);
    try {
      if (portao) await portao;
      return await f();
    } finally {
      voo.agora--;
    }
  };
  const t: TransporteSync = {
    push: (itens) => contar(() => servidor.push(itens)),
    pull: (e, c) => contar(() => servidor.pull(e, c)),
  };
  return {
    t,
    voo,
    segurar() {
      portao = new Promise<void>((r) => (abrir = r));
    },
    soltar() {
      portao = null;
      abrir();
    },
  };
}

interface Processo {
  trava: TravaSync;
  servidor: ServidorSyncSimulado;
  rede: ReturnType<typeof transporteContado>;
  /** Motor do app (com tela) e motor da tarefa (sem tela), sobre o MESMO armazenamento. */
  app: MotorSync;
  tarefa: MotorSync;
  /** O armazenamento do usuário (SQLite), o mesmo dos dois motores. */
  armazenamento: ArmazenamentoSync;
  abertos: number;
}

async function processo(): Promise<Processo> {
  const registro = criarRegistroSync([manifestoCore]);
  for (const e of entidadesProduto) registro.registrar(e);
  const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core'], linhas: { produto: [produto(P1, 'Pastilha')], produto_unidade: [], medida: [] } });
  const rede = transporteContado(servidor);
  const armazenamento = criarArmazenamentoSqlite(criarDriverNode(':memory:'), { entidades: entidadesProduto.map((e) => ({ nome: e.nome, modulo: e.modulo })) });
  const novoMotor = async () => {
    const m = criarMotorSync({ registro, armazenamento, transporte: rede.t, online: () => servidor.online });
    await m.aplicarModulosAtivos(['core']);
    return m;
  };
  const app = await novoMotor();
  expect(await app.sincronizar(), 'carga inicial (com tela)').toBe(true);
  const tarefa = await novoMotor();
  await tarefa.carregar();
  return { trava: criarTravaSync(), servidor, rede, app, tarefa, armazenamento, abertos: 0 };
}

/**
 * A sincronização do app como `executarSync` de `apps/mobile/src/state/plataforma.tsx` (L6 confere a fonte): entra na trava
 * sem esperar por ela; tarefa sem tela rodando = espera, relê o que ela gravou e só então sincroniza; sai no `finally`.
 */
async function sincronizarDoApp(p: Processo, m: MotorSync = p.app): Promise<boolean> {
  p.trava.entrar('sincronizacao');
  try {
    if (p.trava.segundoPlanoAtivo()) {
      await p.trava.esperarSegundoPlano();
      await m.carregar();
    }
    return await m.sincronizar();
  } finally {
    p.trava.sair('sincronizacao');
  }
}

const motorDaTarefa = (m: MotorSync, o: Partial<MotorSegundoPlano> = {}): MotorSegundoPlano => ({
  sincronizadoEm: () => m.estado().sincronizado_em,
  prepararSessao: async () => 'ok',
  sincronizar: () => m.sincronizar(),
  erro: () => m.estado().erro ?? null,
  ...o,
});

function deps(p: Processo, o: Partial<DepsTarefaSegundoPlano> = {}): DepsTarefaSegundoPlano {
  return {
    agora: () => Date.now(),
    modoSemSinal: async () => false,
    motorDoApp: () => null,
    usuarioDaSessao: async () => 'usuario-1',
    abrirMotor: async () => {
      p.abertos++;
      return motorDaTarefa(p.tarefa);
    },
    appEmPrimeiroPlano: () => false,
    trava: p.trava,
    buildAindaNaoAberto: async () => false,
    ...o,
  };
}

const livre = (p: Processo) => {
  expect(p.trava.segundoPlanoAtivo(), 'trava da tarefa solta').toBe(false);
  expect(p.trava.appOcupado(), 'app sem atividade presa').toBe(false);
};

afterEach(() => {
  vi.useRealTimers();
});

describe('T-0140 lote 03 — RD-0033: sync sem lease, a TravaSync é a única porta (ADR 0017 §3)', () => {
  it('L1. tarefa sem tela sincronizando: o app espera, relê o que ela gravou e sincroniza depois; nunca 2 passadas em voo', async () => {
    const p = await processo();
    p.servidor.linhas.produto = [...p.servidor.linhas.produto!, produto(P2, 'Lona', MUDANCA)];
    p.rede.voo.maximo = 0;
    p.rede.segurar();
    const tarefa = executarTarefaSegundoPlano(deps(p));
    await vi.waitFor(() => expect(p.rede.voo.agora).toBe(1));
    expect(p.trava.segundoPlanoAtivo()).toBe(true);
    const app = sincronizarDoApp(p);
    // o app não faz requisição enquanto a tarefa segura a passada
    await new Promise((r) => setTimeout(r, 30));
    expect(p.rede.voo.agora).toBe(1);
    p.rede.soltar();
    expect(await tarefa).toMatchObject({ resultado: 'sincronizado', sem_tela: true });
    expect(await app).toBe(true);
    expect(p.rede.voo.maximo, 'requisições de sync em voo ao mesmo tempo').toBe(1);
    // o app enxerga o produto que a tarefa gravou
    expect((await p.app.linhas('produto')).map((l) => l.id).sort()).toEqual([P1, P2].sort());
    livre(p);
  });

  it('L2. app sincronizando: a tarefa desiste na hora ("app-ocupado"), sem abrir o motor; depois roda normalmente', async () => {
    const p = await processo();
    p.rede.segurar();
    const app = sincronizarDoApp(p);
    await vi.waitFor(() => expect(p.rede.voo.agora).toBe(1));
    expect(await executarTarefaSegundoPlano(deps(p))).toMatchObject({ resultado: 'pulado', motivo: 'app-ocupado' });
    expect(p.abertos).toBe(0);
    p.rede.soltar();
    expect(await app).toBe(true);
    expect(await executarTarefaSegundoPlano(deps(p))).toMatchObject({ resultado: 'sincronizado' });
    expect(p.abertos).toBe(1);
    livre(p);
  });

  const FALHAS: Array<{ nome: string; o: (p: Processo) => Partial<DepsTarefaSegundoPlano>; esperado: Record<string, unknown> }> = [
    { nome: 'sessão guardada ilegível (lança)', o: () => ({ usuarioDaSessao: () => Promise.reject(new Error('json corrompido')) }), esperado: { resultado: 'falhou' } },
    { nome: 'sem sessão no aparelho', o: () => ({ usuarioDaSessao: async () => null }), esperado: { resultado: 'pulado', motivo: 'sem-sessao' } },
    { nome: 'o SQLite não abre (abrirMotor lança)', o: () => ({ abrirMotor: () => Promise.reject(new Error('database is locked')) }), esperado: { resultado: 'falhou', mensagem: 'database is locked' } },
    { nome: 'conferência do build lança', o: () => ({ buildAindaNaoAberto: () => Promise.reject(new Error('x')) }), esperado: { resultado: 'falhou' } },
    { nome: 'build novo ainda não aberto com tela', o: () => ({ buildAindaNaoAberto: async () => true }), esperado: { resultado: 'pulado', motivo: 'app-atualizado' } },
    { nome: 'carga inicial não concluída', o: (p) => ({ abrirMotor: async () => motorDaTarefa(p.tarefa, { sincronizadoEm: () => null }) }), esperado: { resultado: 'pulado', motivo: 'sem-carga' } },
    { nome: 'sessão expirada', o: (p) => ({ abrirMotor: async () => motorDaTarefa(p.tarefa, { prepararSessao: async () => 'sessao-invalida' }) }), esperado: { resultado: 'pulado', motivo: 'sessao-invalida' } },
    { nome: 'aparelho bloqueado (RN-CORE-15)', o: (p) => ({ abrirMotor: async () => motorDaTarefa(p.tarefa, { prepararSessao: async () => 'aparelho-bloqueado' }) }), esperado: { resultado: 'pulado', motivo: 'aparelho-bloqueado' } },
    { nome: 'preparo da sessão lança', o: (p) => ({ abrirMotor: async () => motorDaTarefa(p.tarefa, { prepararSessao: () => Promise.reject(new Error('refresh 500')) }) }), esperado: { resultado: 'falhou' } },
    { nome: 'sincronizar lança', o: (p) => ({ abrirMotor: async () => motorDaTarefa(p.tarefa, { sincronizar: () => Promise.reject(new TypeError('Network request failed')) }) }), esperado: { resultado: 'falhou' } },
  ];

  it.each(FALHAS)('L3. sem trava presa depois de erro: $nome → a tarefa devolve e o app sincroniza na hora', async ({ o, esperado }) => {
    const p = await processo();
    expect(await executarTarefaSegundoPlano(deps(p, o(p)))).toMatchObject(esperado);
    livre(p);
    // o Sincronizar do app não espera ninguém (sem passada em andamento) e a próxima tarefa toma a trava
    const espera = vi.fn();
    void p.trava.esperarSegundoPlano().then(espera);
    await Promise.resolve();
    expect(espera).toHaveBeenCalled();
    expect(await sincronizarDoApp(p)).toBe(true);
    expect(await executarTarefaSegundoPlano(deps(p))).toMatchObject({ resultado: 'sincronizado' });
    livre(p);
  });

  it('L3b. sem rede no meio da passada sem tela (sync devolve false): "falhou" com a mensagem e a trava solta', async () => {
    const p = await processo();
    p.servidor.online = false;
    const r = await executarTarefaSegundoPlano(deps(p));
    expect(r.resultado).toBe('falhou');
    expect(r.mensagem).toBeTruthy();
    livre(p);
    p.servidor.online = true;
    expect(await sincronizarDoApp(p)).toBe(true);
  });

  it('L4. processo morto durante a tarefa (APK v1.0.1 deixou `sync:lease` válido no armazenamento): nada é lido, app e tarefa seguem', async () => {
    const p = await processo();
    const futuro = relogio.relativo({ minutos: 2 }).toISOString();
    await p.armazenamento.gravar('sync:lease', { dono: 'segundo-plano:1', expira_em: futuro });
    expect(await p.armazenamento.ler('sync:lease')).toMatchObject({ expira_em: futuro });
    // processo novo = trava nova (nada persistido)
    p.trava = criarTravaSync();
    expect(await sincronizarDoApp(p)).toBe(true);
    expect(await executarTarefaSegundoPlano(deps(p))).toMatchObject({ resultado: 'sincronizado' });
    livre(p);
  });

  it('L5. passada cortada que não para: a trava fica com ela até o limite de 2 min; o app espera e depois segue', async () => {
    vi.useFakeTimers();
    const p = await processo();
    const presa = new Promise<boolean>(() => undefined); // requisição que nunca volta
    const r = executarTarefaSegundoPlano(
      deps(p, {
        orcamentoMs: 60_000,
        esperaDoCorteMs: 10_000,
        aoEsgotarOrcamento: () => undefined,
        abrirMotor: async () => motorDaTarefa(p.tarefa, { sincronizar: () => presa }),
      }),
    );
    await vi.advanceTimersByTimeAsync(70_000);
    expect(await r).toMatchObject({ resultado: 'parcial', sem_tela: true });
    expect(p.trava.segundoPlanoAtivo(), 'a passada segue com a trava').toBe(true);
    const appTerminou = vi.fn();
    const app = sincronizarDoApp(p, { carregar: async () => undefined, sincronizar: async () => true } as unknown as MotorSync).then(appTerminou);
    await vi.advanceTimersByTimeAsync(LIMITE_DA_PASSADA_CORTADA_MS - 1_000);
    expect(appTerminou).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    await app;
    expect(appTerminou).toHaveBeenCalledWith(true);
    livre(p);
  });

  it('L5b. passada cortada que para depois do corte: a trava sai junto, sem esperar os 2 min', async () => {
    vi.useFakeTimers();
    const p = await processo();
    let parar: (v: boolean) => void = () => undefined;
    const passada = new Promise<boolean>((res) => (parar = res));
    const r = executarTarefaSegundoPlano(
      deps(p, { orcamentoMs: 60_000, esperaDoCorteMs: 10_000, aoEsgotarOrcamento: () => setTimeout(() => parar(false), 3_000), abrirMotor: async () => motorDaTarefa(p.tarefa, { sincronizar: () => passada }) }),
    );
    await vi.advanceTimersByTimeAsync(64_000);
    expect(await r).toMatchObject({ resultado: 'parcial' });
    livre(p);
  });

  it('L6. fonte: nenhum código do shell lê o lease, e o Sincronizar do app entra na trava, espera a tarefa, relê e sai no finally', () => {
    const arquivos = ['apps/mobile/src/state/plataforma.tsx', 'apps/mobile/src/services/segundo-plano.ts', 'apps/mobile/src/lib/segundo-plano.ts', 'apps/mobile/src/services/motor-do-usuario.ts', 'apps/mobile/src/services/armazenamento.ts'];
    for (const a of arquivos) {
      const fonte = ler(a).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(fonte, a).not.toMatch(/sync:lease|CHAVE_LEASE|leaseOcupado|novoLease|passadaEmSegundoPlano|DONO_APP/);
    }
    const plataforma = ler('apps/mobile/src/state/plataforma.tsx');
    const inicio = plataforma.indexOf('const executarSync = useCallback(');
    expect(inicio).toBeGreaterThan(0);
    const corpo = plataforma.slice(inicio, plataforma.indexOf('[atualizarModulos, modo]', inicio));
    const pos = (s: string) => {
      const i = corpo.indexOf(s);
      expect(i, s).toBeGreaterThanOrEqual(0);
      return i;
    };
    expect(pos("travaSync.entrar('sincronizacao')")).toBeLessThan(pos('travaSync.segundoPlanoAtivo()'));
    expect(pos('travaSync.segundoPlanoAtivo()')).toBeLessThan(pos('await travaSync.esperarSegundoPlano()'));
    expect(pos('await travaSync.esperarSegundoPlano()')).toBeLessThan(pos('await m.carregar()'));
    expect(pos('.finally(')).toBeLessThan(pos("travaSync.sair('sincronizacao')"));
    // a abertura do app também segura a trava e solta no finally
    expect(plataforma).toMatch(/travaSync\.entrar\('abertura'\)[\s\S]*\.finally\(\(\) => travaSync\.sair\('abertura'\)\)/);
  });
});
