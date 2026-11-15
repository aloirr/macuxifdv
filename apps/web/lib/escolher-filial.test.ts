/**
 * T-0176 (RN-CORE-39; spec docs/design/filial-cadastro-venda §5): "Escolha a sua filial" no BKO, a parte pura.
 * Leitura tolerante do `GET /v1/core/eu/filial-cadastro`, a ordem das filiais, os estados 16a a 16e e o resultado do PUT.
 */
import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { describe, expect, it, vi } from 'vitest';

import {
  depoisDeSalvar,
  estadoDaEscolha,
  lerMinhaFilial,
  ROTA_MINHA_FILIAL,
  salvarMinhaFilial,
} from './escolher-filial';

const BV = { id: '7d1c2a4e-2f0b-4c55-9a1e-0b6d1f2e3a01', codigo: '01', nome: 'Boa Vista' };
const MAO = { id: '7d1c2a4e-2f0b-4c55-9a1e-0b6d1f2e3a02', codigo: '02', nome: 'Manaus' };
const ARA = { id: '7d1c2a4e-2f0b-4c55-9a1e-0b6d1f2e3a03', codigo: '03', nome: 'Araguaína' };

describe('GET eu/filial-cadastro (leitura tolerante)', () => {
  it('rota do Core pelo SDK web', () => {
    expect(ROTA_MINHA_FILIAL).toBe('/core/eu/filial-cadastro');
  });

  it('filiais em ordem alfabética do nome (a API manda por código)', () => {
    const m = lerMinhaFilial({
      filial_cadastro_id: null,
      filial_venda_ids: [],
      sem_filial: true,
      pode_informar: true,
      filiais: [MAO, BV, ARA],
    });
    expect(m.filiais.map((f) => f.nome)).toEqual(['Araguaína', 'Boa Vista', 'Manaus']);
    expect(m).toMatchObject({ semFilial: true, podeInformar: true });
  });

  it('corpo antigo ou torto: sem permissão, sem lista e segue bloqueado', () => {
    expect(lerMinhaFilial(undefined)).toEqual({ semFilial: true, podeInformar: false, filiais: [] });
    expect(
      lerMinhaFilial({ pode_informar: 'sim', filiais: [{ id: 1 }, null, { id: BV.id, codigo: '01' }] }),
    ).toEqual({
      semFilial: true,
      podeInformar: false,
      filiais: [{ id: BV.id, nome: '01' }],
    });
  });
});

describe('estados da tela (16a a 16e)', () => {
  const dados = (o: Partial<{ semFilial: boolean; podeInformar: boolean; n: number }>) => ({
    semFilial: o.semFilial ?? true,
    podeInformar: o.podeInformar ?? true,
    filiais: [BV, MAO].slice(0, o.n ?? 2),
  });

  it('16a carregando; GET com falha = erro de carga', () => {
    expect(estadoDaEscolha({ carregando: true, erro: false, dados: undefined })).toBe('carregando');
    expect(estadoDaEscolha({ carregando: false, erro: true, dados: undefined })).toBe('erro_carga');
  });

  it('16b escolher; 16c empresa sem filial', () => {
    expect(estadoDaEscolha({ carregando: false, erro: false, dados: dados({}) })).toBe('escolher');
    expect(estadoDaEscolha({ carregando: false, erro: false, dados: dados({ n: 0 }) })).toBe('sem_filiais');
  });

  it('pode_informar=false: só o aviso, mesmo com a lista', () => {
    expect(estadoDaEscolha({ carregando: false, erro: false, dados: dados({ podeInformar: false }) })).toBe(
      'sem_permissao',
    );
  });

  it('filial já definida (outro admin informou): entra no Início', () => {
    expect(estadoDaEscolha({ carregando: false, erro: false, dados: dados({ semFilial: false }) })).toBe(
      'ja_tem_filial',
    );
  });
});

describe('PUT eu/filial-cadastro', () => {
  it('manda só filial_cadastro_id; 2xx = salvo → entra no Início (16e)', async () => {
    const put = vi.fn(() => Promise.resolve({}));
    const r = await salvarMinhaFilial(BV.id, put);
    expect(put).toHaveBeenCalledWith({ filial_cadastro_id: BV.id });
    expect(r).toBe('salvo');
    expect(depoisDeSalvar(r)).toEqual({ entrar: true, erro: false, reler: false });
  });

  it('409 USUARIO_FILIAL_JA_INFORMADA: erro (16d) e relê o GET', async () => {
    const r = await salvarMinhaFilial(BV.id, () =>
      Promise.reject(new ApiRequestError(409, 'USUARIO_FILIAL_JA_INFORMADA', 'x')),
    );
    expect(r).toBe('ja_informada');
    expect(depoisDeSalvar(r)).toEqual({ entrar: false, erro: true, reler: true });
  });

  it('422, 500 ou sem rede: erro (16d), a escolha continua e não relê', async () => {
    for (const e of [
      new ApiRequestError(422, 'USUARIO_FILIAL_INVALIDA', 'x'),
      new ApiRequestError(500, 'erro', 'x'),
      new ApiRequestError(0, 'network', 'x'),
    ]) {
      const r = await salvarMinhaFilial(BV.id, () => Promise.reject(e));
      expect(r).toBe('erro');
      expect(depoisDeSalvar(r)).toEqual({ entrar: false, erro: true, reler: false });
    }
  });
});
