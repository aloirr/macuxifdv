/**
 * ADR 0052 (desenho docs/desenho/empresa-acoes.md; pedido do dono do produto R-20261114-195600-alexandre): ações do portal
 * (`config.`, só super-admin) na lista de empresas: Inativar/Reativar, Backup e Excluir.
 * - Inativar (RN-PLA-07): `plataforma.tenant.status` `ativo` → `suspenso` (rótulo "Inativa"). Não apaga nada; corta todo
 *   acesso (Campo, Gestão, BKO, portal do admin do cliente, sync, arquivos, Conector, jobs e e-mails). Reativar volta.
 * - Backup (RN-PLA-08): job assíncrono por tenant (`em_andamento` → `pronto` | `falhou`), exportação por tabela em NDJSON
 *   cifrado + cópia dos arquivos, no prefixo `backups-empresas/` do bucket. Consistente só com a empresa inativa.
 * - Excluir (RN-PLA-09/10): só empresa inativa, com backup pronto, consistente, iniciado depois da inativação e concluído há
 *   no máximo `PRAZO_BACKUP_PARA_EXCLUIR_DIAS`; confirmação com o código da empresa e a senha do super-admin.
 * Regras puras aqui (o portal mostra o botão com elas; a API revalida com as mesmas). Nada aqui vai a log: só ids e códigos.
 */
import { z } from 'zod';
import { definirEvento } from './eventos';

const Uuid = z.string().uuid();
const Instante = z.string().datetime({ offset: true });
const DIA_MS = 86_400_000;

// ---------- situação da empresa ----------
/** Valores do check `tenant_status_valido` (0001). `suspenso` é a empresa INATIVA; `encerrado` só existe dentro da exclusão. */
export const STATUS_EMPRESA = ['ativo', 'suspenso', 'encerrado'] as const;
export type StatusEmpresa = (typeof STATUS_EMPRESA)[number];
/** Rótulo da situação no portal (o valor do banco não aparece na tela). */
export const ROTULO_STATUS_EMPRESA: Readonly<Record<StatusEmpresa, string>> = Object.freeze({
  ativo: 'Ativa',
  suspenso: 'Inativa',
  encerrado: 'Em exclusão',
});

/**
 * RN-PLA-07: código do bloqueio por empresa inativa. Rotas do tenant (login com senha certa, renovar, toda rota autenticada,
 * sync, arquivos, diagnósticos) respondem 403 `EMPRESA_INATIVA`; as rotas do Conector, 403 `empresa_inativa` (códigos do Hub
 * em minúsculas). O app NÃO apaga os dados locais (diferente do 423 de aparelho bloqueado): guarda a fila e espera.
 */
export const CODIGO_EMPRESA_INATIVA = 'EMPRESA_INATIVA';
export const CODIGO_EMPRESA_INATIVA_CONECTOR = 'empresa_inativa';
export const MENSAGEM_EMPRESA_INATIVA =
  'Sua empresa está inativa no Macuxi. Fale com o administrador da empresa.';

/** Códigos de erro das rotas de ações da empresa no portal (status HTTP no comentário). */
export const CODIGOS_ACOES_EMPRESA = {
  /** 404 — empresa inexistente ou já excluída. */
  naoEncontrada: 'EMPRESA_NAO_ENCONTRADA',
  /** 409 — há exclusão em andamento: nenhuma outra ação vale. */
  exclusaoEmAndamento: 'EXCLUSAO_EM_ANDAMENTO',
  /** 409 — já há um backup em andamento desta empresa (um por vez). */
  backupEmAndamento: 'BACKUP_EM_ANDAMENTO',
  /** 422 RN-PLA-09 — a empresa precisa estar inativa para ser excluída. */
  exclusaoEmpresaAtiva: 'EXCLUSAO_EMPRESA_ATIVA',
  /** 422 RN-PLA-09 — sem backup pronto (o informado não existe, é de outra empresa, falhou ou ainda roda). */
  exclusaoSemBackup: 'EXCLUSAO_SEM_BACKUP',
  /** 422 RN-PLA-09 — o backup começou antes da inativação (ou com a empresa ativa): faça outro. */
  exclusaoBackupAntesDaInativacao: 'EXCLUSAO_BACKUP_ANTES_DA_INATIVACAO',
  /** 422 RN-PLA-09 — o backup passou do prazo: faça outro. */
  exclusaoBackupVencido: 'EXCLUSAO_BACKUP_VENCIDO',
  /** 422 RN-PLA-09 — o código digitado não é o da empresa. */
  exclusaoCodigoNaoConfere: 'EXCLUSAO_CODIGO_NAO_CONFERE',
  /** 403 — a senha do super-admin não conferiu na confirmação (conta no limite de falhas do portal). */
  reautenticacaoFalhou: 'REAUTENTICACAO_FALHOU',
  /** 503 — backup sem bucket ou sem chave de cifra configurados neste servidor (falha fechada). */
  backupIndisponivel: 'BACKUP_INDISPONIVEL',
} as const;
export type CodigoAcaoEmpresa = (typeof CODIGOS_ACOES_EMPRESA)[keyof typeof CODIGOS_ACOES_EMPRESA];

/** Rotas do portal (super-admin; admin do cliente = 403 `PERFIL_SEM_ACESSO`). Ligadas por `MACUXI_EMPRESA_ACOES=1`. */
export const ROTAS_ACOES_EMPRESA = Object.freeze({
  inativar: '/v1/plataforma/empresas/:tenant_id/inativar',
  reativar: '/v1/plataforma/empresas/:tenant_id/reativar',
  backups: '/v1/plataforma/empresas/:tenant_id/backups',
  backup: '/v1/plataforma/empresas/:tenant_id/backups/:backup_id',
  exclusao: '/v1/plataforma/empresas/:tenant_id/exclusao',
});

// ---------- prazos e lugares (RN-PLA-08/09/11) ----------
/** RN-PLA-09: idade máxima do backup que libera a exclusão (contada do `concluido_em`). */
export const PRAZO_BACKUP_PARA_EXCLUIR_DIAS = 7;
/** RN-PLA-11: retenção do backup de empresa que existe (o mais novo pronto sempre fica). */
export const RETENCAO_BACKUP_EMPRESA_DIAS = 30;
/** RN-PLA-11: retenção do backup que serviu a uma exclusão, contada do fim da exclusão. Depois, o worker apaga. */
export const RETENCAO_BACKUP_EXCLUIDA_DIAS = 90;
/** Prefixo no bucket (`macuxi-prod`): fora de `backups/` (dump diário) e de `arquivos/` (fotos), que nunca se tocam. */
export const PREFIXO_BACKUP_EMPRESA = 'backups-empresas/';
/** Backups listados por empresa no portal. */
export const MAX_BACKUPS_LISTADOS = 20;

/** `backups-empresas/<tenant_id>/<backup_id>/` (minúsculas; ids conferidos). */
export function prefixoDoBackupEmpresa(tenantId: string, backupId: string): string {
  if (!Uuid.safeParse(tenantId).success || !Uuid.safeParse(backupId).success)
    throw new Error('prefixo de backup: ids inválidos');
  return `${PREFIXO_BACKUP_EMPRESA}${tenantId.toLowerCase()}/${backupId.toLowerCase()}/`;
}

/** Parte da tabela no backup: `dados/<esquema>.<tabela>.ndjson.gz.cifrado`. */
export function parteDaTabela(tabela: string): string {
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(tabela))
    throw new Error('parte do backup: tabela inválida');
  return `dados/${tabela}.ndjson.gz.cifrado`;
}

// ---------- Inativar / Reativar (RN-PLA-07) ----------
export const MOTIVOS_INATIVACAO = [
  'inadimplencia',
  'pedido_do_cliente',
  'fim_do_contrato',
  'implantacao_cancelada',
  'outro',
] as const;
export type MotivoInativacao = (typeof MOTIVOS_INATIVACAO)[number];
export const ROTULO_MOTIVO_INATIVACAO: Readonly<Record<MotivoInativacao, string>> = Object.freeze({
  inadimplencia: 'Inadimplência',
  pedido_do_cliente: 'Pedido do cliente',
  fim_do_contrato: 'Fim do contrato',
  implantacao_cancelada: 'Implantação cancelada',
  outro: 'Outro',
});

/** `POST …/inativar`. Motivo de lista (sem texto livre: nada de dado pessoal na auditoria). */
export const InativarEmpresaSchema = z.object({ motivo: z.enum(MOTIVOS_INATIVACAO) }).strict();
export type InativarEmpresa = z.infer<typeof InativarEmpresaSchema>;
/** `POST …/reativar` (corpo vazio). */
export const ReativarEmpresaSchema = z.object({}).strict();

/** Resposta de inativar e reativar (200). Repetir a ação já feita = `sem_mudanca` (idempotente). */
export const SituacaoEmpresaRespostaSchema = z
  .object({
    tenant_id: Uuid,
    status: z.enum(['ativo', 'suspenso']),
    inativada_em: Instante.nullable(),
    motivo: z.enum(MOTIVOS_INATIVACAO).nullable(),
    resultado: z.enum(['alterado', 'sem_mudanca']),
  })
  .strict()
  .superRefine((r, ctx) => {
    const inativa = r.status === 'suspenso';
    if (inativa !== (r.inativada_em !== null) || inativa !== (r.motivo !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'inativada_em e motivo só (e sempre) na empresa inativa',
        path: ['inativada_em'],
      });
    }
  });
export type SituacaoEmpresaResposta = z.infer<typeof SituacaoEmpresaRespostaSchema>;

/** Transição pedida sobre a situação atual: `alterado`, `sem_mudanca` (idempotente) ou recusa (empresa em exclusão). */
export function transicaoDeSituacao(
  atual: StatusEmpresa,
  acao: 'inativar' | 'reativar',
): 'alterado' | 'sem_mudanca' | 'recusado' {
  if (atual === 'encerrado') return 'recusado';
  const alvo: StatusEmpresa = acao === 'inativar' ? 'suspenso' : 'ativo';
  return atual === alvo ? 'sem_mudanca' : 'alterado';
}

// ---------- Backup (RN-PLA-08) ----------
export const SITUACOES_BACKUP = ['em_andamento', 'pronto', 'falhou', 'apagado'] as const;
export type SituacaoBackup = (typeof SITUACOES_BACKUP)[number];

/** `POST …/backups` (202). `id` gerado no portal: repetir o mesmo id devolve o mesmo backup (idempotente). */
export const PedirBackupEmpresaSchema = z.object({ id: Uuid }).strict();
export type PedirBackupEmpresa = z.infer<typeof PedirBackupEmpresaSchema>;

const Contagem = z.number().int().nonnegative();
export const BackupEmpresaSchema = z
  .object({
    id: Uuid,
    tenant_id: Uuid,
    situacao: z.enum(SITUACOES_BACKUP),
    /** Começou com a empresa inativa e ela ficou inativa até o fim: o único que libera a exclusão (RN-PLA-08/09). */
    consistente: z.boolean(),
    pedido_em: Instante,
    iniciado_em: Instante.nullable(),
    concluido_em: Instante.nullable(),
    expira_em: Instante.nullable(),
    progresso_pct: z.number().int().min(0).max(100),
    tamanho_bytes: Contagem.nullable(),
    tabelas: Contagem.nullable(),
    linhas: Contagem.nullable(),
    arquivos: Contagem.nullable(),
    /** Código técnico da falha (ex.: `S3_FALHOU`, `TABELA_FALHOU`); nunca mensagem com dado. */
    erro_codigo: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,59}$/)
      .nullable(),
  })
  .strict()
  .superRefine((b, ctx) => {
    const problema =
      b.situacao === 'pronto' &&
      (b.concluido_em === null || b.tamanho_bytes === null || b.progresso_pct !== 100)
        ? 'backup pronto tem concluido_em, tamanho e 100%'
        : b.situacao === 'falhou' && b.erro_codigo === null
          ? 'backup que falhou tem erro_codigo'
          : b.situacao !== 'falhou' && b.erro_codigo !== null
            ? 'erro_codigo só no backup que falhou'
            : b.situacao === 'em_andamento' && b.concluido_em !== null
              ? 'backup em andamento não tem concluido_em'
              : null;
    if (problema) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problema, path: ['situacao'] });
  });
export type BackupEmpresa = z.infer<typeof BackupEmpresaSchema>;
export const ListaBackupsEmpresaSchema = z
  .object({ itens: z.array(BackupEmpresaSchema).max(MAX_BACKUPS_LISTADOS) })
  .strict();

/** Manifesto do backup (`<prefixo>/manifesto.json`, sem cifra; sem dado pessoal). Lido pela restauração antes de tudo. */
export const FORMATO_BACKUP_EMPRESA = 'macuxi-backup-empresa';
export const ManifestoBackupEmpresaSchema = z
  .object({
    formato: z.literal(FORMATO_BACKUP_EMPRESA),
    versao_formato: z.literal(1),
    backup_id: Uuid,
    tenant_id: Uuid,
    codigo: z.string().min(2).max(40),
    /** Última migração aplicada no banco na hora do backup (ex.: `0070`): a restauração só roda na mesma versão. */
    migracao: z.string().regex(/^\d{4}$/),
    criado_em: Instante,
    consistente: z.boolean(),
    cifra: z
      .object({ algoritmo: z.literal('aes-256-gcm'), chave_id: z.string().regex(/^[a-z0-9-]{1,40}$/) })
      .strict(),
    /** Na ordem de restauração (mães antes das filhas); a exclusão usa a ordem inversa. */
    tabelas: z
      .array(
        z
          .object({
            tabela: z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/),
            linhas: Contagem,
            parte: z.string(),
            bytes: Contagem,
            sha256: z.string().regex(/^[0-9a-f]{64}$/),
          })
          .strict(),
      )
      .min(1),
    arquivos: z.object({ quantidade: Contagem, bytes: Contagem }).strict(),
  })
  .strict()
  .superRefine((m, ctx) => {
    const vistas = new Set<string>();
    m.tabelas.forEach((t, i) => {
      if (vistas.has(t.tabela))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'tabela repetida',
          path: ['tabelas', i, 'tabela'],
        });
      vistas.add(t.tabela);
      if (t.parte !== parteDaTabela(t.tabela))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'parte fora do formato',
          path: ['tabelas', i, 'parte'],
        });
    });
    if (!vistas.has('plataforma.tenant'))
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'falta plataforma.tenant', path: ['tabelas'] });
  });
export type ManifestoBackupEmpresa = z.infer<typeof ManifestoBackupEmpresaSchema>;

// ---------- Excluir (RN-PLA-09/10) ----------
/**
 * `POST …/exclusao` (202). `id` gerado no portal (idempotente). `codigo_confirmacao` = o código da empresa digitado (sem
 * diferença de maiúsculas); `senha` = a do super-admin, conferida de novo (nunca volta nem vai a log).
 */
export const ExcluirEmpresaSchema = z
  .object({
    id: Uuid,
    backup_id: Uuid,
    codigo_confirmacao: z.string().trim().min(2).max(40),
    senha: z.string().min(1).max(200),
  })
  .strict();
export type ExcluirEmpresa = z.infer<typeof ExcluirEmpresaSchema>;

export const SITUACOES_EXCLUSAO = ['em_andamento', 'concluida', 'falhou'] as const;
/** `banco` = DELETE em ordem de FK numa transação; `arquivos` = remoção dos objetos de `arquivos/<tenant_id>/`. */
export const ETAPAS_EXCLUSAO = ['banco', 'arquivos', 'fim'] as const;
export const ExclusaoEmpresaSchema = z
  .object({
    id: Uuid,
    tenant_id: Uuid,
    codigo: z.string(),
    backup_id: Uuid,
    situacao: z.enum(SITUACOES_EXCLUSAO),
    etapa: z.enum(ETAPAS_EXCLUSAO),
    pedida_em: Instante,
    concluida_em: Instante.nullable(),
    linhas_apagadas: Contagem.nullable(),
    arquivos_apagados: Contagem.nullable(),
    erro_codigo: z
      .string()
      .regex(/^[A-Z][A-Z0-9_]{1,59}$/)
      .nullable(),
  })
  .strict()
  .superRefine((x, ctx) => {
    const problema =
      x.situacao === 'concluida' && (x.concluida_em === null || x.etapa !== 'fim')
        ? 'exclusão concluída tem concluida_em e etapa fim'
        : (x.situacao === 'falhou') !== (x.erro_codigo !== null)
          ? 'erro_codigo só (e sempre) na exclusão que falhou'
          : null;
    if (problema) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problema, path: ['situacao'] });
  });
export type ExclusaoEmpresa = z.infer<typeof ExclusaoEmpresaSchema>;

/** Backup como a regra da exclusão o vê (datas já em `Date`). */
export interface BackupParaExclusao {
  tenant_id: string;
  situacao: SituacaoBackup;
  consistente: boolean;
  iniciado_em: Date | null;
  concluido_em: Date | null;
}

/**
 * RN-PLA-09: a exclusão está liberada? Ordem das recusas (a primeira que valer): empresa não inativa; sem backup pronto da
 * própria empresa; backup não consistente ou iniciado antes da (última) inativação; backup concluído há mais de
 * `PRAZO_BACKUP_PARA_EXCLUIR_DIAS`. O portal usa para habilitar o botão e a API repete na transação do pedido.
 */
export function conferirExclusao(
  empresa: { id: string; status: StatusEmpresa; inativada_em: Date | null },
  backup: BackupParaExclusao | null,
  agora: Date,
): { ok: true } | { ok: false; codigo: CodigoAcaoEmpresa } {
  const C = CODIGOS_ACOES_EMPRESA;
  if (empresa.status === 'encerrado') return { ok: false, codigo: C.exclusaoEmAndamento };
  if (empresa.status !== 'suspenso' || empresa.inativada_em === null)
    return { ok: false, codigo: C.exclusaoEmpresaAtiva };
  if (
    !backup ||
    backup.tenant_id !== empresa.id ||
    backup.situacao !== 'pronto' ||
    backup.concluido_em === null
  ) {
    return { ok: false, codigo: C.exclusaoSemBackup };
  }
  if (
    !backup.consistente ||
    backup.iniciado_em === null ||
    backup.iniciado_em.getTime() < empresa.inativada_em.getTime()
  ) {
    return { ok: false, codigo: C.exclusaoBackupAntesDaInativacao };
  }
  if (agora.getTime() - backup.concluido_em.getTime() > PRAZO_BACKUP_PARA_EXCLUIR_DIAS * DIA_MS)
    return { ok: false, codigo: C.exclusaoBackupVencido };
  return { ok: true };
}

/** RN-PLA-09: o código digitado confere com o da empresa (espaços nas pontas e maiúsculas não contam). */
export function codigoDeConfirmacaoConfere(digitado: string, codigoDaEmpresa: string): boolean {
  const d = digitado.trim().toLowerCase();
  return d.length > 0 && d === codigoDaEmpresa.trim().toLowerCase();
}

/**
 * Bloco aditivo do item da lista de empresas (`EmpresaResumoSchema.acoes`, opcional): o que a linha precisa para mostrar
 * Inativar/Reativar, Backup e Excluir. `exclusao_bloqueada` = o código de `conferirExclusao` (null = liberada).
 */
export const AcoesDaEmpresaSchema = z
  .object({
    inativada_em: Instante.nullable(),
    motivo_inativacao: z.enum(MOTIVOS_INATIVACAO).nullable(),
    ultimo_backup: BackupEmpresaSchema.nullable(),
    exclusao: ExclusaoEmpresaSchema.nullable(),
    exclusao_bloqueada: z.string().nullable(),
  })
  .strict();
export type AcoesDaEmpresa = z.infer<typeof AcoesDaEmpresaSchema>;

// ---------- eventos `plataforma.tenant.*@1` ----------
/** Publicado pela API na outbox do próprio tenant, na transação da inativação. */
export const EVENTO_TENANT_INATIVADO = definirEvento(
  'plataforma.tenant.inativado@1',
  z.object({ tenant_id: Uuid, motivo: z.enum(MOTIVOS_INATIVACAO), inativada_em: Instante }).strict(),
);
/** Publicado pela API na outbox do próprio tenant, na transação da reativação. */
export const EVENTO_TENANT_REATIVADO = definirEvento(
  'plataforma.tenant.reativado@1',
  z.object({ tenant_id: Uuid, reativada_em: Instante, inativa_desde: Instante }).strict(),
);
/** Publicado pelo worker ao fechar o backup como pronto. */
export const EVENTO_TENANT_BACKUP_CONCLUIDO = definirEvento(
  'plataforma.tenant.backup_concluido@1',
  z
    .object({
      tenant_id: Uuid,
      backup_id: Uuid,
      consistente: z.boolean(),
      tamanho_bytes: Contagem,
      linhas: Contagem,
      arquivos: Contagem,
      concluido_em: Instante,
    })
    .strict(),
);
/** Publicado pelo worker ao fechar o backup como falhou. */
export const EVENTO_TENANT_BACKUP_FALHOU = definirEvento(
  'plataforma.tenant.backup_falhou@1',
  z
    .object({
      tenant_id: Uuid,
      backup_id: Uuid,
      erro_codigo: z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/),
      falhou_em: Instante,
    })
    .strict(),
);
/**
 * NÃO passa pela outbox (o `plataforma.evento` do tenant some na mesma transação): é o `detalhes` da linha
 * `tenant.excluido` de `plataforma.auditoria_plataforma` e o registro de `plataforma.empresa_excluida`.
 */
export const EVENTO_TENANT_EXCLUIDO = definirEvento(
  'plataforma.tenant.excluido@1',
  z
    .object({
      tenant_id: Uuid,
      codigo: z.string(),
      backup_id: Uuid,
      linhas_apagadas: Contagem,
      excluido_em: Instante,
    })
    .strict(),
);
export const EVENTOS_TENANT = [
  EVENTO_TENANT_INATIVADO,
  EVENTO_TENANT_REATIVADO,
  EVENTO_TENANT_BACKUP_CONCLUIDO,
  EVENTO_TENANT_BACKUP_FALHOU,
  EVENTO_TENANT_EXCLUIDO,
] as const;
