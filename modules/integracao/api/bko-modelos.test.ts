import type { ContextoRota } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { DicionarioModelo, ENTIDADES } from '../contracts';
import { rotaModeloCsv, rotaModeloDicionario } from './bko-modelos';

// só `usuario.perfil` e `params` são lidos: as rotas não tocam o banco
const ctx = (perfil: string, entidade: string) => ({ usuario: { perfil }, params: { entidade } }) as unknown as ContextoRota;

const falha = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { status: number; codigo: string; message: string });

describe('RF-INT-03: rotas dos modelos CSV', () => {
  it('RF-INT-03: as rotas usam a ação modelo.baixar e os caminhos combinados', () => {
    expect(rotaModeloCsv).toMatchObject({ metodo: 'GET', caminho: 'modelos/:entidade/csv', acao: 'modelo.baixar', carteira: 'nao_se_aplica' });
    expect(rotaModeloDicionario).toMatchObject({ metodo: 'GET', caminho: 'modelos/:entidade/dicionario', acao: 'modelo.baixar' });
  });

  it.each(ENTIDADES)('RF-INT-03: admin baixa o CSV e o dicionário de "%s"', async (entidade) => {
    const csv = (await rotaModeloCsv.executar(ctx('admin', entidade))) as string;
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const d = DicionarioModelo.parse(await rotaModeloDicionario.executar(ctx('admin', entidade)));
    expect(d.entidade).toBe(entidade);
    expect(d.arquivo).toBe(`${entidade}.csv`);
    expect(csv).toContain(d.campos.map((c) => c.campo).join(';'));
  });

  it.each(['analista', 'vendedor', 'supervisor'])('RF-INT-03: perfil %s recebe 403 PERFIL_SEM_ACESSO', async (perfil) => {
    for (const rota of [rotaModeloCsv, rotaModeloDicionario]) {
      expect(await falha(rota.executar(ctx(perfil, 'cliente') as never))).toMatchObject({ status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    }
  });

  it('RF-INT-03: entidade desconhecida é 404 ENTIDADE_DESCONHECIDA com a lista das válidas', async () => {
    for (const rota of [rotaModeloCsv, rotaModeloDicionario]) {
      const e = await falha(rota.executar(ctx('admin', 'pedido') as never));
      expect(e).toMatchObject({ status: 404, codigo: 'ENTIDADE_DESCONHECIDA' });
      expect(e?.message).toContain('vendedor');
    }
  });
});
