/**
 * T-0192 — massa de volume do Catálogo (gerador puro): determinismo, contagens exatas e RN-CAT-18 (mesmo código de nó em
 * ramos diferentes, único entre os irmãos). Uso: db/seeds/volume/LEIA-ME.md. O tempo do Catálogo é medido pelo módulo.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { gerarCatalogoVolume, PADRAO_VOLUME, tenantDoVolume, TABELAS_VOLUME, type MassaCatalogoVolume } from '../seeds/volume/catalogo-volume';

const SEMENTE = 20261121;
const resumo = (m: MassaCatalogoVolume) => createHash('sha256').update(JSON.stringify(m)).digest('hex');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('massa de volume do Catálogo (T-0192)', () => {
  const m = gerarCatalogoVolume({ semente: SEMENTE });

  it('mesma semente, mesma massa; outra semente, outra massa', () => {
    expect(resumo(gerarCatalogoVolume({ semente: SEMENTE }))).toBe(resumo(m));
    const outra = gerarCatalogoVolume({ semente: SEMENTE + 1 });
    expect(resumo(outra)).not.toBe(resumo(m));
    expect(outra.produtos[0]!.id).not.toBe(m.produtos[0]!.id);
    expect(m.tenant).toEqual(tenantDoVolume(SEMENTE));
  });

  it('contagens exatas: 20.000 produtos, 80.000 preços, 40.000 saldos, 230 nós', () => {
    expect(m.produtoNos).toHaveLength(20_000);
    expect(m.tabelasPreco).toHaveLength(5);
    expect(m.depositos).toHaveLength(3);
    expect(m.contagens).toEqual({
      produtos: 20_000,
      precos: 80_000,
      precosPorTabela: { 'VOL-TAB-BASE': 20_000, 'VOL-TAB-ATAC': 18_000, 'VOL-TAB-VARE': 16_000, 'VOL-TAB-ESPE': 14_000, 'VOL-TAB-INTE': 12_000 },
      saldos: 40_000,
      saldosPorDeposito: { 'VOL-CD': 20_000, 'VOL-LJ1': 12_000, 'VOL-LJ2': 8_000 },
      nos: 230,
      nosPorNivel: { 1: 10, 2: 49, 3: 111, 4: 60 },
    });
  });

  it('RN-CAT-18: o mesmo código aparece em ramos diferentes e nunca repete entre irmãos', () => {
    const paisPorCodigo = new Map<string, Set<string>>();
    const irmaos = new Set<string>();
    for (const n of m.nos) {
      const chave = `${String(n.pai_id)}|${String(n.codigo)}`;
      expect(irmaos.has(chave), chave).toBe(false);
      irmaos.add(chave);
      const pais = paisPorCodigo.get(n.codigo as string) ?? new Set<string>();
      pais.add(String(n.pai_id));
      paisPorCodigo.set(n.codigo as string, pais);
    }
    const repetidos = [...paisPorCodigo].filter(([, pais]) => pais.size > 1).map(([c]) => c);
    expect(repetidos).toEqual(expect.arrayContaining(['NAO_CLASSIFICADO', 'OUTROS', 'LEVE', 'PESADO', 'MOTO', 'DIANTEIRO', 'TRASEIRO', 'OLEO', 'VALVULA', 'JUNTA', 'ADITIVO']));
    expect(paisPorCodigo.get('NAO_CLASSIFICADO')!.size).toBe(10);
    // `OUTROS` raiz e `OUTROS` filho de Outros (o exemplo da RN)
    const outrosRaiz = m.nos.find((n) => n.codigo === 'OUTROS' && n.pai_id === null)!;
    expect(m.nos.some((n) => n.codigo === 'OUTROS' && n.pai_id === outrosRaiz.id)).toBe(true);
    // árvore coerente: raiz no nível 1, filho = nível do pai + 1
    const nivel = new Map(m.nos.map((n) => [n.id as string, n.nivel as number]));
    expect(m.nos.filter((n) => (n.pai_id === null ? n.nivel !== 1 : n.nivel !== nivel.get(n.pai_id as string)! + 1))).toEqual([]);
  });

  it('produto só em folha; preço e saldo sem par repetido; colunas padrão, centavos e EAN válido', () => {
    const pais = new Set(m.nos.map((n) => n.pai_id));
    const nos = new Set(m.nos.map((n) => n.id));
    expect(m.produtoNos.filter((v) => !nos.has(v.no_id) || pais.has(v.no_id))).toEqual([]);
    expect(new Set(m.precos.map((p) => `${String(p.tabela_preco_id)}|${String(p.produto_id)}`)).size).toBe(80_000);
    expect(new Set(m.saldos.map((s) => `${String(s.deposito_id)}|${String(s.produto_id)}`)).size).toBe(40_000);
    expect(new Set(m.produtos.map((p) => p.sku)).size).toBe(20_000);
    expect(new Set(m.produtos.map((p) => p.ean)).size).toBe(20_000);
    expect(m.precos.filter((p) => !Number.isInteger(p.preco_cents) || (p.preco_cents as number) <= 0)).toEqual([]);
    const ids = new Set<string>();
    const desvios: string[] = [];
    for (const [tabela, chave] of TABELAS_VOLUME) {
      for (const l of m[chave]) {
        ids.add(l.id as string);
        const ok =
          UUID.test(l.id as string) && l.tenant_id === m.tenant.id && 'external_id' in l && l.deleted_at === null &&
          l.created_at === PADRAO_VOLUME.agora && l.updated_at === PADRAO_VOLUME.agora;
        if (!ok) desvios.push(`${tabela} ${String(l.id)}`);
      }
    }
    expect(desvios).toEqual([]);
    expect(ids.size).toBe(230 + 20_000 + 20_000 + 5 + 80_000 + 3 + 40_000);
    const ean = m.produtos[0]!.ean as string;
    const soma = [...ean.slice(0, 12)].reduce((s, d, i) => s + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
    expect(Number(ean[12])).toBe((10 - (soma % 10)) % 10);
  });

  it('opções: tenant informado, filial e massa menor', () => {
    const t = '0ca10000-0000-4000-8000-000000000001';
    const p = gerarCatalogoVolume({ semente: 7, tenantId: t, filialId: '0ca10000-0000-4000-8000-000000000002', produtos: 100 });
    expect(p.tenant.id).toBe(t);
    expect(p.contagens.produtos).toBe(100);
    expect(p.contagens.precos).toBe(400);
    expect(p.contagens.saldos).toBe(200);
    expect(new Set(p.precos.map((x) => x.filial_id))).toEqual(new Set(['0ca10000-0000-4000-8000-000000000002']));
    expect(() => gerarCatalogoVolume({ semente: 1.5 })).toThrow(/semente/);
  });
});
