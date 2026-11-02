/**
 * Base de demonstração (db/seeds/demo) — demo com o gestor externo (R-20261031-233442, item 1).
 * Idempotência (rodar 2× não duplica nem troca o hash), --recriar (zera o ensaio), isolamento do tenant (não toca
 * linha de outro tenant; pelo papel macuxi_app só o contexto demo enxerga a base) e a trava de banco local.
 */
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { carregarDoisTenants, DOIS_TENANTS } from '../seeds/fixtures/dois-tenants';
import { politicaDosParametros, revalidarPedido } from '../../modules/vendedor/domain/aprovacao';
import {
  ALCADAS_DEMO, carregarDemo, CLIENTE_SEM_CEP_DEMO, PRECO_PROPRIO_CX_LIGADO, CODIGO_DEMO, dadosDemo, DESCONTO_MAXIMO_PROPRIO_DEMO, diasUteisAtras, idClienteDemo, idUsuarioDemo, MODULOS_DEMO, SEM_PRECO_NO_ATACADO, TENANT_DEMO,
  USUARIOS_DEMO,
} from '../seeds/demo/demo';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { comTenant } from '../src/contexto';
import { anoMes, hojeNoFuso, somarDias } from '../src/datas';
import { verificarSenha } from '../src/senha';
import { semBanco } from './estado';
import { tabelasComTenant } from './util';

const SENHA = 'senha-do-teste-demo';
const HASH_FALSO = '$argon2id$v=19$m=1,t=1,p=1$c2Fs$aGFzaA';

describe('base de demo (estático)', () => {
  const hoje = '2026-11-04'; // hora-fixa-ok: dados estáticos (dadosDemo puro), nunca comparados ao relógio
  const d = dadosDemo(HASH_FALSO, { hoje });
  const vendedor = d['core.usuario'].find((u) => u.email === USUARIOS_DEMO.vendedor.email)!;

  it('tenant "Distribuidora Exemplo", código curto, fuso de Manaus e os 4 módulos', () => {
    expect(d['plataforma.tenant']).toEqual([expect.objectContaining({ id: TENANT_DEMO, codigo: CODIGO_DEMO, nome: 'Distribuidora Exemplo', fuso: 'America/Manaus' })]);
    expect(CODIGO_DEMO).toMatch(/^[a-z]{3,8}$/);
    expect(d['plataforma.tenant_modulo'].map((m) => m.modulo).sort()).toEqual([...MODULOS_DEMO].sort());
  });

  it('logins: vendedor, supervisor, gerente, promotor, analista e admin, só e-mails fictícios', () => {
    const perfis = new Set(d['core.usuario'].map((u) => u.perfil));
    for (const p of ['vendedor', 'supervisor', 'gerente', 'promotor', 'analista', 'admin']) expect(perfis.has(p)).toBe(true);
    expect(d['core.usuario'].every((u) => String(u.email).endsWith('@exemplo.com.br'))).toBe(true);
    // RN-PRO-01: o perfil promotor não ganha o módulo Vendedor
    expect(d['plataforma.perfil_modulo'].some((p) => p.perfil === 'promotor' && p.modulo === 'vendedor')).toBe(false);
  });

  it('30 clientes em Manaus, com coordenadas na cidade, contato com telefone fictício e financeiro', () => {
    const cs = d['core.cliente'];
    expect(cs).toHaveLength(30);
    for (const c of cs) {
      expect(c.cidade).toBe('Manaus');
      expect(c.uf).toBe('AM');
      expect(Number(c.latitude)).toBeGreaterThan(-3.2);
      expect(Number(c.latitude)).toBeLessThan(-2.95);
      expect(Number(c.longitude)).toBeGreaterThan(-60.15);
      expect(Number(c.longitude)).toBeLessThan(-59.9);
      expect(c.logradouro).toBeTruthy();
    }
    // prefixos não atribuídos (fixo 3000-0xxx, celular 9 0000-xxxx): nunca é número real
    expect(d['core.cliente_contato'].every((x) => /^9230000\d{3}$/.test(String(x.telefone)) && /^9290000\d{4}$/.test(String(x.whatsapp)))).toBe(true);
    expect(d['core.cliente_financeiro']).toHaveLength(30);
    const vencidos = d['core.titulo'].filter((t) => t.situacao === 'aberto' && String(t.vencimento) < hoje);
    expect(new Set(vencidos.map((t) => t.cliente_id)).size).toBe(8);
    expect(d['core.cliente_financeiro'].filter((f) => f.bloqueado)).toHaveLength(1);
  });

  it('rota de hoje do vendedor com 6 paradas da carteira dele, na data dada', () => {
    const rota = d['core.rota'].find((r) => r.usuario_id === vendedor.id)!;
    expect(rota.data).toBe(hoje);
    const paradas = d['core.rota_parada'].filter((p) => p.rota_id === rota.id);
    expect(paradas.map((p) => p.sequencia)).toEqual([1, 2, 3, 4, 5, 6]);
    const carteira = new Set(d['core.carteira'].filter((c) => c.usuario_id === vendedor.id).map((c) => c.cliente_id));
    expect(paradas.every((p) => carteira.has(p.cliente_id) && p.data === hoje)).toBe(true);
  });

  it('metas do mês, pedidos e visitas só no passado, diário coerente com os pedidos', () => {
    expect(d['core.meta'].every((m) => m.periodo === anoMes(hoje))).toBe(true);
    expect(d['core.meta'].filter((m) => m.usuario_id === vendedor.id).map((m) => m.indicador).sort()).toEqual(['cobertura_pct', 'positivacao', 'venda_cents', 'visitas']);
    expect(d['core.visita'].every((v) => String(v.data_local) < hoje)).toBe(true);
    const status = new Set(d['vendedor.pedido'].map((p) => p.status));
    for (const s of ['pending_approval', 'approved', 'rejected', 'cancelled']) expect(status.has(s)).toBe(true);
    const vendido = d['vendedor.pedido'].filter((p) => ['approved', 'sent_to_erp', 'invoiced', 'cancelled'].includes(String(p.status))).reduce((s, p) => s + Number(p.total_cents), 0);
    expect(d['core.indicador_diario'].reduce((s, x) => s + Number(x.vendido_cents), 0)).toBe(vendido);
    for (const p of d['vendedor.pedido']) {
      const itens = d['vendedor.pedido_item'].filter((i) => i.pedido_id === p.id);
      expect(itens.reduce((s, i) => s + Number(i.total_cents), 0)).toBe(p.total_cents);
    }
  });

  describe('0013: cadastro mínimo, produto, catálogo e frete (T-0047, T-0059, R-20261102-092329/093007/094644)', () => {
    /** Dígitos verificadores do CNPJ conferidos de forma independente do seed. */
    const cnpjValido = (doc: string) => {
      if (!/^\d{14}$/.test(doc) || /^(\d)\1{13}$/.test(doc)) return false;
      const dv = (base: string) => {
        const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
        const r = [...base].reduce((t, c, i) => t + Number(c) * pesos[i]!, 0) % 11;
        return r < 2 ? 0 : 11 - r;
      };
      return dv(doc.slice(0, 12)) === Number(doc[12]) && dv(doc.slice(0, 13)) === Number(doc[13]);
    };

    it('RN-CORE-16: todos os clientes com CNPJ fictício válido (único) e IE; o retrato dos pedidos leva o CNPJ', () => {
      const docs = d['core.cliente'].map((c) => String(c.documento));
      expect(docs.every(cnpjValido)).toBe(true);
      expect(new Set(docs).size).toBe(30);
      expect(cnpjValido('11444777000162')).toBe(false); // controle: DV errado reprova
      expect(d['core.cliente'].every((c) => typeof c.inscricao_estadual === 'string' && c.inscricao_estadual !== '')).toBe(true);
      for (const p of d['vendedor.pedido']) expect(cnpjValido(String((p.cliente_resumo as { documento: string }).documento)), String(p.id)).toBe(true);
      expect(d['vendedor.transportadora'].map((t) => String(t.documento)).every(cnpjValido)).toBe(true);
    });

    it('RN-CORE-17: só o Atacado Boto Rosa sem CEP, marcado como cadastro incompleto (falta cep)', () => {
      const incompletos = d['core.cliente'].filter((c) => c.cadastro_incompleto);
      expect(incompletos.map((c) => c.id)).toEqual([idClienteDemo(CLIENTE_SEM_CEP_DEMO)]);
      expect(incompletos[0]).toMatchObject({ nome_fantasia: 'Atacado Boto Rosa', cep: null, cadastro_campos_faltantes: '{cep}' });
      expect(d['core.cliente'].filter((c) => !c.cadastro_incompleto).every((c) => /^\d{8}$/.test(String(c.cep)) && c.cadastro_campos_faltantes === '{}')).toBe(true);
    });

    it('RN-CORE-18 e RN-VEN-11: custo com margem de 20% a 40%, preço de venda = Varejo e 3 produtos com desconto máximo próprio', () => {
      for (const p of d['core.produto']) {
        const margem = (Number(p.preco_venda_cents) - Number(p.custo_cents)) / Number(p.preco_venda_cents);
        expect(margem, String(p.sku)).toBeGreaterThanOrEqual(0.195);
        expect(margem, String(p.sku)).toBeLessThanOrEqual(0.405);
      }
      expect(Object.fromEntries(d['core.produto'].filter((p) => p.desconto_maximo_pct !== null).map((p) => [p.sku, p.desconto_maximo_pct]))).toEqual({ ...DESCONTO_MAXIMO_PROPRIO_DEMO });
      // o padrão de 15% (desconto_maximo_produto_pct) fica sem linha: ausente = padrão do doc 03
      expect(d['plataforma.parametro'].some((x) => x.chave === 'desconto_maximo_produto_pct')).toBe(false);
      // os produtos com desconto máximo próprio não estão nos pedidos com desconto da demo (não contradizem o RN-VEN-11)
      const comDesconto = new Set(d['vendedor.pedido'].filter((p) => Number(p.desconto_pct) > 0).map((p) => p.id));
      const skusComDesconto = new Set(d['vendedor.pedido_item'].filter((i) => comDesconto.has(i.pedido_id)).map((i) => i.produto_sku));
      for (const sku of Object.keys(DESCONTO_MAXIMO_PROPRIO_DEMO)) expect(skusComDesconto.has(sku), sku).toBe(false);
    });

    it('RN-VEN-15 e RF-CAT-04: toda unidade base é a padrão (fator 1); CX com fator > 1; árvore de 3 níveis com todo produto numa folha', () => {
      const uns = d['core.produto_unidade'];
      expect(uns.filter((u) => u.padrao)).toHaveLength(d['core.produto'].length);
      expect(uns.filter((u) => u.padrao).every((u) => u.fator === 1)).toBe(true);
      expect(uns.filter((u) => u.unidade === 'CX').every((u) => Number(u.fator) > 1)).toBe(true);
      const nos = d['catalogo.catalogo_no'];
      expect(new Set(nos.map((n) => n.nivel))).toEqual(new Set([1, 2, 3]));
      const folhas = new Set(nos.filter((n) => n.nivel === 3).map((n) => n.id));
      expect(d['catalogo.produto_no']).toHaveLength(d['core.produto'].length);
      expect(d['catalogo.produto_no'].every((x) => folhas.has(x.no_id))).toBe(true);
      // preço próprio da CX só quando a consulta de preço filtrar a unidade (PRECO_PROPRIO_CX_LIGADO)
      expect(d['catalogo.tabela_preco_item'].filter((i) => i.unidade !== null).length > 0).toBe(PRECO_PROPRIO_CX_LIGADO);
    });

    it('RN-VEN-16/17: 2 transportadoras; pedidos com frete (FOB só com transportadora, sem valor de frete) e endereço de entrega principal', () => {
      expect(d['vendedor.transportadora']).toHaveLength(2);
      for (const p of d['vendedor.pedido']) {
        expect(['CIF', 'FOB']).toContain(p.frete_modalidade);
        if (p.frete_modalidade === 'CIF') expect(p.transportadora_id).toBeNull();
        else expect(p.transportadora_id).toBeTruthy();
        expect(d['core.cliente_endereco'].some((e) => e.id === p.endereco_entrega_id && e.principal)).toBe(true);
      }
      expect(d['core.cliente_endereco'].filter((e) => e.principal)).toHaveLength(30);
      expect(d['core.cliente_endereco'].filter((e) => !e.principal).length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('T-0029: fatia do pedido (preço, condições, alçadas, gerente e pedidos)', () => {
    const pedidos = d['vendedor.pedido'];
    const tabelaDoCliente = new Map(d['catalogo.cliente_tabela_preco'].map((x) => [x.cliente_id, x.tabela_preco_id]));
    const tabelaPorCodigo = new Map(d['catalogo.tabela_preco'].map((t) => [t.codigo, t.id]));
    const produtoPorSku = new Map(d['core.produto'].map((p) => [p.sku, p.id]));
    /** Preço na unidade base (as linhas com unidade = preço próprio da CX, 0013). */
    const precoDe = (tabela: unknown, produto: unknown) =>
      d['catalogo.tabela_preco_item'].find((i) => i.tabela_preco_id === tabela && i.produto_id === produto && i.unidade === null)?.preco_cents as number | undefined;

    it('licenças: Vendedor e Catálogo para vendedor, supervisor, gerente, analista, assistente e admin; promotor sem Vendedor (RN-PRO-01)', () => {
      const pm = (perfil: string) => d['plataforma.perfil_modulo'].filter((p) => p.perfil === perfil).map((p) => p.modulo);
      for (const perfil of ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin']) expect(pm(perfil), perfil).toEqual(expect.arrayContaining(['catalogo', 'vendedor']));
      expect(pm('promotor')).not.toContain('vendedor');
    });

    it('gerente responsável pela Regional Norte, pai da Equipe Manaus da supervisora (RN-CORE-04)', () => {
      const eq = new Map(d['core.equipe'].map((e) => [e.nome, e]));
      expect(eq.get('Regional Norte')).toMatchObject({ equipe_pai_id: null, responsavel_id: idUsuarioDemo('gerente') });
      expect(eq.get('Equipe Manaus')).toMatchObject({ equipe_pai_id: eq.get('Regional Norte')!.id, responsavel_id: idUsuarioDemo('supervisor') });
      expect(d['core.usuario'].find((u) => u.id === idUsuarioDemo('gerente'))).toMatchObject({ email: 'gerente@exemplo.com.br', perfil: 'gerente', equipe_id: eq.get('Regional Norte')!.id });
    });

    it('preço: Varejo com todos os produtos, Atacado ~7% menor sem 3 produtos; cada cliente com uma tabela, vigente desde o 1º dia do mês anterior', () => {
      const varejo = tabelaPorCodigo.get('VAREJO');
      const atacado = tabelaPorCodigo.get('ATACADO');
      expect(d['catalogo.tabela_preco_item'].filter((i) => i.tabela_preco_id === varejo && i.unidade === null)).toHaveLength(d['core.produto'].length);
      expect(d['catalogo.tabela_preco_item'].filter((i) => i.tabela_preco_id === atacado && i.unidade === null)).toHaveLength(d['core.produto'].length - 3);
      for (const sku of SEM_PRECO_NO_ATACADO) expect(precoDe(atacado, produtoPorSku.get(sku)), sku).toBeUndefined();
      const cafe = produtoPorSku.get('CAF-500');
      expect(precoDe(atacado, cafe)! / precoDe(varejo, cafe)!).toBeCloseTo(0.93, 2);
      expect(d['catalogo.cliente_tabela_preco']).toHaveLength(30);
      expect(new Set(d['catalogo.cliente_tabela_preco'].map((x) => x.cliente_id)).size).toBe(30);
      // hora-fixa-ok: vigência derivada do hoje fixo dos dados estáticos (2026-11-04), nunca comparada ao relógio
      expect(new Set(d['catalogo.tabela_preco_item'].map((i) => i.vigencia_inicio))).toEqual(new Set(['2026-10-01T04:00:00Z']));
      // a 1ª parada do Lucas hoje é cliente do Atacado: lá ele vê "Sem preço para este cliente" (RN-CAT-06)
      expect(tabelaDoCliente.get(idClienteDemo(0))).toBe(atacado);
    });

    it('condições: À vista (padrão única), 28, 28/56, 30/60/90; título vencido só À vista e 28 dias (RN-VEN-14)', () => {
      expect(d['vendedor.condicao_pagamento'].map((c) => c.descricao)).toEqual(['À vista', '28 dias', '28/56 dias', '30/60/90 dias']);
      expect(d['vendedor.condicao_pagamento'].filter((c) => c.padrao).map((c) => c.codigo)).toEqual(['AVISTA']);
      const porCliente = (n: number) => d['vendedor.cliente_condicao'].filter((x) => x.cliente_id === idClienteDemo(n)).length;
      expect(porCliente(1)).toBe(2); // Mercadinho São Jorge: título vencido
      expect([3, 4]).toContain(porCliente(0));
      expect([3, 4]).toContain(porCliente(3));
    });

    it('alçadas 5/10/15 e acima do gerente = analista; o ensaio do Lucas: 3% aprova sozinho, 8% vai à supervisora, 12% ao gerente', () => {
      const politica = politicaDosParametros({ ...ALCADAS_DEMO });
      const cafe = String(produtoPorSku.get('CAF-500'));
      const cliente = idClienteDemo(2);
      const carteira = d['core.carteira'].filter((x) => x.usuario_id === idUsuarioDemo('vendedor')).map((x) => String(x.cliente_id));
      const preco = precoDe(tabelaDoCliente.get(cliente), cafe)!;
      const tentar = (pct: number) =>
        revalidarPedido({ perfil: 'vendedor', vendedor_id: idUsuarioDemo('vendedor'), cliente_id: cliente, carteira, desconto_pct: pct, itens: [{ product_id: cafe, sku: 'CAF-500', quantity: 10 }], precos: { [cafe]: preco }, policy: politica });
      expect(tentar(3)).toMatchObject({ ok: true, status: 'approved', aprovacao_automatica: true });
      expect(tentar(8)).toMatchObject({ ok: true, status: 'pending_approval', nivel: 'supervisor' });
      expect(tentar(12)).toMatchObject({ ok: true, status: 'pending_approval', nivel: 'gerente' });
    });

    it('pedidos: 2 aguardando o supervisor (um de cada vendedor), 1 o gerente, 1 rejeitado com motivo, 1 cancelado; nada enviado ao ERP', () => {
      const pend = pedidos.filter((p) => p.status === 'pending_approval');
      expect(pend.filter((p) => p.nivel_aprovacao === 'supervisor').map((p) => p.vendedor_id).sort()).toEqual([idUsuarioDemo('vendedor'), idUsuarioDemo('vendedor2')].sort());
      expect(pend.filter((p) => p.nivel_aprovacao === 'gerente')).toHaveLength(1);
      expect(pend).toHaveLength(3);
      const rej = pedidos.filter((p) => p.status === 'rejected');
      expect(rej).toHaveLength(1);
      expect(String(rej[0]!.motivo_rejeicao).trim().length).toBeGreaterThanOrEqual(3);
      expect(rej[0]!.decidido_por_id).toBe(idUsuarioDemo('supervisor'));
      expect(pedidos.filter((p) => p.status === 'cancelled')).toHaveLength(1);
      expect(pedidos.every((p) => ['approved', 'pending_approval', 'rejected', 'cancelled'].includes(String(p.status)))).toBe(true);
      expect(pedidos.filter((p) => p.status === 'approved').every((p) => p.aprovacao_automatica === true)).toBe(true);
      // o Lucas segue com 7 pedidos e 1 aguardando aprovação (o "de ontem", do recado)
      const lucas = pedidos.filter((p) => p.vendedor_id === idUsuarioDemo('vendedor'));
      expect([lucas.length, lucas.filter((p) => p.status === 'pending_approval').length]).toEqual([7, 1]);
    });

    it('pedidos recalculados pela tabela do cliente, com número, retratos e condição permitida', () => {
      const numeros = pedidos.map((p) => p.numero);
      expect(new Set(numeros).size).toBe(pedidos.length);
      expect([...numeros].sort()).toEqual(pedidos.map((_, i) => String(i + 1).padStart(6, '0')));
      expect(d['vendedor.numeracao_pedido']).toEqual([expect.objectContaining({ ultimo: pedidos.length })]);
      for (const p of pedidos) {
        expect(p.tabela_preco_id, String(p.numero)).toBe(tabelaDoCliente.get(p.cliente_id));
        const permitidas = d['vendedor.cliente_condicao'].filter((x) => x.cliente_id === p.cliente_id).map((x) => x.condicao_pagamento_id);
        expect(permitidas).toContain(p.condicao_pagamento_id);
        expect(p.cliente_nome).toBeTruthy();
        expect(p.vendedor_nome).toBeTruthy();
        expect((p.cliente_resumo as { razao_social: string }).razao_social).toBeTruthy();
        const itens = d['vendedor.pedido_item'].filter((i) => i.pedido_id === p.id);
        let tabela = 0;
        for (const i of itens) {
          expect(i.preco_tabela_cents).toBe(precoDe(p.tabela_preco_id, i.produto_id));
          expect(i.produto_sku && i.produto_nome && i.unidade).toBeTruthy();
          tabela += Number(i.preco_tabela_cents) * Number(i.quantidade);
        }
        expect(tabela).toBe(p.total_tabela_cents);
      }
    });

    it('linha do tempo: começa em null -> received, transições encadeadas, termina no status do pedido', () => {
      for (const p of pedidos) {
        const ev = d['vendedor.pedido_evento'].filter((e) => e.pedido_id === p.id);
        expect(ev[0]).toMatchObject({ de: null, para: 'received' });
        for (let i = 1; i < ev.length; i++) expect(ev[i]!.de).toBe(ev[i - 1]!.para);
        expect(ev[ev.length - 1]!.para).toBe(p.status);
        expect(ev.every((e) => String(e.ocorrido_em) >= String(p.recebido_em))).toBe(true);
      }
    });
  });

  it('dias úteis pulam o domingo', () => {
    expect(diasUteisAtras('2026-11-02', 1)).toBe('2026-10-31'); // segunda -> sábado
    expect(diasUteisAtras('2026-11-03', 2)).toBe('2026-10-31');
  });

  it('recusa banco que não é local, antes de qualquer consulta', async () => {
    let consultou = false;
    const remoto = { host: 'db.homologacao.exemplo.com', query: async () => { consultou = true; return { rows: [] }; } };
    await expect(carregarDemo(remoto as unknown as pg.Client, { senha: SENHA })).rejects.toThrow(/recusado: banco fora do ambiente local/);
    expect(consultou).toBe(false);
  });
});

describe.skipIf(semBanco())('base de demo (Postgres)', () => {
  let b: BancoDeTeste;
  let pool: pg.Pool;

  /** Contagem por tabela e "impressão digital" (md5 das linhas) de tudo que NÃO é do tenant demo. */
  async function outrosTenants(): Promise<Record<string, string>> {
    return comAdmin(b.nome, async (c) => {
      const out: Record<string, string> = {};
      for (const t of await tabelasComTenant(c)) {
        const r = await c.query<{ n: number; h: string | null }>(
          `select count(*)::int as n, md5(string_agg(x::text, '|' order by x::text)) as h from ${t.schema}.${t.tabela} x where tenant_id <> $1`,
          [TENANT_DEMO],
        );
        out[t.nome] = `${r.rows[0]!.n}:${r.rows[0]!.h ?? ''}`;
      }
      const tn = await c.query<{ h: string }>('select md5(string_agg(x::text, \'|\' order by x.id)) as h from plataforma.tenant x where id <> $1', [TENANT_DEMO]);
      out['plataforma.tenant'] = tn.rows[0]!.h;
      return out;
    });
  }

  async function contarDemo(): Promise<Record<string, number>> {
    return comAdmin(b.nome, async (c) => {
      const out: Record<string, number> = {};
      for (const t of await tabelasComTenant(c)) {
        const r = await c.query<{ n: number }>(`select count(*)::int as n from ${t.schema}.${t.tabela} where tenant_id = $1`, [TENANT_DEMO]);
        out[t.nome] = r.rows[0]!.n;
      }
      return out;
    });
  }

  let antesOutros: Record<string, string>;
  /** "Hoje" da 1ª carga (padrão do seed: data de Manaus no relógio); as recargas fixam o mesmo dia (sem corrida na virada). */
  let hojeCarga: string;
  let hojesPossiveis: string[];

  beforeAll(async () => {
    b = await criarBancoDeTeste({ preparar: (c) => carregarDoisTenants(c).then(() => undefined) });
    antesOutros = await outrosTenants();
    const antes = hojeNoFuso('America/Manaus');
    hojeCarga = (await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA }))).hoje;
    hojesPossiveis = [...new Set([antes, hojeNoFuso('America/Manaus')])];
    pool = new pg.Pool({ connectionString: b.urlApp });
  });
  afterAll(async () => {
    await pool?.end();
    await b?.apagar();
  });

  it('carrega 30 clientes, rota de hoje (fuso do tenant) com 6 paradas e os motivos padrão do gatilho', async () => {
    // padrão do seed = hoje em Manaus no momento da carga (se a carga cruzou a meia-noite, vale qualquer dos dois)
    expect(hojesPossiveis).toContain(hojeCarga);
    const hoje = hojeCarga;
    const r = await comTenant(pool, TENANT_DEMO, async (c) => ({
      clientes: (await c.query<{ n: number }>('select count(*)::int as n from core.cliente')).rows[0]!.n,
      paradas: (await c.query<{ n: number }>(
        "select count(*)::int as n from core.rota_parada p join core.usuario u on u.id = p.usuario_id where u.email = $1 and p.data = $2::date and p.deleted_at is null",
        [USUARIOS_DEMO.vendedor.email, hoje],
      )).rows[0]!.n,
      motivos: (await c.query<{ codigo: string }>("select codigo from core.motivo where tipo = 'cliente_fechado' order by codigo")).rows.map((x) => x.codigo),
      modulos: (await c.query<{ modulo: string }>('select modulo from plataforma.tenant_modulo where ativo order by modulo')).rows.map((x) => x.modulo),
    }));
    expect(r).toEqual({ clientes: 30, paradas: 6, motivos: ['acesso_negado', 'loja_fechada'], modulos: [...MODULOS_DEMO].sort() });
  });

  it('login: o código "demo" resolve o tenant e as senhas são argon2id que conferem', async () => {
    const t = await pool.query<{ id: string; nome: string }>('select id, nome from plataforma.tenant_por_codigo($1)', ['DEMO']);
    expect(t.rows).toEqual([{ id: TENANT_DEMO, nome: 'Distribuidora Exemplo' }]);
    const us = await comAdmin(b.nome, (c) => c.query<{ senha_hash: string }>('select senha_hash from core.usuario where tenant_id = $1', [TENANT_DEMO]));
    expect(us.rows).toHaveLength(Object.keys(USUARIOS_DEMO).length);
    for (const u of us.rows) {
      expect(u.senha_hash.startsWith('$argon2id$')).toBe(true);
      expect(u.senha_hash).not.toContain(SENHA);
    }
    expect(verificarSenha(SENHA, us.rows[0]!.senha_hash)).toBe(true);
  });

  it('idempotente: rodar de novo não duplica nada nem troca o hash da senha', async () => {
    const antes = await contarDemo();
    const hash = () => comAdmin(b.nome, (c) => c.query('select id, senha_hash from core.usuario where tenant_id = $1 order by id', [TENANT_DEMO]));
    const hashAntes = (await hash()).rows;
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }));
    expect(await contarDemo()).toEqual(antes);
    expect((await hash()).rows).toEqual(hashAntes);
  });

  it('número legível: o contador do tenant continua depois dos pedidos da base e a recarga não o faz voltar', async () => {
    const proximo = () => comTenant(pool, TENANT_DEMO, async (c) => (await c.query<{ n: string }>('select vendedor.proximo_numero_pedido() as n')).rows[0]!.n);
    const total = dadosDemo(HASH_FALSO)['vendedor.pedido'].length;
    const primeiro = await proximo();
    expect(Number(primeiro)).toBeGreaterThan(total);
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }));
    expect(Number(await proximo())).toBe(Number(primeiro) + 1);
    // sem contexto de tenant a função falha (não numera "no escuro")
    await expect(pool.query('select vendedor.proximo_numero_pedido()')).rejects.toThrow();
  });

  it('pelo papel macuxi_app: cada cliente com uma tabela de preço viva e 3 produtos sem preço no Atacado', async () => {
    const r = await comTenant(pool, TENANT_DEMO, async (c) => ({
      clientes: (await c.query<{ n: number }>('select count(distinct cliente_id)::int as n from catalogo.cliente_tabela_preco where deleted_at is null')).rows[0]!.n,
      semPreco: (await c.query<{ n: number }>(
        `select count(*)::int as n from catalogo.tabela_preco t cross join (select distinct produto_id from catalogo.tabela_preco_item) p
          where t.codigo = 'ATACADO' and not exists (select 1 from catalogo.tabela_preco_item i where i.tabela_preco_id = t.id and i.produto_id = p.produto_id)`,
      )).rows[0]!.n,
      pendentes: (await c.query<{ nivel: string; n: number }>("select nivel_aprovacao as nivel, count(*)::int as n from vendedor.pedido where status = 'pending_approval' group by 1 order by 1")).rows,
    }));
    expect(r).toEqual({ clientes: 30, semPreco: 3, pendentes: [{ nivel: 'gerente', n: 1 }, { nivel: 'supervisor', n: 2 }] });
  });

  it('outro dia: só a rota do novo dia entra; o diário anda junto (realizado não duplica)', async () => {
    const somaDiario = () =>
      comAdmin(b.nome, (c) => c.query<{ s: string }>('select coalesce(sum(vendido_cents), 0)::text as s from core.indicador_diario where tenant_id = $1', [TENANT_DEMO]));
    const antes = (await somaDiario()).rows[0]!.s;
    const contagem = await contarDemo();
    // relativo à carga (T-0042, B1): com data fixa, no próprio dia (2027-03-10) o "outro dia" era o da carga e entrava +0
    const dia = somarDias(hojeCarga, 200);
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: dia }));
    const depois = await contarDemo();
    expect(depois['core.rota']).toBe(contagem['core.rota']! + 3);
    expect(depois['core.rota_parada']).toBe(contagem['core.rota_parada']! + 14);
    expect(depois['core.indicador_diario']).toBe(contagem['core.indicador_diario']);
    expect((await somaDiario()).rows[0]!.s).toBe(antes);
    expect(depois['core.cliente']).toBe(30);
  });

  it('--recriar zera o ensaio: visita aberta e senha bloqueada somem, a base volta ao tamanho de uma carga só', async () => {
    const vendedorId = (await comAdmin(b.nome, (c) => c.query<{ id: string }>('select id from core.usuario where tenant_id = $1 and email = $2', [TENANT_DEMO, USUARIOS_DEMO.vendedor.email]))).rows[0]!.id;
    await comTenant(pool, TENANT_DEMO, async (c) => {
      const cli = (await c.query<{ id: string }>('select id from core.cliente limit 1')).rows[0]!.id;
      await c.query(
        "insert into core.visita (tenant_id, usuario_id, cliente_id, data_local, checkin_em) values (plataforma.tenant_atual(), $1, $2, $3::date, $4::timestamptz)",
        [vendedorId, cli, hojeCarga, `${hojeCarga}T14:00:00Z`],
      );
    });
    await comAdmin(b.nome, (c) => c.query('update core.usuario set tentativas_falhas = 5, bloqueio_ate = now() + interval \'1 hour\' where id = $1', [vendedorId]));
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, recriar: true, hoje: hojeCarga }));
    const n = await contarDemo();
    const limpo = await (async () => {
      const outro = await criarBancoDeTeste({ preparar: (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }).then(() => undefined) });
      try {
        return await comAdmin(outro.nome, async (c) => {
          const out: Record<string, number> = {};
          for (const t of await tabelasComTenant(c)) {
            out[t.nome] = (await c.query<{ n: number }>(`select count(*)::int as n from ${t.schema}.${t.tabela} where tenant_id = $1`, [TENANT_DEMO])).rows[0]!.n;
          }
          return out;
        });
      } finally {
        await outro.apagar();
      }
    })();
    expect(n).toEqual(limpo);
    const u = await comAdmin(b.nome, (c) => c.query<{ tentativas_falhas: number; bloqueio_ate: Date | null }>('select tentativas_falhas, bloqueio_ate from core.usuario where id = $1', [vendedorId]));
    expect(u.rows[0]).toEqual({ tentativas_falhas: 0, bloqueio_ate: null });
  }, 300_000); // cria e migra um 2º banco dentro do teste: ~30 s sozinho, passa de 60 s com as outras suítes em paralelo

  it('RF-CAT-01 (T-0047): a busca do servidor acha "óleo para moto 150 cilindradas" e "detergente neutro 5 litros" pelo papel macuxi_app', async () => {
    const buscar = (texto: string) =>
      comTenant(pool, TENANT_DEMO, async (c) =>
        (await c.query<{ sku: string }>(
          `select sku from catalogo.produto_busca
            where documento @@ websearch_to_tsquery('portuguese', catalogo.sem_acento($1)) and ativo and deleted_at is null
            order by ts_rank_cd(documento, websearch_to_tsquery('portuguese', catalogo.sem_acento($1))) desc, sku`,
          [texto],
        )).rows.map((x) => x.sku),
      );
    expect(await buscar('óleo para moto 150 cilindradas')).toContain('OLE-4T-1L');
    expect(await buscar('detergente neutro 5 litros')).toEqual(['DET-5L']);
    expect(await buscar('oleo moto')).toEqual(expect.arrayContaining(['OLE-4T-1L', 'OLE-4T-SEMI']));
    expect(await buscar('pneu de trator')).toEqual([]);
  });

  it('isolamento: carga, recarga e --recriar não mudam nenhuma linha de outro tenant', async () => {
    expect(await outrosTenants()).toEqual(antesOutros);
  });

  it('isolamento pelo papel macuxi_app: o tenant A não vê a base demo e o demo não vê o A', async () => {
    const demoClientes = new Set(dadosDemo(HASH_FALSO)['core.cliente'].map((c) => String(c.id)));
    const vistosPorA = await comTenant(pool, DOIS_TENANTS.A.tenantId, (c) => c.query<{ id: string; tenant_id: string }>('select id, tenant_id from core.cliente'));
    expect(vistosPorA.rows.length).toBeGreaterThan(0);
    expect(vistosPorA.rows.some((r) => demoClientes.has(r.id) || r.tenant_id === TENANT_DEMO)).toBe(false);
    const vistosPeloDemo = await comTenant(pool, TENANT_DEMO, (c) => c.query<{ tenant_id: string }>('select distinct tenant_id from core.usuario'));
    expect(vistosPeloDemo.rows).toEqual([{ tenant_id: TENANT_DEMO }]);
  });
});
