/**
 * Fixture "dois-tenants" para os testes de RLS/vazamento e de licenças (pedido R-20261030-235502-testes,
 * tests/plano/sprint-0.md §3). SEPARADA do seed da Fase M. Dono: banco-dados.
 *
 * - Tenant A "Distribuidora Alfa" (America/Manaus): core, vendedor, promotor, teste, teste-dependente, catalogo;
 *   8 usuários (admin, analista, assistente, gerente, supervisor, vendedor-1 equipe 1, vendedor-2 equipe 2, promotor).
 * - Tenant B "Comercial Beta" (America/Sao_Paulo): core, vendedor, catalogo; admin-B, vendedor-B.
 * - O Vendedor depende do Catálogo (ADR 0005, T-0007; RN-CORE-03): todo perfil com 'vendedor' também tem 'catalogo'.
 *   'catalogo' vai NO FIM das listas para não deslocar os UUIDs sequenciais já gravados (upsert por id + únicos).
 * - UUIDs fixos: prefixo aaaaaaaa- (A) e bbbbbbbb- (B); formato <prefixo>-<grupo>-4000-8000-<seq>.
 * - Pelo menos 1 linha em TODA tabela com tenant_id, nos dois tenants (o teste de vazamento confere).
 * - Caso de borda S0-072: vendedor-1 (A) e vendedor-B (B) têm o MESMO e-mail (único por tenant, Q3).
 * - Senha de todos: MACUXI_SENHA_TESTE (padrão "Teste@1234", só para teste), hash argon2id.
 */
import type { ClientBase } from 'pg';
import { gravarLinhas, type Linha } from '../../src/gravar';
import { idFixo } from '../../src/ids';
import { hashSenha } from '../../src/senha';

const G = {
  tenant: 0x00,
  usuario: 0x01,
  equipe: 0x02,
  produto: 0x03,
  cliente: 0x04,
  carteira: 0x05,
  tenant_modulo: 0x10,
  perfil_modulo: 0x11,
  usuario_modulo: 0x12,
  evento: 0x13,
  parametro: 0x14,
  auditoria: 0x15,
  evento_consumo: 0x16,
} as const;

const a = (grupo: keyof typeof G, seq: number) => idFixo('aaaaaaaa', G[grupo], seq);
const b = (grupo: keyof typeof G, seq: number) => idFixo('bbbbbbbb', G[grupo], seq);

/** IDs para asserts determinísticos nos testes. */
export const DOIS_TENANTS = {
  A: {
    tenantId: a('tenant', 1),
    codigo: 'alfa',
    fuso: 'America/Manaus',
    modulos: ['core', 'vendedor', 'promotor', 'teste', 'teste-dependente', 'catalogo'],
    usuarios: {
      admin: a('usuario', 1),
      analista: a('usuario', 2),
      assistente: a('usuario', 3),
      gerente: a('usuario', 4),
      supervisor: a('usuario', 5),
      vendedor1: a('usuario', 6),
      vendedor2: a('usuario', 7),
      promotor: a('usuario', 8),
    },
    equipes: { regional: a('equipe', 1), equipe1: a('equipe', 2), equipe2: a('equipe', 3) },
    clientes: { c1: a('cliente', 1), c2: a('cliente', 2), c3: a('cliente', 3) },
  },
  B: {
    tenantId: b('tenant', 1),
    codigo: 'beta',
    fuso: 'America/Sao_Paulo',
    modulos: ['core', 'vendedor', 'catalogo'],
    usuarios: { admin: b('usuario', 1), vendedor: b('usuario', 2) },
    equipes: { equipe: b('equipe', 1) },
    clientes: { c1: b('cliente', 1) },
  },
  /** E-mail repetido de propósito em A (vendedor-1) e B (vendedor-B). */
  emailRepetido: 'vendedor@exemplo.com.br',
} as const;

/** Ordem de gravação (respeita as FKs). */
export const ORDEM_TABELAS = [
  'plataforma.tenant',
  'plataforma.tenant_modulo',
  'plataforma.perfil_modulo',
  'core.equipe',
  'core.usuario',
  'plataforma.usuario_modulo',
  'core.produto',
  'core.cliente',
  'core.carteira',
  'plataforma.evento',
  'plataforma.evento_consumo',
  'plataforma.parametro',
  'plataforma.auditoria',
] as const;

export type DadosFixture = Record<(typeof ORDEM_TABELAS)[number], Linha[]>;

const usuario = (id: string, tenant_id: string, nome: string, email: string, perfil: string, equipe_id: string | null, senha_hash: string): Linha => ({
  id,
  tenant_id,
  nome,
  nome_curto: nome,
  email,
  perfil,
  equipe_id,
  senha_hash,
  ativo: true,
  external_id: null,
});

export function dadosDoisTenants(senhaHash: string): DadosFixture {
  const A = DOIS_TENANTS.A;
  const B = DOIS_TENANTS.B;
  const tA = A.tenantId;
  const tB = B.tenantId;

  const perfilModulo: Array<[string, string, string]> = [
    // tenant, perfil, módulo — A conforme o plano §3 (+ admin/analista/assistente, complemento do banco)
    [tA, 'vendedor', 'core'], [tA, 'vendedor', 'vendedor'], [tA, 'vendedor', 'teste'],
    [tA, 'promotor', 'core'], [tA, 'promotor', 'promotor'], [tA, 'promotor', 'teste'],
    [tA, 'supervisor', 'core'], [tA, 'supervisor', 'vendedor'], [tA, 'supervisor', 'promotor'],
    [tA, 'gerente', 'core'], [tA, 'gerente', 'vendedor'], [tA, 'gerente', 'promotor'],
    [tA, 'admin', 'core'],
    [tA, 'analista', 'core'], [tA, 'analista', 'vendedor'], [tA, 'analista', 'promotor'],
    [tA, 'assistente', 'core'], [tA, 'assistente', 'vendedor'],
    [tB, 'vendedor', 'core'], [tB, 'vendedor', 'vendedor'],
    [tB, 'admin', 'core'], [tB, 'admin', 'vendedor'],
    // Catálogo junto de todo perfil com 'vendedor' (ADR 0005); no fim para manter os ids anteriores.
    [tA, 'vendedor', 'catalogo'], [tA, 'supervisor', 'catalogo'], [tA, 'gerente', 'catalogo'],
    [tA, 'analista', 'catalogo'], [tA, 'assistente', 'catalogo'],
    [tB, 'vendedor', 'catalogo'], [tB, 'admin', 'catalogo'],
  ];
  const seqPerfil = { [tA]: 0, [tB]: 0 } as Record<string, number>;

  return {
    'plataforma.tenant': [
      { id: tA, codigo: A.codigo, nome: 'Distribuidora Alfa', documento: '11111111000191', fuso: A.fuso, plano: 'piloto', status: 'ativo', external_id: null },
      { id: tB, codigo: B.codigo, nome: 'Comercial Beta', documento: '22222222000191', fuso: B.fuso, plano: 'piloto', status: 'ativo', external_id: null },
    ],
    'plataforma.tenant_modulo': [
      ...A.modulos.map((modulo, i) => ({ id: a('tenant_modulo', i + 1), tenant_id: tA, modulo, ativo: true, plano: 'piloto', licencas: null, parametros: {}, external_id: null })),
      ...B.modulos.map((modulo, i) => ({ id: b('tenant_modulo', i + 1), tenant_id: tB, modulo, ativo: true, plano: 'piloto', licencas: null, parametros: {}, external_id: null })),
    ],
    'plataforma.perfil_modulo': perfilModulo.map(([tenant_id, perfil, modulo]) => {
      seqPerfil[tenant_id] = (seqPerfil[tenant_id] ?? 0) + 1;
      const id = tenant_id === tA ? a('perfil_modulo', seqPerfil[tenant_id]!) : b('perfil_modulo', seqPerfil[tenant_id]!);
      return { id, tenant_id, perfil, modulo, external_id: null };
    }),
    // equipes: gravadas primeiro sem responsável (ciclo equipe <-> usuario); responsável aplicado depois.
    'core.equipe': [
      { id: A.equipes.regional, tenant_id: tA, nome: 'Regional Alfa', equipe_pai_id: null, responsavel_id: A.usuarios.gerente, ativo: true, external_id: null },
      { id: A.equipes.equipe1, tenant_id: tA, nome: 'Equipe 1', equipe_pai_id: A.equipes.regional, responsavel_id: A.usuarios.supervisor, ativo: true, external_id: null },
      { id: A.equipes.equipe2, tenant_id: tA, nome: 'Equipe 2', equipe_pai_id: A.equipes.regional, responsavel_id: null, ativo: true, external_id: null },
      { id: B.equipes.equipe, tenant_id: tB, nome: 'Equipe Beta', equipe_pai_id: null, responsavel_id: B.usuarios.admin, ativo: true, external_id: null },
    ],
    'core.usuario': [
      usuario(A.usuarios.admin, tA, 'Admin Alfa', 'admin@exemplo.com.br', 'admin', null, senhaHash),
      usuario(A.usuarios.analista, tA, 'Analista Alfa', 'analista@exemplo.com.br', 'analista', null, senhaHash),
      usuario(A.usuarios.assistente, tA, 'Assistente Alfa', 'assistente@exemplo.com.br', 'assistente', null, senhaHash),
      usuario(A.usuarios.gerente, tA, 'Gerente Alfa', 'gerente@exemplo.com.br', 'gerente', A.equipes.regional, senhaHash),
      usuario(A.usuarios.supervisor, tA, 'Supervisor Alfa', 'supervisor@exemplo.com.br', 'supervisor', A.equipes.equipe1, senhaHash),
      usuario(A.usuarios.vendedor1, tA, 'Vendedor Um', DOIS_TENANTS.emailRepetido, 'vendedor', A.equipes.equipe1, senhaHash),
      usuario(A.usuarios.vendedor2, tA, 'Vendedor Dois', 'vendedor2@exemplo.com.br', 'vendedor', A.equipes.equipe2, senhaHash),
      usuario(A.usuarios.promotor, tA, 'Promotor Alfa', 'promotor@exemplo.com.br', 'promotor', A.equipes.equipe1, senhaHash),
      usuario(B.usuarios.admin, tB, 'Admin Beta', 'admin.b@exemplo.com.br', 'admin', null, senhaHash),
      usuario(B.usuarios.vendedor, tB, 'Vendedor Beta', DOIS_TENANTS.emailRepetido, 'vendedor', B.equipes.equipe, senhaHash),
    ],
    'plataforma.usuario_modulo': [
      { id: a('usuario_modulo', 1), tenant_id: tA, usuario_id: A.usuarios.vendedor2, modulo: 'teste', efeito: 'remover', motivo: 'fixture: exceção que remove teste (S0-042)', external_id: null },
      { id: b('usuario_modulo', 1), tenant_id: tB, usuario_id: B.usuarios.admin, modulo: 'vendedor', efeito: 'remover', motivo: 'fixture: garante linha em B', external_id: null },
    ],
    'core.produto': [
      { id: a('produto', 1), tenant_id: tA, sku: 'ALFA-001', ean: '7890000000011', nome: 'Pastilha de freio dianteira', marca: 'Norfreio', categoria: 'Freios', unidade: 'PC', ativo: true, external_id: 'ERP-A-001' },
      { id: a('produto', 2), tenant_id: tA, sku: 'ALFA-002', ean: null, nome: 'Filtro de óleo', marca: 'FiltraMax', categoria: 'Filtros', unidade: 'PC', ativo: true, external_id: null },
      { id: b('produto', 1), tenant_id: tB, sku: 'BETA-001', ean: '7890000000028', nome: 'Óleo 5W30 1 L', marca: 'Lubrion', categoria: 'Lubrificantes', unidade: 'UN', ativo: true, external_id: 'ERP-B-001' },
    ],
    'core.cliente': [
      cliente(A.clientes.c1, tA, '33333333000191', 'Auto Peças Um', 'Manaus', 'AM'),
      cliente(A.clientes.c2, tA, '44444444000191', 'Auto Peças Dois', 'Manaus', 'AM'),
      cliente(A.clientes.c3, tA, '55555555000191', 'Auto Peças Três', 'Manacapuru', 'AM'),
      cliente(B.clientes.c1, tB, '66666666000191', 'Mecânica Beta', 'São Paulo', 'SP'),
    ],
    'core.carteira': [
      { id: a('carteira', 1), tenant_id: tA, cliente_id: A.clientes.c1, usuario_id: A.usuarios.vendedor1, papel: 'vendedor', inicio: null, fim: null, external_id: null },
      { id: a('carteira', 2), tenant_id: tA, cliente_id: A.clientes.c1, usuario_id: A.usuarios.promotor, papel: 'promotor', inicio: null, fim: null, external_id: null },
      { id: a('carteira', 3), tenant_id: tA, cliente_id: A.clientes.c2, usuario_id: A.usuarios.vendedor2, papel: 'vendedor', inicio: null, fim: null, external_id: null },
      { id: a('carteira', 4), tenant_id: tA, cliente_id: A.clientes.c3, usuario_id: A.usuarios.vendedor1, papel: 'vendedor', inicio: null, fim: null, external_id: null },
      { id: b('carteira', 1), tenant_id: tB, cliente_id: B.clientes.c1, usuario_id: B.usuarios.vendedor, papel: 'vendedor', inicio: null, fim: null, external_id: null },
    ],
    'plataforma.evento': [
      evento(a('evento', 1), tA, A.usuarios.vendedor2),
      evento(b('evento', 1), tB, B.usuarios.admin),
    ],
    'plataforma.evento_consumo': [
      { id: a('evento_consumo', 1), tenant_id: tA, consumidor: 'core.fixture', evento_id: a('evento', 1), external_id: null },
      { id: b('evento_consumo', 1), tenant_id: tB, consumidor: 'core.fixture', evento_id: b('evento', 1), external_id: null },
    ],
    'plataforma.parametro': [
      { id: a('parametro', 1), tenant_id: tA, modulo: 'core', chave: 'raio_checkin_m', valor: '200', external_id: null },
      { id: a('parametro', 2), tenant_id: tA, modulo: 'vendedor', chave: 'alcada.vendedor_pct', valor: '5', external_id: null },
      { id: b('parametro', 1), tenant_id: tB, modulo: 'core', chave: 'raio_checkin_m', valor: '300', external_id: null },
    ],
    'plataforma.auditoria': [
      auditoria(a('auditoria', 1), tA, A.usuarios.admin, A.usuarios.vendedor2),
      auditoria(b('auditoria', 1), tB, B.usuarios.admin, B.usuarios.admin),
    ],
  };
}

function cliente(id: string, tenant_id: string, documento: string, nome: string, cidade: string, uf: string): Linha {
  return {
    id, tenant_id, documento, razao_social: `${nome} Ltda`, nome_fantasia: nome, segmento: 'Linha leve', telefone: null, email: null,
    logradouro: null, numero: null, bairro: null, cidade, uf, cep: null, latitude: null, longitude: null, ativo: true, external_id: null,
  };
}

function evento(id: string, tenant_id: string, usuarioId: string): Linha {
  return {
    id, tenant_id, nome: 'core.usuario.modulos_alterados@1', modulo: 'core', agregado_id: usuarioId,
    payload: { usuario_id: usuarioId, fixture: true }, publicado_em: null, tentativas: 0, ultimo_erro: null,
    usuario_id: usuarioId, request_id: 'fixture', external_id: null,
  };
}

function auditoria(id: string, tenant_id: string, autor: string, alvo: string): Linha {
  return {
    id, tenant_id, usuario_id: autor, modulo: 'core', acao: 'licenca.alterar', entidade: 'usuario_modulo', entidade_id: alvo,
    antes: { modulos: ['core', 'vendedor', 'teste'] }, depois: { modulos: ['core', 'vendedor'] }, request_id: 'fixture', external_id: null,
  };
}

/**
 * Carrega a fixture com um cliente ADMIN (o papel de aplicação não pode criar tenant). Idempotente.
 * Roda numa transação: ou entra tudo, ou nada.
 */
export async function carregarDoisTenants(admin: ClientBase, opcoes: { senha?: string } = {}): Promise<DadosFixture> {
  const senha = opcoes.senha ?? process.env.MACUXI_SENHA_TESTE ?? 'Teste@1234';
  const dados = dadosDoisTenants(hashSenha(senha));
  await admin.query('begin');
  try {
    for (const tabela of ORDEM_TABELAS) {
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
