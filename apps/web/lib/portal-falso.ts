/**
 * Modo falso do portal `config.` (T-0087; pedido R-20261106-002311 item 5): responde no navegador as mesmas rotas, com os mesmos
 * schemas (`@macuxi/platform-sdk` e `@macuxi/integracao/contracts`), para navegar o fluxo antes de as rotas reais chegarem.
 * Liga só com `NEXT_PUBLIC_PORTAL_FALSO=1` fora de produção (`MODO_PORTAL_FALSO` em `lib/portal-api.ts`, import dinâmico: o build
 * de produção não chama isto). Dados fictícios guardados no `sessionStorage` (o F5 não perde o que foi criado).
 * Acesso (T-0093; ADR 0031), só e-mail e senha, com qualquer senha que não seja `errada` (401) e 5 erros seguidos = 423:
 * - `time@macuxi.com.br`: time da Macuxi (vê todas as empresas e cria empresa);
 * - `admin@uma.com.br`: admin do cliente com 1 empresa (entra direto);
 * - `admin@duas.com.br`: admin do cliente com 2 empresas (escolhe; "Trocar de empresa");
 * - `troca@uma.com.br`: admin do cliente com a senha ainda por trocar (403 `SENHA_A_TROCAR`, T-0094).
 * Outro e-mail = 401 (mesma resposta da senha errada).
 * Planos (ADR 0047): o catálogo da spec portal-config-enxuto §11.3; cada empresa fictícia tem uma assinatura (Uma: PME em teste,
 * com Promotor Avulso 3 e Pesquisa 10; o `PUT` troca o plano com a trava da RN-PLA-05, só o time da Macuxi). CNPJ (ADR 0048), pela raiz (8 primeiros dígitos) de um CNPJ com dígitos válidos: começa
 * com `99` = Receita fora (503), `88` = não encontrado (404), `77` = baixado; o resto = ativo. A empresa nova recebe o código da
 * licença UF + 4 dígitos, como a migração 0068.
 * Admins da empresa (T-0094 fatia S, só o time da Macuxi): na Distribuidora Uma, um admin normal, um bloqueado, um em
 * `@sem-email.` (o redefinir dele responde 503 `EMAIL_INDISPONIVEL`, como a API sem e-mail configurado) e um admin + vendedor
 * (`entra_no_portal = false`, migração 0047, RN-CORE-35); nas outras, o admin
 * inicial com a troca pendente. Só na memória da aba (nada de e-mail no `sessionStorage`).
 */
import { cnpjValido, somenteDigitos } from '@macuxi/comum/documento';
import { ehUf } from '@macuxi/comum/endereco';
import {
  CODIGOS_CNPJ,
  conferirTrocaDePlano,
  ConsultaCnpjPedidoSchema,
  CriarEmpresaComPlanoSchema,
  EscolherEmpresaPortalSchema,
  fimDoTeste,
  ITENS_CONTADOS,
  licencasContratadas,
  LoginPortalSchema,
  modulosDaAssinatura,
  RedefinirSenhaAdminSchema,
  SessaoPortalSchema,
  TrocarPlanoSchema,
  usoPorItem,
  valorDaAssinatura,
  type AdicionalContratado,
  type AdminDaEmpresa,
  type Ciclo,
  type ConsultaCnpjResposta,
  type FichaAssinatura,
  type ItemContado,
  type Plano,
  type RedefinirSenhaAdminResposta,
} from '@macuxi/platform-sdk';
import { ConectorCriar, type ConectorResumo, type Entidade } from '@macuxi/integracao/contracts';

import { CODIGOS_PORTAL, faltasNaSenha, mensagemDaSenha, MENSAGEM_PORTAL_SENHA_A_TROCAR } from '@macuxi/core/contracts';

import { ROTAS_PORTAL } from './portal-rotas';

const CHAVE = 'macuxi.portal.falso';

interface EmpresaFalsa {
  id: string;
  codigo: string;
  razao_social: string;
  cnpj: string;
  fuso: string;
  status: string;
  criada_em: string;
  modulos: { modulo: string; licencas: number | null }[];
}
/** Sessão do modo falso: o token é a chave; o admin do cliente tem a lista conferida e a escolhida. */
interface SessaoFalsa {
  tipo: 'super_admin' | 'admin_cliente';
  empresas: string[];
  empresa: string | null;
  teto: string;
}
interface Estado {
  sessoes: Record<string, SessaoFalsa>;
  empresas: EmpresaFalsa[];
  conectores: Record<string, ConectorResumo[]>;
  assinaturas: Record<string, AssinaturaFalsa>;
}
/** Assinatura fictícia: a escolha e o uso (sem dado pessoal; vai ao `sessionStorage`). */
interface AssinaturaFalsa {
  plano: string;
  ciclo: Ciclo;
  adicionais: AdicionalContratado[];
  teste_ate: string | null;
  paga: boolean;
  em_uso: Partial<Record<ItemContado, number>>;
  desde: string;
}

/** Catálogo da spec portal-config-enxuto §11.3 (no servidor, é dado do banco). */
const plano = (n: number, codigo: string, nome: string, centavos: number, vendedor: number, gestor: number, bko: number): Plano => ({
  id: `7c2a0f10-0000-4000-8000-00000000000${n}`,
  codigo,
  nome,
  ordem: n,
  preco_mensal_centavos: centavos,
  licencas: { vendedor, gestor, bko, promotor: 0 },
  modulos: ['core', 'catalogo', 'vendedor', 'gestor', 'integracao'],
  adicionais: [
    { adicional: 'promotor', preco_unitario_centavos: 8000, incluidos: 0 },
    { adicional: 'pesquisa', preco_unitario_centavos: 1000, incluidos: 0 },
    { adicional: 'treinamento', preco_unitario_centavos: 1000, incluidos: 0 },
  ],
  meses_gratis_anual: 2,
  dias_teste: 14,
  ativo: true,
});
export const PLANOS_FALSOS: readonly Plano[] = [
  plano(1, 'light', 'Light', 61_000, 10, 1, 1),
  plano(2, 'pme', 'PME', 119_700, 20, 2, 3),
  plano(3, 'enterprise', 'Enterprise', 171_900, 30, 3, 5),
  plano(4, 'corporate', 'Corporate', 259_250, 50, 5, 5),
];

/** Empresas dos admins do cliente falsos (ids fixos: o F5 e os testes acham as mesmas). */
const EMPRESAS_DOS_CLIENTES: EmpresaFalsa[] = [
  { id: '0b6f1a52-5c1e-4c4e-9a43-000000000001', codigo: 'AM4821', razao_social: 'Distribuidora Uma Ltda', cnpj: '11222333000181', fuso: 'America/Manaus', status: 'ativo', criada_em: '2026-11-01T12:00:00.000Z', modulos: [{ modulo: 'core', licencas: null }, { modulo: 'vendedor', licencas: 10 }, { modulo: 'integracao', licencas: null }] },
  { id: '0b6f1a52-5c1e-4c4e-9a43-000000000002', codigo: 'RR3907', razao_social: 'Atacado Norte S.A.', cnpj: '04252011000110', fuso: 'America/Manaus', status: 'ativo', criada_em: '2026-11-02T12:00:00.000Z', modulos: [{ modulo: 'core', licencas: null }, { modulo: 'vendedor', licencas: 25 }, { modulo: 'integracao', licencas: null }] },
  { id: '0b6f1a52-5c1e-4c4e-9a43-000000000003', codigo: 'RR1562', razao_social: 'Comercial Boa Vista Ltda', cnpj: '33000167000101', fuso: 'America/Boa_Vista', status: 'ativo', criada_em: '2026-11-03T12:00:00.000Z', modulos: [{ modulo: 'core', licencas: null }, { modulo: 'promotor', licencas: 5 }, { modulo: 'integracao', licencas: null }] },
];
/** Contas falsas por e-mail: `null` = time da Macuxi; lista = admin do cliente nessas empresas (por nome). */
export const CONTAS_FALSAS: Readonly<Record<string, readonly string[] | null>> = Object.freeze({
  'time@macuxi.com.br': null,
  'admin@uma.com.br': ['0b6f1a52-5c1e-4c4e-9a43-000000000001'],
  'admin@duas.com.br': ['0b6f1a52-5c1e-4c4e-9a43-000000000002', '0b6f1a52-5c1e-4c4e-9a43-000000000003'],
});

/** Conta falsa com a senha certa, mas ainda temporária: o portal responde 403 `SENHA_A_TROCAR` (T-0094). */
export const CONTA_SENHA_A_TROCAR = 'troca@uma.com.br';

/** Admins por empresa e redefinições já feitas (por `email_id`): só na memória da aba (e-mail não vai ao `sessionStorage`). */
const adminsFalsos = new Map<string, AdminDaEmpresa[]>();
let adminsSemeados = false;
const redefinicoesFalsas = new Map<string, { tenant: string; usuario: string; resposta: RedefinirSenhaAdminResposta }>();

function adminsIniciais(): Map<string, AdminDaEmpresa[]> {
  const admin = (n: number, nome: string, email: string, x: Partial<AdminDaEmpresa> = {}): AdminDaEmpresa => ({
    usuario_id: `5d1e2c0a-7b3f-4a51-8c2d-0000000000${String(n).padStart(2, '0')}`,
    nome,
    email,
    ativo: true,
    bloqueado: false,
    tem_senha: true,
    trocar_senha: false,
    senha_expira_em: null,
    // 0047: só admin + vendedor/promotor/supervisor fica fora do portal (RN-CORE-35)
    entra_no_portal: true,
    ...x,
  });
  const [uma, norte, boaVista] = EMPRESAS_DOS_CLIENTES.map((e) => e.id);
  return new Map([
    [uma ?? '', [admin(1, 'Ana Souza', 'admin@uma.com.br'), admin(2, 'Carlos Lima', 'carlos@uma.com.br', { bloqueado: true }), admin(3, 'Suporte TI', 'ti@sem-email.uma.com.br'), admin(7, 'Marcos Reis', 'marcos@uma.com.br', { entra_no_portal: false })]],
    [norte ?? '', [admin(4, 'Bruno Dias', 'admin@duas.com.br', { trocar_senha: true })]],
    [boaVista ?? '', [admin(5, 'Bruno Dias', 'admin@duas.com.br'), admin(6, 'Rita Melo', 'rita@boavista.com.br', { tem_senha: false })]],
  ]);
}

/** Erros seguidos por e-mail: só na memória da aba (nem o e-mail vai ao `sessionStorage`). */
const falhas = new Map<string, number>();

const ADMINS_M = /^\/plataforma\/empresas\/([^/]+)\/admins(?:\/([^/]+)\/redefinir-senha)?$/;

/** `GET/POST /plataforma/empresas/:id/admins[/:usuario/redefinir-senha]` como a API (fatia S da T-0094). */
function responderAdmins(metodo: string, tenant: string, usuario: string | undefined, sessao: SessaoFalsa, e: Estado, corpo: unknown): Response {
  if (sessao.tipo !== 'super_admin') return erro(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi redefine a senha do administrador.');
  if (!e.empresas.some((x) => x.id === tenant)) return erro(404, 'TENANT_NAO_ENCONTRADO', 'Empresa não encontrada ou inativa.');
  if (!adminsSemeados) {
    adminsSemeados = true;
    for (const [k, v] of adminsIniciais()) if (!adminsFalsos.has(k)) adminsFalsos.set(k, v);
  }
  const lista = adminsFalsos.get(tenant) ?? [];
  if (metodo === 'GET' && !usuario) return json(200, { itens: lista });
  if (metodo !== 'POST' || !usuario) return erro(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
  const c = lerCorpo(RedefinirSenhaAdminSchema, corpo);
  if (c instanceof Response) return c;
  const feita = redefinicoesFalsas.get(c.email_id);
  if (feita) {
    if (feita.tenant !== tenant || feita.usuario !== usuario) return erro(409, 'PEDIDO_REPETIDO_DIFERENTE', 'Este pedido já foi usado para outro administrador. Tente de novo.');
    return json(200, { ...feita.resposta, repetida: true });
  }
  const alvo = lista.find((a) => a.usuario_id === usuario);
  if (alvo && /@sem-email\./i.test(alvo.email)) return erro(503, 'EMAIL_INDISPONIVEL', 'O envio de e-mail não está configurado: a senha não foi trocada. Fale com o suporte da Macuxi.');
  if (!alvo || !alvo.ativo || alvo.bloqueado) return erro(404, 'USUARIO_NAO_ENCONTRADO', 'Administrador não encontrado nesta empresa.');
  const resposta: RedefinirSenhaAdminResposta = { email_id: c.email_id, email: 'enfileirado', senha_expira_em: agoraIso(72 * 60), repetida: false };
  redefinicoesFalsas.set(c.email_id, { tenant, usuario, resposta });
  adminsFalsos.set(tenant, lista.map((a) => (a.usuario_id === usuario ? { ...a, tem_senha: true, trocar_senha: true, senha_expira_em: resposta.senha_expira_em } : a)));
  return json(200, resposta);
}

const [UMA = '', NORTE = '', BOA_VISTA = ''] = EMPRESAS_DOS_CLIENTES.map((x) => x.id);
const ASSINATURAS_INICIAIS: Record<string, AssinaturaFalsa> = {
  [UMA]: {
    plano: 'pme',
    ciclo: 'mensal',
    adicionais: [
      { adicional: 'promotor', quantidade: 3 },
      { adicional: 'pesquisa', quantidade: 10 },
    ],
    teste_ate: '2026-11-27',
    paga: false,
    em_uso: { vendedor: 14, gestor: 2, bko: 1, promotor: 3, pesquisa: 6 },
    desde: '2026-11-14T12:00:00.000Z',
  },
  [NORTE]: { plano: 'light', ciclo: 'anual', adicionais: [], teste_ate: null, paga: true, em_uso: { vendedor: 8, gestor: 1, bko: 1 }, desde: '2026-11-02T12:00:00.000Z' },
  [BOA_VISTA]: { plano: 'enterprise', ciclo: 'mensal', adicionais: [], teste_ate: '2026-11-16', paga: false, em_uso: { vendedor: 3, gestor: 1, bko: 1 }, desde: '2026-11-03T12:00:00.000Z' },
};

const vazio = (): Estado => ({ sessoes: {}, empresas: [...EMPRESAS_DOS_CLIENTES], conectores: {}, assinaturas: { ...ASSINATURAS_INICIAIS } });

/** Ficha como a API (`FichaAssinaturaSchema`): contratadas pelo plano + adicionais, valor pelo `valorDaAssinatura`. */
function fichaFalsa(tenant: string, a: AssinaturaFalsa): FichaAssinatura | null {
  const p = PLANOS_FALSOS.find((x) => x.codigo === a.plano);
  if (!p) return null;
  const contratadas = licencasContratadas(p, a.adicionais);
  return {
    tenant_id: tenant,
    plano: p,
    ciclo: a.ciclo,
    adicionais: a.adicionais,
    teste_ate: a.teste_ate,
    paga: a.paga,
    licencas: ITENS_CONTADOS.map((item) => ({ item, contratadas: contratadas[item], em_uso: a.em_uso[item] ?? 0 })),
    valor: valorDaAssinatura(p, a.adicionais, a.ciclo),
    desde: a.desde,
    atualizada_em: a.desde,
  };
}

/** Consulta fictícia do CNPJ (regras no topo do arquivo); `Response` = erro como a API. */
function consultaFalsa(cnpj: string): ConsultaCnpjResposta | Response {
  const d = somenteDigitos(cnpj);
  if (!cnpjValido(d)) return erro(400, CODIGOS_CNPJ.invalido, 'CNPJ inválido: confira os dígitos.', { campo: 'cnpj' });
  if (d.startsWith('99')) return erro(503, CODIGOS_CNPJ.fonteFora, 'A consulta à Receita está fora do ar. Tente de novo em instantes.');
  if (d.startsWith('88')) return erro(404, CODIGOS_CNPJ.naoEncontrado, 'CNPJ não encontrado na Receita Federal.');
  const uma = d === '11222333000181';
  return {
    cnpj: d,
    razao_social: uma ? 'Distribuidora Uma Ltda' : 'Empresa Exemplo Ltda',
    nome_fantasia: uma ? 'Distribuidora Uma' : null,
    endereco: { logradouro: 'Rua Fictícia', numero: '100', complemento: null, bairro: 'Bairro Teste' },
    municipio: 'Manaus',
    uf: 'AM',
    cep: '69000000',
    situacao_cadastral: d.startsWith('77') ? 'baixada' : 'ativa',
    cnae_principal: { codigo: '4639701', descricao: 'Comércio atacadista de alimentos' },
    telefone: '9200000000',
    email: uma ? 'contato@distribuidorauma.invalid' : null,
    fonte: 'brasilapi',
  };
}

/** Código da licença: UF + 4 dígitos que ninguém usa (migração 0068). */
function sortearCodigo(uf: string, usados: readonly string[]): string {
  for (;;) {
    const c = `${uf}${String(Math.floor(Math.random() * 10_000)).padStart(4, '0')}`;
    if (!usados.includes(c)) return c;
  }
}

function ler(): Estado {
  try {
    const b = window.sessionStorage.getItem(CHAVE);
    return b ? { ...vazio(), ...(JSON.parse(b) as Partial<Estado>) } : vazio();
  } catch {
    return vazio();
  }
}
function gravar(e: Estado) {
  try {
    window.sessionStorage.setItem(CHAVE, JSON.stringify(e));
  } catch {
    // sem storage
  }
}

const json = (status: number, corpo: unknown, cabecalhos: Record<string, string> = {}) =>
  new Response(status === 204 ? null : JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json', ...cabecalhos } });
const erro = (status: number, codigo: string, mensagem: string, detalhes?: Record<string, unknown>) => json(status, { codigo, mensagem, ...(detalhes ? { detalhes } : {}) });
const agoraIso = (deslocMin = 0) => new Date(Date.now() + deslocMin * 60_000).toISOString();
const nomeDaEmpresa = (e: EmpresaFalsa) => ({ id: e.id, codigo: e.codigo, nome: e.razao_social });

/** Abre (ou reabre, no escolher e no renovar) a sessão: token novo; o anterior deixa de valer. */
function emitirSessao(e: Estado, s: SessaoFalsa, tokenAnterior?: string): { estado: Estado; corpo: unknown } {
  const token = `token-falso-${crypto.randomUUID()}`;
  const sessoes = { ...e.sessoes, [token]: s };
  if (tokenAnterior) delete sessoes[tokenAnterior];
  const lista = s.empresas.map((id) => e.empresas.find((x) => x.id === id)).filter((x): x is EmpresaFalsa => !!x);
  const escolhida = s.empresa ? (lista.find((x) => x.id === s.empresa) ?? null) : null;
  const corpo = SessaoPortalSchema.parse({
    token,
    expira_em: agoraIso(15),
    sessao_expira_em: s.teto,
    tipo: s.tipo,
    empresa: escolhida ? nomeDaEmpresa(escolhida) : null,
    empresas: s.tipo === 'super_admin' ? [] : lista.map(nomeDaEmpresa),
  });
  return { estado: { ...e, sessoes }, corpo };
}

function lerCorpo<T>(schema: { safeParse(x: unknown): { success: true; data: T } | { success: false; error: { issues: { message: string }[] } } }, corpo: unknown): T | Response {
  const p = schema.safeParse(corpo);
  if (p.success) return p.data;
  return erro(400, 'VALIDACAO', p.error.issues[0]?.message ?? 'Dados inválidos.');
}

function conectorResumo(c: { conector_id: string; nome: string; tipo: ConectorResumo['tipo']; recebe_pedidos: boolean; aceita_cancelamento?: boolean; entidades: Entidade[] }): ConectorResumo {
  return {
    id: crypto.randomUUID(),
    conector_id: c.conector_id,
    nome: c.nome,
    tipo: c.tipo,
    ativo: true,
    recebe_pedidos: c.recebe_pedidos,
    // T-0114: devolução do cancelamento ao ERP (desligada, como o padrão do contrato)
    aceita_cancelamento: c.aceita_cancelamento ?? false,
    entidades: c.entidades,
    ips_permitidos: [],
    versao_conector: null,
    situacao_versao: 'sem_politica',
    ultimo_sinal_em: null,
    saude: 'nunca_conectou',
    chave: { prefixo: 'mx_falso', criada_em: agoraIso(), anterior_prefixo: null, anterior_valida_ate: null, expira_em: null },
    criado_em: agoraIso(),
  };
}

export async function responderFalso(metodo: string, caminhoComQuery: string, corpo: unknown, cabecalhos: Record<string, string>): Promise<Response> {
  await new Promise((r) => setTimeout(r, 250));
  const [caminho = ''] = caminhoComQuery.split('?');
  const e = ler();
  const tenant = cabecalhos['x-macuxi-tenant'];
  const autenticado = (cabecalhos.Authorization ?? '').startsWith('Bearer token-falso-');
  const rota = `${metodo} ${caminho}`;

  // ---------- autenticação (T-0093: só e-mail e senha)
  if (rota === `POST ${ROTAS_PORTAL.login}`) {
    const c = lerCorpo(LoginPortalSchema, corpo);
    if (c instanceof Response) return c;
    if ((falhas.get(c.email) ?? 0) >= 5) return erro(423, 'BLOQUEADO', 'Acesso bloqueado por tentativas erradas. Tente de novo em 15 minutos.');
    // T-0094 (RN-CORE-34): admin do cliente com a senha master ainda por trocar; a troca é no backoffice (só para a senha certa)
    if (c.email === CONTA_SENHA_A_TROCAR && c.senha !== 'errada') return erro(403, CODIGOS_PORTAL.senhaATrocar, MENSAGEM_PORTAL_SENHA_A_TROCAR);
    const conta = CONTAS_FALSAS[c.email];
    if (conta === undefined || c.senha === 'errada') {
      falhas.set(c.email, (falhas.get(c.email) ?? 0) + 1);
      return erro(401, 'CREDENCIAIS_INVALIDAS', 'E-mail ou senha incorretos. Confira e tente de novo.');
    }
    falhas.delete(c.email);
    const base: Estado = { ...e, empresas: [...e.empresas, ...EMPRESAS_DOS_CLIENTES.filter((x) => !e.empresas.some((y) => y.id === x.id))] };
    const s: SessaoFalsa =
      conta === null
        ? { tipo: 'super_admin', empresas: [], empresa: null, teto: agoraIso(480) }
        : { tipo: 'admin_cliente', empresas: [...conta], empresa: conta.length === 1 ? (conta[0] ?? null) : null, teto: agoraIso(480) };
    const r = emitirSessao(base, s);
    gravar(r.estado);
    return json(200, r.corpo);
  }
  const token = (cabecalhos.Authorization ?? '').replace(/^Bearer /, '');
  const sessao = autenticado ? e.sessoes[token] : undefined;
  if (!sessao) return erro(401, 'SESSAO_PLATAFORMA_INVALIDA', 'Sua sessão do portal expirou. Entre de novo.');
  if (rota === `POST ${ROTAS_PORTAL.escolherEmpresa}`) {
    const c = lerCorpo(EscolherEmpresaPortalSchema, corpo);
    if (c instanceof Response) return c;
    if (sessao.tipo !== 'admin_cliente') return erro(403, 'EMPRESA_NAO_PERMITIDA', 'O acesso do time da Macuxi já vê todas as empresas. Escolha a empresa na lista.');
    if (!sessao.empresas.includes(c.tenant_id)) return erro(403, 'EMPRESA_NAO_PERMITIDA', 'Você não tem acesso a esta empresa. Escolha uma da lista.');
    const r = emitirSessao(e, { ...sessao, empresa: c.tenant_id }, token);
    gravar(r.estado);
    return json(200, r.corpo);
  }
  if (rota === `POST ${ROTAS_PORTAL.renovar}`) {
    const r = emitirSessao(e, sessao, token);
    gravar(r.estado);
    return json(200, r.corpo);
  }
  if (rota === `POST ${ROTAS_PORTAL.sair}`) {
    const sessoes = { ...e.sessoes };
    delete sessoes[token];
    gravar({ ...e, sessoes });
    return json(204, null);
  }

  // ---------- empresas
  if (rota === `GET ${ROTAS_PORTAL.empresas}`) return json(200, { itens: sessao.tipo === 'super_admin' ? e.empresas : e.empresas.filter((x) => sessao.empresas.includes(x.id)) });
  // ---------- planos e CNPJ (ADR 0047 e 0048)
  if (rota === `GET ${ROTAS_PORTAL.planos}`) return json(200, { itens: PLANOS_FALSOS });
  if (rota === `POST ${ROTAS_PORTAL.cnpj}`) {
    const bruto = (corpo as { cnpj?: unknown } | null)?.cnpj;
    if (typeof bruto === 'string' && !cnpjValido(somenteDigitos(bruto))) return consultaFalsa(bruto) as Response;
    const c = lerCorpo(ConsultaCnpjPedidoSchema, corpo);
    if (c instanceof Response) return c;
    const r = consultaFalsa(c.cnpj);
    return r instanceof Response ? r : json(200, r);
  }
  if (rota === `POST ${ROTAS_PORTAL.empresaComPlano}`) {
    if (sessao.tipo !== 'super_admin') return erro(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi cadastra empresas.');
    const uf = (corpo as { uf?: unknown } | null)?.uf;
    if (typeof uf !== 'string' || !ehUf(uf)) return erro(400, 'VALIDACAO', 'Escolha a UF.', { campo: 'uf' });
    const c = lerCorpo(CriarEmpresaComPlanoSchema.omit({ codigo: true }), corpo);
    if (c instanceof Response) return c;
    // RN-CORE-34 e RN-CORE-32 como a API: sem admin = 422; senha fora da regra do Core = 422 com as faltas
    if (!c.admin) return erro(422, 'RN-CORE-34', 'Informe o administrador da empresa.', { campo: 'admin' });
    const faltas = faltasNaSenha(c.admin.senha);
    const m = mensagemDaSenha(faltas, c.admin.senha);
    if (m) return erro(422, 'RN-CORE-32', m, { campo: 'admin.senha', faltas });
    const receita = consultaFalsa(c.cnpj);
    if (receita instanceof Response) return receita.status === 404 ? erro(422, CODIGOS_CNPJ.naoEncontrado, 'CNPJ não encontrado na Receita Federal. A empresa não foi criada.', { campo: 'cnpj' }) : receita;
    if (receita.situacao_cadastral !== 'ativa') return erro(422, CODIGOS_CNPJ.inativo, `Este CNPJ não está ativo na Receita (situação: ${receita.situacao_cadastral}). A empresa não foi criada.`, { campo: 'cnpj', situacao_cadastral: receita.situacao_cadastral });
    const p = PLANOS_FALSOS.find((x) => x.codigo === c.assinatura.plano);
    if (!p) return erro(422, 'PLANO_DESCONHECIDO', 'Plano não encontrado no catálogo.', { campo: 'plano' });
    const codigo = sortearCodigo(uf, e.empresas.map((x) => x.codigo));
    const id = crypto.randomUUID();
    const teste_ate = c.assinatura.com_teste ? fimDoTeste(agoraIso().slice(0, 10), p.dias_teste) : null;
    const modulos = modulosDaAssinatura(p, c.assinatura.adicionais).map((modulo) => ({ modulo, licencas: null }));
    const assinatura: AssinaturaFalsa = { plano: p.codigo, ciclo: c.assinatura.ciclo, adicionais: c.assinatura.adicionais, teste_ate, paga: !teste_ate, em_uso: { bko: 1 }, desde: agoraIso() };
    gravar({
      ...e,
      empresas: [...e.empresas, { id, codigo, razao_social: c.razao_social, cnpj: c.cnpj, fuso: c.fuso, status: 'ativo', criada_em: agoraIso(), modulos }],
      assinaturas: { ...e.assinaturas, [id]: assinatura },
    });
    // o admin inicial entra na lista de admins (só na memória), com a troca pendente (RN-CORE-34)
    adminsFalsos.set(id, [{ usuario_id: crypto.randomUUID(), nome: c.admin.nome, email: c.admin.email, ativo: true, bloqueado: false, tem_senha: true, trocar_senha: true, senha_expira_em: null, entra_no_portal: true }]);
    return json(201, { tenant_id: id, codigo, resultado: 'criado', assinatura: 'criada', teste_ate, valor: valorDaAssinatura(p, c.assinatura.adicionais, c.assinatura.ciclo), avisos: [], admin: 'criado', simulado: false });
  }
  const assinaturaM = /^\/plataforma\/empresas\/([^/]+)\/assinatura$/.exec(caminho);
  if (metodo === 'GET' && assinaturaM) {
    const t = decodeURIComponent(assinaturaM[1] ?? '');
    if (sessao.tipo === 'admin_cliente' && t !== sessao.empresa) return erro(403, 'PERFIL_SEM_ACESSO', 'Você só vê o plano da sua empresa.');
    const a = e.assinaturas[t];
    const f = a ? fichaFalsa(t, a) : null;
    return f ? json(200, f) : erro(404, 'SEM_ASSINATURA', 'Esta empresa ainda não tem plano.');
  }
  if (metodo === 'PUT' && assinaturaM) {
    const t = decodeURIComponent(assinaturaM[1] ?? '');
    if (sessao.tipo !== 'super_admin') return erro(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi troca o plano.');
    const a = e.assinaturas[t];
    const atual = a ? fichaFalsa(t, a) : null;
    if (!a || !atual) return erro(404, 'SEM_ASSINATURA', 'Esta empresa ainda não tem plano.');
    const c = lerCorpo(TrocarPlanoSchema, corpo);
    if (c instanceof Response) return c;
    const novo = PLANOS_FALSOS.find((x) => x.codigo === c.plano);
    if (!novo) return erro(422, 'PLANO_DESCONHECIDO', 'Plano não encontrado no catálogo.', { campo: 'plano' });
    // RN-PLA-05, como a API: abaixo do uso = 422 com os problemas
    const problemas = conferirTrocaDePlano(novo, c.adicionais, usoPorItem(atual.licencas).emUso);
    if (problemas.length > 0) return erro(422, problemas[0]?.codigo ?? 'VALIDACAO', problemas[0]?.mensagem ?? 'Plano inválido.', { problemas });
    const nova: AssinaturaFalsa = { ...a, plano: novo.codigo, ciclo: c.ciclo, adicionais: c.adicionais };
    gravar({ ...e, assinaturas: { ...e.assinaturas, [t]: nova } });
    return json(200, fichaFalsa(t, nova));
  }
  // ---------- diagnósticos (T-0158): o modo falso não tem aparelhos, a lista vem vazia
  if (rota === `GET ${ROTAS_PORTAL.diagnosticos}`) {
    if (sessao.tipo !== 'super_admin') return erro(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi vê os diagnósticos.');
    return json(200, { itens: [], cursor: null });
  }

  const adminsM = ADMINS_M.exec(caminho);
  if (adminsM) return responderAdmins(metodo, decodeURIComponent(adminsM[1] ?? ''), adminsM[2] ? decodeURIComponent(adminsM[2]) : undefined, sessao, e, corpo);

  // ---------- rotas de módulo (com tenant): o admin do cliente só na empresa escolhida (desenho T-0093 §4)
  if (sessao.tipo === 'admin_cliente') {
    if (!sessao.empresa) return erro(409, 'EMPRESA_NAO_ESCOLHIDA', 'Escolha a empresa para continuar.');
    if (tenant !== sessao.empresa) return erro(403, 'EMPRESA_NAO_PERMITIDA', 'Você não tem acesso a esta empresa. Escolha outra.');
  }
  if (!tenant || !e.empresas.some((x) => x.id === tenant)) return erro(404, 'TENANT_NAO_ENCONTRADO', 'Empresa não encontrada ou inativa.');
  if (rota === `GET ${ROTAS_PORTAL.conectores}`) return json(200, { itens: e.conectores[tenant] ?? [] });
  if (rota === `POST ${ROTAS_PORTAL.conectores}`) {
    const c = lerCorpo(ConectorCriar, corpo);
    if (c instanceof Response) return c;
    const lista = e.conectores[tenant] ?? [];
    if (lista.some((x) => x.conector_id === c.conector_id)) return erro(409, 'conector_ja_existe', `Já existe um Conector com o identificador "${c.conector_id}" nesta empresa.`);
    const ocupadas = new Set(lista.filter((x) => x.ativo).flatMap((x) => x.entidades));
    const conflito = c.entidades.filter((x) => ocupadas.has(x));
    if (conflito.length) {
      return erro(409, 'topologia_conflitante', `As bases ${conflito.join(', ')} já são recebidas por outro Conector. Na v1 cada base vem de um único Conector por empresa.`, { entidades_livres: c.entidades.filter((x) => !ocupadas.has(x)) });
    }
    const novo = conectorResumo({ conector_id: c.conector_id, nome: c.nome, tipo: c.tipo, recebe_pedidos: c.recebe_pedidos, aceita_cancelamento: c.aceita_cancelamento, entidades: c.entidades });
    gravar({ ...e, conectores: { ...e.conectores, [tenant]: [...lista, novo] } });
    return json(201, { conector: novo, chave: { conector_id: c.conector_id, escopo: 'integracao.v1', chave: `mx_falso_${crypto.randomUUID().replace(/-/g, '')}`, prefixo: 'mx_falso', criada_em: agoraIso(), anterior_valida_ate: null } });
  }
  // N1/N2 (nuvem) ainda não existem: igual à API real antes do merge
  return erro(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
}

/** Para os testes e para "recomeçar" o modo falso. */
export function zerarModoFalso() {
  falhas.clear();
  adminsFalsos.clear();
  adminsSemeados = false;
  redefinicoesFalsas.clear();
  gravar(vazio());
}
