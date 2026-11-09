import { matrizDeFabrica, perfilDeFabrica, PERFIS, pode, resolverPerfil, type ContextoRota } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { DicionarioModelo, ENTIDADES } from '../contracts';
import { manifest } from '../manifest';
import { rotaModeloCsv, rotaModeloDicionario } from './bko-modelos';

// só `superAdmin`, `usuario.perfil` e `params` são lidos: as rotas não tocam o banco
const ctx = (entidade: string, superAdmin: boolean, perfil = 'admin') =>
  ({ usuario: { perfil }, params: { entidade }, ...(superAdmin ? { superAdmin: { id: 'sa' } } : {}) }) as unknown as ContextoRota;

const falha = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as { status: number; codigo: string; message: string });

describe('RF-INT-03/T-0100: rotas dos modelos CSV (ação carga.arquivo pelo motor de permissões, ADR 0033)', () => {
  it('T-0100: as rotas declaram a ação carga.arquivo (sem perfil fixo), superAdmin "aceita", caminho com .csv, tipo CSV e nome do arquivo pela entidade', () => {
    expect(rotaModeloCsv).toMatchObject({ metodo: 'GET', caminho: 'modelos/:entidade.csv', acao: 'carga.arquivo', superAdmin: 'aceita', tipoConteudo: 'text/csv; charset=utf-8', carteira: 'nao_se_aplica' });
    expect(rotaModeloDicionario).toMatchObject({ metodo: 'GET', caminho: 'modelos/:entidade/dicionario', acao: 'carga.arquivo', superAdmin: 'aceita' });
    expect(rotaModeloCsv.perfis).toBeUndefined();
    expect(rotaModeloDicionario.perfis).toBeUndefined();
    const nome = rotaModeloCsv.nomeArquivo as (e: unknown) => string;
    expect(nome({ params: { entidade: 'cliente_endereco' } })).toBe('cliente_endereco.csv');
    for (const e of ENTIDADES) expect(nome({ params: { entidade: e } })).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
    expect(nome({ params: { entidade: '../x' } })).toBe('modelo.csv');
  });

  it('T-0100: de fábrica só admin e analista têm carga.arquivo; vendedor, promotor, supervisor, gerente e assistente recebem 403 na plataforma', () => {
    const matriz = matrizDeFabrica([manifest]);
    const com = PERFIS.filter((p) => pode([resolverPerfil(perfilDeFabrica(p), matriz)], 'carga.arquivo'));
    expect(com.sort()).toEqual(['admin', 'analista']);
  });

  it('T-0100: o admin do cliente tira a chave de um perfil na página Perfis de acesso e o modelo deixa de baixar (sem perfil fixo no código)', () => {
    const matriz = matrizDeFabrica([manifest]);
    const semChave = resolverPerfil({ ...perfilDeFabrica('analista'), fabrica: false, codigo: 'analista_ro', sobreposicoes: [{ chave: 'carga.arquivo', concedida: false }] }, matriz);
    expect(pode([semChave], 'carga.arquivo')).toBe(false);
    expect(pode([resolverPerfil(perfilDeFabrica('admin'), matriz)], 'carga.arquivo')).toBe(true);
  });

  it.each(ENTIDADES)('RF-INT-03: super-admin baixa o CSV (com BOM) e o dicionário de "%s"', async (entidade) => {
    const csv = (await rotaModeloCsv.executar(ctx(entidade, true))) as string;
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const d = DicionarioModelo.parse(await rotaModeloDicionario.executar(ctx(entidade, true)));
    expect(d.entidade).toBe(entidade);
    expect(d.arquivo).toBe(`${entidade}.csv`);
    expect(csv).toContain(d.campos.map((c) => c.campo).join(';'));
  });

  it.each(['admin', 'analista'])('T-0100: o usuário do tenant (%s) baixa o CSV e o dicionário sem ser super-admin (a barreira é a ação, não o handler)', async (perfil) => {
    const csv = (await rotaModeloCsv.executar(ctx('cliente', false, perfil) as never)) as string;
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(DicionarioModelo.parse(await rotaModeloDicionario.executar(ctx('cliente', false, perfil) as never)).entidade).toBe('cliente');
  });

  it('T-0100: o modelo é igual para todas as empresas: nada do tenant entra no arquivo (só o contrato)', async () => {
    const a = (await rotaModeloCsv.executar({ usuario: { perfil: 'admin', tenant_id: 'tenant-a' }, params: { entidade: 'cliente' } } as never)) as string;
    const b = (await rotaModeloCsv.executar({ usuario: { perfil: 'admin', tenant_id: 'tenant-b' }, params: { entidade: 'cliente' } } as never)) as string;
    expect(a).toBe(b);
  });

  it('RF-INT-03: entidade desconhecida é 404 ENTIDADE_DESCONHECIDA com a lista das válidas', async () => {
    for (const rota of [rotaModeloCsv, rotaModeloDicionario]) {
      const e = await falha(rota.executar(ctx('pedido', true) as never));
      expect(e).toMatchObject({ status: 404, codigo: 'ENTIDADE_DESCONHECIDA' });
      expect(e?.message).toContain('vendedor');
    }
  });
});
