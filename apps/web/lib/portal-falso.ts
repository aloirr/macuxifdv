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
 * Admins da empresa (T-0094 fatia S, só o time da Macuxi): na Distribuidora Uma, um admin normal, um bloqueado, um em
 * `@sem-email.` (o redefinir dele responde 503 `EMAIL_INDISPONIVEL`, como a API sem e-mail configurado) e um admin + vendedor
 * (`entra_no_portal = false`, migração 0047, RN-CORE-35); nas outras, o admin
 * inicial com a troca pendente. Só na memória da aba (nada de e-mail no `sessionStorage`).
 * Backup, Inativar e Excluir (ADR 0052; spec portal-config-enxuto §15.3): as empresas começam nos estados da simulação
 * `depois-02b` (ativa com backup, ativa sem backup, inativa com backup em andamento, anterior à inativação, vencido e válido).
 * O backup leva 6 s; o da Atacado Norte sempre falha. A exclusão leva 6 s; a senha `errada` dá 403 `REAUTENTICACAO_FALHOU`.
 * A liberação do Excluir é a `conferirExclusao` do SDK, a mesma da API.
 * Planos e licenças (ADR 0047): catálogo de `portal-planos.fixture.ts`; a Distribuidora Uma (PME em teste, 14 vendedores em uso)
 * recusa a troca para o Light (422 `PLANO_ABAIXO_DO_USO`); a Mercado Caracaraí não tem plano (404 `SEM_ASSINATURA`).
 * CNPJ pela Receita (ADR 0048): todo CNPJ válido é encontrado e ativo, menos os gatilhos de `CNPJS_GATILHO_FALSO`
 * (não encontrado = 404, Receita fora = 503, baixado = encontrado, mas o criar responde 422 `CNPJ_INATIVO`).
 */
import {
  CODIGOS_ACOES_EMPRESA,
  MENSAGENS_ACOES_EMPRESA,
  MENSAGEM_EXCLUSAO_NAO_ENCONTRADA,
  MENSAGEM_SO_SUPER_ADMIN_ACOES,
  conferirLogo,
  CODIGOS_CNPJ,
  ConsultaCnpjPedidoSchema,
  ConsultaCnpjRespostaSchema,
  conferirEscolhaDePlano,
  conferirTrocaDePlano,
  CriarEmpresaComPlanoSchema,
  CriarEmpresaSchema,
  fimDoTeste,
  modulosDaAssinatura,
  ROTA_PORTAL_CNPJ,
  ROTA_PORTAL_EMPRESA_COM_PLANO,
  ROTA_PORTAL_PLANOS,
  TrocarPlanoSchema,
  usoPorItem,
  valorDaAssinatura,
  type AdicionalContratado,
  type Ciclo,
  type ConsultaCnpjResposta,
  type CriarEmpresa,
  type FichaAssinatura,
  type ItemContado,
  type ProblemaDePlano,
  type SituacaoCadastral,
  ExcluirEmpresaSchema,
  PedirBackupEmpresaSchema,
  codigoDeConfirmacaoConfere,
  conferirExclusao,
  type AcoesDaEmpresa,
  type BackupEmpresa,
  type CodigoAcaoEmpresa,
  type ExclusaoEmpresa,
  type StatusEmpresa,
  FRASES_CARGA_INICIAIS,
  FraseCargaAlteracaoSchema,
  FraseCargaEntradaSchema,
  ordenarFrasesDoPortal,
  validarTextoFrase,
  type FraseCarga,
  EscolherEmpresaPortalSchema,
  GravarNomeFantasiaSchema,
  GravarOcultarMarcaMacuxiSchema,
  MENSAGENS_ACESSO_LOGO,
  MENSAGENS_LOGO,
  LoginPortalSchema,
  RedefinirSenhaAdminSchema,
  SessaoPortalSchema,
  linhasDosParametrosIniciais,
  type AdminDaEmpresa,
  type EmpresaLogo,
  type MarcaEmpresa,
  type RedefinirSenhaAdminResposta,
} from '@macuxi/platform-sdk';
import { ConectorAtualizar, ConectorCriar, type ConectorResumo, type Entidade } from '@macuxi/integracao/contracts';
import { localIsoDate } from '@macuxi/comum/fuso';

import { CODIGOS_PORTAL, faltasNaSenha, mensagemBloqueioPorTentativas, mensagemDaSenha, MENSAGEM_PORTAL_SENHA_A_TROCAR } from '@macuxi/core/contracts';

import { fichaExemplo, PLANOS_EXEMPLO } from './portal-planos.fixture';
import { GUIA_PDF_HUB, OPENAPI_HUB, ROTAS_PORTAL, semV1 } from './portal-rotas';

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
  /** Planos (0071): nome do plano e `em_teste` (a API calcula; aqui fixo). */
  plano?: string | null;
  em_teste?: boolean;
  /** ADR 0052 (só no modo falso; a lista devolve no bloco `acoes`). */
  inativada_em?: string | null;
  backups?: BackupFalso[];
  exclusao?: ExclusaoFalsa | null;
  /** ADR 0047: assinatura (sem = 404 `SEM_ASSINATURA`, como as empresas de antes dos planos). */
  assinatura?: AssinaturaFalsa | null;
}
/** Assinatura falsa: o que a `sa_*` guarda, mais o uso por item (a API conta os usuários; aqui fixo). */
interface AssinaturaFalsa {
  plano: string;
  ciclo: Ciclo;
  adicionais: AdicionalContratado[];
  teste_ate: string | null;
  paga: boolean;
  em_uso: Partial<Record<ItemContado, number>>;
  desde: string;
  atualizada_em: string;
  /** Último `pedido_id` gravado (repetir = mesma resposta, nada muda). */
  pedido_id: string | null;
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
}

/** Empresas dos admins do cliente falsos (ids fixos: o F5 e os testes acham as mesmas). */
const assinaturaFalsa = (plano: string, x: Partial<AssinaturaFalsa> = {}): AssinaturaFalsa => ({
  plano,
  ciclo: 'mensal',
  adicionais: [],
  teste_ate: null,
  paga: true,
  em_uso: { vendedor: 3, gestor: 1, bko: 1 },
  desde: '2026-11-01T12:00:00.000Z',
  atualizada_em: '2026-11-01T12:00:00.000Z',
  pedido_id: null,
  ...x,
});
const EMPRESAS_DOS_CLIENTES: EmpresaFalsa[] = [
  { id: '0b6f1a52-5c1e-4c4e-9a43-000000000001', codigo: 'distribuidora-uma', razao_social: 'Distribuidora Uma Ltda', cnpj: '11222333000181', fuso: 'America/Manaus', status: 'ativo', criada_em: '2026-11-01T12:00:00.000Z', modulos: [{ modulo: 'core', licencas: null }, { modulo: 'vendedor', licencas: 10 }, { modulo: 'integracao', licencas: null }], plano: 'PME', em_teste: false },
  { id: '0b6f1a52-5c1e-4c4e-9a43-000000000002', codigo: 'atacado-norte', razao_social: 'Atacado Norte S.A.', cnpj: '04252011000110', fuso: 'America/Manaus', status: 'ativo', criada_em: '2026-11-02T12:00:00.000Z', modulos: [{ modulo: 'core', licencas: null }, { modulo: 'vendedor', licencas: 25 }, { modulo: 'integracao', licencas: null }], plano: 'Light', em_teste: false },
  { id: '0b6f1a52-5c1e-4c4e-9a43-000000000003', codigo: 'comercial-boa-vista', razao_social: 'Comercial Boa Vista Ltda', cnpj: '33000167000101', fuso: 'America/Boa_Vista', status: 'ativo', criada_em: '2026-11-03T12:00:00.000Z', modulos: [{ modulo: 'core', licencas: null }, { modulo: 'promotor', licencas: 5 }, { modulo: 'integracao', licencas: null }], plano: 'Enterprise', em_teste: true },
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
  plano: 'Light',
  em_teste: false,
});

/** Empresas do começo, nos estados da simulação `depois-02b` (datas relativas a agora). */
function empresasIniciais(): EmpresaFalsa[] {
  const agora = Date.now();
  const [uma, norte, boaVista] = EMPRESAS_DOS_CLIENTES as [EmpresaFalsa, EmpresaFalsa, EmpresaFalsa];
  return [
    {
      ...uma,
      inativada_em: null,
      backups: [backupFalso(1, 20 * HORA, 5 * 60_000, false)],
      assinatura: assinaturaFalsa('pme', {
        adicionais: [
          { adicional: 'promotor', quantidade: 3 },
          { adicional: 'pesquisa', quantidade: 10 },
        ],
        teste_ate: localIsoDate(agora + 5 * DIA, uma.fuso),
        paga: false,
        em_uso: { vendedor: 14, gestor: 2, bko: 1, promotor: 3, pesquisa: 6 },
      }),
    },
    { ...norte, inativada_em: null, backups: [], assinatura: assinaturaFalsa('light', { em_uso: { vendedor: 8, gestor: 1, bko: 1 } }) },
    {
      ...boaVista,
      status: 'suspenso',
      inativada_em: iso(agora - 2 * DIA),
      backups: [{ ...backupFalso(2, 5 * 60_000, 2 * HORA, true) }],
      assinatura: assinaturaFalsa('enterprise', { teste_ate: localIsoDate(agora + 10 * DIA, boaVista.fuso), paga: false }),
    },
    // sem plano: a ficha responde 404 `SEM_ASSINATURA` (aba Empresa com os "Módulos licenciados")
    { ...empresaDoTime(1, 'RR4410', 'Mercado Caracaraí Ltda', '19131243000197', '2026-10-29'), plano: null, inativada_em: iso(agora - DIA), backups: [backupFalso(3, 3 * DIA, 10 * 60_000, false)] },
    { ...empresaDoTime(2, 'AM5173', 'Solimões Ltda', '45997418000153', '2026-10-27'), inativada_em: iso(agora - 20 * DIA), backups: [backupFalso(4, 9 * DIA, 10 * 60_000, true)], assinatura: assinaturaFalsa('light') },
    { ...empresaDoTime(3, 'AM2290', 'Mercantil Rio Branco Ltda', '07526557000100', '2026-10-28'), inativada_em: iso(agora - 2 * DIA), backups: [backupFalso(5, DIA, 10 * 60_000, true)], assinatura: assinaturaFalsa('light') },
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
  const { inativada_em = null, backups: _b, exclusao: _x, assinatura: a, ...resto } = x;
  // o nome do plano e o selo "teste" saem da assinatura, como a API
  const doPlano = a ? { plano: PLANOS_EXEMPLO.find((p) => p.codigo === a.plano)?.nome ?? null, em_teste: a.teste_ate !== null && !a.paga } : {};
  const ultimo = ultimoBackup(x);
  const regra = conferirExclusao(
    { id: x.id, status: x.status as StatusEmpresa, inativada_em: inativada_em ? new Date(inativada_em) : null },
    ultimo ? { ...ultimo, iniciado_em: ultimo.iniciado_em ? new Date(ultimo.iniciado_em) : null, concluido_em: ultimo.concluido_em ? new Date(ultimo.concluido_em) : null } : null,
    new Date(),
  );
  const acoes: AcoesDaEmpresa = { inativada_em, motivo_inativacao: null, ultimo_backup: ultimo, exclusao: exclusaoDaApi(x), exclusao_bloqueada: regra.ok ? null : regra.codigo };
  return { ...resto, ...doPlano, acoes };
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
/** RN-CORE-31: o falso não conta o tempo do bloqueio (só o `zerarModoFalso` solta); responde sempre os 15 min inteiros. */
const MINUTOS_BLOQUEIO_FALSO = 15;

const ADMINS_M = /^\/plataforma\/empresas\/([^/]+)\/admins(?:\/([^/]+)\/redefinir-senha)?$/;

const MARCA_M = /^\/plataforma\/empresas\/([^/]+)\/(marca|logo|marca\/ocultar-macuxi)$/;
/** T-0182: nome fantasia e logo por empresa, só na memória da aba (o `sessionStorage` não guarda bytes); item 15: ocultar a marca. */
const marcasFalsas = new Map<string, { nome_fantasia: string | null; logo: { bytes: Blob; resumo: EmpresaLogo } | null; ocultar_marca_macuxi: boolean }>();

/**
 * `GET|PUT .../marca`, `GET|PUT|DELETE .../logo` e `PUT .../marca/ocultar-macuxi` como a API (T-0182 e item 15): ler = time da
 * Macuxi ou o admin da empresa; gravar = só o time.
 */
async function responderMarca(metodo: string, tenant: string, alvo: 'marca' | 'logo' | 'ocultar', sessao: SessaoFalsa, e: Estado, corpo: unknown): Promise<Response> {
  const empresa = e.empresas.find((x) => x.id === tenant);
  if (!empresa) return erro(404, 'TENANT_NAO_ENCONTRADO', 'Empresa não encontrada.');
  if (sessao.tipo === 'admin_cliente' && sessao.empresa !== tenant) return erro(403, 'PERFIL_SEM_ACESSO', MENSAGENS_ACESSO_LOGO.leitura);
  if (metodo !== 'GET' && sessao.tipo !== 'super_admin') return erro(403, 'PERFIL_SEM_ACESSO', MENSAGENS_ACESSO_LOGO.escrita);
  const atual = marcasFalsas.get(tenant) ?? { nome_fantasia: null, logo: null, ocultar_marca_macuxi: false };
  const responder = (m: typeof atual) => {
    marcasFalsas.set(tenant, m);
    const r: MarcaEmpresa = { tenant_id: tenant, razao_social: empresa.razao_social, nome_fantasia: m.nome_fantasia, logo: m.logo?.resumo ?? null, ocultar_marca_macuxi: m.ocultar_marca_macuxi };
    return json(200, r);
  };
  if (alvo === 'ocultar') {
    const c = lerCorpo(GravarOcultarMarcaMacuxiSchema, corpo);
    if (c instanceof Response) return c;
    return responder({ ...atual, ocultar_marca_macuxi: c.ocultar });
  }
  if (alvo === 'marca') {
    if (metodo === 'GET') return responder(atual);
    const c = lerCorpo(GravarNomeFantasiaSchema, corpo);
    if (c instanceof Response) return c;
    return responder({ ...atual, nome_fantasia: c.nome_fantasia });
  }
  if (metodo === 'GET') {
    if (!atual.logo) return erro(404, 'LOGO_NAO_ENCONTRADA', MENSAGENS_LOGO.LOGO_NAO_ENCONTRADA);
    return new Response(atual.logo.bytes, { status: 200, headers: { 'content-type': atual.logo.resumo.tipo } });
  }
  if (metodo === 'DELETE') return responder({ ...atual, logo: null });
  const arquivo = corpo instanceof Blob ? corpo : new Blob([]);
  const bytes = new Uint8Array(await arquivo.arrayBuffer());
  const c = conferirLogo(bytes, arquivo.type);
  if (!c.ok) return erro(c.status, c.codigo, MENSAGENS_LOGO[c.codigo]);
  const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const resumo: EmpresaLogo = { sha256, tipo: c.tipo, tamanho_bytes: bytes.length, largura_px: c.largura_px, altura_px: c.altura_px, atualizada_em: agoraIso() };
  return responder({ ...atual, logo: { bytes: new Blob([bytes], { type: c.tipo }), resumo } });
}

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

/** T-0181: frases da carga (só na memória da aba), como a API: só o time da Macuxi; sem DELETE. */
const frasesFalsas = new Map<string, FraseCarga>();
const FRASE_M = /^\/plataforma\/frases-carga\/([^/]+)$/;

function responderFrases(metodo: string, id: string | undefined, sessao: SessaoFalsa, corpo: unknown): Response {
  if (sessao.tipo !== 'super_admin') return erro(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi cuida das frases da carga.');
  if (frasesFalsas.size === 0) for (const f of FRASES_CARGA_INICIAIS) frasesFalsas.set(f.id, { ...f });
  const lista = [...frasesFalsas.values()];
  const recusa = (codigo: string, mensagem: string) => erro(422, codigo, mensagem);
  if (metodo === 'GET' && !id) return json(200, { itens: ordenarFrasesDoPortal(lista) });
  if (metodo === 'POST' && !id) {
    const c = lerCorpo(FraseCargaEntradaSchema, corpo);
    if (c instanceof Response) return c;
    const novoId = c.id ?? crypto.randomUUID();
    const r = validarTextoFrase(c.texto, lista, novoId);
    if (!r.ok) return recusa(r.codigo, r.mensagem);
    const existente = frasesFalsas.get(novoId);
    if (existente) return json(201, existente);
    const numero = Math.max(0, ...lista.map((f) => f.numero)) + 1;
    const nova: FraseCarga = { id: novoId, numero, texto: r.texto, ativa: true, ordem: Math.max(0, ...lista.map((f) => f.ordem)) + 1 };
    frasesFalsas.set(novoId, nova);
    return json(201, nova);
  }
  if (metodo === 'PATCH' && id) {
    const c = lerCorpo(FraseCargaAlteracaoSchema, corpo);
    if (c instanceof Response) return c;
    const atual = frasesFalsas.get(id);
    if (!atual) return erro(404, 'FRASE_NAO_ENCONTRADA', 'Frase não encontrada.');
    let texto = atual.texto;
    if (c.texto !== undefined) {
      const r = validarTextoFrase(c.texto, lista, id);
      if (!r.ok) return recusa(r.codigo, r.mensagem);
      texto = r.texto;
    }
    const nova = { ...atual, texto, ativa: c.ativa ?? atual.ativa };
    frasesFalsas.set(id, nova);
    return json(200, nova);
  }
  return erro(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
}

// ---------------------------------------------------------------------------------------------------------- planos (ADR 0047)

const ASSINATURA_M = /^\/plataforma\/empresas\/([^/]+)\/assinatura$/;
const SEM_ASSINATURA = () => erro(404, 'SEM_ASSINATURA', 'Esta empresa ainda não tem plano.');
const PLANO_DESCONHECIDO = () => erro(422, 'PLANO_DESCONHECIDO', 'Plano não encontrado no catálogo.', { campo: 'plano' });

/** 422 com a lista de problemas (RN-PLA-05), como o `recusar` da API: o código e a frase do primeiro, todos em `detalhes`. */
function recusarPlano(problemas: readonly ProblemaDePlano[]): Response {
  const [primeiro] = problemas;
  return erro(422, primeiro?.codigo ?? 'VALIDACAO', primeiro?.mensagem ?? 'Plano inválido.', { problemas: problemas.map((p) => ({ ...p })) });
}

/** Ficha como a API monta (`fichaExemplo`: licenças na ordem de `ITENS_CONTADOS`, valor pelo `valorDaAssinatura`). */
function fichaDaEmpresa(x: EmpresaFalsa, a: AssinaturaFalsa): FichaAssinatura {
  return {
    ...fichaExemplo({ tenant_id: x.id, plano: a.plano, ciclo: a.ciclo, adicionais: a.adicionais, emUso: a.em_uso, teste_ate: a.teste_ate, paga: a.paga }),
    desde: a.desde,
    atualizada_em: a.atualizada_em,
  };
}

/** `GET|PUT /plataforma/empresas/:id/assinatura`: ler = time da Macuxi ou o admin da própria empresa; trocar = só o time. */
function responderAssinatura(metodo: string, tenant: string, sessao: SessaoFalsa, e: Estado, corpo: unknown): Response {
  if (metodo !== 'GET' && metodo !== 'PUT') return erro(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
  if (sessao.tipo === 'admin_cliente' && sessao.empresa !== tenant) return erro(403, 'PERFIL_SEM_ACESSO', 'Você só vê o plano da sua empresa.');
  if (metodo === 'PUT' && sessao.tipo !== 'super_admin') return erro(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi troca o plano.');
  const x = e.empresas.find((y) => y.id === tenant && !excluida(y));
  const atual = x?.assinatura;
  if (!x || !atual) return SEM_ASSINATURA();
  if (metodo === 'GET') return json(200, fichaDaEmpresa(x, atual));
  const t = lerCorpo(TrocarPlanoSchema, corpo);
  if (t instanceof Response) return t;
  // mesmo pedido = mesma resposta, nada muda (idempotente)
  if (atual.pedido_id === t.pedido_id) return json(200, fichaDaEmpresa(x, atual));
  const novo = PLANOS_EXEMPLO.find((p) => p.codigo === t.plano);
  if (!novo) return PLANO_DESCONHECIDO();
  // RN-PLA-05 pela regra do SDK, a mesma da API (ex.: Light com 14 vendedores em uso = PLANO_ABAIXO_DO_USO)
  const problemas = conferirTrocaDePlano(novo, t.adicionais, usoPorItem(fichaDaEmpresa(x, atual).licencas).emUso);
  if (problemas.length > 0) return recusarPlano(problemas);
  const nova: AssinaturaFalsa = { ...atual, plano: novo.codigo, ciclo: t.ciclo, adicionais: t.adicionais, atualizada_em: agoraIso(), pedido_id: t.pedido_id };
  const modulos = modulosDaAssinatura(novo, t.adicionais).map((modulo) => ({ modulo, licencas: null }));
  gravar({ ...e, empresas: e.empresas.map((y) => (y.id === tenant ? { ...y, assinatura: nova, modulos } : y)) });
  return json(200, fichaDaEmpresa(x, nova));
}

// ---------------------------------------------------------------------------------------------------------- CNPJ (ADR 0048)

/**
 * CNPJs-gatilho do modo falso (fictícios, com os dígitos verificadores certos). Qualquer outro CNPJ válido é encontrado e ativo,
 * com dados fictícios; dígito errado = 400 `CNPJ_INVALIDO`.
 * - `naoEncontrado` 99.000.001/0001-01: 404 `CNPJ_NAO_ENCONTRADO`;
 * - `receitaFora` 99.000.002/0001-48: 503 `CNPJ_FONTE_FORA`;
 * - `baixado` 99.000.003/0001-92: encontrado com a situação `baixada`; criar a empresa com ele = 422 `CNPJ_INATIVO`.
 */
export const CNPJS_GATILHO_FALSO = Object.freeze({ naoEncontrado: '99000001000101', receitaFora: '99000002000148', baixado: '99000003000192' });

const situacaoFalsa = (cnpj: string): SituacaoCadastral => (cnpj === CNPJS_GATILHO_FALSO.baixado ? 'baixada' : 'ativa');

function consultaFalsa(cnpj: string): ConsultaCnpjResposta {
  return ConsultaCnpjRespostaSchema.parse({
    cnpj,
    razao_social: `Empresa Fictícia ${cnpj.slice(0, 8)} Ltda`,
    nome_fantasia: 'Empresa Fictícia',
    endereco: { logradouro: 'Rua Fictícia', numero: '100', complemento: 'Sala 2', bairro: 'Centro' },
    municipio: 'Manaus',
    uf: 'AM',
    cep: '69000000',
    situacao_cadastral: situacaoFalsa(cnpj),
    cnae_principal: { codigo: '4639701', descricao: 'Comércio atacadista de produtos alimentícios em geral' },
    telefone: '9232320000',
    email: 'contato@empresa-ficticia.com.br',
    fonte: 'brasilapi',
  });
}

function responderCnpj(corpo: unknown): Response {
  const p = ConsultaCnpjPedidoSchema.safeParse(corpo);
  if (!p.success) return erro(400, CODIGOS_CNPJ.invalido, 'CNPJ inválido: confira os dígitos.');
  const { cnpj } = p.data;
  if (cnpj === CNPJS_GATILHO_FALSO.naoEncontrado)
    return erro(404, CODIGOS_CNPJ.naoEncontrado, 'CNPJ não encontrado na Receita Federal. Confira o número ou preencha os dados à mão.');
  if (cnpj === CNPJS_GATILHO_FALSO.receitaFora) return erro(503, CODIGOS_CNPJ.fonteFora, 'A consulta à Receita está fora do ar. Preencha os dados à mão ou tente de novo em instantes.');
  return json(200, consultaFalsa(cnpj));
}

// ---------------------------------------------------------------------------------------------------------- criar empresa

type CriacaoFalsa = { status: 200 | 201; estado: Estado; existente: EmpresaFalsa | undefined; resposta: { tenant_id: string | null; codigo: string; resultado: string; modulos_adicionados: string[]; parametros_gravados: string[]; avisos: string[]; admin: 'criado' | 'existente' | null; simulado: boolean } };

/** O passo Empresa como a API (`POST /plataforma/empresas` e o `empresas-com-plano`): RN-CORE-34, RN-CORE-32 e idempotente pelo código. */
function criarEmpresaFalsa(e: Estado, c: CriarEmpresa): CriacaoFalsa | Response {
  const existente = e.empresas.find((x) => x.codigo === c.codigo);
  // RN-CORE-34 e RN-CORE-32 como a API: empresa nova sem admin = 422; senha fora da regra do Core = 422 com as faltas
  if (!existente && !c.admin) return erro(422, 'RN-CORE-34', 'Informe o administrador da empresa.', { campo: 'admin' });
  if (!existente && c.admin) {
    const faltas = faltasNaSenha(c.admin.senha);
    const m = mensagemDaSenha(faltas, c.admin.senha);
    if (m) return erro(422, 'RN-CORE-32', m, { campo: 'admin.senha', faltas });
  }
  if (!existente && situacaoFalsa(c.cnpj) !== 'ativa')
    return erro(422, CODIGOS_CNPJ.inativo, `Este CNPJ não está ativo na Receita (situação: ${situacaoFalsa(c.cnpj)}). A empresa não foi criada.`, { campo: 'cnpj', situacao_cadastral: situacaoFalsa(c.cnpj) });
  const modulos = [...new Map([{ modulo: 'core', licencas: null }, { modulo: 'integracao', licencas: null }, ...c.modulos].map((m) => [m.modulo, m])).values()];
  const adicionados = modulos.filter((m) => !existente?.modulos.some((x) => x.modulo === m.modulo)).map((m) => m.modulo);
  const resposta: CriacaoFalsa['resposta'] = {
    tenant_id: c.simular ? (existente?.id ?? null) : (existente?.id ?? crypto.randomUUID()),
    codigo: c.codigo,
    resultado: existente ? (adicionados.length ? 'atualizado' : 'sem_mudanca') : 'criado',
    modulos_adicionados: adicionados,
    parametros_gravados: existente ? [] : linhasDosParametrosIniciais(c.parametros).map((l) => l.chave),
    avisos: existente ? ['A empresa já existe: razão social e fuso não mudam.'] : [],
    admin: existente ? (c.admin ? 'existente' : null) : 'criado',
    simulado: c.simular,
  };
  if (c.simular) return { status: 200, estado: e, existente, resposta };
  const lista = existente
    ? e.empresas.map((x) => (x.id === existente.id ? { ...x, modulos: [...x.modulos, ...modulos.filter((m) => adicionados.includes(m.modulo))] } : x))
    : [...e.empresas, { id: resposta.tenant_id as string, codigo: c.codigo, razao_social: c.razao_social, cnpj: c.cnpj, fuso: c.fuso, status: 'ativo', criada_em: agoraIso(), modulos }];
  // o admin inicial da empresa nova entra na lista de admins (só na memória), com a troca pendente (RN-CORE-34)
  if (!existente && c.admin && resposta.tenant_id) {
    adminsFalsos.set(resposta.tenant_id, [
      { usuario_id: crypto.randomUUID(), nome: c.admin.nome, email: c.admin.email, ativo: true, bloqueado: false, tem_senha: true, trocar_senha: true, senha_expira_em: null, entra_no_portal: true },
    ]);
  }
  return { status: 201, estado: { ...e, empresas: lista }, existente, resposta };
}

/** `POST /plataforma/empresas-com-plano` (só o time): o passo Empresa com os módulos do plano (RN-PLA-01) e a assinatura. */
function responderEmpresaComPlano(sessao: SessaoFalsa, e: Estado, corpo: unknown): Response {
  if (sessao.tipo !== 'super_admin') return erro(403, 'PERFIL_SEM_ACESSO', 'Só o time da Macuxi cadastra empresas.');
  const c = lerCorpo(CriarEmpresaComPlanoSchema, corpo);
  if (c instanceof Response) return c;
  const { assinatura: escolha, ...empresa } = c;
  const plano = PLANOS_EXEMPLO.find((p) => p.codigo === escolha.plano);
  if (!plano) return PLANO_DESCONHECIDO();
  const problemas = conferirEscolhaDePlano(plano, escolha.adicionais);
  if (problemas.length > 0) return recusarPlano(problemas);
  const modulos = modulosDaAssinatura(plano, escolha.adicionais).map((modulo) => ({ modulo, licencas: null }));
  const r = criarEmpresaFalsa(e, { ...empresa, modulos });
  if (r instanceof Response) return r;
  const testeAte = escolha.com_teste ? fimDoTeste(localIsoDate(new Date(), empresa.fuso), plano.dias_teste) : null;
  let assinatura: 'criada' | 'existente' | 'simulada' = 'simulada';
  let testeGravado = testeAte;
  let estado = r.estado;
  if (!c.simular) {
    const ja = r.existente?.assinatura;
    if (ja) {
      assinatura = 'existente';
      testeGravado = ja.teste_ate;
    } else {
      assinatura = 'criada';
      const nova = assinaturaFalsa(plano.codigo, { ciclo: escolha.ciclo, adicionais: escolha.adicionais, teste_ate: testeAte, paga: testeAte === null, em_uso: { bko: 1 }, desde: agoraIso(), atualizada_em: agoraIso(), pedido_id: escolha.pedido_id });
      estado = { ...estado, empresas: estado.empresas.map((x) => (x.id === r.resposta.tenant_id ? { ...x, assinatura: nova } : x)) };
    }
    gravar(estado);
  }
  const { modulos_adicionados: _m, parametros_gravados: _p, ...resto } = r.resposta;
  return json(r.status, { ...resto, assinatura, teste_ate: testeGravado, valor: valorDaAssinatura(plano, escolha.adicionais, escolha.ciclo) });
}

const vazio = (): Estado => ({ sessoes: {}, empresas: empresasIniciais(), conectores: {} });

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
    if ((falhas.get(c.email) ?? 0) >= 5) return erro(423, 'BLOQUEADO', mensagemBloqueioPorTentativas(MINUTOS_BLOQUEIO_FALSO), { minutos_restantes: MINUTOS_BLOQUEIO_FALSO });
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

  // ---------- frases da carga (T-0181)
  if (caminho === ROTAS_PORTAL.frasesCarga) return responderFrases(metodo, undefined, sessao, corpo);
  const mFrase = FRASE_M.exec(caminho);
  if (mFrase) return responderFrases(metodo, decodeURIComponent(mFrase[1] ?? ''), sessao, corpo);

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
    const r = criarEmpresaFalsa(e, c);
    if (r instanceof Response) return r;
    if (!c.simular) gravar(r.estado);
    return json(r.status, r.resposta);
  }
  // ---------- planos (ADR 0047) e CNPJ (ADR 0048)
  if (rota === `GET ${semV1(ROTA_PORTAL_PLANOS)}`) return json(200, { itens: [...PLANOS_EXEMPLO].sort((a, b) => a.ordem - b.ordem) });
  if (rota === `POST ${semV1(ROTA_PORTAL_EMPRESA_COM_PLANO)}`) return responderEmpresaComPlano(sessao, e, corpo);
  if (rota === `POST ${semV1(ROTA_PORTAL_CNPJ)}`) return responderCnpj(corpo);
  const assinaturaM = ASSINATURA_M.exec(caminho);
  if (assinaturaM) return responderAssinatura(metodo, decodeURIComponent(assinaturaM[1] ?? ''), sessao, e, corpo);

  const adminsM = ADMINS_M.exec(caminho);
  if (adminsM) return responderAdmins(metodo, decodeURIComponent(adminsM[1] ?? ''), adminsM[2] ? decodeURIComponent(adminsM[2]) : undefined, sessao, e, corpo);
  const marcaM = MARCA_M.exec(caminho);
  if (marcaM) return responderMarca(metodo, decodeURIComponent(marcaM[1] ?? ''), marcaM[2] === 'logo' ? 'logo' : marcaM[2] === 'marca' ? 'marca' : 'ocultar', sessao, e, corpo);

  // ---------- rotas de módulo (com tenant): o admin do cliente só na empresa escolhida (desenho T-0093 §4)
  if (sessao.tipo === 'admin_cliente') {
    if (!sessao.empresa) return erro(409, 'EMPRESA_NAO_ESCOLHIDA', 'Escolha a empresa para continuar.');
    if (tenant !== sessao.empresa) return erro(403, 'EMPRESA_NAO_PERMITIDA', 'Você não tem acesso a esta empresa. Escolha outra.');
  }
  if (!tenant || !e.empresas.some((x) => x.id === tenant)) return erro(404, 'TENANT_NAO_ENCONTRADO', 'Empresa não encontrada ou inativa.');
  if (rota === `GET ${ROTAS_PORTAL.conectores}`) {
    // `?tipo=` (desenho config-credencial-api): `conector` à esquerda e `nuvem` (credencial de API) à direita da aba Integração
    const tipo = new URLSearchParams(caminhoComQuery.split('?')[1] ?? '').get('tipo');
    return json(200, { itens: (e.conectores[tenant] ?? []).filter((c) => !tipo || c.tipo === tipo) });
  }
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
  const chaveM = /^\/integracao\/conectores\/([^/]+)\/chave$/.exec(caminho);
  if (metodo === 'POST' && chaveM) {
    const c = (e.conectores[tenant] ?? []).find((x) => x.id === chaveM[1]);
    if (!c) return erro(404, 'CONECTOR_NAO_ENCONTRADO', 'Conector não encontrado.');
    if (!c.ativo) return erro(409, 'conector_inativo', `O Conector "${c.conector_id}" está desativado.`);
    return json(201, { conector_id: c.conector_id, escopo: 'integracao.v1', chave: `mx_falso_${crypto.randomUUID().replace(/-/g, '')}`, prefixo: 'mx_falso', criada_em: agoraIso(), anterior_valida_ate: agoraIso(24 * 60) });
  }
  const conectorM = /^\/integracao\/conectores\/([^/]+)$/.exec(caminho);
  if (metodo === 'PATCH' && conectorM) {
    const lista = e.conectores[tenant] ?? [];
    if (!lista.some((x) => x.id === conectorM[1])) return erro(404, 'CONECTOR_NAO_ENCONTRADO', 'Conector não encontrado.');
    const c = lerCorpo(ConectorAtualizar, corpo);
    if (c instanceof Response) return c;
    // RN-INT-13: com `entidades`, cada base só pode vir deste Conector (como a API: 409 `topologia_conflitante` com a mensagem)
    if (c.entidades) {
      const outros = lista.filter((x) => x.ativo && x.id !== conectorM[1]);
      const conflito = c.entidades.map((b) => ({ b, dono: outros.find((x) => x.entidades.includes(b)) })).filter((x) => x.dono);
      if (conflito.length) {
        return erro(409, 'topologia_conflitante', conflito.map((x) => `A base ${x.b} já vem do Conector ${x.dono?.conector_id}.`).join(' '), { entidades_livres: c.entidades.filter((b) => !conflito.some((x) => x.b === b)) });
      }
    }
    const nova = lista.map((x) => (x.id !== conectorM[1] ? x : { ...x, ...(c.entidades ? { entidades: c.entidades } : {}), ...(typeof c.ativo === 'boolean' ? { ativo: c.ativo, saude: c.ativo ? x.saude : ('desativado' as const) } : {}) }));
    gravar({ ...e, conectores: { ...e.conectores, [tenant]: nova } });
    return json(200, nova.find((x) => x.id === conectorM[1]));
  }
  // T-0098: link temporário do pacote do Conector (spec portal-config-enxuto §10.2: "38 MB", validade e SHA-256); o link não abre nada
  if (rota === `POST ${ROTAS_PORTAL.conectorDownload}`) {
    const arquivo = 'macuxi-conector-1.4.0-win-x64.zip';
    return json(200, { url: `https://pacotes.exemplo.invalid/${arquivo}`, expira_em: new Date(Date.now() + 15 * 60_000).toISOString(), versao: '1.4.0', arquivo, tamanho_bytes: 38 * 1024 * 1024, sha256: '3f9a7b2e5d81c0f4a96e2b7d3c58f01a4e9b6c2d7f3a8e15b0c4d9f62a7ec21e' });
  }
  // N1/N2 (nuvem) ainda não existem: igual à API real antes do merge
  return erro(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
}

/** Para os testes e para "recomeçar" o modo falso. */
/** PDF mínimo válido (uma página, uma linha), para o "Baixar o guia (PDF)" baixar um arquivo de verdade no modo falso. */
function pdfDeExemplo(texto: string): string {
  const objetos = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${`BT /F1 14 Tf 72 770 Td (${texto}) Tj ET`.length} >>\nstream\nBT /F1 14 Tf 72 770 Td (${texto}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const posicoes = objetos.map((o, i) => {
    const pos = pdf.length;
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return pos;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n${posicoes.map((p) => `${String(p).padStart(10, '0')} 00000 n \n`).join('')}`;
  return `${pdf}trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
}

/**
 * Documentos públicos do Hub no modo falso (sem sessão, como na API): o guia da API em PDF (`GUIA_PDF_HUB`) e o OpenAPI (`OPENAPI_HUB`),
 * com o nome que a API manda no `Content-Disposition`; outro caminho = rota ausente.
 */
export function documentoPublicoFalso(viaProxy: string): Response {
  if (viaProxy === GUIA_PDF_HUB.viaProxy) {
    return new Response(pdfDeExemplo('Macuxi - Guia da API do Hub (modo falso)'), { status: 200, headers: { 'content-type': 'application/pdf', 'content-disposition': 'attachment; filename="macuxi-guia-api-v1.pdf"' } });
  }
  if (viaProxy === OPENAPI_HUB.viaProxy) {
    const doc = { openapi: '3.1.0', info: { title: 'Macuxi Hub de Integração (modo falso)', version: '1' }, paths: {} };
    return new Response(JSON.stringify(doc, null, 2), { status: 200, headers: { 'content-type': 'application/json', 'content-disposition': 'attachment; filename="macuxi-openapi-hub-v1.json"' } });
  }
  return erro(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
}

export function zerarModoFalso() {
  falhas.clear();
  adminsFalsos.clear();
  adminsSemeados = false;
  redefinicoesFalsas.clear();
  frasesFalsas.clear();
  gravar(vazio());
}
