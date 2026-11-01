/**
 * Seed de demonstração "Fase M" (dono: banco-dados). Reaproveita a base fictícia do mockup
 * (apps/mock-api/src/seed/generate.ts, copiada de C:\Users\domon\dev\forca-vendas — só leitura):
 * tenant "Distribuidora Exemplo", 12 usuários fake, 6 equipes sob a gerência, produtos e os clientes
 * nomeados com sua carteira. Tudo fictício (e-mails @exemplo.com.br). Idempotente (upsert por id fixo).
 *
 * Mapeamento de perfis Fase M -> plataforma: seller->vendedor, manager->gerente, analyst->analista,
 * bko_assistant->assistente, admin->admin. A Fase M não tinha supervisor nem promotor.
 * Senha de todos: MACUXI_SENHA_DEMO (padrão "demo-macuxi", só para demonstração local), argon2id.
 * Só roda contra o Postgres local (exigirBancoLocal): senha pública + usuários fake nunca vão para banco compartilhado.
 * Sprint 1 (0006–0007): Cliente 360 dos 18 clientes, rota de hoje de cada vendedor e pedidos do Rafael S.
 * (dadosSprint1FaseM; datas relativas a hoje em America/Manaus, opção `hoje` para fixar).
 */
import type { ClientBase } from 'pg';
import { exigirBancoLocal, hostDoCliente } from '../../src/config';
import { anoMes, hojeNoFuso, menorData, somarDias } from '../../src/datas';
import { gravarLinhas, type Linha } from '../../src/gravar';
import { idDeterministico } from '../../src/ids';
import { hashSenha } from '../../src/senha';

export const TENANT_FASE_M = '7d0c2f4e-1a2b-4c3d-8e9f-000000000001';
const T = TENANT_FASE_M;
const id = (chave: string) => idDeterministico(`fase-m:${chave}`);

const PERFIL_FASE_M = { seller: 'vendedor', manager: 'gerente', analyst: 'analista', bko_assistant: 'assistente', admin: 'admin' } as const;

const EQUIPES = ['Zona Norte', 'Zona Sul', 'Centro', 'Interior', 'Zona Leste', 'Zona Oeste'] as const;
type Equipe = (typeof EQUIPES)[number];

/** Vendedores da Fase M (nome, apelido, equipe). Código ERP = 100 + ordem. */
const VENDEDORES: Array<[string, string, Equipe]> = [
  ['Bruna Teixeira', 'Bruna T.', 'Zona Sul'],
  ['Rafael Souza', 'Rafael S.', 'Zona Norte'],
  ['Diego Martins', 'Diego M.', 'Centro'],
  ['Carla Nogueira', 'Carla N.', 'Interior'],
  ['Marcos Pereira', 'Marcos P.', 'Zona Leste'],
  ['Lívia Rocha', 'Lívia R.', 'Zona Oeste'],
  ['Thiago Almeida', 'Thiago A.', 'Interior'],
  ['Paula Vieira', 'Paula V.', 'Zona Norte'],
];

const OUTROS: Array<[string, string, keyof typeof PERFIL_FASE_M]> = [
  ['Fernando Lima', 'fernando@exemplo.com.br', 'manager'],
  ['Juliana Melo', 'juliana@exemplo.com.br', 'analyst'],
  ['Ana Costa', 'ana@exemplo.com.br', 'bko_assistant'],
  ['Patrícia Gomes', 'patricia@exemplo.com.br', 'admin'],
];

const emailDe = (nome: string) => `${nome.split(' ')[0]!.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()}@exemplo.com.br`;

const MARCAS: Record<string, string> = {
  Freios: 'Norfreio', Filtros: 'FiltraMax', Suspensão: 'Suspentec', Motor: 'Motorpart', Elétrica: 'Voltrix', Arrefecimento: 'Termax',
  Transmissão: 'Transpar', Lubrificantes: 'Lubrion', Ignição: 'Faiscar', Rolamentos: 'Rolatec',
};

/** [sku, descrição, linha] — os 60 produtos da Fase M (preço/estoque vão para o Catálogo, ADR-0005). */
const PRODUTOS: Array<[string, string, string]> = [
  ['PST-4410', 'Pastilha de freio dianteira', 'Freios'], ['FLT-0207', 'Filtro de óleo', 'Filtros'], ['AMT-1132', 'Amortecedor traseiro', 'Suspensão'],
  ['PST-4420', 'Pastilha de freio dianteira', 'Freios'], ['PST-4431', 'Pastilha de freio traseira', 'Freios'], ['DSC-2210', 'Disco de freio ventilado', 'Freios'],
  ['DSC-2214', 'Disco de freio sólido', 'Freios'], ['LON-1180', 'Lona de freio', 'Freios'], ['CIL-0912', 'Cilindro de roda', 'Freios'], ['FLD-0050', 'Fluido de freio DOT 4 500 ml', 'Freios'],
  ['FLT-0210', 'Filtro de óleo', 'Filtros'], ['FLT-0315', 'Filtro de ar do motor', 'Filtros'], ['FLT-0322', 'Filtro de ar condicionado', 'Filtros'], ['FLT-0418', 'Filtro de combustível', 'Filtros'],
  ['FLT-0420', 'Filtro de combustível diesel', 'Filtros'], ['AMT-1120', 'Amortecedor dianteiro', 'Suspensão'], ['AMT-1140', 'Amortecedor traseiro', 'Suspensão'],
  ['BCJ-0331', 'Bucha da bandeja', 'Suspensão'], ['BAN-0712', 'Bandeja de suspensão', 'Suspensão'], ['PIV-0440', 'Pivô de suspensão', 'Suspensão'], ['TRM-0218', 'Terminal de direção', 'Suspensão'],
  ['KIT-0801', 'Kit batente e coifa', 'Suspensão'], ['CRR-1501', 'Correia dentada', 'Motor'], ['TEN-1503', 'Tensor da correia', 'Motor'], ['JNT-0610', 'Junta do cabeçote', 'Motor'],
  ['BMB-0901', 'Bomba de óleo', 'Motor'], ['VLV-0233', 'Válvula termostática', 'Arrefecimento'], ['BMA-0412', 'Bomba d’água', 'Arrefecimento'], ['RAD-0120', 'Radiador', 'Arrefecimento'],
  ['MNG-0310', 'Mangueira do radiador', 'Arrefecimento'], ['ADT-0001', 'Aditivo de radiador 1 L', 'Arrefecimento'], ['VEL-0505', 'Vela de ignição (jogo)', 'Ignição'],
  ['CAB-0602', 'Cabo de vela (jogo)', 'Ignição'], ['BOB-0701', 'Bobina de ignição', 'Ignição'], ['BAT-6001', 'Bateria 60 Ah', 'Elétrica'], ['LMP-0011', 'Lâmpada H4 12 V', 'Elétrica'],
  ['LMP-0012', 'Lâmpada H7 12 V', 'Elétrica'], ['ALT-0420', 'Alternador remanufaturado', 'Elétrica'], ['MTP-0330', 'Motor de partida remanufaturado', 'Elétrica'],
  ['EMB-1101', 'Kit de embreagem', 'Transmissão'], ['ROL-0101', 'Rolamento de roda dianteiro', 'Rolamentos'], ['ROL-0102', 'Rolamento de roda traseiro', 'Rolamentos'],
  ['CUB-0220', 'Cubo de roda', 'Rolamentos'], ['HMC-0140', 'Homocinética', 'Transmissão'], ['CRD-0118', 'Coifa da homocinética', 'Transmissão'], ['OLE-5W30', 'Óleo de motor 5W30 sintético 1 L', 'Lubrificantes'],
  ['OLE-1540', 'Óleo de motor 15W40 diesel 1 L', 'Lubrificantes'], ['OLE-2050', 'Óleo de motor 20W50 moto 1 L', 'Lubrificantes'], ['GRX-0500', 'Graxa multiuso 500 g', 'Lubrificantes'],
  ['ATF-0001', 'Fluido de transmissão ATF 1 L', 'Lubrificantes'], ['KRL-0160', 'Kit relação moto', 'Transmissão'], ['PST-7101', 'Pastilha de freio moto', 'Freios'],
  ['FLT-7201', 'Filtro de óleo moto', 'Filtros'], ['VEL-7301', 'Vela de ignição moto', 'Ignição'], ['CAB-7401', 'Cabo de embreagem moto', 'Transmissão'],
  ['AMT-1150', 'Amortecedor dianteiro', 'Suspensão'], ['FLT-0330', 'Filtro de ar do motor diesel', 'Filtros'], ['PST-4450', 'Pastilha de freio dianteira diesel', 'Freios'],
  ['DSC-2230', 'Disco de freio diesel', 'Freios'], ['ROL-0130', 'Rolamento de roda diesel', 'Rolamentos'],
];

const unidadeDe = (sku: string, linha: string) =>
  linha === 'Lubrificantes' || sku.startsWith('FLD') || sku.startsWith('ADT') ? 'UN' : sku.startsWith('VEL-05') || sku.startsWith('CAB-06') ? 'JG' : 'PC';

/** Coordenadas aproximadas (fictícias) dos bairros/cidades usados pelos clientes nomeados. */
const LUGARES: Record<string, [number, number]> = {
  Cachoeirinha: [-3.12, -60.01], Tarumã: [-3.0, -60.06], 'Ponta Negra': [-3.08, -60.1], 'Cidade Nova': [-3.03, -59.99], 'Santa Etelvina': [-2.99, -60.02],
  'Novo Israel': [-3.04, -60.03], 'Monte das Oliveiras': [-3.01, -60.0], Flores: [-3.07, -60.01], Aleixo: [-3.09, -59.99], Compensa: [-3.11, -60.06],
  Japiim: [-3.12, -59.98], Parintins: [-2.63, -56.74], Itacoatiara: [-3.14, -58.44], 'Cidade de Deus': [-3.02, -59.95], Manacapuru: [-3.3, -60.62],
  'Nova Cidade': [-2.99, -59.98],
};
const INTERIOR = new Set(['Parintins', 'Itacoatiara', 'Manacapuru']);

/** Clientes nomeados da Fase M: [nome, apelido do vendedor, bairro/cidade, segmento]. */
const CLIENTES: Array<[string, string, string, string]> = [
  ['Auto Peças Rio Negro', 'Rafael S.', 'Cachoeirinha', 'Linha leve'],
  ['Mecânica Tarumã', 'Rafael S.', 'Tarumã', 'Linha leve'],
  ['Center Car Ponta Negra', 'Rafael S.', 'Ponta Negra', 'Linha leve'],
  ['Freios & Cia Cidade Nova', 'Rafael S.', 'Cidade Nova', 'Linha leve'],
  ['Oficina Santa Etelvina', 'Rafael S.', 'Santa Etelvina', 'Linha leve'],
  ['Moto Peças Novo Israel', 'Rafael S.', 'Novo Israel', 'Motos'],
  ['Retífica Monte das Oliveiras', 'Rafael S.', 'Monte das Oliveiras', 'Linha pesada'],
  ['Auto Center Flores', 'Bruna T.', 'Flores', 'Linha leve'],
  ['Peças Express Aleixo', 'Diego M.', 'Aleixo', 'Linha leve'],
  ['Lubri Center Compensa', 'Diego M.', 'Compensa', 'Linha leve'],
  ['Freios Rápidos Japiim', 'Diego M.', 'Japiim', 'Linha leve'],
  ['Distribuidora Parintins Motos', 'Carla N.', 'Parintins', 'Motos'],
  ['Oficina do Vale Itacoatiara', 'Carla N.', 'Itacoatiara', 'Linha leve'],
  ['Turbo Diesel Distrito', 'Carla N.', 'Itacoatiara', 'Linha pesada'],
  ['Center Car Cidade de Deus', 'Marcos P.', 'Cidade de Deus', 'Linha leve'],
  ['Auto Center Flores II', 'Lívia R.', 'Flores', 'Linha leve'],
  ['Comercial Peças Manacapuru', 'Thiago A.', 'Manacapuru', 'Linha leve'],
  ['Rei dos Rolamentos', 'Paula V.', 'Nova Cidade', 'Linha leve'],
];

/** Módulos que a Fase M demonstrava (catálogo, pedidos e painéis do gestor). */
const MODULOS = ['core', 'catalogo', 'vendedor', 'gestor'] as const;
const PERFIL_MODULOS: Record<string, readonly string[]> = {
  vendedor: ['core', 'catalogo', 'vendedor'],
  gerente: ['core', 'catalogo', 'vendedor', 'gestor'],
  analista: ['core', 'catalogo', 'vendedor', 'gestor'],
  assistente: ['core', 'catalogo', 'vendedor'],
  admin: ['core'],
};

/** Parâmetros padrão do tenant (doc 03, "Parâmetros do tenant"). */
const PARAMETROS: Array<[string, string, unknown]> = [
  ['vendedor', 'alcada.vendedor_pct', 5], ['vendedor', 'alcada.supervisor_pct', 10], ['vendedor', 'alcada.gerente_pct', 15],
  ['vendedor', 'credito_excedido', 'enviar_para_aprovacao'], ['vendedor', 'dias_atraso_restringir', 5],
  ['vendedor', 'estoque_insuficiente', 'permitir_com_aviso'], ['vendedor', 'pedido_minimo_centavos', null],
  ['core', 'raio_checkin_m', 200], ['vendedor', 'validade_orcamento_dias', 7], ['vendedor', 'alerta_ruptura_dias', 7],
  ['promotor', 'permanencia_minima_min', 10], ['promotor', 'janela_validade_dias', 30], ['promotor', 'tolerancia_variacao_preco_pct', 50],
  ['promotor', 'fotos_so_camera', true], ['core', 'base_apuracao_metas', 'aprovado'],
];

/**
 * Sprint 1 (0006–0007). Motivos (de sistema e de não venda) e os parâmetros core checkin.raio_m / metas.base_apuracao
 * NÃO estão aqui: vêm do gatilho core.semear_tenant no INSERT do tenant.
 */
const ORDEM_SPRINT1_FASE_M = [
  'core.cliente_contato',
  'core.cliente_financeiro',
  'core.titulo',
  'core.historico_compra',
  'core.rota',
  'core.rota_parada',
  'vendedor.pedido',
  'vendedor.pedido_item',
] as const;

export const ORDEM_FASE_M = [
  'plataforma.tenant',
  'plataforma.tenant_modulo',
  'plataforma.perfil_modulo',
  'plataforma.parametro',
  'core.equipe',
  'core.usuario',
  'core.produto',
  'core.cliente',
  'core.carteira',
  ...ORDEM_SPRINT1_FASE_M,
] as const;

export type DadosFaseM = Record<(typeof ORDEM_FASE_M)[number], Linha[]>;

export interface OpcoesFaseM {
  /** "Hoje" (AAAA-MM-DD) da demonstração; padrão: hoje em America/Manaus. */
  hoje?: string;
}

const FUSO_FASE_M = 'America/Manaus';

/**
 * Sprint 1: Cliente 360 (contato, financeiro, 3 títulos e 12 meses de histórico por cliente), rota de HOJE de cada
 * vendedor com as paradas da carteira e alguns pedidos do Rafael S. Datas relativas a hoje. Rotas e paradas têm id
 * pela data (cada dia de demonstração ganha a sua rota; as de dias anteriores ficam como histórico); o resto tem
 * id estável e só move as datas.
 */
function dadosSprint1FaseM(hoje: string, vendedorPorApelido: Map<string, string>): Pick<DadosFaseM, (typeof ORDEM_SPRINT1_FASE_M)[number]> {
  const comuns = { deleted_at: null, external_id: null };
  const clienteId = (nome: string) => id(`cliente:${nome}`);
  const contatos: Linha[] = [];
  const financeiros: Linha[] = [];
  const titulos: Linha[] = [];
  const historico: Linha[] = [];
  CLIENTES.forEach(([nome], i) => {
    const c = clienteId(nome);
    const limite = 1_000_000 + (i % 5) * 1_000_000;
    const vencido = i % 3 === 0 ? 180_000 + i * 1_000 : 0;
    const aVencer = 250_000 + i * 5_000;
    const bloqueado = i % 7 === 6;
    contatos.push({
      id: id(`cliente_contato:${nome}:1`), tenant_id: T, cliente_id: c, nome: `Comprador ${i + 1}`, cargo: 'Comprador', telefone: `92332${String(i).padStart(5, '0')}`,
      whatsapp: `929${String(90000000 + i).padStart(8, '0')}`, email: null, principal: true, ...comuns,
    });
    financeiros.push({
      id: id(`cliente_financeiro:${nome}`), tenant_id: T, cliente_id: c, limite_cents: limite, saldo_aberto_cents: vencido + aVencer, credito_disponivel_cents: null,
      bloqueado, motivo_bloqueio: bloqueado ? 'Bloqueio comercial (demonstração)' : null, atualizado_erp_em: `${somarDias(hoje, -1)}T23:00:00Z`, ...comuns, // ontem 19:00 em Manaus: nunca no futuro, qualquer que seja a hora
    });
    const doc = `NF-${String(20000 + i * 10)}`;
    titulos.push(
      { id: id(`titulo:${nome}:1`), tenant_id: T, cliente_id: c, documento: doc, parcela: '1/2', emissao: somarDias(hoje, -45), vencimento: somarDias(hoje, -15),
        valor_cents: vencido || 180_000, saldo_cents: vencido, situacao: vencido ? 'aberto' : 'liquidado', liquidado_em: vencido ? null : `${somarDias(hoje, -14)}T15:00:00Z`, ...comuns },
      { id: id(`titulo:${nome}:2`), tenant_id: T, cliente_id: c, documento: doc, parcela: '2/2', emissao: somarDias(hoje, -45), vencimento: somarDias(hoje, 15 + (i % 10)),
        valor_cents: aVencer, saldo_cents: aVencer, situacao: 'aberto', liquidado_em: null, ...comuns },
      { id: id(`titulo:${nome}:3`), tenant_id: T, cliente_id: c, documento: `NF-${String(19000 + i * 10)}`, parcela: '1/1', emissao: somarDias(hoje, -80),
        vencimento: somarDias(hoje, -50), valor_cents: 320_000, saldo_cents: 0, situacao: 'liquidado', liquidado_em: `${somarDias(hoje, -49)}T15:00:00Z`, ...comuns },
    );
    for (let m = 0; m < 12; m++) {
      const am = anoMes(hoje, m - 11);
      historico.push({
        id: id(`historico_compra:${nome}:${m}`), tenant_id: T, cliente_id: c, ano_mes: am, valor_cents: 300_000 + ((i * 37 + m * 53) % 20) * 25_000,
        pedidos: 1 + ((i + m) % 4), itens: 6 + ((i * 3 + m) % 15), ultima_compra_em: menorData(`${am}-${String(5 + (i % 20)).padStart(2, '0')}`, hoje),
        origem: 'erp', ...comuns,
      });
    }
  });

  // rota de hoje: uma por vendedor com carteira, paradas na ordem da carteira
  const rotas: Linha[] = [];
  const paradas: Linha[] = [];
  for (const [nomeVend, apelido] of VENDEDORES) {
    const clientes = CLIENTES.filter(([, ap]) => ap === apelido).map(([nome]) => nome);
    if (clientes.length === 0) continue;
    const usuario_id = vendedorPorApelido.get(apelido)!;
    const rota_id = id(`rota:${emailDe(nomeVend)}:${hoje}`);
    rotas.push({ id: rota_id, tenant_id: T, usuario_id, data: hoje, situacao: 'publicada', origem: 'bko', regiao: null, observacao: null, ...comuns });
    clientes.forEach((nome, i) => {
      paradas.push({
        id: id(`rota_parada:${emailDe(nomeVend)}:${hoje}:${nome}`), tenant_id: T, rota_id, usuario_id, data: hoje, cliente_id: clienteId(nome), sequencia: i + 1,
        janela_inicio: null, janela_fim: null, ...comuns,
      });
    });
  }

  // alguns pedidos do Rafael S. (estados diferentes) com itens dos produtos da Fase M
  const rafael = vendedorPorApelido.get('Rafael S.')!;
  const pedidos: Linha[] = [];
  const itens: Linha[] = [];
  const PEDIDOS: Array<[string, string, number, Array<[string, number, number]>]> = [
    ['Auto Peças Rio Negro', 'received', 0, [['PST-4410', 4, 8_990], ['FLT-0207', 10, 2_450]]],
    ['Mecânica Tarumã', 'approved', 5, [['AMT-1132', 2, 31_900], ['BCJ-0331', 6, 3_800]]],
    ['Center Car Ponta Negra', 'invoiced', 0, [['OLE-5W30', 24, 4_290]]],
    ['Freios & Cia Cidade Nova', 'pending_approval', 12, [['DSC-2210', 4, 15_900], ['PST-4420', 4, 9_490]]],
  ];
  PEDIDOS.forEach(([cliente, status, desconto, linhas], n) => {
    const pedido_id = id(`pedido:${cliente}:1`);
    let tabela = 0;
    let total = 0;
    linhas.forEach(([sku, qtd, preco], s) => {
      const unitario = Math.round((preco * (100 - desconto)) / 100);
      tabela += preco * qtd;
      total += unitario * qtd;
      itens.push({
        id: id(`pedido_item:${cliente}:1:${s + 1}`), tenant_id: T, pedido_id, sequencia: s + 1, produto_id: id(`produto:${sku}`), quantidade: qtd,
        preco_tabela_cents: preco, preco_unitario_cents: unitario, desconto_pct: desconto, total_cents: unitario * qtd, ...comuns,
      });
    });
    pedidos.push({
      id: pedido_id, tenant_id: T, cliente_id: clienteId(cliente), vendedor_id: rafael, autor_id: rafael, status, condicao_pagamento: '28 dias',
      desconto_pct: desconto, total_tabela_cents: tabela, total_cents: total, observacao: null, visita_id: null, rota_parada_id: null,
      criado_no_aparelho_em: `${somarDias(hoje, -n)}T14:00:00Z`, recebido_em: `${somarDias(hoje, -n)}T14:05:00Z`,
      numero_erp: status === 'invoiced' ? `PV${30000 + n}` : null, motivo_cancelamento: null, ...comuns,
    });
  });

  return {
    'core.cliente_contato': contatos,
    'core.cliente_financeiro': financeiros,
    'core.titulo': titulos,
    'core.historico_compra': historico,
    'core.rota': rotas,
    'core.rota_parada': paradas,
    'vendedor.pedido': pedidos,
    'vendedor.pedido_item': itens,
  };
}

export function dadosFaseM(senhaHash: string, opcoes: OpcoesFaseM = {}): DadosFaseM {
  const hoje = opcoes.hoje ?? hojeNoFuso(FUSO_FASE_M);
  const gerenteId = id('usuario:fernando@exemplo.com.br');
  const gerencia = id('equipe:Gerência Comercial');
  const equipeId = (nome: Equipe) => id(`equipe:${nome}`);

  const usuarios: Linha[] = [
    ...VENDEDORES.map(([nome, curto, equipe], i) => ({
      id: id(`usuario:${emailDe(nome)}`), tenant_id: T, nome, nome_curto: curto, email: emailDe(nome), perfil: PERFIL_FASE_M.seller,
      equipe_id: equipeId(equipe), senha_hash: senhaHash, ativo: true, external_id: String(100 + i + 1),
    })),
    ...OUTROS.map(([nome, email, papel]) => ({
      id: id(`usuario:${email}`), tenant_id: T, nome, nome_curto: nome, email, perfil: PERFIL_FASE_M[papel],
      equipe_id: papel === 'manager' ? gerencia : null, senha_hash: senhaHash, ativo: true, external_id: null,
    })),
  ];
  const vendedorPorApelido = new Map(VENDEDORES.map(([nome, curto]) => [curto, id(`usuario:${emailDe(nome)}`)]));

  const clientes: Linha[] = CLIENTES.map(([nome, , lugar, segmento], i) => {
    const [lat, lng] = LUGARES[lugar] ?? [-3.08, -60.0];
    return {
      id: id(`cliente:${nome}`), tenant_id: T, documento: null, razao_social: `${nome} Comércio de Peças Ltda`, nome_fantasia: nome,
      segmento, telefone: null, email: null, logradouro: null, numero: null,
      bairro: INTERIOR.has(lugar) ? 'Centro' : lugar, cidade: INTERIOR.has(lugar) ? lugar : 'Manaus', uf: 'AM', cep: null,
      latitude: lat, longitude: lng, ativo: true, external_id: String(10000 + i + 1),
    };
  });

  return {
    'plataforma.tenant': [
      { id: T, codigo: 'exemplo', nome: 'Distribuidora Exemplo', documento: '00000000000100', fuso: 'America/Manaus', plano: 'piloto', status: 'ativo', external_id: null },
    ],
    'plataforma.tenant_modulo': MODULOS.map((modulo) => ({
      id: id(`tenant_modulo:${modulo}`), tenant_id: T, modulo, ativo: true, plano: 'piloto', licencas: null, parametros: {}, external_id: null,
    })),
    'plataforma.perfil_modulo': Object.entries(PERFIL_MODULOS).flatMap(([perfil, modulos]) =>
      modulos.map((modulo) => ({ id: id(`perfil_modulo:${perfil}:${modulo}`), tenant_id: T, perfil, modulo, external_id: null })),
    ),
    'plataforma.parametro': PARAMETROS.map(([modulo, chave, valor]) => ({
      id: id(`parametro:${modulo}:${chave}`), tenant_id: T, modulo, chave, valor: JSON.stringify(valor), external_id: null,
    })),
    'core.equipe': [
      { id: gerencia, tenant_id: T, nome: 'Gerência Comercial', equipe_pai_id: null, responsavel_id: gerenteId, ativo: true, external_id: null },
      ...EQUIPES.map((nome) => ({ id: equipeId(nome), tenant_id: T, nome, equipe_pai_id: gerencia, responsavel_id: null, ativo: true, external_id: null })),
    ],
    'core.usuario': usuarios,
    'core.produto': PRODUTOS.map(([sku, nome, linha]) => ({
      id: id(`produto:${sku}`), tenant_id: T, sku, ean: null, nome, marca: MARCAS[linha] ?? 'Genérica', categoria: linha,
      unidade: unidadeDe(sku, linha), ativo: true, external_id: sku,
    })),
    'core.cliente': clientes,
    'core.carteira': CLIENTES.map(([nome, apelido]) => ({
      id: id(`carteira:${nome}`), tenant_id: T, cliente_id: id(`cliente:${nome}`), usuario_id: vendedorPorApelido.get(apelido)!,
      papel: 'vendedor', inicio: null, fim: null, external_id: null,
    })),
    ...dadosSprint1FaseM(hoje, vendedorPorApelido),
  };
}

/** Carrega o seed com cliente ADMIN, numa transação. Rodar 2× não duplica (S0-033). */
export async function carregarFaseM(admin: ClientBase, opcoes: { senha?: string } & OpcoesFaseM = {}): Promise<DadosFaseM> {
  exigirBancoLocal(hostDoCliente(admin), 'Seed de demonstração da Fase M');
  const senha = opcoes.senha ?? process.env.MACUXI_SENHA_DEMO ?? 'demo-macuxi';
  const dados = dadosFaseM(hashSenha(senha), { hoje: opcoes.hoje });
  await admin.query('begin');
  try {
    for (const tabela of ORDEM_FASE_M) {
      const linhas = tabela === 'core.equipe' ? dados[tabela].map((e) => ({ ...e, responsavel_id: null })) : dados[tabela];
      await gravarLinhas(admin, tabela, linhas, { preservar: tabela === 'core.usuario' ? ['senha_hash'] : [] });
      if (tabela === 'core.usuario') await gravarLinhas(admin, 'core.equipe', dados['core.equipe']);
    }
    await admin.query('commit');
  } catch (e) {
    await admin.query('rollback');
    throw e;
  }
  return dados;
}
