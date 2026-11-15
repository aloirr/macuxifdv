/**
 * Estoque diário, parte E (ADR 0057, RN-CORE-61): o shell injeta no motor a regra da carga diária com o fuso do tenant e a
 * hora do parâmetro `catalogo.estoque_carga_hora` (sem parâmetro, 06:00).
 */
import type { OpcoesMotorSync } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';

const capturado = vi.hoisted(() => ({ op: null as OpcoesMotorSync | null, parametros: {} as Record<string, unknown> }));

vi.mock('@macuxi/platform-sdk', async (original) => ({
  ...(await original<typeof import('@macuxi/platform-sdk')>()),
  criarMotorSync: (op: OpcoesMotorSync) => {
    capturado.op = op;
    return { estado: () => ({ modulosAtivos: [] }), parametros: () => capturado.parametros };
  },
}));
vi.mock('./api', () => ({ ApiClient: class {}, errorMessage: String, HttpError: class {} }));
vi.mock('./arquivos', () => ({ arquivosLocais: () => undefined }));
vi.mock('./credenciais', () => ({ gravarTokens: vi.fn(), lerTokens: vi.fn() }));
vi.mock('./device', () => ({ uuid: () => 'u' }));
vi.mock('./storage', () => ({ readJson: vi.fn(), writeJson: vi.fn() }));
vi.mock('./transporte', () => ({ modoSync: () => 'v1', transporteFaseM: () => ({}), transporteV1: () => ({}) }));
vi.mock('@/lib/efetivos-locais', () => ({ efetivosSemServidor: () => [] }));
vi.mock('@/lib/ordem-da-carga', () => ({ ordemDaCargaDoUsuario: () => () => 0 }));

const { cargaDiariaDoUsuario, criarMotorDoUsuario } = await import('./motor-do-usuario');

/** 15/11 às 05:59 e às 06:01 em Manaus (UTC−4). */
const ANTES_DAS_6 = new Date('2026-11-15T09:59:00.000Z');
const DEPOIS_DAS_6 = new Date('2026-11-15T10:01:00.000Z');
/** Carga de ontem, 14/11 às 07:12 em Manaus. */
const ONTEM = '2026-11-14T11:12:00.000Z';

describe('cargaDiariaDoUsuario — fuso do tenant e hora do Catálogo', () => {
  it('sem parâmetro, 06:00 no fuso do tenant: antes das 6 a de ontem vale; depois, está devida', () => {
    const devida = cargaDiariaDoUsuario(() => 'America/Manaus', () => ({}));
    expect(devida(ONTEM, ANTES_DAS_6)).toBe(false);
    expect(devida(ONTEM, DEPOIS_DAS_6)).toBe(true);
    expect(devida(null, ANTES_DAS_6)).toBe(true);
  });

  it('usa `estoque_carga_hora` do Catálogo (lido a cada consulta)', () => {
    const parametros: Record<string, unknown> = { estoque_carga_hora: '07:00' };
    const devida = cargaDiariaDoUsuario(() => 'America/Manaus', () => parametros);
    expect(devida(ONTEM, DEPOIS_DAS_6)).toBe(false);
    parametros.estoque_carga_hora = '06:00';
    expect(devida(ONTEM, DEPOIS_DAS_6)).toBe(true);
  });

  it('usa o fuso do tenant: 06:01 em Manaus ainda é 05:01 em Rio Branco (UTC−5)', () => {
    // carga de 14/11 às 06:30 em Rio Branco (07:30 em Manaus)
    const ultima = '2026-11-14T11:30:00.000Z';
    expect(cargaDiariaDoUsuario(() => 'America/Manaus', () => ({}))(ultima, DEPOIS_DAS_6)).toBe(true);
    expect(cargaDiariaDoUsuario(() => 'America/Rio_Branco', () => ({}))(ultima, DEPOIS_DAS_6)).toBe(false);
  });

  it('sem fuso (demonstração), America/Manaus', () => {
    expect(cargaDiariaDoUsuario(() => null, () => undefined)(ONTEM, DEPOIS_DAS_6)).toBe(true);
  });
});

describe('criarMotorDoUsuario — injeção no motor', () => {
  it('passa `cargaDiariaDevida` com o fuso da sessão e os parâmetros do Catálogo do próprio motor', () => {
    capturado.parametros = { estoque_carga_hora: '07:00' };
    criarMotorDoUsuario({
      usuarioId: 'u1',
      armazenamento: {} as never,
      shell: { registroSync: {}, etapasSync: [], consultas: {} } as never,
      modo: 'v1',
      api: () => ({}) as never,
      online: () => true,
      ambiente: {} as never,
      fuso: () => 'America/Manaus',
    });
    const devida = capturado.op?.cargaDiariaDevida;
    expect(devida).toBeTypeOf('function');
    expect(devida?.(ONTEM, DEPOIS_DAS_6)).toBe(false);
    capturado.parametros = {};
    expect(devida?.(ONTEM, DEPOIS_DAS_6)).toBe(true);
  });
});
