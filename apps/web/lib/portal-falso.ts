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
 * Outro e-mail = 401 (mesma resposta da senha errada). Na carga, linha sem `external_id` ou com `erro` no texto vira erro de linha.
 * Admins da empresa (T-0094 fatia S, só o time da Macuxi): na Distribuidora Uma, um admin normal, um bloqueado, um em
 * `@sem-email.` (o redefinir dele responde 503 `EMAIL_INDISPONIVEL`, como a API sem e-mail configurado) e um admin + vendedor
 * (`entra_no_portal = false`, migração 0047, RN-CORE-35); nas outras, o admin
 * inicial com a troca pendente. Só na memória da aba (nada de e-mail no `sessionStorage`).
 * Backup, Inativar e Excluir (ADR 0052; spec portal-config-enxuto §15.3): as empresas começam nos estados da simulação
 * `depois-02b` (ativa com backup, ativa sem backup, inativa com backup em andamento, anterior à inativação, vencido e válido).
 * O backup leva 6 s; o da Atacado Norte sempre falha. A exclusão leva 6 s; a senha `errada` dá 403 `REAUTENTICACAO_FALHOU`.
 * A liberação do Excluir é a `conferirExclusao` do SDK, a mesma da API.
 */
import {
  CODIGOS_ACOES_EMPRESA,
  MENSAGENS_ACOES_EMPRESA,
  MENSAGEM_EXCLUSAO_NAO_ENCONTRADA,
  MENSAGEM_SO_SUPER_ADMIN_ACOES,
  CriarEmpresaSchema,
  ExcluirEmpresaSchema,
  PedirBackupEmpresaSchema,
  codigoDeConfirmacaoConfere,
  conferirExclusao,
  type AcoesDaEmpresa,
  type BackupEmpresa,
  type CodigoAcaoEmpresa,
  type ExclusaoEmpresa,
  type StatusEmpresa,
  EscolherEmpresaPortalSchema,
  LoginPortalSchema,
  RedefinirSenhaAdminSchema,
  SessaoPortalSchema,
  linhasDosParametrosIniciais,
  type AdminDaEmpresa,
  type RedefinirSenhaAdminResposta,
} from '@macuxi/platform-sdk';
import {
  CargaArquivoEntrada,
  ConectorCriar,
  ConferirArquivoEntrada,
  type ConectorResumo,
  type Entidade,
  type LinhaErro,
  type LoteResultado,
} from '@macuxi/integracao/contracts';

import { CODIGOS_PORTAL, faltasNaSenha, ImportarEquipeRequestSchema, mensagemDaSenha, MENSAGEM_PORTAL_SENHA_A_TROCAR, PerfilSchema, type ImportarEquipeResposta } from '@macuxi/core/contracts';

import { ROTAS_PORTAL } from './portal-rotas';

const CHAVE = 'macuxi.portal.falso';
const ORDEM: Entidade[] = ['vendedor', 'catalogo_no', 'forma_pagamento', 'prazo_pagamento', 'produto', 'produto_unidade', 'preco', 'tabela_escalonada', 'estoque', 'cliente', 'cliente_endereco', 'transportadora', 'rota', 'titulo', 'nota'];

interface EmpresaFalsa {
  id: string;
  codigo: string;
  razao_social: string;
  cnpj: string;
  fuso: string;
  status: string;
  criada_em: string;
  modulos: { modulo: string; licencas: number | null }[];
  /** ADR 0052 (só no modo falso; a lista devolve no bloco `acoes`). */
  inativada_em?: string | null;
  backups?: BackupFalso[];
  exclusao?: ExclusaoFalsa | null;
}
/** Backup falso: termina em `termina_em` (ms) como `pronto`, ou `falhou` com `falha`. */
interface BackupFalso {
  id: string;
  pedido_em: string;
  consistente: boolean;
  termina_em: number;
  falha: boolean;
}
interface ExclusaoFalsa {
  id: string;
  backup_id: string;
  pedida_em: string;
  termina_em: number;
}
interface LoteFalso {
  tenant: string;
  resultado: LoteResultado;
  sessao: string | null;
  parte: number;
  total: number;
  pronto_em: number;
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
  lotes: Record<string, LoteFalso>;
}

/** Empresas dos admins do cliente falsos (ids fixos: o F5 e os testes acham as mesmas). */
const EMPRESAS_DOS_CLIENTES: EmpresaFalsa[] = [
  { id: '0b6f1a52-5c1e-4c4e-9a43-000000000001', codigo: 'distribuidora-uma', razao_social: 'Distribuidora Uma Ltda', cnpj: '11222333000181', fuso: 'America/Manaus', status: 'ativo', criada_em: '2026-11-01T12:00:00.000Z', modulos: [{ modulo: 'core', licencas: null }, { modulo: 'vendedor', licencas: 10 }, { modulo: 'integracao', licencas: null }] },
  { id: '0b6f1a52-5c1e-4c4e-9a43-000000000002', codigo: 'atacado-norte', razao_social: 'Atacado Norte S.A.', cnpj: '04252011000110', fuso: 'America/Manaus', status: 'ativo', criada_em: '2026-11-02T12:00:00.000Z', modulos: [{ modulo: 'core', licencas: null }, { modulo: 'vendedor', licencas: 25 }, { modulo: 'integracao', licencas: null }] },
  { id: '0b6f1a52-5c1e-4c4e-9a43-000000000003', codigo: 'comercial-boa-vista', razao_social: 'Comercial Boa Vista Ltda', cnpj: '33000167000101', fuso: 'America/Boa_Vista', status: 'ativo', criada_em: '2026-11-03T12:00:00.000Z', modulos: [{ modulo: 'core', licencas: null }, { modulo: 'promotor', licencas: 5 }, { modulo: 'integracao', licencas: null }] },
];
const DIA = 86_400_000;
const HORA = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();
const backupFalso = (n: number, pedidoHa: number, duracao: number, consistente: boolean): BackupFalso => ({
  id: `7c0d5e1a-2b4f-4c6d-8e9f-00000000000${n}`,
  pedido_em: iso(Date.now() - pedidoHa),
  consistente,
  termina_em: Date.now() - pedidoHa + duracao,
  falha: false,
});
const empresaDoTime = (n: number, codigo: string, razao_social: string, cnpj: string, criada: string): EmpresaFalsa => ({
  id: `0b6f1a52-5c1e-4c4e-9a43-00000000001${n}`,
  codigo,
  razao_social,
  cnpj,
  fuso: 'America/Manaus',
  status: 'suspenso',
  criada_em: `${criada}T12:00:00.000Z`,
  modulos: [{ modulo: 'core', licencas: null }, { modulo: 'vendedor', licencas: 10 }, { modulo: 'integracao', licencas: null }],
});

/** Empresas do começo, nos estados da simulação `depois-02b` (datas relativas a agora). */
function empresasIniciais(): EmpresaFalsa[] {
  const agora = Date.now();
  const [uma, norte, boaVista] = EMPRESAS_DOS_CLIENTES as [EmpresaFalsa, EmpresaFalsa, EmpresaFalsa];
  return [
    { ...uma, inativada_em: null, backups: [backupFalso(1, 20 * HORA, 5 * 60_000, false)] },
    { ...norte, inativada_em: null, backups: [] },
    { ...boaVista, status: 'suspenso', inativada_em: iso(agora - 2 * DIA), backups: [{ ...backupFalso(2, 5 * 60_000, 2 * HORA, true) }] },
    { ...empresaDoTime(1, 'RR4410', 'Mercado Caracaraí Ltda', '19131243000197', '2026-10-29'), inativada_em: iso(agora - DIA), backups: [backupFalso(3, 3 * DIA, 10 * 60_000, false)] },
    { ...empresaDoTime(2, 'AM5173', 'Solimões Ltda', '45997418000153', '2026-10-27'), inativada_em: iso(agora - 20 * DIA), backups: [backupFalso(4, 9 * DIA, 10 * 60_000, true)] },
    { ...empresaDoTime(3, 'AM2290', 'Mercantil Rio Branco Ltda', '07526557000100', '2026-10-28'), inativada_em: iso(agora - 2 * DIA), backups: [backupFalso(5, DIA, 10 * 60_000, true)] },
  ];
}

/** Backup falso como a API devolve, na hora `agora`. */
function backupDaApi(tenant: string, b: BackupFalso, agora = Date.now()): BackupEmpresa {
  const pronto = agora >= b.termina_em;
  const base = { id: b.id, tenant_id: tenant, consistente: b.consistente, pedido_em: b.pedido_em, iniciado_em: b.pedido_em, expira_em: null, tabelas: null, linhas: null, arquivos: null };
  if (!pronto) return { ...base, situacao: 'em_andamento', concluido_em: null, progresso_pct: 40, tamanho_bytes: null, erro_codigo: null };
  if (b.falha) return { ...base, situacao: 'falhou', concluido_em: null, progresso_pct: 40, tamanho_bytes: null, erro_codigo: 'S3_FALHOU' };
  return { ...base, situacao: 'pronto', concluido_em: iso(b.termina_em), progresso_pct: 100, tamanho_bytes: 512_000, tabelas: 115, linhas: 1802, arquivos: 0, erro_codigo: null };
}

function exclusaoDaApi(x: EmpresaFalsa, agora = Date.now()): ExclusaoEmpresa | null {
  const f = x.exclusao;
  if (!f) return null;
  const fim = agora >= f.termina_em;
  return {
    id: f.id,
    tenant_id: x.id,
    codigo: x.codigo,
    backup_id: f.backup_id,
    situacao: fim ? 'concluida' : 'em_andamento',
    etapa: fim ? 'fim' : 'banco',
    pedida_em: f.pedida_em,
    concluida_em: fim ? iso(f.termina_em) : null,
    linhas_apagadas: fim ? 1802 : null,
    arquivos_apagados: fim ? 0 : null,
    erro_codigo: null,
  };
}
const excluida = (x: EmpresaFalsa) => exclusaoDaApi(x)?.situacao === 'concluida';

/** O último backup que conta (o que falhou não aparece: a célula fica no anterior). */
function ultimoBackup(x: EmpresaFalsa): BackupEmpresa | null {
  const lista = (x.backups ?? []).map((b) => backupDaApi(x.id, b)).filter((b) => b.situacao !== 'falhou');
  return lista.sort((a, b) => b.pedido_em.localeCompare(a.pedido_em))[0] ?? null;
}

/** Item da lista como a API (`EmpresaResumoSchema` com o bloco `acoes`). */
function resumoDaEmpresa(x: EmpresaFalsa) {
  const { inativada_em = null, backups: _b, exclusao: _x, ...resto } = x;
  const ultimo = ultimoBackup(x);
  const regra = conferirExclusao(
    { id: x.id, status: x.status as StatusEmpresa, inativada_em: inativada_em ? new Date(inativada_em) : null },
    ultimo ? { ...ultimo, iniciado_em: ultimo.iniciado_em ? new Date(ultimo.iniciado_em) : null, concluido_em: ultimo.concluido_em ? new Date(ultimo.concluido_em) : null } : null,
    new Date(),
  );
  const acoes: AcoesDaEmpresa = { inativada_em, motivo_inativacao: null, ultimo_backup: ultimo, exclusao: exclusaoDaApi(x), exclusao_bloqueada: regra.ok ? null : regra.codigo };
  return { ...resto, acoes };
}

/** Frase de cada recusa: a mesma tabela do SDK que a API usa (`MENSAGENS_ACOES_EMPRESA`; RD-0407, RD-0429). */
const fraseDaApi = (codigo: CodigoAcaoEmpresa): string => MENSAGENS_ACOES_EMPRESA[codigo];

const ACOES_M = /^\/plataforma\/empresas\/([^/]+)\/(inativar|reativar|backups|exclusao)(?:\/([^/]+))?$/;

/** Rotas das ações da empresa (ADR 0052 §4), só do time da Macuxi. */
function responderAcoes(metodo: string, tenant: string, acao: string, sub: string | undefined, sessao: SessaoFalsa, e: Estado, corpo: unknown): Response {
  if (sessao.tipo !== 'super_admin') return erro(403, 'PERFIL_SEM_ACESSO', MENSAGEM_SO_SUPER_ADMIN_ACOES);
  // a exclusão concluída continua legível (GET …/exclusao), como o registro da API
  const x = e.empresas.find((y) => y.id === tenant && (!excluida(y) || (acao === 'exclusao' && metodo === 'GET')));
  if (!x) return erro(404, CODIGOS_ACOES_EMPRESA.naoEncontrada, fraseDaApi(CODIGOS_ACOES_EMPRESA.naoEncontrada));
  const trocar = (f: (y: EmpresaFalsa) => EmpresaFalsa) => gravar({ ...e, empresas: e.empresas.map((y) => (y.id === tenant ? f(y) : y)) });
  const emExclusao = x.status === 'encerrado';
  if ((acao === 'inativar' || acao === 'reativar') && metodo === 'POST') {
    if (emExclusao) return erro(409, CODIGOS_ACOES_EMPRESA.exclusaoEmAndamento, fraseDaApi(CODIGOS_ACOES_EMPRESA.exclusaoEmAndamento));
    const alvo = acao === 'inativar' ? 'suspenso' : 'ativo';
    const mudou = x.status !== alvo;
    const inativada_em = alvo === 'suspenso' ? (mudou ? agoraIso() : (x.inativada_em ?? agoraIso())) : null;
    if (mudou) trocar((y) => ({ ...y, status: alvo, inativada_em }));
    return json(200, { tenant_id: tenant, status: alvo, inativada_em, motivo: null, resultado: mudou ? 'alterado' : 'sem_mudanca' });
  }
  if (acao === 'backups' && metodo === 'POST') {
    const c = lerCorpo(PedirBackupEmpresaSchema, corpo);
    if (c instanceof Response) return c;
    const mesmo = x.backups?.find((b) => b.id === c.id);
    if (mesmo) return json(202, backupDaApi(tenant, mesmo));
    if (emExclusao) return erro(409, CODIGOS_ACOES_EMPRESA.exclusaoEmAndamento, fraseDaApi(CODIGOS_ACOES_EMPRESA.exclusaoEmAndamento));
    if ((x.backups ?? []).some((b) => backupDaApi(tenant, b).situacao === 'em_andamento'))
      return erro(409, CODIGOS_ACOES_EMPRESA.backupEmAndamento, fraseDaApi(CODIGOS_ACOES_EMPRESA.backupEmAndamento));
    const b: BackupFalso = { id: c.id, pedido_em: agoraIso(), consistente: x.status === 'suspenso', termina_em: Date.now() + 6_000, falha: x.codigo === 'atacado-norte' };
    trocar((y) => ({ ...y, backups: [...(y.backups ?? []), b] }));
    return json(202, backupDaApi(tenant, b));
  }
  if (acao === 'backups' && metodo === 'GET') {
    const lista = (x.backups ?? []).map((b) => backupDaApi(tenant, b));
    if (!sub) return json(200, { itens: lista });
    const b = lista.find((y) => y.id === sub);
    return b ? json(200, b) : erro(404, 'BACKUP_NAO_ENCONTRADO', 'Backup não encontrado.');
  }
  if (acao === 'exclusao' && metodo === 'GET') {
    const ex = exclusaoDaApi(x);
    return ex ? json(200, ex) : erro(404, 'EXCLUSAO_NAO_ENCONTRADA', MENSAGEM_EXCLUSAO_NAO_ENCONTRADA);
  }
  if (acao === 'exclusao' && metodo === 'POST') {
    const c = lerCorpo(ExcluirEmpresaSchema, corpo);
    if (c instanceof Response) return c;
    if (x.exclusao) return erro(409, CODIGOS_ACOES_EMPRESA.exclusaoEmAndamento, fraseDaApi(CODIGOS_ACOES_EMPRESA.exclusaoEmAndamento));
    if (c.senha === 'errada') return erro(403, CODIGOS_ACOES_EMPRESA.reautenticacaoFalhou, fraseDaApi(CODIGOS_ACOES_EMPRESA.reautenticacaoFalhou));
    const b = (x.backups ?? []).find((y) => y.id === c.backup_id);
    const api = b ? backupDaApi(tenant, b) : null;
    const regra = conferirExclusao(
      { id: x.id, status: x.status as StatusEmpresa, inativada_em: x.inativada_em ? new Date(x.inativada_em) : null },
      api ? { ...api, iniciado_em: api.iniciado_em ? new Date(api.iniciado_em) : null, concluido_em: api.concluido_em ? new Date(api.concluido_em) : null } : null,
      new Date(),
    );
    if (!regra.ok) return erro(422, regra.codigo, fraseDaApi(regra.codigo));
    if (!codigoDeConfirmacaoConfere(c.codigo_confirmacao, x.codigo)) return erro(422, CODIGOS_ACOES_EMPRESA.exclusaoCodigoNaoConfere, fraseDaApi(CODIGOS_ACOES_EMPRESA.exclusaoCodigoNaoConfere));
    const f: ExclusaoFalsa = { id: c.id, backup_id: c.backup_id, pedida_em: agoraIso(), termina_em: Date.now() + 6_000 };
    trocar((y) => ({ ...y, status: 'encerrado', exclusao: f }));
    return json(202, exclusaoDaApi({ ...x, status: 'encerrado', exclusao: f }));
  }
  return erro(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
}

/** Contas falsas por e-mail: `null` = time da Macuxi; lista = admin do cliente nessas empresas (por nome). */
export const CONTAS_FALSAS: Readonly<Record<string, readonly string[] | null>> = Object.freeze({
  'time@macuxi.com.br': null,
  'admin@uma.com.br': ['0b6f1a52-5c1e-4c4e-9a43-000000000001'],
  'admin@duas.com.br': ['0b6f1a52-5c1e-4c4e-9a43-000000000002', '0b6f1a52-5c1e-4c4e-9a43-000000000003'],
});

/** Conta falsa com a senha certa, mas ainda temporária: o portal responde 403 `SENHA_A_TROCAR` (T-0094). */
export const CONTA_SENHA_A_TROCAR = 'troca@uma.com.br';

/** E-mails já gravados pela Equipe por CSV, por empresa: só na memória da aba (nada de e-mail no `sessionStorage`). */
const equipeFalsa = new Map<string, Set<string>>();

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

const vazio = (): Estado => ({ sessoes: {}, empresas: empresasIniciais(), conectores: {}, lotes: {} });

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

const NL = String.fromCharCode(10);

/** BOM do UTF-8 (o Excel abre o CSV sem perguntar a codificação). */
const BOM = String.fromCharCode(0xfeff);
const BOM_INICIO = new RegExp(`^${BOM}`);

function linhasDoCsv(texto: string): string[][] {
  const linhas = texto.replace(BOM_INICIO, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const sep = (linhas[0] ?? '').includes(';') ? ';' : ',';
  return linhas.map((l) => l.split(sep));
}

/** Erros de linha do modo falso: sem `external_id` na 1ª coluna, ou com a palavra "erro". */
function errosFalsos(texto: string, linhaInicial = 2): { total: number; erros: LinhaErro[] } {
  const [, ...dados] = linhasDoCsv(texto);
  const erros: LinhaErro[] = [];
  dados.forEach((cols, i) => {
    const id = (cols[0] ?? '').trim();
    const n = linhaInicial + i;
    if (!id) erros.push({ indice: i, external_id: null, codigo: 'campo_obrigatorio', campo: 'external_id', mensagem: `Linha ${n} do arquivo: external_id é obrigatório.`, reprocessavel: false, origem: 'hub' });
    else if (cols.join(' ').toLowerCase().includes('erro')) erros.push({ indice: i, external_id: id, codigo: 'formato_invalido', campo: cols.length > 1 ? 'nome' : null, mensagem: `Linha ${n} do arquivo: valor em formato inválido (exemplo do modo falso).`, reprocessavel: false, origem: 'hub' });
  });
  return { total: dados.length, erros };
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

function statusDoLote(l: LoteFalso): LoteResultado {
  if (Date.now() < l.pronto_em) return { ...l.resultado, status: Date.now() < l.pronto_em - 1000 ? 'recebido' : 'processando', concluido_em: null };
  return l.resultado;
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
    const base: Estado = { ...e, empresas: [...e.empresas, ...empresasIniciais().filter((x) => !e.empresas.some((y) => y.id === x.id))] };
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
  if (rota === `GET ${ROTAS_PORTAL.empresas}`) {
    const vivas = e.empresas.filter((x) => !excluida(x)).map(resumoDaEmpresa);
    return json(200, { itens: sessao.tipo === 'super_admin' ? vivas : vivas.filter((x) => sessao.empresas.includes(x.id)) });
  }
  const acaoM = ACOES_M.exec(caminho);
  if (acaoM) return responderAcoes(metodo, decodeURIComponent(acaoM[1] ?? ''), acaoM[2] ?? '', acaoM[3] ? decodeURIComponent(acaoM[3]) : undefined, sessao, e, corpo);
  if (rota === `POST ${ROTAS_PORTAL.empresas}`) {
    if (sessao.tipo !== 'super_admin') return erro(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi cadastra empresas.');
    const c = lerCorpo(CriarEmpresaSchema, corpo);
    if (c instanceof Response) return c;
    const jaExiste = e.empresas.some((x) => x.codigo === c.codigo);
    // RN-CORE-34 e RN-CORE-32 como a API: empresa nova sem admin = 422; senha fora da regra do Core = 422 com as faltas
    if (!jaExiste && !c.admin) return erro(422, 'RN-CORE-34', 'Informe o administrador da empresa.', { campo: 'admin' });
    if (!jaExiste && c.admin) {
      const faltas = faltasNaSenha(c.admin.senha);
      const m = mensagemDaSenha(faltas, c.admin.senha);
      if (m) return erro(422, 'RN-CORE-32', m, { campo: 'admin.senha', faltas });
    }
    const modulos = [...new Map([{ modulo: 'core', licencas: null }, { modulo: 'integracao', licencas: null }, ...c.modulos].map((m) => [m.modulo, m])).values()];
    const existente = e.empresas.find((x) => x.codigo === c.codigo);
    const adicionados = modulos.filter((m) => !existente?.modulos.some((x) => x.modulo === m.modulo)).map((m) => m.modulo);
    const resposta = {
      tenant_id: c.simular ? (existente?.id ?? null) : (existente?.id ?? crypto.randomUUID()),
      codigo: c.codigo,
      resultado: existente ? (adicionados.length ? 'atualizado' : 'sem_mudanca') : 'criado',
      modulos_adicionados: adicionados,
      parametros_gravados: existente ? [] : linhasDosParametrosIniciais(c.parametros).map((l) => l.chave),
      avisos: existente ? ['A empresa já existe: razão social e fuso não mudam.'] : [],
      admin: existente ? (c.admin ? 'existente' : null) : 'criado',
      simulado: c.simular,
    };
    if (!c.simular) {
      const lista = existente
        ? e.empresas.map((x) => (x.id === existente.id ? { ...x, modulos: [...x.modulos, ...modulos.filter((m) => adicionados.includes(m.modulo))] } : x))
        : [...e.empresas, { id: resposta.tenant_id as string, codigo: c.codigo, razao_social: c.razao_social, cnpj: c.cnpj, fuso: c.fuso, status: 'ativo', criada_em: agoraIso(), modulos }];
      gravar({ ...e, empresas: lista });
      // o admin inicial da empresa nova entra na lista de admins (só na memória), com a troca pendente (RN-CORE-34)
      if (!existente && c.admin && resposta.tenant_id) {
        adminsFalsos.set(resposta.tenant_id, [
          { usuario_id: crypto.randomUUID(), nome: c.admin.nome, email: c.admin.email, ativo: true, bloqueado: false, tem_senha: true, trocar_senha: true, senha_expira_em: null, entra_no_portal: true },
        ]);
      }
    }
    return json(c.simular ? 200 : 201, resposta);
  }

  const adminsM = ADMINS_M.exec(caminho);
  if (adminsM) return responderAdmins(metodo, decodeURIComponent(adminsM[1] ?? ''), adminsM[2] ? decodeURIComponent(adminsM[2]) : undefined, sessao, e, corpo);

  // ---------- rotas de módulo (com tenant): o admin do cliente só na empresa escolhida (desenho T-0093 §4)
  if (sessao.tipo === 'admin_cliente') {
    if (!sessao.empresa) return erro(409, 'EMPRESA_NAO_ESCOLHIDA', 'Escolha a empresa para continuar.');
    if (tenant !== sessao.empresa) return erro(403, 'EMPRESA_NAO_PERMITIDA', 'Você não tem acesso a esta empresa. Escolha outra.');
  }
  if (!tenant || !e.empresas.some((x) => x.id === tenant)) return erro(404, 'TENANT_NAO_ENCONTRADO', 'Empresa não encontrada ou inativa.');
  if (rota === `GET ${ROTAS_PORTAL.ordemCarga}`) {
    return json(200, { itens: ORDEM.map((entidade, i) => ({ entidade, posicao: i + 1, opcional: entidade === 'titulo' || entidade === 'nota', depende_de: [] })) });
  }
  if (rota === `POST ${ROTAS_PORTAL.conferirArquivo}`) {
    const c = lerCorpo(ConferirArquivoEntrada, corpo);
    if (c instanceof Response) return c;
    const r = errosFalsos(c.conteudo, c.linha_inicial ?? 2);
    const comErro = new Set(r.erros.map((x) => x.indice)).size;
    return json(200, { entidade: c.entidade, modo: c.modo ?? 'delta', linhas_lidas: r.total, linhas_validas: r.total - comErro, linhas_com_erro: comErro, erros: r.erros.slice(0, 200), erros_omitidos: Math.max(0, r.erros.length - 200), pode_gravar: comErro === 0, gravou: false });
  }
  if (rota === `POST ${ROTAS_PORTAL.cargaArquivo}`) {
    const c = lerCorpo(CargaArquivoEntrada, corpo);
    if (c instanceof Response) return c;
    const conectores = e.conectores[tenant] ?? [];
    const dono = conectores.find((x) => x.tipo === 'arquivo' && x.entidades.includes(c.entidade as Entidade));
    if (!dono) return erro(404, 'CONECTOR_NAO_ENCONTRADO', 'Esta empresa ainda não tem um Conector de arquivo para esta base.');
    const r = errosFalsos(c.conteudo, c.linha_inicial ?? 2);
    const id = crypto.randomUUID();
    const comErro = new Set(r.erros.map((x) => x.indice)).size;
    const resultado: LoteResultado = {
      lote_id: id,
      entidade: c.entidade as Entidade,
      modo: (c.modo ?? 'delta') as LoteResultado['modo'],
      status: comErro ? 'concluido_com_erros' : 'concluido',
      contagens: { recebidas: r.total, duplicadas_no_lote: 0, com_erro: comErro, novas: r.total - comErro, atualizadas: 0, inalteradas: 0, obsoletas: 0 },
      erros: r.erros,
      avisos: [],
      cursor: null,
      inativadas: 0,
      erros_total: r.erros.length,
      recebido_em: agoraIso(),
      concluido_em: agoraIso(),
    };
    gravar({ ...e, lotes: { ...e.lotes, [id]: { tenant, resultado, sessao: c.sessao_id ?? null, parte: c.parte ?? 1, total: c.total_partes ?? 1, pronto_em: Date.now() + 2500 } } });
    return json(202, {
      lote_id: id,
      status: 'recebido',
      entidade: c.entidade,
      modo: c.modo ?? 'delta',
      recebidos: Math.max(1, r.total),
      consulta: `/v1/integracao/lotes/${id}`,
      conector_id: dono.conector_id,
      linhas_lidas: Math.max(1, r.total),
      linhas_invalidas_leitura: 0,
      ...(c.sessao_id ? { sessao: { id: c.sessao_id, parte: c.parte, total_partes: c.total_partes, consulta: `/v1/integracao/cargas-arquivo/sessoes/${c.sessao_id}` } } : {}),
    });
  }
  const sessaoM = /^\/integracao\/cargas-arquivo\/sessoes\/([^/]+)$/.exec(caminho);
  if (metodo === 'GET' && sessaoM) {
    const partes = Object.values(e.lotes).filter((l) => l.sessao === sessaoM[1]);
    const p0 = partes[0];
    if (!p0) return erro(404, 'SESSAO_NAO_ENCONTRADA', 'Sessão de carga não encontrada.');
    const prontas = partes.filter((l) => Date.now() >= l.pronto_em);
    const soma = (k: 'recebidas' | 'com_erro' | 'novas' | 'atualizadas' | 'inalteradas' | 'obsoletas') => partes.reduce((a, l) => a + l.resultado.contagens[k], 0);
    const faltando = Array.from({ length: p0.total }, (_, i) => i + 1).filter((n) => !partes.some((l) => l.parte === n));
    return json(200, {
      sessao_id: sessaoM[1],
      entidade: p0.resultado.entidade,
      modo: p0.resultado.modo,
      total_partes: p0.total,
      situacao: faltando.length === 0 && prontas.length === partes.length ? 'completa' : 'aberta',
      partes_recebidas: partes.length,
      partes_aplicadas: prontas.length,
      partes_com_falha: 0,
      partes_faltando: faltando,
      partes: partes.map((l) => ({ parte: l.parte, lote_id: l.resultado.lote_id, status: statusDoLote(l).status, ...l.resultado.contagens })).map(({ duplicadas_no_lote: _d, ...x }) => x),
      contagens: { recebidas: soma('recebidas'), com_erro: soma('com_erro'), novas: soma('novas'), atualizadas: soma('atualizadas'), inalteradas: soma('inalteradas'), obsoletas: soma('obsoletas') },
      erros_total: partes.reduce((a, l) => a + l.resultado.erros.length, 0),
      iniciada_em: p0.resultado.recebido_em,
      expira_em: agoraIso(24 * 60),
    });
  }
  const loteM = /^\/integracao\/lotes\/([^/]+?)(\/erros(\.csv)?)?$/.exec(caminho);
  if (metodo === 'GET' && loteM) {
    const l = e.lotes[loteM[1] ?? ''];
    if (!l || l.tenant !== tenant) return erro(404, 'LOTE_NAO_ENCONTRADO', 'Lote não encontrado.');
    if (loteM[3]) {
      const csv = ['linha_do_lote;external_id;codigo;campo;reprocessavel;mensagem', ...l.resultado.erros.map((x) => [x.indice + 1, x.external_id ?? '', x.codigo, x.campo ?? '', x.reprocessavel ? 'sim' : 'nao', x.mensagem].join(';'))].join('\r\n');
      return new Response(`${BOM}${csv}\r\n`, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="erros-${l.resultado.lote_id}.csv"` } });
    }
    if (loteM[2]) return json(200, { itens: l.resultado.erros, total: l.resultado.erros.length });
    return json(200, statusDoLote(l));
  }
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
  const conectorM = /^\/integracao\/conectores\/([^/]+)$/.exec(caminho);
  if (metodo === 'PATCH' && conectorM) {
    const lista = e.conectores[tenant] ?? [];
    if (!lista.some((x) => x.id === conectorM[1])) return erro(404, 'CONECTOR_NAO_ENCONTRADO', 'Conector não encontrado.');
    const ativo = (corpo as { ativo?: boolean } | null)?.ativo;
    const nova = lista.map((x) => (x.id === conectorM[1] && typeof ativo === 'boolean' ? { ...x, ativo, saude: ativo ? x.saude : ('desativado' as const) } : x));
    gravar({ ...e, conectores: { ...e.conectores, [tenant]: nova } });
    return json(200, nova.find((x) => x.id === conectorM[1]));
  }
  // ---------- Equipe por CSV (Core): linha sem e-mail ou com perfil fora da lista vira erro; cada pessoa nova recebe o acesso por e-mail
  //            (T-0094); arquivo com alguém em `@sem-email.` simula o 503 EMAIL_INDISPONIVEL no gravar
  if (rota === `GET ${ROTAS_PORTAL.equipeModeloCsv}`) {
    const csv = ['nome,email,telefone,perfil,email_superior,codigo_erp,modulos', 'Ana Souza,ana.souza@empresa.com.br,95991112222,supervisor,,,', 'Bruno Dias,bruno.dias@empresa.com.br,,vendedor,ana.souza@empresa.com.br,V0042,vendedor', ''].join(NL);
    return new Response(csv, { status: 200, headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="modelo-equipe.csv"' } });
  }
  if (rota === `POST ${ROTAS_PORTAL.equipeImportacoes}`) {
    const c = lerCorpo(ImportarEquipeRequestSchema, corpo);
    if (c instanceof Response) return c;
    if (c.modo === 'gravar' && /@sem-email\./i.test(c.csv)) return erro(503, 'EMAIL_INDISPONIVEL', 'O envio de e-mail não está configurado. Fale com o suporte da Macuxi.');
    return json(200, importarEquipeFalsa(tenant, c.csv, c.modo));
  }
  // N1/N2 (nuvem) ainda não existem: igual à API real antes do merge
  return erro(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
}

function importarEquipeFalsa(tenant: string, csv: string, modo: 'conferir' | 'gravar'): ImportarEquipeResposta {
  const [cab = [], ...dados] = linhasDoCsv(csv);
  const col = (nome: string) => cab.findIndex((x) => x.trim().toLowerCase() === nome);
  const [iNome, iEmail, iPerfil, iSup] = [col('nome'), col('email'), col('perfil'), col('email_superior')];
  const existentes = equipeFalsa.get(tenant) ?? new Set<string>();
  const erros: ImportarEquipeResposta['erros'] = [];
  const plano: ImportarEquipeResposta['plano'] = [];
  dados.forEach((cols, i) => {
    const linha = i + 2;
    const email = (cols[iEmail] ?? '').trim().toLowerCase();
    const perfil = PerfilSchema.safeParse((cols[iPerfil] ?? '').trim().toLowerCase());
    if (!email.includes('@')) erros.push({ linha, coluna: 'email', mensagem: `Linha ${linha}: informe um e-mail válido, como nome@empresa.com.br.` });
    else if (!perfil.success) erros.push({ linha, coluna: 'perfil', mensagem: `Linha ${linha}: perfil fora da lista (admin, gerente, supervisor, vendedor, promotor...).` });
    else plano.push({ linha, acao: existentes.has(email) ? 'sem_mudanca' : 'criar', usuario_id: null, email, nome: (cols[iNome] ?? '').trim(), perfil: perfil.data, superior_email: (cols[iSup] ?? '').trim() || null, external_id: null, modulos_removidos: [] });
  });
  const comErro = new Set(erros.map((x) => x.linha)).size;
  const resumo = { total: dados.length, novos: plano.filter((p) => p.acao === 'criar').length, atualizados: 0, sem_mudanca: plano.filter((p) => p.acao === 'sem_mudanca').length, com_erro: comErro };
  const erros_csv = erros.length ? ['linha,coluna,mensagem', ...erros.map((x) => `${x.linha},${x.coluna},"${x.mensagem.replace(/"/g, '""')}"`)].join(NL) + NL : '';
  const base = { modo, resumo, erros, avisos: [], plano, erros_csv, acessos_enviados: 0, email_acesso: null };
  if (modo === 'conferir' || erros.length) return { ...base, gravado: false };
  const novos = plano.filter((p) => p.acao === 'criar').map((p) => p.email);
  equipeFalsa.set(tenant, new Set([...existentes, ...novos]));
  return { ...base, gravado: true, acessos_enviados: novos.length, email_acesso: novos.length > 0 ? 'enfileirado' : null };
}

/** Para os testes e para "recomeçar" o modo falso. */
export function zerarModoFalso() {
  falhas.clear();
  equipeFalsa.clear();
  adminsFalsos.clear();
  adminsSemeados = false;
  redefinicoesFalsas.clear();
  gravar(vazio());
}
