/**
 * T-0107 (frente N14) — o gerador da base de carga (tests/carga/t0107/gerador.ts) SEM banco: roda em qualquer máquina.
 * Prova o que a carga com Postgres assume: determinismo (mesma semente ⇒ mesma base, byte a byte), volumes, árvore de 3
 * níveis com o produto na folha, códigos únicos e válidos (SKU, EAN-13, CNPJ), nada de dado pessoal (cliente sem telefone e
 * sem e-mail; e-mails só no domínio reservado), limites das colunas (aplicação ≤ 2.000, ≤ 3 referências com código compacto,
 * etiquetas ≤ 4 × ≤ 20), dinheiro em centavos inteiros e a aplicação EXPANDIDA no documento de busca (RN-CAT-12).
 */
import { describe, expect, it } from 'vitest';
import { cnpjValido, ean13, gerarBaseCarga, impressaoDigital, ORDEM_TABELAS_CARGA, PRODUTOS_PADRAO, SEMENTE_PADRAO, type BaseCarga, type Linha } from './gerador';

const TENANT = '00000000-0000-4000-8000-0000000000aa';
const INSTANTE = '2026-11-08T12:00:00.000Z';
/** Hash fixo (o gerador não faz hash; o argon2id real tem sal aleatório e quebraria a comparação). */
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsLWZpeG8$aGFzaC1maXhvLXNvLWRlLXRlc3Rl';
const op = { tenantId: TENANT, instante: INSTANTE, senhaHash: HASH };

const eanValido = (e: string) => /^\d{13}$/.test(e) && ean13(e.slice(0, 12)) === e;
const s = (l: Linha, k: string) => l[k] as string;

describe('T-0107 — gerador determinístico da base de carga (sem banco)', () => {
  // uma base padrão para os casos de forma (20 mil produtos, 300 clientes)
  const { base, resumo } = gerarBaseCarga(op);
  const t = (nome: keyof BaseCarga) => base[nome];

  it('mesma semente ⇒ mesma impressão digital; semente diferente ⇒ diferente', () => {
    const deNovo = gerarBaseCarga(op);
    expect(impressaoDigital(deNovo.base)).toBe(impressaoDigital(base));
    expect(resumo.semente).toBe(SEMENTE_PADRAO);
    const outra = gerarBaseCarga({ ...op, semente: SEMENTE_PADRAO + 1 });
    expect(impressaoDigital(outra.base)).not.toBe(impressaoDigital(base));
    // o tenant só entra na coluna tenant_id: os ids não mudam com ele
    const outroTenant = gerarBaseCarga({ ...op, tenantId: '00000000-0000-4000-8000-0000000000bb', produtos: 50, clientes: 9 });
    const mesmoTenant = gerarBaseCarga({ ...op, produtos: 50, clientes: 9 });
    expect(outroTenant.base['core.produto'].map((p) => p.id)).toEqual(mesmoTenant.base['core.produto'].map((p) => p.id));
  });

  it('volumes: 20.000 produtos (com preço, busca, conteúdo e nó), 2 saldos por produto, 300 clientes e 300 linhas de carteira em 3 vendedores', () => {
    expect(resumo.produtos).toBe(PRODUTOS_PADRAO);
    for (const nome of ['core.produto', 'catalogo.produto_no', 'catalogo.produto_conteudo', 'catalogo.produto_busca', 'catalogo.tabela_preco_item'] as const) expect(t(nome), nome).toHaveLength(20_000);
    expect(t('catalogo.estoque_saldo')).toHaveLength(40_000);
    expect(t('catalogo.deposito')).toHaveLength(2);
    expect(t('core.cliente')).toHaveLength(300);
    expect(t('core.carteira')).toHaveLength(300);
    expect(t('core.cliente_financeiro')).toHaveLength(300);
    expect(t('catalogo.cliente_tabela_preco')).toHaveLength(300);
    expect(t('core.usuario')).toHaveLength(3);
    expect(resumo.vendedores).toHaveLength(3);
    // 1/3 da carteira para cada um
    for (const v of resumo.vendedores) expect(resumo.clientesPorVendedor[v.id], v.email).toHaveLength(100);
    const porVendedor = new Map<string, number>();
    for (const c of t('core.carteira')) porVendedor.set(s(c, 'usuario_id'), (porVendedor.get(s(c, 'usuario_id')) ?? 0) + 1);
    expect([...porVendedor.values()]).toEqual([100, 100, 100]);
    // toda tabela da ordem de gravação existe; toda linha é do tenant e tem as colunas da regra 5
    for (const nome of ORDEM_TABELAS_CARGA) {
      for (const l of base[nome].slice(0, 5)) {
        expect(l.tenant_id, nome).toBe(TENANT);
        for (const c of ['id', 'created_at', 'updated_at', 'deleted_at', 'external_id']) expect(l, `${nome}.${c}`).toHaveProperty(c);
      }
    }
    // ids únicos em todas as tabelas
    const ids = ORDEM_TABELAS_CARGA.flatMap((nome) => base[nome].map((l) => s(l, 'id')));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('árvore sistema › grupo › linha (3 níveis, pai coerente) e todo produto numa folha (nível 3)', () => {
    const nos = new Map(t('catalogo.catalogo_no').map((n) => [s(n, 'id'), n]));
    expect(new Set([...nos.values()].map((n) => n.nivel))).toEqual(new Set([1, 2, 3]));
    for (const n of nos.values()) {
      if (n.nivel === 1) expect(n.pai_id).toBeNull();
      else expect(nos.get(s(n, 'pai_id'))?.nivel, s(n, 'codigo')).toBe((n.nivel as number) - 1);
      expect(s(n, 'codigo')).toMatch(/^T107-/);
    }
    const produtos = new Set(t('core.produto').map((p) => s(p, 'id')));
    const vinculados = new Set<string>();
    for (const pn of t('catalogo.produto_no')) {
      expect(nos.get(s(pn, 'no_id'))?.nivel).toBe(3);
      vinculados.add(s(pn, 'produto_id'));
    }
    expect(vinculados).toEqual(produtos);
  });

  it('SKUs e external_id únicos; EAN-13 com dígito verificador válido e único', () => {
    const p = t('core.produto');
    expect(new Set(p.map((x) => s(x, 'sku'))).size).toBe(p.length);
    expect(new Set(p.map((x) => s(x, 'external_id'))).size).toBe(p.length);
    const eans = p.map((x) => x.ean as string | null).filter((e): e is string => e !== null);
    expect(eans.length).toBeGreaterThan(1_000);
    for (const e of eans) expect(eanValido(e), e).toBe(true);
    expect(new Set(eans).size).toBe(eans.length);
    expect(ean13('400638133393')).toBe('4006381333931'); // exemplo clássico do padrão GS1
  });

  it('clientes: CNPJ válido e único, sem telefone e sem e-mail; e-mails (vendedores) só @exemplo.com.br', () => {
    const c = t('core.cliente');
    const docs = c.map((x) => s(x, 'documento'));
    for (const d of docs) expect(cnpjValido(d), d).toBe(true);
    expect(new Set(docs).size).toBe(docs.length);
    expect(cnpjValido('90000001000100')).toBe(false);
    expect(cnpjValido('11222333000181')).toBe(true); // exemplo clássico de CNPJ válido (Receita)
    for (const x of c) {
      expect(x.telefone).toBeNull();
      expect(x.email).toBeNull();
    }
    expect(new Set(c.map((x) => s(x, 'external_id'))).size).toBe(c.length);
    // nenhum e-mail fora do domínio reservado em NENHUMA tabela
    const emails = ORDEM_TABELAS_CARGA.flatMap((nome) => base[nome].flatMap((l) => Object.values(l).filter((v): v is string => typeof v === 'string' && /@/.test(v) && !v.startsWith('$argon2id$'))));
    expect(emails.length).toBe(3);
    for (const e of emails) expect(e).toMatch(/^[a-z0-9.]+@exemplo\.com\.br$/);
  });

  it('limites das colunas: aplicação ≤ 2.000; ≤ 3 referências com código compacto ^[a-z0-9]{1,30}$; etiquetas ≤ 4 e ≤ 20 caracteres', () => {
    for (const c of t('catalogo.produto_conteudo')) {
      const ap = c.aplicacoes as string | null;
      if (ap !== null) expect(ap.length).toBeLessThanOrEqual(2_000);
      const et = c.etiquetas as string[];
      expect(Array.isArray(et)).toBe(true);
      expect(et.length).toBeLessThanOrEqual(4);
      for (const e of et) expect(e.trim().length > 0 && e.length <= 20, e).toBe(true);
      expect(Array.isArray(c.faq)).toBe(true);
    }
    const porProduto = new Map<string, Linha[]>();
    for (const r of t('catalogo.produto_referencia')) porProduto.set(s(r, 'produto_id'), [...(porProduto.get(s(r, 'produto_id')) ?? []), r]);
    expect(porProduto.size).toBeGreaterThan(10_000);
    for (const refs of porProduto.values()) {
      expect(refs.length).toBeLessThanOrEqual(3);
      expect(new Set(refs.map((r) => r.ordem))).toEqual(new Set(refs.map((_, i) => i + 1)));
      for (const r of refs) {
        expect(s(r, 'codigo_compacto')).toMatch(/^[a-z0-9]{1,30}$/);
        expect(s(r, 'codigo').length).toBeLessThanOrEqual(30);
      }
    }
    for (const x of t('catalogo.sinonimo')) expect((x.sinonimos as string[]).length).toBeGreaterThan(0);
  });

  it('dinheiro em centavos inteiros e > 0 (preço, custo, preço de venda, limite)', () => {
    const inteiroPositivo = (v: unknown) => Number.isInteger(v) && (v as number) > 0;
    for (const x of t('catalogo.tabela_preco_item')) expect(inteiroPositivo(x.preco_cents), String(x.preco_cents)).toBe(true);
    for (const x of t('core.produto')) {
      expect(inteiroPositivo(x.custo_cents)).toBe(true);
      expect(inteiroPositivo(x.preco_venda_cents)).toBe(true);
    }
    for (const x of t('core.cliente_financeiro')) {
      expect(inteiroPositivo(x.limite_cents)).toBe(true);
      expect(Number.isInteger(x.saldo_aberto_cents)).toBe(true);
    }
    for (const p of resumo.produtosComEstoque) expect(inteiroPositivo(p.preco_cents)).toBe(true);
  });

  it('RN-CAT-12: produto_busca.aplicacao traz os anos EXPANDIDOS de uma faixa (ex.: "2010–2014" ⇒ contém 2012)', () => {
    const conteudo = new Map(t('catalogo.produto_conteudo').map((c) => [s(c, 'produto_id'), c.aplicacoes as string | null]));
    let provados = 0;
    let exemplo = '';
    for (const b of t('catalogo.produto_busca')) {
      const original = conteudo.get(s(b, 'produto_id'));
      const indice = b.aplicacao as string | null;
      if (!original || !indice) continue;
      // faixa fechada com ano do meio que NÃO aparece escrito no texto original
      for (const m of original.matchAll(/(\d{4})\s*(?:–|-|\/|a)\s*(\d{4})/g)) {
        const de = Number(m[1]);
        const ate = Number(m[2]);
        if (ate - de < 2) continue;
        const meio = de + 1;
        if (original.includes(String(meio))) continue;
        expect(indice, `${original} → ${indice}`).toContain(String(meio));
        provados += 1;
        if (!exemplo) exemplo = `${m[0]} ⇒ ${meio}`;
      }
    }
    expect(provados, 'nenhuma faixa fechada para provar a expansão').toBeGreaterThan(100);
    expect(exemplo).not.toBe('');
  });

  it('resumo para a carga: termos de busca variados (SKU, referência, "item modelo"), produtos com estoque e clientes por vendedor', () => {
    const skus = new Set(t('core.produto').map((p) => s(p, 'sku')));
    expect(resumo.termosDeBusca.length).toBeGreaterThanOrEqual(20);
    expect(resumo.termosDeBusca.some((x) => skus.has(x))).toBe(true);
    expect(resumo.termosDeBusca.some((x) => /\s/.test(x) && !skus.has(x))).toBe(true);
    expect(resumo.produtosComEstoque.length).toBeGreaterThanOrEqual(100);
    const clientes = new Set(t('core.cliente').map((c) => s(c, 'id')));
    for (const lista of Object.values(resumo.clientesPorVendedor)) for (const c of lista) expect(clientes.has(c)).toBe(true);
    expect(t('catalogo.tabela_preco')[0]?.id).toBe(resumo.tabelaPrecoId);
  });
});
