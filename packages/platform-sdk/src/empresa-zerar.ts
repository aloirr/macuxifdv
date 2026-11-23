/**
 * ADR 0068 (desenho docs/desenho/empresa-zerar.md; pedido do dono do produto na v1.0.30): "Zerar dados" no menu ⋯ da empresa do
 * portal `config.` (só super-admin), ao lado de Excluir. Apaga os dados da empresa e mantém a empresa, o plano e as licenças, os
 * usuários e os perfis, os parâmetros e os conectores (RN-PLA-12). A lista do que sai e a ordem moram SÓ no banco
 * (`plataforma.zerar_tenant`, migração 0099); aqui ficam o contrato das rotas, a regra de liberação do botão e o agrupamento da
 * prévia para a tela. Nada aqui vai a log: só ids, códigos e contagens.
 */
import { z } from 'zod';
import { definirEvento } from './eventos';
import { CODIGOS_ACOES_EMPRESA, MENSAGENS_ACOES_EMPRESA, type StatusEmpresa } from './empresa-acoes';

const Uuid = z.string().uuid();
const Instante = z.string().datetime({ offset: true });
const Contagem = z.number().int().nonnegative();
/** Código técnico de falha; nunca mensagem com dado. */
const ErroCodigo = z.string().regex(/^[A-Z][A-Z0-9_]{1,59}$/);
/** Tabela qualificada `<esquema>.<tabela>`. */
const Tabela = z.string().regex(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/);

/** Rotas do portal (super-admin; admin do cliente = 403 `PERFIL_SEM_ACESSO`). Ligadas com as ações da empresa (`MACUXI_EMPRESA_ACOES=1`). */
export const ROTAS_ZERAR_EMPRESA = Object.freeze({
  /** POST 202 `ZerarEmpresa` (senha do super-admin conferida de novo) · GET 200 `ZerarEmpresa` (o mais recente). */
  zerar: '/v1/plataforma/empresas/:tenant_id/zerar',
  /** GET 200 `PreviaZerarEmpresa`: contagem, por tabela, do que vai sair. */
  previa: '/v1/plataforma/empresas/:tenant_id/zerar/previa',
});

// ---------- limites (RN-PLA-12) ----------
/** Acima disto o zerar do portal é recusado (uma transação só, com cópia das linhas): 422 `ZERAR_VOLUME_ALTO`. */
export const LIMITE_LINHAS_ZERAR = 2_000_000;
/** Dias em que a cópia das linhas apagadas (e os bytes das fotos) ficam guardados para desfazer; depois o worker expurga. */
export const RETENCAO_COPIA_ZERAR_DIAS = 7;
/** Tentativas do worker em falha de concorrência (FK, serialização, deadlock) antes de fechar como `falhou`. */
export const TENTATIVAS_ZERAR = 3;
/** Teto de tabelas na prévia e na contagem (hoje são ~110; folga para as novas). */
export const MAX_TABELAS_ZERAR = 300;

// ---------- códigos ----------
const C = CODIGOS_ACOES_EMPRESA;
/** Códigos das rotas do zerar (status HTTP no comentário). Os comuns às outras ações vêm de `CODIGOS_ACOES_EMPRESA`. */
export const CODIGOS_ZERAR_EMPRESA = {
  /** 404 — empresa inexistente ou excluída. */
  naoEncontrada: C.naoEncontrada,
  /** 404 — GET …/zerar sem nenhum zerar pedido. */
  zerarNaoEncontrado: 'ZERAR_NAO_ENCONTRADO',
  /** 409 — já há um zerar em andamento desta empresa. */
  zerarEmAndamento: 'ZERAR_EM_ANDAMENTO',
  /** 409 — a exclusão da empresa está em andamento. */
  exclusaoEmAndamento: C.exclusaoEmAndamento,
  /** 409 — há backup em andamento (ele leria metade antes e metade depois). */
  backupEmAndamento: C.backupEmAndamento,
  /** 422 RN-PLA-12 — o código digitado não é o da empresa. */
  codigoNaoConfere: 'ZERAR_CODIGO_NAO_CONFERE',
  /** 422 RN-PLA-12 — mais linhas que `LIMITE_LINHAS_ZERAR`. */
  volumeAlto: 'ZERAR_VOLUME_ALTO',
  /** 403 — a senha do super-admin não conferiu (conta no limite de falhas do portal). */
  reautenticacaoFalhou: C.reautenticacaoFalhou,
} as const;
export type CodigoZerarEmpresa = (typeof CODIGOS_ZERAR_EMPRESA)[keyof typeof CODIGOS_ZERAR_EMPRESA];
const VALORES_CODIGOS_ZERAR = [...new Set(Object.values(CODIGOS_ZERAR_EMPRESA))] as [
  CodigoZerarEmpresa,
  ...CodigoZerarEmpresa[],
];

/** Falhas do worker gravadas no `erro_codigo` (o pedido foi aceito; a empresa ficou intacta). */
export const ERROS_WORKER_ZERAR = Object.freeze({
  /** As `TENTATIVAS_ZERAR` caíram por escrita concorrente (FK 23503, 40001, 40P01). */
  concorrencia: 'ZERAR_CONCORRENCIA',
  /** Qualquer outro erro do banco na transação. */
  falhou: 'ZERAR_FALHOU',
});

/** Frases próprias do zerar (texto final do designer-ux); as comuns vêm de `MENSAGENS_ACOES_EMPRESA`. */
const MENSAGENS_PROPRIAS: Readonly<Record<string, string>> = Object.freeze({
  [CODIGOS_ZERAR_EMPRESA.zerarNaoEncontrado]: 'Nenhum zerar pedido para esta empresa.',
  [CODIGOS_ZERAR_EMPRESA.zerarEmAndamento]: 'Os dados desta empresa já estão sendo zerados.',
  [CODIGOS_ZERAR_EMPRESA.codigoNaoConfere]: 'Código não confere.',
  [CODIGOS_ZERAR_EMPRESA.volumeAlto]: 'Esta empresa tem dados demais para zerar pelo portal. Avise o suporte da Macuxi.',
  [ERROS_WORKER_ZERAR.concorrencia]: 'A empresa estava em uso e nada foi apagado. Tente de novo.',
  [ERROS_WORKER_ZERAR.falhou]: 'Não foi possível zerar e nada foi apagado. Avise o suporte da Macuxi.',
});

/** Frase de um código do zerar (a API põe no `mensagem` e a tela mostra a mesma). Uma tabela só para API e BKO. */
export function mensagemDoZerar(codigo: string): string | null {
  return (
    MENSAGENS_PROPRIAS[codigo] ??
    (MENSAGENS_ACOES_EMPRESA as Readonly<Record<string, string>>)[codigo] ??
    null
  );
}

// ---------- pedido e situação ----------
/**
 * `POST …/zerar` (202). `id` gerado no portal (idempotente: o mesmo id devolve o mesmo zerar). `codigo_confirmacao` = código da
 * empresa digitado (sem diferença de maiúsculas; `codigoDeConfirmacaoConfere`); `senha` = a do super-admin (nunca volta nem vai a log).
 */
export const PedirZerarEmpresaSchema = z
  .object({
    id: Uuid,
    codigo_confirmacao: z.string().trim().min(2).max(40),
    senha: z.string().min(1).max(200),
  })
  .strict();
export type PedirZerarEmpresa = z.infer<typeof PedirZerarEmpresaSchema>;

export const SITUACOES_ZERAR = ['em_andamento', 'concluido', 'falhou'] as const;
export type SituacaoZerar = (typeof SITUACOES_ZERAR)[number];
/** `portal` = botão do super-admin; `workflow` = `producao-limpar-cadastros.yml` (mesma função do banco). */
export const ORIGENS_ZERAR = ['portal', 'workflow'] as const;

/** Contagem por tabela das linhas apagadas (`{"core.cliente": 120, ...}`). */
export const ContagemZerarSchema = z
  .record(Tabela, Contagem)
  .refine((r) => Object.keys(r).length <= MAX_TABELAS_ZERAR, 'tabelas demais');

export const ZerarEmpresaSchema = z
  .object({
    id: Uuid,
    tenant_id: Uuid,
    codigo: z.string(),
    origem: z.enum(ORIGENS_ZERAR),
    situacao: z.enum(SITUACOES_ZERAR),
    pedido_em: Instante,
    concluido_em: Instante.nullable(),
    linhas_apagadas: Contagem.nullable(),
    contagem: ContagemZerarSchema.nullable(),
    /** Até quando a cópia das linhas e os bytes das fotos ficam para desfazer (RN-PLA-12). */
    copia_expira_em: Instante.nullable(),
    erro_codigo: ErroCodigo.nullable(),
  })
  .strict()
  .superRefine((x, ctx) => {
    const concluidoIncompleto =
      x.concluido_em === null || x.linhas_apagadas === null || x.contagem === null || x.copia_expira_em === null;
    const problema =
      x.situacao === 'concluido' && concluidoIncompleto
        ? 'zerar concluído tem concluido_em, linhas_apagadas, contagem e copia_expira_em'
        : x.situacao === 'em_andamento' && x.concluido_em !== null
          ? 'zerar em andamento não tem concluido_em'
          : (x.situacao === 'falhou') !== (x.erro_codigo !== null)
            ? 'erro_codigo só (e sempre) no zerar que falhou'
            : x.contagem !== null &&
                x.linhas_apagadas !== null &&
                Object.values(x.contagem).reduce((a, b) => a + b, 0) !== x.linhas_apagadas
              ? 'linhas_apagadas é a soma da contagem'
              : null;
    if (problema) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problema, path: ['situacao'] });
  });
export type ZerarEmpresa = z.infer<typeof ZerarEmpresaSchema>;

// ---------- prévia ----------
export const LinhaPreviaZerarSchema = z.object({ tabela: Tabela, linhas: Contagem }).strict();
/**
 * `GET …/zerar/previa`: o que vai sair, por tabela (só as com linhas, na ordem em que o banco apaga), e o bloqueio atual
 * (`conferirZerar`; null = liberado). A contagem é do momento: o worker recontará na transação.
 */
export const PreviaZerarEmpresaSchema = z
  .object({
    tenant_id: Uuid,
    codigo: z.string(),
    contado_em: Instante,
    total_linhas: Contagem,
    tabelas: z.array(LinhaPreviaZerarSchema).max(MAX_TABELAS_ZERAR),
    bloqueio: z.enum(VALORES_CODIGOS_ZERAR).nullable(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.tabelas.reduce((a, t) => a + t.linhas, 0) !== p.total_linhas)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'total_linhas é a soma das tabelas', path: ['total_linhas'] });
  });
export type PreviaZerarEmpresa = z.infer<typeof PreviaZerarEmpresaSchema>;

// ---------- regra (RN-PLA-12) ----------
/** O que mais está acontecendo com a empresa, como o banco vê na transação do pedido. */
export interface OcupacaoDaEmpresa {
  zerar_em_andamento: boolean;
  backup_em_andamento: boolean;
  exclusao_em_andamento: boolean;
}

/**
 * RN-PLA-12: o zerar está liberado? Vale para empresa ativa ou inativa. Ordem das recusas (a primeira que valer): exclusão em
 * andamento (ou empresa `encerrado`); zerar em andamento; backup em andamento; mais linhas que `LIMITE_LINHAS_ZERAR`. O portal
 * usa para habilitar o botão; a `sa_pedir_zerar` repete na transação do pedido.
 */
export function conferirZerar(
  empresa: { status: StatusEmpresa },
  ocupacao: OcupacaoDaEmpresa,
  totalLinhas: number,
): { ok: true } | { ok: false; codigo: CodigoZerarEmpresa } {
  const Z = CODIGOS_ZERAR_EMPRESA;
  if (empresa.status === 'encerrado' || ocupacao.exclusao_em_andamento) return { ok: false, codigo: Z.exclusaoEmAndamento };
  if (ocupacao.zerar_em_andamento) return { ok: false, codigo: Z.zerarEmAndamento };
  if (ocupacao.backup_em_andamento) return { ok: false, codigo: Z.backupEmAndamento };
  if (totalLinhas > LIMITE_LINHAS_ZERAR) return { ok: false, codigo: Z.volumeAlto };
  return { ok: true };
}

// ---------- agrupamento da prévia para a tela ----------
/** Grupos da confirmação (só apresentação; a regra do que sai é do banco). Ordem fixa. */
export const GRUPOS_ZERAR = ['cadastros', 'pedidos', 'registros', 'integracao', 'sistema', 'arquivos'] as const;
export type GrupoZerar = (typeof GRUPOS_ZERAR)[number];
/** Rótulo de cada grupo na confirmação (texto final do designer-ux). */
export const ROTULO_GRUPO_ZERAR: Readonly<Record<GrupoZerar, string>> = Object.freeze({
  cadastros: 'Cadastros',
  pedidos: 'Pedidos',
  registros: 'Registros de campo',
  integracao: 'Integração com o ERP',
  sistema: 'Fila do sistema',
  arquivos: 'Fotos e arquivos',
});

const PEDIDOS = new Set(['integracao.pedido_retorno', 'integracao.pedido_retorno_erro']);
const REGISTROS_CORE = new Set([
  'core.visita',
  'core.visita_etapa',
  'core.deslocamento_dia',
  'core.ponto_trajeto',
  'core.notificacao',
  'core.tarefa',
  'core.tarefa_destinatario',
  'core.indicador_diario',
]);
const SISTEMA = new Set([
  'plataforma.evento',
  'plataforma.evento_consumo',
  'plataforma.trabalho',
  'plataforma.email_saida',
  'plataforma.diagnostico',
  'plataforma.sync_pacote',
  'plataforma.sync_pacote_pedido',
]);

/** Grupo de uma tabela da prévia. Tabela nova cai em `cadastros` (o teste do banco obriga a classificá-la no 0099). */
export function grupoDaTabelaZerar(tabela: string): GrupoZerar {
  const esquema = tabela.slice(0, tabela.indexOf('.'));
  if (tabela === 'plataforma.arquivo') return 'arquivos';
  if (PEDIDOS.has(tabela) || tabela === 'vendedor.pedido' || tabela.startsWith('vendedor.pedido_')) return 'pedidos';
  if (esquema === 'integracao') return 'integracao';
  if (SISTEMA.has(tabela)) return 'sistema';
  if (REGISTROS_CORE.has(tabela) || ['promotor', 'pesquisa', 'treinamento', 'gestor'].includes(esquema)) return 'registros';
  return 'cadastros';
}

/** Soma da prévia por grupo, na ordem de `GRUPOS_ZERAR`, só os grupos com linhas. */
export function resumirPreviaPorGrupo(
  tabelas: readonly { tabela: string; linhas: number }[],
): { grupo: GrupoZerar; rotulo: string; linhas: number }[] {
  const soma = new Map<GrupoZerar, number>();
  for (const t of tabelas) {
    const g = grupoDaTabelaZerar(t.tabela);
    soma.set(g, (soma.get(g) ?? 0) + t.linhas);
  }
  return GRUPOS_ZERAR.filter((g) => (soma.get(g) ?? 0) > 0).map((g) => ({
    grupo: g,
    rotulo: ROTULO_GRUPO_ZERAR[g],
    linhas: soma.get(g) ?? 0,
  }));
}

// ---------- auditoria ----------
/**
 * NÃO passa pela outbox (o `plataforma.evento` do tenant é apagado na mesma transação): é o `detalhes` da linha `tenant.zerado`
 * de `plataforma.auditoria_plataforma` (histórico da empresa). O aparelho percebe pelo giro da `geracao_base`.
 */
export const EVENTO_TENANT_ZERADO = definirEvento(
  'plataforma.tenant.zerado@1',
  z
    .object({
      tenant_id: Uuid,
      codigo: z.string(),
      zerar_id: Uuid,
      origem: z.enum(ORIGENS_ZERAR),
      linhas_apagadas: Contagem,
      copia_expira_em: Instante,
      zerado_em: Instante,
    })
    .strict(),
);
