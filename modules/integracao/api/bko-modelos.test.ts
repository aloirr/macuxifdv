import type { ContextoRota } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { DicionarioModelo, ENTIDADES } from '../contracts';
import { rotaModeloCsv, rotaModeloDicionario } from './bko-modelos';

// só `superAdmin`, `usuario.perfil` e `params` são lidos: as rotas não tocam o banco
const ctx = (entidade: string, superAdmin: boolean, perfil = 'admin') =>
  ({ usuario: { perfil }, params: { entidade }, ...(superAdmin ? { superAdmin: { id: 'sa' } } : {}) }) as unknown as ContextoRota;

const falha = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { status: number; codigo: string; message: string });

describe('RF-INT-03: rotas dos modelos CSV (só super-admin, ADR 0029)', () => {
  it('RF-INT-03: as rotas declaram superAdmin "aceita" + perfis ["admin"], caminho com .csv, tipo CSV e nome do arquivo pela entidade', () => {
    expect(rotaModeloCsv).toMatchObject({ metodo: 'GET', caminho: 'modelos/:entidade.csv', superAdmin: 'aceita', perfis: ['admin'], tipoConteudo: 'text/csv; charset=utf-8', carteira: 'nao_se_aplica' });
    expect(rotaModeloDicionario).toMatchObject({ metodo: 'GET', caminho: 'modelos/:entidade/dicionario', superAdmin: 'aceita', perfis: ['admin'] });
    expect(rotaModeloCsv.acao).toBeUndefined();
    expect(rotaModeloDicionario.acao).toBeUndefined();
    const nome = rotaModeloCsv.nomeArquivo as (e: unknown) => string;
    expect(nome({ params: { entidade: 'cliente_endereco' } })).toBe('cliente_endereco.csv');
    for (const e of ENTIDADES) expect(nome({ params: { entidade: e } })).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
    expect(nome({ params: { entidade: '../x' } })).toBe('modelo.csv');
  });

  it.each(ENTIDADES)('RF-INT-03: super-admin baixa o CSV (com BOM) e o dicionário de "%s"', async (entidade) => {
    const csv = (await rotaModeloCsv.executar(ctx(entidade, true))) as string;
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const d = DicionarioModelo.parse(await rotaModeloDicionario.executar(ctx(entidade, true)));
    expect(d.entidade).toBe(entidade);
    expect(d.arquivo).toBe(`${entidade}.csv`);
    expect(csv).toContain(d.campos.map((c) => c.campo).join(';'));
  });

  it.each(['admin', 'analista'])('RF-INT-03: usuário do tenant (%s) sem superAdmin recebe 403 PERFIL_SEM_ACESSO no handler (na plataforma, só o admin chega aqui)', async (perfil) => {
    for (const rota of [rotaModeloCsv, rotaModeloDicionario]) {
      expect(await falha(rota.executar(ctx('cliente', false, perfil) as never))).toMatchObject({ status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    }
  });

  it('RF-INT-03: entidade desconhecida é 404 ENTIDADE_DESCONHECIDA com a lista das válidas', async () => {
    for (const rota of [rotaModeloCsv, rotaModeloDicionario]) {
      const e = await falha(rota.executar(ctx('pedido', true) as never));
      expect(e).toMatchObject({ status: 404, codigo: 'ENTIDADE_DESCONHECIDA' });
      expect(e?.message).toContain('vendedor');
    }
  });
});
