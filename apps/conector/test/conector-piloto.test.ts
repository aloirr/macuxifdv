/** T-0162: o conector.json do kit do piloto (gerado do exemplo oficial) passa na validação do Conector e não carrega segredo. */
import { describe, expect, it } from 'vitest';
import { interpretarConfig } from '../src/config/carregar';
import { ORDEM_CARGA } from '../src/config/entidades';
// @ts-expect-error módulo .mjs sem tipos (kit do piloto em Node puro)
import { ENTIDADES_PILOTO, montarEntradas } from '../../../modules/integracao/kit-piloto/scripts/montar-kit.mjs';

const entradas = montarEntradas() as { nome: string; dados: Buffer }[];
const texto = entradas.find((e) => e.nome === 'conector/conector.json')!.dados.toString('utf8');

describe('T-0162: conector.json do kit do piloto', () => {
  it('RN-INT-kit: valida no esquema do Conector, aponta para o Hub e para a ERP_PILOTO e não tem chave nem senha', () => {
    const cfg = interpretarConfig(texto, 'json');
    expect(cfg.hub.url).toBe('https://api.macuxifdv.com.br');
    expect(cfg.hub.conectorId).toBe('piloto-conector');
    expect(cfg.erp).toMatchObject({ tipo: 'sqlserver', banco: 'ERP_PILOTO', usuario: 'macuxi_conector' });
    expect(texto).not.toMatch(/mxc_|"(chave|senha|password|token)"/i);
  });

  it('RN-INT-04: só as entidades do piloto, na ordem de carga do Conector, e a entrada de pedidos liga o status do modelo', () => {
    const cfg = interpretarConfig(texto, 'json');
    const chaves = Object.keys(cfg.entidades);
    expect([...chaves].sort((a, b) => ORDEM_CARGA.indexOf(a as never) - ORDEM_CARGA.indexOf(b as never))).toEqual(chaves);
    expect(chaves).toEqual(ENTIDADES_PILOTO);
    expect(cfg.pedidos?.ativo).toBe(true);
    expect(cfg.pedidos?.status?.consulta).toContain('vw_macuxi_pedido_status');
    expect(cfg.pedidos?.gravacao?.cabecalho).toContain('sp_macuxi_pedido_inserir');
  });
});
