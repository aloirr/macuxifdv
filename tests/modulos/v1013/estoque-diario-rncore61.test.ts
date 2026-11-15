/**
 * Estoque diário (RN-CORE-61, ADR 0057; RN-VEN-20 opção b; RN-CAT-07 revista). Aceite com valor: a marca da carga no fuso do
 * tenant, o disponível da filial do pedido (saldo da carga − reservas) com o faturado reservado até a próxima carga, e a hora
 * do estoque no fuso do tenant. A regra pura de cada parte tem teste de unidade no módulo dono.
 */
import { describe, expect, it } from 'vitest';
import { existe, importar, ler } from '../apoio/v1013';

const CARGA = 'modules/core/contracts/carga-diaria.ts';
const RESERVA = 'modules/vendedor/domain/reserva-filial.ts';
const ROTULO = 'modules/catalogo/domain/estoque-campo.ts';
const COM_CARGA = existe(CARGA);
const COM_RESERVA_B = ler(RESERVA).includes('faturadoDepoisDaCarga');
const COM_ROTULO = existe(ROTULO) && ler(ROTULO).includes('rotuloCargaEstoque');

interface CargaDiaria {
  marcaCargaDiaria(p: { agora: Date; fuso: string; hora: string }): string;
  cargaDiariaDevida(p: { ultima: string | null; agora: Date; fuso: string; hora: string }): boolean;
}
type Linhas = Record<string, unknown>;
interface Pull {
  disponivelPorProduto(l: Linhas, filialId: string | null, cargaDiariaEm?: string | null): Map<string, number>;
}
interface Rotulo {
  rotuloCargaEstoque(cargaEm: string | null, agora: string, fuso: string): string;
}

const MANAUS = 'America/Manaus';
const SAO_PAULO = 'America/Sao_Paulo';

describe('RN-CORE-61 — carga diária às 06:00 no fuso do tenant', () => {
  if (!COM_CARGA) {
    it('antes do PR do modulo-core: sem a regra da carga e sem entidade de cliente marcada como parcial', () => {
      expect(ler('modules/core/app/lib/entidades-cliente.ts')).not.toMatch(/parcial/);
    });
    return;
  }
  const carga = () => importar<CargaDiaria>(CARGA);

  it('Manaus: às 05:59 vale a carga de ontem; às 06:00 a de hoje fica devida', async () => {
    const { marcaCargaDiaria, cargaDiariaDevida } = await carga();
    const ontem = '2026-11-14T10:05:00.000Z';
    const as0559 = new Date('2026-11-15T09:59:00Z');
    const as0600 = new Date('2026-11-15T10:00:00Z');
    expect(marcaCargaDiaria({ agora: as0559, fuso: MANAUS, hora: '06:00' })).toBe('2026-11-14T10:00:00.000Z');
    expect(cargaDiariaDevida({ ultima: ontem, agora: as0559, fuso: MANAUS, hora: '06:00' })).toBe(false);
    expect(marcaCargaDiaria({ agora: as0600, fuso: MANAUS, hora: '06:00' })).toBe('2026-11-15T10:00:00.000Z');
    expect(cargaDiariaDevida({ ultima: ontem, agora: as0600, fuso: MANAUS, hora: '06:00' })).toBe(true);
    expect(cargaDiariaDevida({ ultima: null, agora: as0559, fuso: MANAUS, hora: '06:00' })).toBe(true);
  });

  it('o mesmo instante UTC dá marcas diferentes conforme o fuso do tenant (09:30Z = 05:30 em Manaus, 06:30 em São Paulo)', async () => {
    const { marcaCargaDiaria } = await carga();
    const agora = new Date('2026-11-15T09:30:00Z');
    expect(marcaCargaDiaria({ agora, fuso: MANAUS, hora: '06:00' })).toBe('2026-11-14T10:00:00.000Z');
    expect(marcaCargaDiaria({ agora, fuso: SAO_PAULO, hora: '06:00' })).toBe('2026-11-15T09:00:00.000Z');
  });

  it('virada de mês: 30/11 às 23:30 em Manaus (01/12 03:30 UTC) ainda é a carga de 30/11', async () => {
    const { marcaCargaDiaria } = await carga();
    expect(marcaCargaDiaria({ agora: new Date('2026-12-01T03:30:00Z'), fuso: MANAUS, hora: '06:00' })).toBe('2026-11-30T10:00:00.000Z');
  });
});

describe('RN-VEN-20 (opção b) — disponível na filial do pedido = saldo da carga − reservas; faturado reserva até a próxima carga', () => {
  if (!COM_RESERVA_B) {
    it('antes do PR do modulo-vendedor: o faturado não reserva (só os status que reservam)', () => {
      expect(ler(RESERVA)).toMatch(/STATUS_QUE_RESERVAM = \[[^\]]*'invoiced_partial'\]/);
      expect(ler(RESERVA)).not.toMatch(/'invoiced'[,\]]/);
    });
    return;
  }
  const MAO = '00000000-0000-4000-8000-0000000000a1';
  const BVB = '00000000-0000-4000-8000-0000000000b2';
  const CARGA_HOJE = '2026-11-15T10:00:00.000Z';
  const CARGA_AMANHA = '2026-11-16T10:00:00.000Z';
  const pedido = (id: string, filial: string, status: string, faturado_em: string | null = null) => ({
    id,
    filial_id: filial,
    tipo: 'pedido',
    status,
    faturado_em,
    deleted_at: null,
  });
  const item = (pedido_id: string, quantidade: number, quantidade_faturada = 0) => ({
    id: `${pedido_id}-i`,
    pedido_id,
    produto_id: 'p1',
    quantidade,
    quantidade_base: quantidade,
    quantidade_faturada,
    deleted_at: null,
  });
  const linhas = (saldoMao: number): Linhas => ({
    pedidos: [pedido('f', MAO, 'invoiced', '2026-11-15T14:00:00.000Z'), pedido('a', MAO, 'approved'), pedido('b', BVB, 'approved')],
    itens: [item('f', 10, 10), item('a', 5), item('b', 7)],
    depositos: [
      { id: 'd-mao', filial_id: MAO, deleted_at: null },
      { id: 'd-bvb', filial_id: BVB, deleted_at: null },
    ],
    saldos: [
      { produto_id: 'p1', deposito_id: 'd-mao', quantidade: saldoMao, deleted_at: null },
      { produto_id: 'p1', deposito_id: 'd-bvb', quantidade: 30, deleted_at: null },
    ],
  });
  const pull = () => importar<Pull>('modules/vendedor/app/lib/pull.ts');

  it('carga das 06:00 com saldo 50 em Manaus e pedido faturado às 10:00 (10 un.) + aprovado (5 un.): disponível 35', async () => {
    const { disponivelPorProduto } = await pull();
    expect(disponivelPorProduto(linhas(50), MAO, CARGA_HOJE).get('p1')).toBe(50 - 10 - 5);
  });

  it('na próxima carga o ERP já baixou o faturado (saldo 40): a reserva dele solta e o disponível continua 35', async () => {
    const { disponivelPorProduto } = await pull();
    expect(disponivelPorProduto(linhas(40), MAO, CARGA_AMANHA).get('p1')).toBe(40 - 5);
  });

  it('só reservas da filial do pedido: Boa Vista = 30 − 7; sem carga_diaria_em vale a regra de antes (50 − 5)', async () => {
    const { disponivelPorProduto } = await pull();
    expect(disponivelPorProduto(linhas(50), BVB, CARGA_HOJE).get('p1')).toBe(23);
    expect(disponivelPorProduto(linhas(50), MAO, null).get('p1')).toBe(45);
  });
});

describe('RN-CAT-07 revista — hora do estoque = hora da carga no aparelho, no fuso do tenant', () => {
  if (!COM_ROTULO) {
    it('antes do PR do Catálogo: a hora do estoque ainda é a do saldo do ERP', () => {
      expect(ler('modules/catalogo/domain/estoque.ts')).not.toContain('rotuloCargaEstoque');
    });
    return;
  }
  const rotulo = async () => (await importar<Rotulo>(ROTULO)).rotuloCargaEstoque;

  it('hoje, ontem e dia mais antigo (virada de mês) com a hora local da carga (10:12Z = 06:12 em Manaus)', async () => {
    const r = await rotulo();
    expect(r('2026-11-15T10:12:00Z', '2026-11-15T19:00:00Z', MANAUS)).toBe('Atualizado às 06:12');
    expect(r('2026-11-15T10:12:00Z', '2026-11-16T09:00:00Z', MANAUS)).toBe('Atualizado ontem às 06:12');
    expect(r('2026-11-30T10:12:00Z', '2026-12-02T09:00:00Z', MANAUS)).toBe('Atualizado em 30/11 às 06:12');
  });

  it('o dia é o do tenant: 16/11 03:30Z é "ontem às 23:30" em Manaus e "às 00:30" em São Paulo', async () => {
    const r = await rotulo();
    expect(r('2026-11-16T03:30:00Z', '2026-11-16T12:00:00Z', MANAUS)).toBe('Atualizado ontem às 23:30');
    expect(r('2026-11-16T03:30:00Z', '2026-11-16T12:00:00Z', SAO_PAULO)).toBe('Atualizado às 00:30');
  });
});
