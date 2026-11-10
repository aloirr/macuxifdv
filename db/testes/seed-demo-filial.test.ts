/**
 * Seed da demo — filiais (0056, T-0149, RN-CORE-39) e fotos do PDV (0057, T-0147, RN-CORE-38). Sem banco: confere as linhas
 * montadas por `dadosDemoFilial` e `dadosDemoFotosPdv` (a gravação roda no CI, com o seed inteiro em seed-demo.test.ts).
 * Critério da T-0149: com 2 filiais, um cliente de cada vê o estoque e o preço da sua filial (Boa Vista ≈ 5% acima, um produto
 * sem saldo lá).
 */
import { describe, expect, it } from 'vitest';
import { dadosDemo, idUsuarioDemo, TENANT_DEMO } from '../seeds/demo/demo';
import {
  ACRESCIMO_PRECO_BOA_VISTA_PCT,
  CLIENTES_BOA_VISTA_DEMO,
  dadosDemoFilial,
  idFilialBoaVistaDemo,
  PRODUTO_SEM_SALDO_BOA_VISTA_DEMO,
  SEED_BOA_VISTA_DEMO,
} from '../seeds/demo/filial';
import { CLIENTES_COM_FACHADA_DEMO, dadosDemoFotosPdv } from '../seeds/demo/fotos-pdv';
import { idFilialPadrao, idFotoTipoFachada } from '../src/ids';

const HASH_FALSO = '$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA';
const HOJE = '2026-11-10';
const d = dadosDemo(HASH_FALSO, { hoje: HOJE });
const f = dadosDemoFilial({ tenantId: TENANT_DEMO, dados: d });

describe('seed demo — filiais (T-0149)', () => {
  it('v1.0.3: a Boa Vista fica FORA da recriação da demo (R-20261110-111746; volta ligada na v1.0.4)', () => {
    expect(SEED_BOA_VISTA_DEMO).toBe(false);
  });

  it('2 filiais: Manaus 0001 (a padrão do gatilho, completada) e Boa Vista 0002', () => {
    expect(f.filiais.map((x) => [x.id, x.codigo, x.nome, x.cidade, x.uf, x.padrao])).toEqual([
      [idFilialPadrao(TENANT_DEMO), '0001', 'Filial Manaus', 'Manaus', 'AM', true],
      [idFilialBoaVistaDemo(), '0002', 'Filial Boa Vista', 'Boa Vista', 'RR', false],
    ]);
  });

  it('4 clientes na Boa Vista, nos dois vendedores e em rota de hoje; nenhum com pedido do seed', () => {
    expect(f.clientesBoaVista).toHaveLength(CLIENTES_BOA_VISTA_DEMO.length);
    const pedidos = new Set(d['vendedor.pedido'].map((p) => String(p.cliente_id)));
    for (const c of f.clientesBoaVista) expect(pedidos.has(c)).toBe(false);
    const donos = new Set(d['core.carteira'].filter((c) => f.clientesBoaVista.includes(String(c.cliente_id)) && c.papel === 'vendedor').map((c) => c.usuario_id));
    expect(donos).toEqual(new Set([idUsuarioDemo('vendedor'), idUsuarioDemo('vendedor2')]));
    const naRota = new Set(d['core.rota_parada'].map((p) => String(p.cliente_id)));
    expect(f.clientesBoaVista.some((c) => naRota.has(c))).toBe(true);
  });

  it(`preço: Boa Vista com os MESMOS itens da Manaus, ${ACRESCIMO_PRECO_BOA_VISTA_PCT}% acima (centavos inteiros)`, () => {
    const manaus = d['catalogo.tabela_preco_item'];
    expect(f.itensBoaVista).toHaveLength(manaus.length);
    manaus.forEach((m, i) => {
      const bv = f.itensBoaVista[i]!;
      expect([bv.tabela_preco_id, bv.produto_id, bv.filial_id]).toEqual([m.tabela_preco_id, m.produto_id, idFilialBoaVistaDemo()]);
      expect(Number(bv.preco_cents)).toBe(Math.round((Number(m.preco_cents) * 105) / 100));
      expect(Number(bv.preco_cents)).toBeGreaterThan(Number(m.preco_cents));
    });
  });

  it('estoque: depósito CD Boa Vista na filial 0002, um saldo por produto, café zerado lá e com saldo no CD Manaus', () => {
    expect(f.deposito).toMatchObject({ codigo: 'CD-BVB', filial_id: idFilialBoaVistaDemo() });
    const produtos = d['core.produto'];
    expect(f.saldosBoaVista).toHaveLength(produtos.length);
    const cafe = produtos.find((p) => p.sku === PRODUTO_SEM_SALDO_BOA_VISTA_DEMO)!;
    const cdManaus = d['catalogo.deposito'].find((x) => x.codigo === 'CD-MAO')!;
    const saldoManaus = d['catalogo.estoque_saldo'].find((s) => s.deposito_id === cdManaus.id && s.produto_id === cafe.id)!;
    expect(Number(saldoManaus.quantidade)).toBeGreaterThan(0);
    expect(f.saldosBoaVista.find((s) => s.produto_id === cafe.id)!.quantidade).toBe(0);
    // estoque diferente da Manaus em algum produto com saldo
    expect(f.saldosBoaVista.some((s) => Number(s.quantidade) > 0)).toBe(true);
  });

  it('retrato da filial dos pedidos = a Manaus, no formato do CHECK pedido_filial_coerente', () => {
    expect(f.retratoManaus).toEqual({ id: idFilialPadrao(TENANT_DEMO), codigo: '0001', nome: 'Filial Manaus', cidade: 'Manaus', uf: 'AM', external_id: 'FIL-MAO', padrao: true });
  });
});

describe('seed demo — fotos do PDV (T-0147)', () => {
  const fp = dadosDemoFotosPdv({ tenantId: TENANT_DEMO, hoje: HOJE, dados: d, usuario: idUsuarioDemo });

  it('tipos: Fachada (a do gatilho, obrigatória), CNH do sócio (sensível, obrigatória) e Contrato social (sensível)', () => {
    expect(fp.tipos.map((t) => [t.nome, t.obrigatorio, t.sensivel, t.fachada])).toEqual([
      ['Fachada', true, false, true],
      ['CNH do sócio', true, true, false],
      ['Contrato social', false, true, false],
    ]);
    expect(fp.tipos[0]!.id).toBe(idFotoTipoFachada(TENANT_DEMO));
  });

  it('fachada em 5 clientes, enviada pelo vendedor da carteira; arquivo aguardando, sem restrição de perfil', () => {
    expect(fp.fotos).toHaveLength(CLIENTES_COM_FACHADA_DEMO.length);
    for (const foto of fp.fotos) {
      expect(foto.foto_tipo_id).toBe(idFotoTipoFachada(TENANT_DEMO));
      const dono = d['core.carteira'].find((c) => c.cliente_id === foto.cliente_id && c.papel === 'vendedor')!;
      expect(foto.enviado_por).toBe(dono.usuario_id);
      const arq = fp.arquivos.find((a) => a.id === foto.arquivo_id)!;
      expect(arq).toMatchObject({ modulo: 'core', finalidade: 'pdv', entidade: 'cliente_foto', entidade_id: foto.id, cliente_id: foto.cliente_id, situacao: 'aguardando', perfis_leitura: null });
    }
  });
});
