/**
 * RN-CORE-48 (pedido do dono do produto, 14/11: "1 de 5, 2 de 5, 3 de 5..."): a tela de entrada mostrava as etapas pulando
 * (1 de 5 → 4 de 5 → 1 de 5 → 3 de 5) porque o motor puxa as entidades em ordem alfabética, de todos os módulos misturados,
 * e roda as etapas extras no fim. Com `ordemDaCargaDoUsuario` o motor segue a ordem das etapas da tela e, com a memória da
 * entrada (`anterior`), o número mostrado é 1, 2, 3, 4, 5, sem voltar. Campo (vendedor) e Gestão (supervisor).
 */
import {
  criarArmazenamentoEmMemoria,
  criarMotorSync,
  criarRegistroSync,
  definirEntidadeSync,
  type EstadoMotorSync,
  type EtapaSync,
  type ItemDaCarga,
  type ModuloId,
  type TransporteSync,
} from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { criarMemoriaDaEntrada } from './entrada';
import { MANIFESTOS_INSTALADOS } from './instalados';
import { ordemDaCargaDoUsuario } from './ordem-da-carga';

// o índice de `@macuxi/core/app` (API pública do Core) puxa telas: os módulos nativos viram vazios e a regra pura é a real
vi.mock('react-native', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('react-native-safe-area-context', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('react-native-svg', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('expo-router', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
vi.mock('@macuxi/ui/mobile', () => import('@/teste/nativo-vazio').then((m) => m.moduloVazio()));
const { progressoDaEntrada } = await import('@macuxi/core/app');

/** Registro com todas as entidades dos manifestos instalados (a mistura real de módulos, em ordem alfabética no motor). */
function registroCompleto() {
  const registro = criarRegistroSync(MANIFESTOS_INSTALADOS);
  for (const m of MANIFESTOS_INSTALADOS) {
    for (const nome of m.sync) {
      registro.registrar(
        definirEntidadeSync({
          nome,
          modulo: m.id,
          direcao: 'pull',
          conflito: 'servidor_vence',
          schema: z.object({}).passthrough(),
        }),
      );
    }
  }
  return registro;
}

const etapa = (id: string, modulo: ModuloId): EtapaSync => ({
  id,
  rotulo: id,
  modulo,
  executar: async () => {},
});
/** As etapas do shell, na ordem em que entram no motor (`me` da demonstração, Core, Gestor e Vendedor). */
const ETAPAS: readonly EtapaSync[] = [
  etapa('me', 'core'),
  etapa('metas', 'core'),
  etapa('pedidos-da-visita', 'core'),
  etapa('core-inicio', 'core'),
  etapa('core-rv', 'core'),
  etapa('gestor-equipe', 'gestor'),
  etapa('alcadas', 'vendedor'),
  etapa('carteira', 'vendedor'),
  etapa('produtos', 'vendedor'),
  etapa('pedidos', 'vendedor'),
];

const transporte: TransporteSync = {
  push: async (itens) => itens.map((i) => ({ id: i.id, status: 'aceito' as const })),
  pull: async () => ({ itens: [], proximo_cursor: null }),
};

/** Roda uma carga completa e devolve os números de etapa mostrados na tela, em ordem (sem repetir os iguais seguidos). */
async function numerosMostrados(
  perfil: string,
  modulos: ModuloId[],
  o: { ordenar: boolean; lembrar: boolean },
) {
  const motor = criarMotorSync({
    registro: registroCompleto(),
    armazenamento: criarArmazenamentoEmMemoria(),
    transporte,
    online: () => true,
    etapas: ETAPAS,
    ...(o.ordenar
      ? {
          ordemDaCarga: ordemDaCargaDoUsuario(
            () => perfil,
            () => motor.estado().modulosAtivos,
          ),
        }
      : {}),
  });
  await motor.carregar();
  await motor.aplicarModulosAtivos(modulos);
  const lembrar = criarMemoriaDaEntrada();
  const mostrados: number[] = [];
  const ver = (e: EstadoMotorSync) => {
    const calcular = (anterior: Parameters<typeof progressoDaEntrada>[0]['anterior']) =>
      progressoDaEntrada({
        perfil,
        modulos: e.modulosAtivos,
        carga: e.carga,
        progresso: e.progresso,
        sincronizando: e.sincronizando,
        erro: e.erro,
        sincronizado: Boolean(e.sincronizado_em),
        anterior,
      });
    const p = o.lembrar ? lembrar('u1|t1', calcular) : calcular(null);
    if (mostrados.at(-1) !== p.atual.numero) mostrados.push(p.atual.numero);
  };
  ver(motor.estado());
  const sair = motor.assinar(ver);
  expect(await motor.sincronizar()).toBe(true);
  sair();
  return mostrados;
}

const crescente = (xs: number[]) => xs.every((x, i) => i === 0 || x > xs[i - 1]!);

describe.each([
  ['Campo', 'vendedor', ['core', 'catalogo', 'vendedor', 'promotor']],
  ['Gestão', 'supervisor', ['core', 'catalogo', 'vendedor', 'gestor']],
] as const)('%s (%s): etapas da sincronização em sequência (RN-CORE-48)', (_app, perfil, modulos) => {
  it('sem a ordem do usuário as etapas pulam e voltam (o defeito relatado)', async () => {
    const xs = await numerosMostrados(perfil, [...modulos], { ordenar: false, lembrar: false });
    expect(crescente(xs)).toBe(false);
  });

  it('com a ordem do usuário e a memória da entrada: 1, 2, 3, 4, 5 de 5', async () => {
    expect(await numerosMostrados(perfil, [...modulos], { ordenar: true, lembrar: true })).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it('a ordem do usuário sozinha já percorre as etapas em sequência', async () => {
    expect(await numerosMostrados(perfil, [...modulos], { ordenar: true, lembrar: false })).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });
});

describe('ordemDaCargaDoUsuario', () => {
  it('chave = número da etapa do perfil; lê perfil e módulos a cada chamada', () => {
    let perfil: string | null = 'vendedor';
    let modulos: string[] = ['core', 'catalogo', 'vendedor', 'promotor'];
    const ordem = ordemDaCargaDoUsuario(
      () => perfil,
      () => modulos,
    );
    const item = (chave: string, modulo: ModuloId | null): ItemDaCarga => ({
      chave,
      modulo,
      tipo: 'entidade',
    });
    expect(ordem(item('cliente', 'core'))).toBe(2);
    expect(ordem(item('produto', 'catalogo'))).toBe(3);
    expect(ordem(item('pedido', 'vendedor'))).toBe(4);
    expect(ordem(item('carteira', 'vendedor'))).toBe(4);
    expect(ordem(item('questionario', 'pesquisa'))).toBe(5);
    // sem o Catálogo, o Campo tem 4 etapas e "Pedidos e metas" passa a ser a 3
    modulos = ['core', 'vendedor', 'promotor'];
    expect(ordem(item('pedido', 'vendedor'))).toBe(3);
    perfil = 'supervisor';
    modulos = ['core', 'catalogo', 'vendedor', 'gestor'];
    expect(ordem(item('painel_vendedor_dia', 'gestor'))).toBe(2);
    expect(ordem(item('pedido', 'vendedor'))).toBe(3);
    expect(ordem(item('meta', 'core'))).toBe(4);
    expect(ordem(item('alerta', 'gestor'))).toBe(5);
  });
});
