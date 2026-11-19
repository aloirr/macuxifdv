/**
 * ADR 0054 (solução 5, entrar enquanto o catálogo carrega): o motor do usuário recebe os `essenciais` do Core (envio e
 * "Clientes e rota"/"Equipe") e liga a busca online do Catálogo (`definirCargaOnline`) a ele; a tarefa em segundo plano
 * (`cargaOnline: false`) não troca a porta do app.
 */
import { criarArmazenamentoEmMemoria, criarRegistroSync, type AmbienteAparelho, type MotorSync, type OpcoesMotorSync } from '@macuxi/platform-sdk';
import type { BancoDoTrajeto } from '@macuxi/core/app';
import { beforeEach, describe, expect, it, vi } from 'vitest';


const sim = vi.hoisted(() => ({
  opcoes: null as unknown as OpcoesMotorSync,
  definir: [] as unknown[],
  pendentes: undefined as readonly string[] | undefined,
  essenciais: () => false,
  perfilDosEssenciais: null as (() => string | null | undefined) | null,
  passos: [] as string[],
  pushes: 0,
  erros: [] as { mensagem: string; onde: string | null }[],
}));

vi.mock('react-native', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('react-native-safe-area-context', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('react-native-svg', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('expo-router', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('@macuxi/ui/mobile', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('@macuxi/catalogo/app', () => ({ definirCargaOnline: (p: unknown) => sim.definir.push(p) }));
vi.mock('@/lib/ordem-da-carga', () => ({
  ordemDaCargaDoUsuario: () => () => 0,
  essenciaisDoUsuario: (perfil: () => string | null | undefined) => ((sim.perfilDosEssenciais = perfil), sim.essenciais),
}));
vi.mock('./arquivos', () => ({ arquivosLocais: () => undefined }));
vi.mock('./credenciais', () => ({ gravarTokens: async () => undefined, lerTokens: async () => null }));
vi.mock('./device', () => ({ uuid: () => '00000000-0000-4000-8000-000000000000' }));
vi.mock('./storage', () => ({ readJson: async () => null, writeJson: async () => undefined }));
vi.mock('./erros', () => ({
  gravarErro: async (e: Error, _origem: string, onde: string | null) => void sim.erros.push({ mensagem: e.message, onde }),
}));
vi.mock('./transporte', () => {
  // o transporte do motor recusa (sem rede no meio do envio): a mensagem dele leva coordenada, que não pode chegar ao Diagnóstico
  const transporte = { push: async () => (sim.pushes++, Promise.reject(new Error('sem rede em -3.119027'))) };
  return { modoSync: () => 'v1', transporteV1: () => transporte, transporteFaseM: () => transporte };
});
vi.mock('@macuxi/platform-sdk', async (original) => ({
  ...(await original<typeof import('@macuxi/platform-sdk')>()),
  criarMotorSync: (o: OpcoesMotorSync) => {
    sim.opcoes = o;
    return {
      estado: () => ({ modulosAtivos: ['core', 'catalogo', 'vendedor'], pendentes: sim.pendentes }),
      sincronizar: async () => (sim.passos.push('sincronizar'), true),
    } as unknown as MotorSync;
  },
}));

const { criarMotorDoUsuario, portaCargaOnline } = await import('./motor-do-usuario');

const pedidos: { caminho: string; query: unknown }[] = [];
const ambiente = {
  online: () => true,
  http: { get: async (caminho: string, query?: unknown) => (pedidos.push({ caminho, query }), { ok: true }) },
} as unknown as AmbienteAparelho;

function montar(o: { perfil?: string; cargaOnline?: boolean; bancoDoTrajeto?: () => BancoDoTrajeto | null } = {}) {
  return criarMotorDoUsuario({
    usuarioId: 'u1',
    armazenamento: criarArmazenamentoEmMemoria(),
    shell: { registroSync: criarRegistroSync([]), etapasSync: [], consultas: undefined } as never,
    modo: 'v1',
    api: () => {
      throw new Error('sem API no teste');
    },
    online: () => true,
    ambiente,
    perfil: () => o.perfil ?? 'vendedor',
    ...(o.cargaOnline === undefined ? {} : { cargaOnline: o.cargaOnline }),
    ...(o.bancoDoTrajeto ? { bancoDoTrajeto: o.bancoDoTrajeto } : {}),
  });
}

beforeEach(() => {
  sim.definir = [];
  sim.pendentes = undefined;
  pedidos.length = 0;
  sim.passos = [];
  sim.pushes = 0;
  sim.erros = [];
});

describe('motor do usuário — entrada enquanto carrega (ADR 0054)', () => {
  it('passa ao motor os essenciais do usuário, com o perfil da sessão (a regra é testada no Core)', () => {
    montar({ perfil: 'supervisor' });
    expect(sim.opcoes.essenciais).toBe(sim.essenciais);
    expect(sim.perfilDosEssenciais?.()).toBe('supervisor');
  });

  it('liga a busca online do Catálogo ao motor do app; a tarefa em segundo plano não troca a porta', () => {
    montar();
    expect(sim.definir).toHaveLength(1);
    montar({ cargaOnline: false });
    expect(sim.definir).toHaveLength(1);
  });
});

describe('motor do usuário — pontos do trajeto depois de cada envio (T-0156, RN-CORE-13)', () => {
  const linha = {
    id: '0b9a4c1e-7f3d-4a2b-9c8d-1e2f3a4b5c6d',
    capturado_em: '2026-11-19T13:00:00.000Z',
    latitude: -3.119027,
    longitude: -60.021731,
    precisao_m: 12,
    velocidade_ms: null,
  };
  const banco = { todas: async () => [linha], rodar: async () => ({ alteradas: 0 }) } as unknown as BancoDoTrajeto;

  it('usa o push do transporte do motor; a falha não para o sync e o Diagnóstico recebe só contagens', async () => {
    const m = montar({ bancoDoTrajeto: () => banco });
    expect(await m.sincronizar()).toBe(true);
    expect(sim.pushes).toBe(1);
    expect(sim.passos).toEqual(['sincronizar']);
    expect(sim.erros).toHaveLength(1);
    expect(sim.erros[0]?.onde).toBe('envio do trajeto');
    expect(sim.erros[0]?.mensagem).not.toMatch(/-?\d+\.\d{3,}|0b9a4c1e/);
  });
});

describe('portaCargaOnline', () => {
  it('pendentes do motor (ausente = motor sem a peça), sinal e GET pelo ambiente do shell', async () => {
    const motor = { estado: () => ({ pendentes: sim.pendentes }) } as unknown as MotorSync;
    const porta = portaCargaOnline(motor, ambiente);
    expect(porta.pendentes()).toBeUndefined();
    sim.pendentes = ['produto'];
    expect(porta.pendentes()).toEqual(['produto']);
    expect(porta.online()).toBe(true);
    expect(await porta.get('/v1/catalogo/busca', { q: 'cimento' })).toEqual({ ok: true });
    expect(pedidos).toEqual([{ caminho: '/v1/catalogo/busca', query: { q: 'cimento' } }]);
  });
});
