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
  METAS_MES_ANTERIOR_DEMO, TIPO_METAS_DEMO, USUARIOS_DEMO, CLIENTE_REFERENCIA_DEMO, codigoErpDemo, RELACOES_DEMO, numerarPedidosDemo,
} from '../seeds/demo/demo';
import { dadosDemoMedidas, MEDIDAS_ATIVAS_DEMO } from '../seeds/demo/medidas';
import { dadosGestorDemo, MODULO_GESTOR, PERFIS_GESTOR_DEMO, projecaoDemo } from '../seeds/demo/gestor';
import { painelDoMes } from '../../modules/gestor/domain/painel';
import { MODULO_PESQUISA, PERFIS_PESQUISA_DEMO } from '../seeds/demo/pesquisa';
import { MARCAS_CONCORRENTES_DEMO, PERFIS_PROMOTOR_DEMO } from '../seeds/demo/promotor';
import { dadosDemoCatalogoCadastro, ETIQUETAS_DEMO, REFERENCIAS_DEMO } from '../seeds/demo/catalogo-cadastro';
import { MODULO_TREINAMENTO, PERFIS_TREINAMENTO_DEMO, TRILHAS_DEMO } from '../seeds/demo/treinamento';
import {
  CLIENTE_PRAZO_30_DEMO, CLIENTE_SEM_BOLETO_DEMO, dadosDemoPagamento, FAIXAS_DEMO, FORMAS_DEMO, FORMAS_SEM_BOLETO_DEMO, idsPagamentoPadrao, PRAZO_MEDIO_MAX_DEMO,
} from '../seeds/demo/pagamento';
import { comAdmin, criarBancoDeTeste, type BancoDeTeste } from '../src/banco-teste';
import { comTenant } from '../src/contexto';
import { anoMes, hojeNoFuso, somarDias } from '../src/datas';
import { verificarSenha } from '../src/senha';
import { semBanco } from './estado';
import { semMarcaDeAmbiente, tabelasComTenant } from './util';

const SENHA = 'senha-do-teste-demo';
/** Módulos ativos no tenant demo depois da carga: os do demo.ts + os dos seeds próprios ligados no carregarDemo (0014 Gestor, 0016 Pesquisa, 0017 Treinamento). */
const MODULOS_ATIVOS_DEMO = [...new Set<string>([...MODULOS_DEMO, MODULO_GESTOR, MODULO_PESQUISA, MODULO_TREINAMENTO])].sort();
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

  it('T-0067/T-0068: metas do mês de Lucas e Camila com o tipo (0019); equipe da Renata com supervisora e gerente na árvore', () => {
    const lucas = idUsuarioDemo('vendedor');
    const camila = idUsuarioDemo('vendedor2');
    for (const quem of [lucas, camila]) {
      const metas = d['core.meta'].filter((m) => m.usuario_id === quem && m.periodo === anoMes(hoje));
      expect(metas.map((m) => m.indicador).sort()).toEqual(['cobertura_pct', 'positivacao', 'venda_cents', 'visitas']);
      expect(metas.every((m) => m.tipo === TIPO_METAS_DEMO)).toBe(true);
    }
    expect(d['core.meta'].every((m) => m.tipo === 'pedido')).toBe(true);
    const equipe = (nome: string) => d['core.equipe'].find((e) => e.nome === nome)!;
    const manaus = equipe('Equipe Manaus');
    const regional = equipe('Regional Norte');
    expect([manaus.responsavel_id, manaus.equipe_pai_id, regional.responsavel_id, regional.equipe_pai_id]).toEqual([
      idUsuarioDemo('supervisor'), regional.id, idUsuarioDemo('gerente'), null,
    ]);
    const daManaus = d['core.usuario'].filter((u) => u.equipe_id === manaus.id).map((u) => String(u.id)).sort();
    expect(daManaus).toEqual([lucas, camila, idUsuarioDemo('promotor'), idUsuarioDemo('supervisor')].sort());
    expect(d['core.usuario'].find((u) => u.id === idUsuarioDemo('gerente'))!.equipe_id).toBe(regional.id);
  });

  it('T-0070/T-0068: metas do mês anterior só de Lucas e Camila, mesmos 4 indicadores e tipo, valores diferentes do mês corrente', () => {
    const anterior = d['core.meta'].filter((m) => m.periodo === anoMes(hoje, -1));
    expect(anterior).toHaveLength(METAS_MES_ANTERIOR_DEMO.length);
    expect(new Set(anterior.map((m) => m.usuario_id))).toEqual(new Set([idUsuarioDemo('vendedor'), idUsuarioDemo('vendedor2')]));
    for (const m of anterior) {
      expect(m.tipo).toBe(TIPO_METAS_DEMO);
      const corrente = d['core.meta'].find((x) => x.usuario_id === m.usuario_id && x.indicador === m.indicador && x.periodo === anoMes(hoje))!;
      expect(corrente, `meta corrente de ${String(m.indicador)}`).toBeDefined();
      expect(m.valor).not.toBe(corrente.valor);
      expect(m.id).not.toBe(corrente.id);
    }
    // ids determinísticos únicos e uma linha por (usuário, período, indicador) (único meta_uk)
    expect(new Set(d['core.meta'].map((m) => m.id)).size).toBe(d['core.meta'].length);
    expect(new Set(d['core.meta'].map((m) => `${String(m.usuario_id)}|${String(m.periodo)}|${String(m.indicador)}`)).size).toBe(d['core.meta'].length);
  });

  it('T-0070: o Gestor projeta a meta do mês anterior por usuário|mês; o painel do mês corrente fica com a meta corrente', () => {
    const { estado } = projecaoDemo(dadosGestorDemo(d).eventos);
    const mes = anoMes(hoje);
    const anterior = anoMes(hoje, -1);
    const semAnterior = projecaoDemo(dadosGestorDemo({ ...d, 'core.meta': d['core.meta'].filter((m) => m.periodo === mes) }).eventos).estado;
    for (const k of ['vendedor', 'vendedor2'] as const) {
      const u = idUsuarioDemo(k);
      const venda = (p: string) => Number(d['core.meta'].find((m) => m.usuario_id === u && m.periodo === p && m.indicador === 'venda_cents')!.valor);
      expect(estado.metas[`${u}|${mes}`]?.meta_cents).toBe(venda(mes));
      expect(estado.metas[`${u}|${anterior}`]?.meta_cents).toBe(venda(anterior));
      expect(painelDoMes(estado, u, hoje)).toEqual(painelDoMes(semAnterior, u, hoje));
    }
  });

  it('metas do mês, pedidos e visitas só no passado, diário coerente com os pedidos', () => {
    expect(d['core.meta'].every((m) => m.periodo === anoMes(hoje) || m.periodo === anoMes(hoje, -1))).toBe(true);
    expect(d['core.meta'].filter((m) => m.usuario_id === vendedor.id && m.periodo === anoMes(hoje)).map((m) => m.indicador).sort()).toEqual(['cobertura_pct', 'positivacao', 'venda_cents', 'visitas']);
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
      // RN-VEN-15 (T-0089): sem preço próprio da embalagem; toda linha de preço é da UN (unidade nula)
      expect(PRECO_PROPRIO_CX_LIGADO).toBe(false);
      expect(d['catalogo.tabela_preco_item'].filter((i) => i.unidade !== null)).toEqual([]);
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

  describe('T-0084/T-0085 (0033): aplicação, oferece junto, árvore sistema › grupo › linha, referências cruzadas e etiquetas', () => {
    const sku = new Map(d['core.produto'].map((p) => [p.id as string, p.sku as string]));
    const idDe = new Map(d['core.produto'].map((p) => [p.sku as string, p.id as string]));
    const aplicacao = new Map(d['catalogo.produto_conteudo'].map((c) => [sku.get(c.produto_id as string)!, c.aplicacoes as string | null]));
    const autopecas = d['core.produto'].filter((p) => p.categoria === 'Automotivo').map((p) => p.sku as string);
    const cad = dadosDemoCatalogoCadastro({ tenantId: TENANT_DEMO, hoje, dados: d });
    const marcas = cad['catalogo.marca_concorrente']; // T-0113 (0045): as marcas são do Catálogo

    it('RN-CAT-11: aplicação em ~40% das autopeças (5 de 12), com os casos do Uno, do Gol, do "a partir de 2018" e do texto > 300 sem separador; o resto sem', () => {
      expect(autopecas).toHaveLength(12);
      const com = autopecas.filter((s) => aplicacao.get(s));
      expect(com.sort()).toEqual(['AMR-T01', 'FOL-G01', 'LAM-H4', 'OLE-4T-1L', 'PST-D01']);
      expect(com.length / autopecas.length).toBeGreaterThan(0.35);
      expect(com.length / autopecas.length).toBeLessThan(0.5);
      expect(aplicacao.get('PST-D01')).toBe('Fiat Uno 1.0/1.4 2010–2014; Fiat Palio 1.0/1.4 2012–2016');
      expect(aplicacao.get('FOL-G01')).toBe('VW Gol G5/G6 1.0/1.6 2009–2016; VW Voyage 1.0/1.6 2009–2016');
      expect(aplicacao.get('AMR-T01')).toContain('a partir de 2018');
      const longa = aplicacao.get('LAM-H4')!;
      expect(longa.length).toBeGreaterThan(300);
      expect(longa.length).toBeLessThanOrEqual(2000);
      expect(longa).not.toMatch(/[;|•\n]/);
      // controle: fora das autopeças nenhum produto tem aplicação (o texto sairia no orçamento)
      for (const [s, a] of aplicacao) if (!autopecas.includes(s)) expect(a, s).toBeNull();
      for (const a of aplicacao.values()) if (a) expect(a.length).toBeLessThanOrEqual(2000);
    });

    it('RN-CAT-12: sinônimos VW = Volkswagen e GM = Chevrolet; o conteúdo da busca do servidor não leva a aplicação', () => {
      const sin = new Map(d['catalogo.sinonimo'].map((x) => [x.termo, x.sinonimos]));
      expect(sin.get('vw')).toBe('{volkswagen}');
      expect(sin.get('gm')).toBe('{chevrolet}');
      const busca = d['catalogo.produto_busca'].find((b) => b.produto_id === idDe.get('PST-D01'))!;
      expect(String(busca.conteudo)).not.toContain('Uno');
      // documento do servidor (0033): aplicação expandida (anos de dentro da faixa) e referências cruas + compactas
      const b = cad.busca.find((x) => x.produto_id === idDe.get('PST-D01'))!;
      expect(b.aplicacao).toContain('Fiat Uno 1.0/1.4 2010–2014');
      expect(b.aplicacao).toMatch(/ 2011 /);
      expect(b.aplicacao).toMatch(/2012/);
      expect(b.referencias).toBe('CB 3401 cb3401 RF-1187 rf1187');
      expect(cad.busca.find((x) => x.produto_id === idDe.get('CAF-500'))).toEqual({ produto_id: idDe.get('CAF-500'), aplicacao: null, referencias: null });
    });

    it('RF-CAT-09: oferece junto = complementar (pastilha → disco e fluido; filtro → óleo 5W30), até 5 por produto', () => {
      const comp = RELACOES_DEMO.filter(([, , tipo]) => tipo === 'complementar');
      expect(comp.filter(([p]) => p === 'PST-D01').map(([, r]) => r)).toEqual(['DSC-D01', 'FLU-DOT4']);
      expect(comp.filter(([p]) => p === 'FOL-G01').map(([, r]) => r)).toEqual(['OLE-5W30']);
      const porProduto = new Map<string, number>();
      for (const [p] of comp) porProduto.set(p, (porProduto.get(p) ?? 0) + 1);
      for (const [p, n] of porProduto) expect(n, p).toBeLessThanOrEqual(5);
    });

    it('RF-CAT-09: árvore sistema › grupo › linha (Freios › Pastilhas › Dianteiras etc.), cada autopeça nova numa folha', () => {
      const nos = new Map(d['catalogo.catalogo_no'].map((n) => [n.id as string, n]));
      const trilha = (s: string) => {
        const pn = d['catalogo.produto_no'].find((x) => x.produto_id === idDe.get(s))!;
        const out: string[] = [];
        for (let n = nos.get(pn.no_id as string); n; n = n.pai_id ? nos.get(n.pai_id as string) : undefined) out.unshift(String(n.nome));
        return out.join(' › ');
      };
      expect(trilha('PST-D01')).toBe('Freios › Pastilhas › Dianteiras');
      expect(trilha('DSC-D01')).toBe('Freios › Discos › Dianteiros');
      expect(trilha('FOL-G01')).toBe('Filtros › Filtros de óleo › Linha leve');
      expect(trilha('AMR-T01')).toBe('Suspensão › Amortecedores › Traseiros');
    });

    it('RN-CAT-09: referências até 3 por produto, "CB 3401" (Freiomax) na pastilha do Uno e "FB-0207" (Filtrobom) no filtro, marca = concorrente do Promotor, compacto da regra do domain', () => {
      const refs = cad['catalogo.produto_referencia'];
      expect(refs).toHaveLength(REFERENCIAS_DEMO.length);
      const nomeDaMarca = new Map(marcas.map((m) => [m.id as string, m.nome as string]));
      const de = (s: string) => refs.filter((r) => r.produto_id === idDe.get(s)).map((r) => `${nomeDaMarca.get(r.marca_id as string)} ${r.codigo}`);
      expect(de('PST-D01')).toEqual(['Freiomax CB 3401', 'Rodaforte RF-1187']);
      expect(de('FOL-G01')).toEqual(['Filtrobom FB-0207']);
      const porProduto = new Map<string, number[]>();
      for (const r of refs) porProduto.set(r.produto_id as string, [...(porProduto.get(r.produto_id as string) ?? []), r.ordem as number]);
      for (const [p, ordens] of porProduto) {
        expect(ordens.length, p).toBeLessThanOrEqual(3);
        expect(new Set(ordens).size, p).toBe(ordens.length);
      }
      for (const r of refs) {
        expect(String(r.codigo).length).toBeLessThanOrEqual(30);
        expect(r.codigo_compacto).toMatch(/^[a-z0-9]{1,30}$/);
        expect(r.codigo_compacto).toBe(String(r.codigo).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, ''));
        expect(nomeDaMarca.has(r.marca_id as string), String(r.codigo)).toBe(true);
        // 0034: retrato do nome da marca = o nome do concorrente do Promotor
        expect(r.marca_nome, String(r.codigo)).toBe(nomeDaMarca.get(r.marca_id as string));
      }
      expect(new Set(refs.map((r) => r.id)).size).toBe(refs.length);
    });

    it('marcas concorrentes fictícias no Catálogo (Freiomax, Rodaforte, Filtrobom, Vialume), diferentes das marcas próprias', () => {
      expect(marcas.map((m) => m.nome)).toEqual(expect.arrayContaining(Object.values(MARCAS_CONCORRENTES_DEMO)));
      const proprias = new Set(d['core.produto'].map((p) => String(p.marca).toLowerCase()));
      for (const m of Object.values(MARCAS_CONCORRENTES_DEMO)) expect(proprias.has(m.toLowerCase()), m).toBe(false);
    });

    it('etiquetas: "Dianteira" e "Novo" na pastilha; até 4, cada uma com até 20 caracteres; os demais sem', () => {
      const porSku = new Map(cad.etiquetas.map((e) => [sku.get(d['catalogo.produto_conteudo'].find((c) => c.id === e.id)!.produto_id as string)!, e.etiquetas]));
      expect(porSku.get('PST-D01')).toEqual(['Dianteira', 'Novo']);
      expect(porSku.get('CAF-500')).toEqual([]);
      for (const [s, e] of porSku) {
        expect(e.length, s).toBeLessThanOrEqual(4);
        for (const x of e) expect(x.length > 0 && x.length <= 20, `${s}: ${x}`).toBe(true);
      }
      expect(Object.keys(ETIQUETAS_DEMO).every((s) => idDe.has(s))).toBe(true);
    });
  });

  describe('T-0071: referência do novo pedido (Mini Box Japiim, preços e embalagens, relacionados, clientes parecidos, alçada)', () => {
    const porSku = new Map(d['core.produto'].map((p) => [String(p.sku), String(p.id)]));
    const varejo = d['catalogo.tabela_preco'].find((t) => t.codigo === 'VAREJO')!.id;
    const precoVarejo = (sku: string, unidade: string | null = null) =>
      d['catalogo.tabela_preco_item'].find((i) => i.tabela_preco_id === varejo && i.produto_id === porSku.get(sku) && i.unidade === unidade)?.preco_cents as number | undefined;
    const unidadesDe = (sku: string) => d['core.produto_unidade'].filter((u) => u.produto_id === porSku.get(sku)).map((u) => [u.unidade, u.fator, u.padrao]);
    const miniBox = idClienteDemo(CLIENTE_REFERENCIA_DEMO);

    it('Mini Box Japiim: cód. C5110, Mercadinho, Av. Ajuricaba 1200 (CEP 69077-000) + 1 endereço de entrega, no Varejo, sem vencido nem bloqueio, prazos À vista/28/28-56', () => {
      const c = d['core.cliente'].find((x) => x.id === miniBox)!;
      expect(c).toMatchObject({ nome_fantasia: 'Mini Box Japiim', external_id: 'C5110', segmento: 'Mercadinho', logradouro: 'Av. Ajuricaba', numero: '1200', bairro: 'Japiim', cep: '69077000', cadastro_incompleto: false });
      expect(codigoErpDemo(CLIENTE_REFERENCIA_DEMO)).toBe('C5110');
      expect(new Set(d['core.cliente'].map((x) => x.external_id)).size).toBe(30);
      const enderecos = d['core.cliente_endereco'].filter((e) => e.cliente_id === miniBox);
      expect(enderecos.map((e) => [e.tipo, e.principal]).sort()).toEqual([['entrega', false], ['principal', true]]);
      expect(enderecos.find((e) => e.principal)).toMatchObject({ logradouro: 'Av. Ajuricaba', numero: '1200', cep: '69077000' });
      expect(d['catalogo.cliente_tabela_preco'].find((x) => x.cliente_id === miniBox)!.tabela_preco_id).toBe(varejo);
      expect(d['core.cliente_financeiro'].find((f) => f.cliente_id === miniBox)).toMatchObject({ bloqueado: false });
      expect(d['core.titulo'].filter((t) => t.cliente_id === miniBox && t.situacao === 'aberto' && String(t.vencimento) < hoje)).toEqual([]);
      const prazos = d['vendedor.cliente_condicao'].filter((x) => x.cliente_id === miniBox).map((x) => x.condicao_pagamento_id);
      const codigo = new Map(d['vendedor.condicao_pagamento'].map((x) => [x.id, x.codigo]));
      expect(prazos.map((x) => codigo.get(x)).sort()).toEqual(['28-56', '28D', 'AVISTA']);
      // está na carteira do Lucas e na rota de hoje dele
      expect(d['core.carteira'].some((x) => x.cliente_id === miniBox && x.usuario_id === idUsuarioDemo('vendedor'))).toBe(true);
    });

    it('preços e medidas da referência: AGU-500 FD R$ 17,90; CAF-500 UN R$ 18,90 com CX c/ 12 = R$ 226,80; BIS-400 CX c/ 20 = R$ 117,80; tabela R$ 398,30', () => {
      expect([precoVarejo('AGU-500'), d['core.produto'].find((p) => p.sku === 'AGU-500')!.unidade]).toEqual([1790, 'FD']);
      expect(precoVarejo('CAF-500')).toBe(1890);
      expect(unidadesDe('CAF-500')).toEqual([['UN', 1, true], ['CX', 12, false]]);
      expect(precoVarejo('CAF-500', 'CX')).toBeUndefined(); // RN-VEN-15 (T-0089): UN × fator
      expect(precoVarejo('CAF-500')! * 12).toBe(22_680);
      expect(unidadesDe('BIS-400')).toEqual([['UN', 1, true], ['CX', 20, false]]);
      expect(precoVarejo('BIS-400', 'CX')).toBeUndefined(); // sem preço próprio: UN × fator
      expect(precoVarejo('BIS-400')! * 20).toBe(11_780);
      // 3 FD de água + 12 UN de café + 1 CX de biscoito (desenho §3.2)
      expect(3 * precoVarejo('AGU-500')! + 12 * precoVarejo('CAF-500')! + 20 * precoVarejo('BIS-400')!).toBe(39_830);
      expect(ALCADAS_DEMO['alcada.vendedor_pct']).toBe(5);
    });

    it('relacionados: complementares do café (açúcar R$ 4,99, filtro R$ 5,49, leite em pó R$ 16,90) e superior da água (1,5 L FD R$ 19,90), com estoque', () => {
      const rel = d['catalogo.produto_relacao'];
      expect(rel).toHaveLength(RELACOES_DEMO.length);
      const do_ = (sku: string, tipo: string) => rel.filter((r) => r.produto_id === porSku.get(sku) && r.tipo === tipo).sort((x, y) => Number(x.ordem) - Number(y.ordem)).map((r) => r.relacionado_id);
      expect(do_('CAF-500', 'complementar')).toEqual(['ACU-1K', 'FIL-103', 'LPO-400'].map((s) => porSku.get(s)));
      expect(do_('AGU-500', 'superior')).toEqual([porSku.get('AGU-1500')]);
      expect(['ACU-1K', 'FIL-103', 'LPO-400', 'AGU-1500'].map((s) => precoVarejo(s))).toEqual([499, 549, 1690, 1990]);
      expect(d['core.produto'].find((p) => p.sku === 'AGU-1500')!.unidade).toBe('FD');
      const saldo = (sku: string) => d['catalogo.estoque_saldo'].filter((e) => e.produto_id === porSku.get(sku)).reduce((t, e) => t + Number(e.quantidade), 0);
      for (const sku of ['ACU-1K', 'FIL-103', 'LPO-400', 'AGU-1500']) expect(saldo(sku), sku).toBeGreaterThan(0);
      // "Leve mais": a CX do café exige estoque >= fator na unidade base
      expect(saldo('CAF-500')).toBeGreaterThanOrEqual(12);
      for (const r of rel) expect(r.produto_id).not.toBe(r.relacionado_id);
      expect(new Set(rel.map((r) => `${String(r.produto_id)}|${String(r.relacionado_id)}|${String(r.tipo)}`)).size).toBe(rel.length);
      // todo produto das relações existe na base (sem FK no banco: a base garante)
      const ids = new Set(porSku.values());
      for (const r of rel) expect(ids.has(String(r.produto_id)) && ids.has(String(r.relacionado_id))).toBe(true);
    });

    it('clientes parecidos (desenho §4.3): 2 mercadinhos do Lucas com pedido recente que conta (nem cancelado nem rejeitado), só com itens da referência ou complementares', () => {
      const lucas = idUsuarioDemo('vendedor');
      const carteira = new Set(d['core.carteira'].filter((x) => x.usuario_id === lucas && x.papel === 'vendedor').map((x) => x.cliente_id));
      const mercadinhos = new Set(d['core.cliente'].filter((c) => c.segmento === 'Mercadinho' && c.id !== miniBox && carteira.has(c.id)).map((c) => c.id));
      const contam = d['vendedor.pedido'].filter((p) => p.vendedor_id === lucas && mercadinhos.has(p.cliente_id) && !['cancelled', 'rejected'].includes(String(p.status)));
      expect(new Set(contam.map((p) => p.cliente_id)).size).toBe(2);
      expect(contam.every((p) => String(p.created_at) >= `${somarDias(hoje, -90)}`)).toBe(true);
      const skus = new Set(d['vendedor.pedido_item'].filter((i) => contam.some((p) => p.id === i.pedido_id)).map((i) => String(i.produto_sku)));
      expect([...skus].sort()).toEqual(['ACU-1K', 'AGU-500', 'BIS-400', 'CAF-500', 'FIL-103', 'LPO-400']);
      // o Mini Box não tem pedido (nada a tirar do "Combina" por já ter comprado)
      expect(d['vendedor.pedido'].filter((p) => p.cliente_id === miniBox)).toEqual([]);
      // 11 pedidos na base: o próximo número (orçamento da referência) é o 000012
      expect(d['vendedor.numeracao_pedido'][0]!.ultimo).toBe(11);
    });
  });

  describe('T-0029: fatia do pedido (preço, condições, alçadas, gerente e pedidos)', () => {
    const pedidos = d['vendedor.pedido'];
    const tabelaDoCliente = new Map(d['catalogo.cliente_tabela_preco'].map((x) => [x.cliente_id, x.tabela_preco_id]));
    const tabelaPorCodigo = new Map(d['catalogo.tabela_preco'].map((t) => [t.codigo, t.id]));
    const produtoPorSku = new Map(d['core.produto'].map((p) => [p.sku, p.id]));
    /** Preço na unidade base (RN-VEN-15: não há linha com unidade; o filtro só protege bases antigas). */
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
      // o Lucas com 8 pedidos (7 + o p11 da T-0071, clientes parecidos) e 1 aguardando aprovação (o "de ontem", do recado)
      const lucas = pedidos.filter((p) => p.vendedor_id === idUsuarioDemo('vendedor'));
      expect([lucas.length, lucas.filter((p) => p.status === 'pending_approval').length]).toEqual([8, 1]);
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

  describe('T-0026: numerarPedidosDemo (número já emitido não volta nem muda de dono)', () => {
    const n = (k: number) => String(k).padStart(6, '0');
    const seed = [1, 2, 3].map((k) => ({ id: `s${k}`, numero: n(k) }));
    const semNada = { seed, antes: new Map<string, string>(), deVerdade: [], teto: 0 };

    it('base nova: 000001… pela ordem do seed e contador no último', () => {
      const r = numerarPedidosDemo(semNada);
      expect([...r.seed.values()]).toEqual([n(1), n(2), n(3)]);
      expect([r.ultimo, r.renumerar, r.trocadosNoSeed]).toEqual([3, [], []]);
    });

    it('recarga: o seed guarda o número que já tinha (mesmo fora da ordem) e a do aparelho fica; idempotente', () => {
      const antes = new Map([['s1', n(2)], ['s2', n(1)], ['s3', n(3)]]);
      const deVerdade = [{ id: 'a1', numero: n(4), recebido_em: '2026-11-02T13:19:00' }];
      const r = numerarPedidosDemo({ seed, antes, deVerdade, teto: 4 });
      expect(Object.fromEntries(r.seed)).toEqual({ s1: n(2), s2: n(1), s3: n(3) });
      expect([r.ultimo, r.renumerar, r.trocadosNoSeed]).toEqual([4, [], []]);
      expect(numerarPedidosDemo({ seed, antes: r.seed, deVerdade, teto: r.ultimo })).toEqual(r);
    });

    it('000011: pedido novo no seed cujo número da base nova já saiu para um aparelho ganha o próximo do contador', () => {
      // seed tinha s1 e s2; o aparelho recebeu 000003; o s3 entrou no seed depois
      const antes = new Map([['s1', n(1)], ['s2', n(2)]]);
      const deVerdade = [{ id: 'a1', numero: n(3), recebido_em: '2026-11-02T13:19:00' }];
      const r = numerarPedidosDemo({ seed, antes, deVerdade, teto: 3 });
      expect(Object.fromEntries(r.seed)).toEqual({ s1: n(1), s2: n(2), s3: n(4) });
      expect([r.ultimo, r.renumerar, r.trocadosNoSeed]).toEqual([4, [], []]);
    });

    it('--recriar: o aparelho some, mas o número emitido a ele não volta para pedido novo do seed', () => {
      // antes do --recriar: s1 e s2 com número, aparelho com 000003 e 000004 (contador 4); o s3 é novo no seed
      const r = numerarPedidosDemo({ seed, antes: new Map([['s1', n(1)], ['s2', n(2)]]), deVerdade: [], teto: 4 });
      expect(Object.fromEntries(r.seed)).toEqual({ s1: n(1), s2: n(2), s3: n(5) });
      expect(r.ultimo).toBe(5);
    });

    it('número da base nova acima do teto e livre é usado (nunca foi emitido)', () => {
      const r = numerarPedidosDemo({ seed, antes: new Map([['s1', n(1)]]), deVerdade: [], teto: 1 });
      expect(Object.fromEntries(r.seed)).toEqual({ s1: n(1), s2: n(2), s3: n(3) });
      expect(r.ultimo).toBe(3);
    });

    it('repetido de verdade: o mais antigo fica, o outro ganha número novo; do seed no número de um pedido de verdade, quem muda é o do seed', () => {
      const deVerdade = [
        { id: 'a2', numero: n(5), recebido_em: '2026-11-03T10:00:00' },
        { id: 'a1', numero: n(5), recebido_em: '2026-11-02T10:00:00' },
        { id: 'a3', numero: n(1), recebido_em: '2026-11-02T11:00:00' },
      ];
      const antes = new Map([['s1', n(1)], ['s2', n(2)], ['s3', n(3)]]);
      const r = numerarPedidosDemo({ seed, antes, deVerdade, teto: 5 });
      expect(Object.fromEntries(r.seed)).toEqual({ s1: n(6), s2: n(2), s3: n(3) });
      expect(r.renumerar).toEqual([{ id: 'a2', de: n(5), para: n(7), origem: 'aparelho' }]);
      expect(r.trocadosNoSeed).toEqual([{ id: 's1', de: n(1), para: n(6), origem: 'seed' }]);
      expect(r.ultimo).toBe(7);
      const todos = [...r.seed.values(), n(5), n(1), n(7)];
      expect(new Set(todos).size).toBe(todos.length);
    });

    it('número fora do formato (só dígitos) não conta para o teto, mas continua ocupado', () => {
      const deVerdade = [{ id: 'a1', numero: 'ERP-9', recebido_em: null }];
      const r = numerarPedidosDemo({ seed, antes: new Map(), deVerdade, teto: 0 });
      expect([...r.seed.values()]).toEqual([n(1), n(2), n(3)]);
      expect(r.ultimo).toBe(3);
    });
  });

  it('recusa banco que não é local, antes de qualquer consulta', async () => {
    let consultou = false;
    const remoto = { host: 'db.homologacao.exemplo.com', query: async () => { consultou = true; return { rows: [] }; } };
    await semMarcaDeAmbiente(() => expect(carregarDemo(remoto as unknown as pg.Client, { senha: SENHA })).rejects.toThrow(/recusado: banco fora do ambiente local/));
    expect(consultou).toBe(false);
  });
});

describe('base de demo T-0089 (0037): formas e prazos, prazo médio do cliente, tabela escalonada e título vencido (estático)', () => {
  const hoje = '2026-11-06'; // hora-fixa-ok: dados estáticos (funções puras), nunca comparados ao relógio
  const d = dadosDemo(HASH_FALSO, { hoje });
  const p = dadosDemoPagamento({ tenantId: TENANT_DEMO, hoje, dados: d });
  const parcelas = (s: unknown) => String(s).replace(/[{}]/g, '').split(',').map(Number);

  it('RN-VEN-24: 4 formas na ordem (Pix, Dinheiro, Cartão, Boleto) com os prazos da ficha, só o prazo na descrição e o prazo médio arredondado para cima', () => {
    expect(p.formas.map((f) => [f.codigo, f.nome, f.ordem, f.ativo])).toEqual([
      ['PIX', 'Pix', 1, true], ['DINHEIRO', 'Dinheiro', 2, true], ['CARTAO', 'Cartão', 3, true], ['BOLETO', 'Boleto', 4, true],
    ]);
    const nomeDaForma = new Map(p.formas.map((f) => [f.id, f.codigo]));
    expect(p.prazos.map((z) => [nomeDaForma.get(z.forma_pagamento_id), z.codigo, z.descricao, parcelas(z.parcelas_dias), z.prazo_medio_dias])).toEqual([
      ['PIX', 'PIX-AV', 'À vista', [0], 0],
      ['DINHEIRO', 'DIN-AV', 'À vista', [0], 0],
      ['CARTAO', 'CAR-30', '30 dias', [30], 30],
      ['CARTAO', 'CAR-30-60', '30/60 dias', [30, 60], 45],
      ['BOLETO', 'BOL-28', '28 dias', [28], 28],
      ['BOLETO', 'BOL-28-56', '28/56 dias', [28, 56], 42],
      ['BOLETO', 'BOL-30-60-90', '30/60/90 dias', [30, 60, 90], 60],
    ]);
    expect(new Set(p.prazos.map((z) => z.codigo)).size).toBe(p.prazos.length);
    expect(p.formas.some((f) => f.codigo === 'AVISTA') || p.prazos.some((z) => z.codigo === 'AVISTA')).toBe(false);
    expect(FORMAS_DEMO.flatMap((f) => f.prazos).length).toBe(7);
  });

  it('RN-VEN-25: prazo médio 45 em todos os clientes, 30 na Panificadora Pão Dourado; Conveniência Rota 10 sem boleto; os demais com todas as formas', () => {
    expect(p.clientes).toHaveLength(30);
    expect(p.clientes.map((c) => c.id)).toEqual(d['core.cliente'].map((c) => c.id));
    expect(d['core.cliente'][CLIENTE_PRAZO_30_DEMO]!.nome_fantasia).toBe('Panificadora Pão Dourado');
    expect(d['core.cliente'][CLIENTE_SEM_BOLETO_DEMO]!.nome_fantasia).toBe('Conveniência Rota 10');
    expect(p.clientes.filter((c) => c.prazo_medio_max_dias !== PRAZO_MEDIO_MAX_DEMO).map((c) => [c.id, c.prazo_medio_max_dias])).toEqual([[p.clientes[CLIENTE_PRAZO_30_DEMO]!.id, 30]]);
    expect(PRAZO_MEDIO_MAX_DEMO).toBe(45);
    expect(p.clientes.filter((c) => c.formas_pagamento !== null).map((c) => c.formas_pagamento)).toEqual([[...FORMAS_SEM_BOLETO_DEMO]]);
    // com 45: só o Boleto 30/60/90 (60) passa do teto; com 30: também o Cartão 30/60 (45) e o Boleto 28/56 (42)
    const acima = (max: number) => p.prazos.filter((z) => Number(z.prazo_medio_dias) > max).map((z) => z.codigo);
    expect(acima(45)).toEqual(['BOL-30-60-90']);
    expect(acima(30)).toEqual(['CAR-30-60', 'BOL-28-56', 'BOL-30-60-90']);
  });

  it('RN-VEN-23: 3 faixas no BIS-400 (50 UN, 10 CX e 20 CX), preço da unidade base abaixo do Varejo e decrescente, todas as tabelas, vigentes desde o 1º do mês anterior', () => {
    const bis = d['core.produto'].find((x) => x.sku === 'BIS-400')!;
    const caixa = d['core.produto_unidade'].find((u) => u.produto_id === bis.id && u.unidade === 'CX')!;
    expect(caixa.fator).toBe(20);
    expect(p.faixas.map((f) => [f.produto_id, f.medida, f.quantidade_minima, f.preco_unidade_cents, f.tabela_preco_id, f.vigencia_inicio, f.vigencia_fim, f.ativo])).toEqual([
      [bis.id, null, 50, 569, null, '2026-10-01', null, true],
      [bis.id, 'CX', 10, 549, null, '2026-10-01', null, true],
      [bis.id, 'CX', 20, 529, null, '2026-10-01', null, true],
    ]);
    expect(FAIXAS_DEMO).toHaveLength(3);
    const varejo = d['catalogo.tabela_preco_item'].find((i) => i.produto_id === bis.id && i.unidade === null && i.tabela_preco_id === d['catalogo.tabela_preco'].find((t) => t.codigo === 'VAREJO')!.id);
    expect(varejo?.preco_cents).toBe(589);
    for (const f of p.faixas) expect(Number(f.preco_unidade_cents)).toBeLessThan(589);
  });

  it('RN-VEN-13: pelo menos um cliente com título aberto vencido há mais de 5 dias (titulo_vencido_dias padrão)', () => {
    const vencidos = d['core.titulo'].filter((t) => t.situacao === 'aberto' && String(t.vencimento) < somarDias(hoje, -5));
    expect(new Set(vencidos.map((t) => t.cliente_id)).size).toBeGreaterThanOrEqual(1);
  });

  it('a forma padrão da 0037 tem o id gêmeo do SQL (apagada na demo) e as condições antigas continuam (APK antigo)', () => {
    expect(idsPagamentoPadrao(TENANT_DEMO).forma).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(d['vendedor.condicao_pagamento'].map((c) => c.codigo)).toEqual(['AVISTA', '28D', '28-56', '30-60-90']);
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
    expect(r).toEqual({ clientes: 30, paradas: 6, motivos: ['acesso_negado', 'loja_fechada'], modulos: MODULOS_ATIVOS_DEMO });
  });

  it('0014/0015/0016 ligados no carregarDemo: Gestor para a Renata (supervisora) com a equipe projetada; Promotor com as visitas de loja da Joana; Pesquisa publicada', async () => {
    const r = await comTenant(pool, TENANT_DEMO, async (c) => ({
      gestor: (await c.query<{ perfil: string }>("select perfil from plataforma.perfil_modulo where modulo = 'gestor' and deleted_at is null order by perfil")).rows.map((x) => x.perfil),
      promotor: (await c.query<{ perfil: string }>("select perfil from plataforma.perfil_modulo where modulo = 'promotor' and deleted_at is null order by perfil")).rows.map((x) => x.perfil),
      fatos: (await c.query<{ n: number }>('select count(*)::int as n from gestor.projecao_fato')).rows[0]!.n,
      eventos: (await c.query<{ n: number }>('select count(*)::int as n from gestor.evento_aplicado')).rows[0]!.n,
      visitasLoja: (await c.query<{ n: number }>('select count(*)::int as n from promotor.visita_loja where deleted_at is null')).rows[0]!.n,
      pesquisa: (await c.query<{ perfil: string }>("select perfil from plataforma.perfil_modulo where modulo = 'pesquisa' and deleted_at is null order by perfil")).rows.map((x) => x.perfil),
      publicadas: (await c.query<{ n: number }>("select count(*)::int as n from pesquisa.questionario_versao where status = 'publicada'")).rows[0]!.n,
      respostas: (await c.query<{ n: number }>('select count(*)::int as n from pesquisa.resposta')).rows[0]!.n,
    }));
    expect(r.gestor).toEqual([...PERFIS_GESTOR_DEMO].sort());
    expect(r.gestor).toContain(USUARIOS_DEMO.supervisor.perfil);
    expect(r.promotor).toEqual([...PERFIS_PROMOTOR_DEMO].sort());
    expect(r.fatos).toBeGreaterThan(0);
    expect(r.eventos).toBeGreaterThan(0);
    expect(r.visitasLoja).toBe(2);
    expect(r.pesquisa).toEqual([...PERFIS_PESQUISA_DEMO].sort());
    expect(r.publicadas).toBe(2);
    expect(r.respostas).toBe(16);
  });

  it('0017 ligado no carregarDemo: licença do Treinamento para os 7 perfis, 3 trilhas (2 publicadas, 1 obrigatória) e o ranking de XP', async () => {
    const r = await comTenant(pool, TENANT_DEMO, async (c) => ({
      perfis: (await c.query<{ perfil: string }>("select perfil from plataforma.perfil_modulo where modulo = 'treinamento' and deleted_at is null order by perfil")).rows.map((x) => x.perfil),
      trilhas: (await c.query<{ titulo: string; status: string; obrigatoria: boolean }>(
        'select titulo, status, obrigatoria from treinamento.trilha where deleted_at is null order by titulo',
      )).rows,
      xp: (await c.query<{ usuario_id: string; total: number }>(
        'select usuario_id, sum(pontos)::int as total from treinamento.xp_lancamento group by usuario_id order by total desc',
      )).rows,
    }));
    expect(r.perfis).toEqual([...PERFIS_TREINAMENTO_DEMO].sort());
    expect(r.trilhas).toEqual(
      [...TRILHAS_DEMO].map((t) => ({ titulo: t.titulo, status: t.status, obrigatoria: t.obrigatoria })).sort((a, b) => a.titulo.localeCompare(b.titulo)),
    );
    expect(r.trilhas.filter((t) => t.status === 'publicada')).toHaveLength(2);
    expect(r.trilhas.filter((t) => t.obrigatoria)).toHaveLength(1);
    expect(r.xp).toEqual([
      { usuario_id: idUsuarioDemo('vendedor'), total: 115 },
      { usuario_id: idUsuarioDemo('vendedor2'), total: 110 },
      { usuario_id: idUsuarioDemo('promotor'), total: 10 },
    ]);
  });

  it('T-0070 ligado no carregarDemo: medidas (5 ativas, 6 inativas), embalagem das caixas, metas com tipo e a hierarquia pelo papel macuxi_app', async () => {
    const m = dadosDemoMedidas(dadosDemo(HASH_FALSO, { hoje: hojeCarga }));
    const r = await comTenant(pool, TENANT_DEMO, async (c) => ({
      ativas: (await c.query<{ sigla: string }>('select sigla from core.medida where ativo and deleted_at is null order by sigla')).rows.map((x) => x.sigla),
      inativas: (await c.query<{ n: number }>('select count(*)::int as n from core.medida where not ativo')).rows[0]!.n,
      embalagens: (await c.query<{ id: string; medida: string; qtd: number }>(
        'select id, embalagem_medida as medida, embalagem_quantidade as qtd from core.produto where embalagem_medida is not null',
      )).rows.map((x): [string, string, number] => [x.id, x.medida, x.qtd]),
      metas: (await c.query<{ usuario_id: string; tipo: string; n: number }>(
        'select usuario_id, tipo, count(*)::int as n from core.meta where periodo = $1 and deleted_at is null group by 1, 2',
        [anoMes(hojeCarga)],
      )).rows,
      hierarquia: (await c.query<{ nome: string; supervisor: string | null; gerente: string | null }>(
        `select u.nome, s.nome as supervisor, g.nome as gerente
           from core.usuario u join core.equipe e on e.id = u.equipe_id
           left join core.usuario s on s.id = e.responsavel_id
           left join core.equipe p on p.id = e.equipe_pai_id left join core.usuario g on g.id = p.responsavel_id
          where u.perfil in ('vendedor', 'promotor')`,
      )).rows,
    }));
    const porId = (a: [string, string, number], b: [string, string, number]) => a[0].localeCompare(b[0]);
    expect(r.ativas).toEqual([...MEDIDAS_ATIVAS_DEMO].sort());
    expect(r.inativas).toBe(6);
    expect(r.embalagens.sort(porId)).toEqual([...m.embalagens].sort(porId));
    expect(r.embalagens.length).toBeGreaterThanOrEqual(3);
    const porUsuario = Object.fromEntries(r.metas.map((x) => [x.usuario_id, `${x.tipo}:${x.n}`]));
    expect(porUsuario[idUsuarioDemo('vendedor')]).toBe('pedido:4');
    expect(porUsuario[idUsuarioDemo('vendedor2')]).toBe('pedido:4');
    // mês anterior (T-0070, para o "copiar" da T-0068): Lucas e Camila, 4 cada, pelo papel macuxi_app
    const anterior = await comTenant(pool, TENANT_DEMO, async (c) =>
      (await c.query<{ usuario_id: string; tipo: string; n: number }>(
        'select usuario_id, tipo, count(*)::int as n from core.meta where periodo = $1 and deleted_at is null group by 1, 2 order by 1',
        [anoMes(hojeCarga, -1)],
      )).rows);
    expect(Object.fromEntries(anterior.map((x) => [x.usuario_id, `${x.tipo}:${x.n}`]))).toEqual({
      [idUsuarioDemo('vendedor')]: 'pedido:4', [idUsuarioDemo('vendedor2')]: 'pedido:4',
    });
    const chefia = { supervisor: USUARIOS_DEMO.supervisor.nome, gerente: USUARIOS_DEMO.gerente.nome };
    expect(r.hierarquia.sort((a, b) => a.nome.localeCompare(b.nome))).toEqual(
      [USUARIOS_DEMO.vendedor.nome, USUARIOS_DEMO.vendedor2.nome, USUARIOS_DEMO.promotor.nome].sort().map((nome) => ({ nome, ...chefia })),
    );
  });

  it('T-0084/T-0085 (0033) ligado no carregarDemo: referências pelo código normalizado, aplicação no peso C, etiquetas e marcas do Promotor, pelo papel macuxi_app', async () => {
    const r = await comTenant(pool, TENANT_DEMO, async (c) => ({
      refs: (await c.query<{ n: number }>('select count(*)::int as n from catalogo.produto_referencia where deleted_at is null')).rows[0]!.n,
      cb3401: (await c.query<{ sku: string; marca: string; marca_nome: string | null }>(
        `select b.sku, m.nome as marca, r.marca_nome from catalogo.produto_referencia r
           join catalogo.produto_busca b on b.produto_id = r.produto_id and b.deleted_at is null
           join catalogo.marca_concorrente m on m.tenant_id = r.tenant_id and m.id = r.marca_id
          where r.codigo_compacto = 'cb3401' and r.deleted_at is null`,
      )).rows,
      unoC: (await c.query<{ sku: string }>(
        "select sku from catalogo.produto_busca where ts_filter(documento, '{c}') @@ to_tsquery('portuguese', 'uno & 2012') order by sku",
      )).rows.map((x) => x.sku),
      golA: (await c.query<{ sku: string }>("select sku from catalogo.produto_busca where ts_filter(documento, '{a}') @@ to_tsquery('portuguese', 'fb0207')")).rows.map((x) => x.sku),
      etiquetas: (await c.query<{ e: string[] }>(
        "select c.etiquetas as e from catalogo.produto_conteudo c join catalogo.produto_busca b on b.produto_id = c.produto_id where b.sku = 'PST-D01'",
      )).rows,
      marcas: (await c.query<{ nome: string }>('select nome from catalogo.marca_concorrente where deleted_at is null order by nome')).rows.map((x) => x.nome),
      marcasNoPromotor: (await c.query<{ n: number }>('select count(*)::int as n from promotor.concorrente')).rows[0]!.n,
    }));
    expect(r.refs).toBe(REFERENCIAS_DEMO.length);
    expect(r.cb3401).toEqual([{ sku: 'PST-D01', marca: 'Freiomax', marca_nome: 'Freiomax' }]); // 0034: retrato do nome
    expect(r.unoC).toEqual(['PST-D01']);
    expect(r.golA).toEqual(['FOL-G01']);
    expect(r.etiquetas).toEqual([{ e: ['Dianteira', 'Novo'] }]);
    expect(r.marcas).toEqual(expect.arrayContaining(Object.values(MARCAS_CONCORRENTES_DEMO)));
    expect(r.marcasNoPromotor).toBe(0); // T-0113: a base nova não grava mais no cadastro antigo
  });

  it('T-0089 (0037) ligado no carregarDemo: 4 formas e 7 prazos vivos (a "À vista" padrão apagada), clientes com prazo médio, 3 faixas, pelo papel macuxi_app', async () => {
    const r = await comTenant(pool, TENANT_DEMO, async (c) => ({
      formas: (await c.query<{ codigo: string }>('select codigo from vendedor.forma_pagamento where deleted_at is null and ativo order by ordem')).rows.map((x) => x.codigo),
      prazos: (await c.query<{ n: number }>('select count(*)::int as n from vendedor.prazo_pagamento where deleted_at is null and ativo')).rows[0]!.n,
      padrao: (await c.query<{ codigo: string; apagada: boolean }>('select codigo, deleted_at is not null as apagada from vendedor.forma_pagamento where id = $1', [
        idsPagamentoPadrao(TENANT_DEMO).forma,
      ])).rows,
      boleto2856: (await c.query('select parcelas_dias, prazo_medio_dias from vendedor.prazo_pagamento where codigo = $1 and deleted_at is null', ['BOL-28-56'])).rows,
      clientes: (await c.query<{ prazo: number; formas: string[] | null; n: number }>(
        'select prazo_medio_max_dias as prazo, formas_pagamento as formas, count(*)::int as n from core.cliente group by 1, 2 order by 1, 2',
      )).rows,
      faixas: (await c.query<{ n: number }>('select count(*)::int as n from catalogo.tabela_escalonada where deleted_at is null and ativo')).rows[0]!.n,
    }));
    expect(r.formas).toEqual(['PIX', 'DINHEIRO', 'CARTAO', 'BOLETO']);
    expect(r.prazos).toBe(7);
    expect(r.padrao).toEqual([{ codigo: 'AVISTA', apagada: true }]);
    expect(r.boleto2856).toEqual([{ parcelas_dias: [28, 56], prazo_medio_dias: 42 }]);
    expect(r.clientes).toEqual([
      { prazo: 30, formas: null, n: 1 },
      { prazo: 45, formas: [...FORMAS_SEM_BOLETO_DEMO], n: 1 },
      { prazo: 45, formas: null, n: 28 },
    ]);
    expect(r.faixas).toBe(3);
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

  it('recarga -Manter com meta do ensaio no mesmo (usuário, mês anterior, indicador) do seed: mantém a do ensaio sem violar meta_uk', async () => {
    const lucas = idUsuarioDemo('vendedor');
    const anterior = anoMes(hojeCarga, -1);
    const daSeed = dadosDemo(HASH_FALSO, { hoje: hojeCarga })['core.meta'].find((m) => m.usuario_id === lucas && m.periodo === anterior && m.indicador === 'visitas')!;
    // o ensaio apagou a do seed e gravou outra pela API (id novo, mesmo único)
    const ensaio = await comTenant(pool, TENANT_DEMO, async (c) => {
      // hora-fixa-ok: soft delete, o instante nunca é comparado
      await c.query('update core.meta set deleted_at = now() where id = $1', [daSeed.id]);
      return (await c.query<{ id: string }>(
        "insert into core.meta (tenant_id, usuario_id, periodo, indicador, valor, tipo) values (plataforma.tenant_atual(), $1, $2, 'visitas', 77, 'pedido') returning id",
        [lucas, anterior],
      )).rows[0]!.id;
    });
    const antes = await contarDemo();
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }));
    expect(await contarDemo()).toEqual(antes);
    const vivas = await comAdmin(b.nome, (c) =>
      c.query<{ id: string; valor: number }>("select id, valor::int as valor from core.meta where tenant_id = $1 and usuario_id = $2 and periodo = $3 and indicador = 'visitas' and deleted_at is null", [TENANT_DEMO, lucas, anterior]));
    expect(vivas.rows).toEqual([{ id: ensaio, valor: 77 }]);
    // volta ao estado da carga para os testes seguintes
    await comAdmin(b.nome, async (c) => {
      await c.query('delete from core.meta where id = $1', [ensaio]);
      await c.query('update core.meta set deleted_at = null where id = $1', [daSeed.id]);
    });
  });

  it('T-0071/T-0026: recarga sem --recriar com a numeração dos pedidos do seed trocada guarda os números gravados (número já mostrado não muda) sem violar o único', async () => {
    const seed = dadosDemo(HASH_FALSO, { hoje: hojeCarga })['vendedor.pedido'];
    const [x, y] = [seed[0]!, seed[1]!];
    const trocar = () =>
      comAdmin(b.nome, async (c) => {
        const r = await c.query<{ id: string; numero: string }>('select id::text as id, numero from vendedor.pedido where id = any($1::uuid[])', [[x.id, y.id]]);
        const n = new Map(r.rows.map((l) => [l.id, l.numero]));
        await c.query('update vendedor.pedido set numero = null where id = $1', [x.id]);
        await c.query('update vendedor.pedido set numero = $2 where id = $1', [y.id, n.get(String(x.id))]);
        await c.query('update vendedor.pedido set numero = $2 where id = $1', [x.id, n.get(String(y.id))]);
      });
    // simula a base de antes (p11 entrou no meio da linha do tempo): dois pedidos do seed com os números trocados
    await trocar();
    try {
      const r0 = await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }));
      expect(r0.numerosTrocados).toEqual([]);
      const r = await numerosPorId([String(x.id), String(y.id)]);
      expect(Object.fromEntries(r)).toEqual({ [String(x.id)]: y.numero, [String(y.id)]: x.numero });
      expect(await repetidos()).toEqual([]);
    } finally {
      await trocar(); // volta à numeração da base nova para os testes seguintes
    }
  });

  it('recarga sem --recriar com a unidade padrão trocada (PAP-4 PC→UN, 02/11): volta à do seed sem violar o único', async () => {
    const unidades = dadosDemo(HASH_FALSO)['core.produto_unidade'];
    const cx = unidades.find((u) => u.unidade === 'CX')!;
    const padrao = unidades.find((u) => u.produto_id === cx.produto_id && u.padrao === true)!;
    // simula a base antiga: outra unidade do mesmo produto é a padrão
    await comAdmin(b.nome, async (c) => {
      await c.query('update core.produto_unidade set padrao = false where id = $1', [padrao.id]);
      await c.query('update core.produto_unidade set padrao = true where id = $1', [cx.id]);
    });
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }));
    const r = await comAdmin(b.nome, (c) =>
      c.query<{ id: string }>('select id from core.produto_unidade where produto_id = $1 and padrao and deleted_at is null', [cx.produto_id]),
    );
    expect(r.rows.map((x) => x.id)).toEqual([padrao.id]);
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

  // T-0026 (R-20261104-163228, número 000011 repetido no Campo): o banco nunca repete número no tenant.
  const repetidos = () =>
    comAdmin(b.nome, async (c) =>
      (await c.query<{ numero: string; n: number }>(
        'select numero, count(*)::int as n from vendedor.pedido where tenant_id = $1 and numero is not null group by numero having count(*) > 1',
        [TENANT_DEMO],
      )).rows,
    );
  /** Pedido "do aparelho" (fora do seed), como o receber do Vendedor grava: número do contador na mesma transação. */
  const aceitarPedido = (numero?: string) =>
    comTenant(pool, TENANT_DEMO, async (c) => {
      const p = dadosDemo(HASH_FALSO, { hoje: hojeCarga })['vendedor.pedido'][0]!;
      const n = numero ?? (await c.query<{ n: string }>('select vendedor.proximo_numero_pedido() as n')).rows[0]!.n;
      const r = await c.query<{ id: string }>(
        `insert into vendedor.pedido (tenant_id, cliente_id, vendedor_id, autor_id, status, numero)
         values (plataforma.tenant_atual(), $1, $2, $2, 'approved', $3) returning id`,
        [p.cliente_id, idUsuarioDemo('vendedor'), n],
      );
      return { id: r.rows[0]!.id, numero: n };
    });
  const apagarPedidos = (ids: string[]) => comAdmin(b.nome, (c) => c.query('delete from vendedor.pedido where id = any($1::uuid[])', [ids]));
  const contador = async () =>
    Number((await comAdmin(b.nome, (c) => c.query<{ ultimo: string }>('select ultimo from vendedor.numeracao_pedido where tenant_id = $1', [TENANT_DEMO]))).rows[0]?.ultimo ?? 0);
  const numerosPorId = async (ids: string[]) =>
    new Map(
      (await comAdmin(b.nome, (c) => c.query<{ id: string; numero: string }>('select id::text as id, numero from vendedor.pedido where id = any($1::uuid[])', [ids]))).rows.map(
        (r) => [r.id, r.numero] as const,
      ),
    );

  it('T-0026: dois pedidos aceitos em paralelo não repetem o número (o contador do tenant numera em fila)', async () => {
    const aceitos = await Promise.all([aceitarPedido(), aceitarPedido(), aceitarPedido()]);
    try {
      const numeros = aceitos.map((a) => Number(a.numero)).sort((x, y) => x - y);
      expect(new Set(numeros).size).toBe(3);
      expect(numeros[2]! - numeros[0]!).toBe(2); // consecutivos: nenhum número perdido nem repetido
      expect(await repetidos()).toEqual([]);
    } finally {
      await apagarPedidos(aceitos.map((a) => a.id));
    }
  });

  it('T-0026: recarga sem --recriar com pedido do aparelho no número que o seed usaria: o do aparelho guarda o número; o do seed ganha o próximo do contador', async () => {
    const seed = dadosDemo(HASH_FALSO, { hoje: hojeCarga })['vendedor.pedido'];
    const ultimoDoSeed = seed.reduce((m, p) => (String(p.numero) > m ? String(p.numero) : m), '');
    const doSeed = seed.find((p) => p.numero === ultimoDoSeed)!;
    // base de antes do T-0071 (10 pedidos no seed): o número mais alto do seed estava livre e o aparelho o recebeu
    await comAdmin(b.nome, (c) => c.query('update vendedor.pedido set numero = null where id = $1', [doSeed.id]));
    const aparelho = await aceitarPedido(ultimoDoSeed);
    try {
      const contadorAntes = await contador();
      const r0 = await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }));
      const porId = await numerosPorId([String(doSeed.id), aparelho.id]);
      expect(porId.get(aparelho.id)).toBe(ultimoDoSeed);
      const novo = porId.get(String(doSeed.id))!;
      expect(Number(novo)).toBe(Math.max(contadorAntes, Number(ultimoDoSeed)) + 1);
      expect(await contador()).toBe(Number(novo));
      expect(r0.numerosTrocados).toEqual([]); // o do seed não tinha número: não é troca de número já mostrado
      expect(await repetidos()).toEqual([]);
      // idempotente: a próxima recarga não mexe em nenhum dos dois
      await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }));
      expect(await numerosPorId([String(doSeed.id), aparelho.id])).toEqual(porId);
    } finally {
      await apagarPedidos([aparelho.id]);
      await comAdmin(b.nome, (c) => c.query('update vendedor.pedido set numero = $2 where id = $1', [doSeed.id, ultimoDoSeed]));
    }
  });

  it('T-0026: seed duas vezes, --recriar e pedido novo depois: nenhum número repetido nem reusado, e os do seed não mudam', async () => {
    const todos = async () =>
      new Map(
        (
          await comAdmin(b.nome, (c) =>
            c.query<{ id: string; numero: string }>('select id::text as id, numero from vendedor.pedido where tenant_id = $1 and numero is not null', [TENANT_DEMO]),
          )
        ).rows.map((r) => [r.id, r.numero]),
      );
    const a = await aceitarPedido();
    const novos: string[] = [];
    try {
      const antes = await todos();
      const vistos = new Set(antes.values());
      await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }));
      await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }));
      expect(await todos()).toEqual(antes); // duas recargas: nenhum número muda (nem o do aparelho, nem os do seed)
      expect(await repetidos()).toEqual([]);

      const r = await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, recriar: true, hoje: hojeCarga }));
      expect(r.numerosTrocados).toEqual([]);
      const recriada = await todos();
      expect(recriada.has(a.id)).toBe(false); // o --recriar zera o ensaio
      for (const [id, n] of recriada) expect(n, `pedido do seed ${id} guarda o número de antes do --recriar`).toBe(antes.get(id));
      expect(await contador()).toBeGreaterThanOrEqual(Number(a.numero));

      const depois = await aceitarPedido();
      novos.push(depois.id);
      expect(Number(depois.numero)).toBe(Number(a.numero) + 1);
      expect(vistos.has(depois.numero), `${depois.numero} já tinha sido emitido`).toBe(false);
      expect(await repetidos()).toEqual([]);
    } finally {
      await apagarPedidos([a.id, ...novos]);
    }
  });

  it('T-0026 (000011): pedido que entra no seed depois de o número ter saído para um aparelho, com --recriar, não reusa o número', async () => {
    const seed = dadosDemo(HASH_FALSO, { hoje: hojeCarga })['vendedor.pedido'];
    const ultimoDoSeed = seed.reduce((m, p) => (String(p.numero) > m ? String(p.numero) : m), '');
    const doSeed = seed.find((p) => p.numero === ultimoDoSeed)!;
    // base de antes do T-0071: o p11 ainda não tinha número e o 000011 saiu para o aparelho (Atacadinho Cachoeirinha)
    await comAdmin(b.nome, (c) => c.query('update vendedor.pedido set numero = null where id = $1', [doSeed.id]));
    const aparelho = await aceitarPedido(ultimoDoSeed);
    const contadorAntes = await contador();
    try {
      await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, recriar: true, hoje: hojeCarga }));
      const novo = (await numerosPorId([String(doSeed.id)])).get(String(doSeed.id))!;
      expect(novo).not.toBe(ultimoDoSeed);
      expect(Number(novo)).toBe(Math.max(contadorAntes, Number(ultimoDoSeed)) + 1);
      const seguinte = await aceitarPedido();
      try {
        expect(Number(seguinte.numero)).toBe(Number(novo) + 1);
        expect(await repetidos()).toEqual([]);
      } finally {
        await apagarPedidos([seguinte.id]);
      }
    } finally {
      await apagarPedidos([aparelho.id]); // o --recriar já apagou; não falha
      await comAdmin(b.nome, (c) => c.query('update vendedor.pedido set numero = $2 where id = $1', [doSeed.id, ultimoDoSeed]));
    }
  });

  it('T-0026: repetido de verdade (base sem o único pedido_numero_uk) é renumerado pela recarga, o mais antigo fica, e a 2ª recarga não mexe', async () => {
    const seed = dadosDemo(HASH_FALSO, { hoje: hojeCarga })['vendedor.pedido'];
    const p1 = seed.find((p) => p.numero === '000001')!;
    // ids preenchidos a cada pedido aceito: se o teste cair no meio, o finally apaga o repetido antes de recriar o único
    const ids: string[] = [];
    await comAdmin(b.nome, (c) => c.query('drop index vendedor.pedido_numero_uk'));
    try {
      const velho = await aceitarPedido();
      ids.push(velho.id);
      const repetido = await aceitarPedido(velho.numero); // mesmo número, recebido depois
      ids.push(repetido.id);
      const noDoSeed = await aceitarPedido('000001'); // pedido de verdade no número de um pedido do seed
      ids.push(noDoSeed.id);
      // hora-fixa-ok: só a ordem de chegada entre os três importa (o mais antigo guarda o número); nunca comparado ao relógio
      const chegada: Array<[string, string]> = [[velho.id, '2026-11-02T10:00:00Z'], [noDoSeed.id, '2026-11-02T10:30:00Z'], [repetido.id, '2026-11-02T11:00:00Z']];
      for (const [id, em] of chegada) await comAdmin(b.nome, (c) => c.query('update vendedor.pedido set recebido_em = $2 where id = $1', [id, em]));
      const r = await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }));
      const porId = await numerosPorId([velho.id, repetido.id, noDoSeed.id, String(p1.id)]);
      expect(porId.get(velho.id)).toBe(velho.numero);
      expect(porId.get(repetido.id)).not.toBe(velho.numero);
      expect(porId.get(noDoSeed.id)).toBe('000001'); // o de verdade guarda o número; o do seed (fictício) é que muda
      expect(porId.get(String(p1.id))).not.toBe('000001');
      expect(r.numerosTrocados.map((t) => `${t.origem}:${t.id}`).sort()).toEqual([`aparelho:${repetido.id}`, `seed:${String(p1.id)}`].sort());
      expect(await repetidos()).toEqual([]);
      const r2 = await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }));
      expect(r2.numerosTrocados).toEqual([]);
      expect(await numerosPorId([...porId.keys()])).toEqual(porId);
    } finally {
      await apagarPedidos(ids);
      await comAdmin(b.nome, (c) => c.query('update vendedor.pedido set numero = $2 where id = $1', [p1.id, '000001']));
      await comAdmin(b.nome, (c) => c.query('create unique index if not exists pedido_numero_uk on vendedor.pedido (tenant_id, numero) where numero is not null'));
    }
  });

  it('T-0026: --recriar não faz o contador voltar (número já emitido para um aparelho nunca é reusado por pedido novo)', async () => {
    const emitido = await aceitarPedido();
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, recriar: true, hoje: hojeCarga }));
    // o --recriar apagou o pedido do ensaio; o próximo pedido aceito continua depois do número que o aparelho já tem
    const novo = await aceitarPedido();
    try {
      expect(Number(novo.numero)).toBe(Number(emitido.numero) + 1);
      expect(await repetidos()).toEqual([]);
    } finally {
      await apagarPedidos([novo.id]);
    }
  });

  it('T-0079 (0022): recarga sem --recriar mantém a geração da base; --recriar gira só a do tenant demo', async () => {
    const geracoes = () =>
      comAdmin(b.nome, (c) => c.query<{ id: string; g: string }>('select id, geracao_base as g from plataforma.tenant order by id')).then(
        (r) => new Map(r.rows.map((x) => [x.id, x.g])),
      );
    const inicial = await geracoes();
    expect(inicial.get(TENANT_DEMO)).toMatch(/^[0-9a-f-]{36}$/);
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, hoje: hojeCarga }));
    expect(await geracoes()).toEqual(inicial);
    await comAdmin(b.nome, (c) => carregarDemo(c, { senha: SENHA, recriar: true, hoje: hojeCarga }));
    const depois = await geracoes();
    expect(depois.get(TENANT_DEMO)).toMatch(/^[0-9a-f-]{36}$/);
    expect(depois.get(TENANT_DEMO)).not.toBe(inicial.get(TENANT_DEMO));
    for (const [id, g] of inicial) if (id !== TENANT_DEMO) expect(depois.get(id)).toBe(g);
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
    // hora-fixa-ok: bloqueio relativo ao now() do banco, nunca comparado com instante fixo
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
