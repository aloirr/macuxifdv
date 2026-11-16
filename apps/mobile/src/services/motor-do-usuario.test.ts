/**
 * ADR 0054 (solução 5, entrar enquanto o catálogo carrega): o motor do usuário recebe os `essenciais` do Core (envio e
 * "Clientes e rota"/"Equipe") e liga a busca online do Catálogo (`definirCargaOnline`) a ele; a tarefa em segundo plano
 * (`cargaOnline: false`) não troca a porta do app.
 */
import { criarArmazenamentoEmMemoria, criarRegistroSync, type AmbienteAparelho, type MotorSync, type OpcoesMotorSync } from '@macuxi/platform-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';


const sim = vi.hoisted(() => ({
  opcoes: null as unknown as OpcoesMotorSync,
  definir: [] as unknown[],
  pendentes: undefined as readonly string[] | undefined,
  essenciais: () => false,
  perfilDosEssenciais: null as (() => string | null | undefined) | null,
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
vi.mock('./transporte', () => ({ modoSync: () => 'v1', transporteV1: () => ({}), transporteFaseM: () => ({}) }));
vi.mock('@macuxi/platform-sdk', async (original) => ({
  ...(await original<typeof import('@macuxi/platform-sdk')>()),
  criarMotorSync: (o: OpcoesMotorSync) => {
    sim.opcoes = o;
    return { estado: () => ({ modulosAtivos: ['core', 'catalogo', 'vendedor'], pendentes: sim.pendentes }) } as unknown as MotorSync;
  },
}));

const { criarMotorDoUsuario, portaCargaOnline } = await import('./motor-do-usuario');

const pedidos: { caminho: string; query: unknown }[] = [];
const ambiente = {
  online: () => true,
  http: { get: async (caminho: string, query?: unknown) => (pedidos.push({ caminho, query }), { ok: true }) },
} as unknown as AmbienteAparelho;

function montar(o: { perfil?: string; cargaOnline?: boolean } = {}) {
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
  });
}

beforeEach(() => {
  sim.definir = [];
  sim.pendentes = undefined;
  pedidos.length = 0;
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
