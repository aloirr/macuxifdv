import { describe, expect, it } from 'vitest';
import type { ContextoBase } from '@macuxi/platform-sdk';
import { PutAprovadoresRequest } from '../contracts';
import manifest from '../manifest';
import { niveisDosParametros } from '../domain';
import { rotaGravarAprovadores } from './aprovadores';

describe('T-0184 (P2 B, P5 B): quem aprova crédito e inadimplência (Parâmetros › Pedidos)', () => {
  it('RN-VEN-12 e RN-VEN-13: grava as duas chaves do módulo e devolve os níveis', async () => {
    const gravado: Array<Record<string, unknown>> = [];
    const ctx = { corpo: { aprovador_credito: 'analista', aprovador_inadimplencia: 'supervisor' }, gravarParametros: async (v: Record<string, unknown>) => void gravado.push(v) } as unknown as ContextoBase;
    const r = await rotaGravarAprovadores.executar(ctx as never);
    expect(gravado).toEqual([{ 'aprovacao.credito_nivel': 'analista', 'aprovacao.inadimplencia_nivel': 'supervisor' }]);
    expect(r).toEqual({ aprovador_credito: 'analista', aprovador_inadimplencia: 'supervisor' });
    expect(niveisDosParametros(gravado[0]!)).toEqual({ credito: 'analista', inadimplencia: 'supervisor' });
  });
  it('RN-VEN-12: nível fora de supervisor, gerente e analista é recusado pelo contrato', () => {
    expect(PutAprovadoresRequest.safeParse({ aprovador_credito: 'diretor', aprovador_inadimplencia: 'gerente' }).success).toBe(false);
    expect(PutAprovadoresRequest.safeParse({ aprovador_credito: 'gerente' }).success).toBe(false);
  });
  it('RN-PRO-01: só admin, analista e gerente gerenciam; o promotor nunca', () => {
    expect(rotaGravarAprovadores).toMatchObject({ metodo: 'PUT', caminho: 'alcadas/aprovadores', acao: 'alcada.gerenciar' });
    expect(manifest.acoes['alcada.gerenciar']!.perfis).toEqual(['admin', 'analista', 'gerente']);
  });
});
