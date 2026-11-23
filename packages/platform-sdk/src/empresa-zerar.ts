/**
 * ADR 0068 (desenho docs/desenho/empresa-zerar.md; pedidos do dono do produto na v1.0.31): "Zerar dados" da empresa no portal
 * `config.` (só super-admin): a empresa inteira (menu ⋯, ao lado de Excluir) ou só algumas entidades do ERP (aba Integração da
 * empresa, botão em cada entidade). A regra do que sai mora SÓ no banco, na `plataforma.limpar_cadastros(tenant, lote,
 * entidades)` da migração 0100 (o corpo da rotina do workflow `producao-limpar-cadastros.yml`, promovido): soft delete no
 * domínio, físico só no Hub; cópia de cada linha em `plataforma.limpeza_copia` (RN-PLA-12). A regra de liberação também mora
 * só no banco (`plataforma.zerar_bloqueado`). Aqui ficam o contrato das rotas, a lista das entidades, a frase de cada código e
 * o agrupamento da prévia para a tela. Nada aqui vai a log: só ids, códigos e contagens.
 */
import { z } from 'zod';
import { definirEvento } from './eventos';
import { CODIGOS_ACOES_EMPRESA, MENSAGENS_ACOES_EMPRESA } from './empresa-acoes';

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
  /**
   * POST 202 `PreviaZerar` (corpo `PedirPreviaZerar`: id do portal e entidades; sem = a empresa inteira). A conta é do worker
   * (a limpeza rodada e desfeita leva mais que o prazo do pool do portal); a tela lê `previaLer` a cada
   * `CONSULTA_PREVIA_ZERAR_MS` até `pronta` ou `falhou`. O mesmo id devolve a mesma prévia.
   */
  previa: '/v1/plataforma/empresas/:tenant_id/zerar/previa',
  /** GET 200 `PreviaZerar` · 404 `ZERAR_PREVIA_NAO_ENCONTRADA`. */
  previaLer: '/v1/plataforma/empresas/:tenant_id/zerar/previa/:previa_id',
});
/** Intervalo da tela entre duas leituras da prévia em andamento. */
export const CONSULTA_PREVIA_ZERAR_MS = 2_000;

// ---------- prazos ----------
/** Dias em que a cópia das linhas (`plataforma.limpeza_copia`) do zerar do portal fica para desfazer; depois o worker a descarta. */
export const RETENCAO_COPIA_ZERAR_DIAS = 7;
/** Tentativas do worker em falha de concorrência (FK, serialização, deadlock, `lock_timeout`) antes de fechar como `falhou`. */
export const TENTATIVAS_ZERAR = 3;
/** Teto de linhas do resultado na prévia e na contagem (uma por tabela e modo; folga para as tabelas novas). */
export const MAX_TABELAS_ZERAR = 300;

// ---------- entidades ----------
/**
 * As 16 entidades do Hub, na ordem de carga (a mesma `ORDEM_CARGA_ENTIDADES` de `@macuxi/integracao/contracts`; o pacote não
 * importa módulo, e o teste `apps/api/test/empresa-zerar-portal.test.ts` confere que as duas listas são iguais). O mapa
 * entidade → tabelas raiz e linhas do Hub mora na `plataforma.limpar_cadastros` (desenho §4.2). Rótulos: `ROTULO_ENTIDADE`.
 */
export const ENTIDADES_ZERAR = [
  'filial',
  'vendedor',
  'catalogo_no',
  'forma_pagamento',
  'prazo_pagamento',
  'produto',
  'produto_unidade',
  'preco',
  'tabela_escalonada',
  'estoque',
  'cliente',
  'cliente_endereco',
  'transportadora',
  'rota',
  'titulo',
  'nota',
] as const;
export type EntidadeZerar = (typeof ENTIDADES_ZERAR)[number];
export const EntidadeZerarSchema = z.enum(ENTIDADES_ZERAR);

/** Sem repetição e na ordem de carga (o mesmo conjunto dá a mesma lista). */
export function normalizarEntidadesZerar(lista: readonly EntidadeZerar[]): EntidadeZerar[] {
  return ENTIDADES_ZERAR.filter((e) => lista.includes(e));
}

/** Lista de entidades do pedido e da prévia: ao menos uma, sem repetição; `null` = a empresa inteira. Sai normalizada. */
export const EntidadesZerarSchema = z
  .array(EntidadeZerarSchema)
  .min(1)
  .max(ENTIDADES_ZERAR.length)
  .refine((l) => new Set(l).size === l.length, 'entidade repetida')
  .transform(normalizarEntidadesZerar)
  .nullable();


// ---------- lote e modos ----------
/**
 * Lote da limpeza = chave da cópia: carimbo UTC `AAAAMMDDTHHMMSSZ` (workflow) ou o carimbo do pedido + `-` + os 8 primeiros
 * dígitos hexa do id do zerar (portal). É o que o `restaurar` do workflow recebe.
 */
export const LOTE_LIMPEZA_FORMATO = /^[0-9]{8}T[0-9]{6}Z(-[0-9a-f]{8})?$/;
/**
 * O que a limpeza faz em cada tabela (a mesma coluna `modo` da cópia): `soft` = `deleted_at`; `fisico` = DELETE (Hub e filas);
 * `filial` = a filial fica e só perde o `external_id`; `sync_pacote` = pacote pronto vira substituído; `girar` = a
 * `geracao_base` do tenant gira (os aparelhos puxam de novo). Só `soft` e `fisico` contam como linhas que saem.
 */
export const MODOS_LIMPEZA = ['soft', 'fisico', 'filial', 'sync_pacote', 'girar'] as const;
export type ModoLimpeza = (typeof MODOS_LIMPEZA)[number];
const MODOS_QUE_APAGAM: ReadonlySet<ModoLimpeza> = new Set(['soft', 'fisico']);
/**
 * Tabelas que a limpeza só muda e nunca apaga (modos `filial`, `sync_pacote` e `girar`): a prévia não traz o `modo`, e estas
 * ficam fora das linhas que saem.
 */
const TABELAS_QUE_NAO_SAEM: ReadonlySet<string> = new Set(['core.filial', 'plataforma.sync_pacote', 'plataforma.tenant']);
const sai = (t: { tabela: string; modo?: ModoLimpeza | undefined }): boolean =>
  t.modo === undefined ? !TABELAS_QUE_NAO_SAEM.has(t.tabela) : MODOS_QUE_APAGAM.has(t.modo);

/** Uma linha do resultado da `limpar_cadastros`: tabela, o que foi feito e quantas linhas. */
export const LinhaLimpezaSchema = z.object({ tabela: Tabela, modo: z.enum(MODOS_LIMPEZA), linhas: Contagem }).strict();
export type LinhaLimpeza = z.infer<typeof LinhaLimpezaSchema>;
/** Linhas que saem (soft + físico) de um resultado da limpeza. */
export const linhasQueSaem = (l: readonly LinhaLimpeza[]): number => somaQueSai(l);
function somaQueSai(l: readonly { tabela: string; modo?: ModoLimpeza | undefined; linhas: number }[]): number {
  return l.reduce((a, x) => a + (sai(x) ? x.linhas : 0), 0);
}
const ResultadoLimpeza = z.array(LinhaLimpezaSchema).max(MAX_TABELAS_ZERAR);


// ---------- códigos ----------
const C = CODIGOS_ACOES_EMPRESA;
/** Códigos das rotas do zerar (status HTTP no comentário). Os comuns às outras ações vêm de `CODIGOS_ACOES_EMPRESA`. */
export const CODIGOS_ZERAR_EMPRESA = {
  /** 404 — empresa inexistente ou excluída. */
  naoEncontrada: C.naoEncontrada,
  /** 404 — GET …/zerar sem nenhum zerar pedido. */
  zerarNaoEncontrado: 'ZERAR_NAO_ENCONTRADO',
  /** 404 — GET …/zerar/previa/:previa_id de prévia inexistente (ou de outra empresa). */
  previaNaoEncontrada: 'ZERAR_PREVIA_NAO_ENCONTRADA',
  /** 409 — o id do pedido ou da prévia já foi usado em outra empresa. */
  idEmUso: 'ID_EM_USO',
  /** 409 — já há um zerar em andamento desta empresa. */
  zerarEmAndamento: 'ZERAR_EM_ANDAMENTO',
  /** 409 — a exclusão da empresa está em andamento. */
  exclusaoEmAndamento: C.exclusaoEmAndamento,
  /** 409 — há backup em andamento (ele leria metade antes e metade depois). */
  backupEmAndamento: C.backupEmAndamento,
  /** 422 RN-PLA-12 — o código digitado não é o da empresa. */
  codigoNaoConfere: 'ZERAR_CODIGO_NAO_CONFERE',
  /** 422 RN-PLA-12 — linhas demais para uma transação (o limite é do banco, `plataforma.zerar_bloqueado`; prévia e worker). */
  volumeAlto: 'ZERAR_VOLUME_ALTO',
  /** 409 RN-PLA-12 — um lote do Hub desta empresa está em processamento (a limpeza esperaria por ele). */
  hubProcessando: 'ZERAR_HUB_PROCESSANDO',
  /** 403 — a senha do super-admin não conferiu (conta no limite de falhas do portal). */
  reautenticacaoFalhou: C.reautenticacaoFalhou,
} as const;
export type CodigoZerarEmpresa = (typeof CODIGOS_ZERAR_EMPRESA)[keyof typeof CODIGOS_ZERAR_EMPRESA];
const VALORES_CODIGOS_ZERAR = [...new Set(Object.values(CODIGOS_ZERAR_EMPRESA))] as [
  CodigoZerarEmpresa,
  ...CodigoZerarEmpresa[],
];

/**
 * Falhas do worker gravadas no `erro_codigo` (o pedido foi aceito; a empresa ficou intacta). Na prévia, o banco grava
 * `ZERAR_FALHOU` (erro na contagem ou teto de tentativas) ou `TENANT_NAO_ENCONTRADO` (frases: `mensagemDaPreviaZerar`).
 */
export const ERROS_WORKER_ZERAR = Object.freeze({
  /** As `TENTATIVAS_ZERAR` caíram por escrita concorrente (23503, 40001, 40P01, 55P03). */
  concorrencia: 'ZERAR_CONCORRENCIA',
  /** Qualquer outro erro do banco na transação (ou o teto de tentativas). */
  falhou: 'ZERAR_FALHOU',
});

/** Frase da prévia que não pôde ser lida ou contada (texto final do designer-ux, R4-1). */
const FRASE_PREVIA_FALHOU = 'Não foi possível contar os dados. Tente de novo.';

/** Frases próprias do zerar (texto final do designer-ux); as comuns vêm de `MENSAGENS_ACOES_EMPRESA`. */
const MENSAGENS_PROPRIAS: Readonly<Record<string, string>> = Object.freeze({
  [CODIGOS_ZERAR_EMPRESA.zerarNaoEncontrado]: 'Nenhum zerar pedido para esta empresa.',
  [CODIGOS_ZERAR_EMPRESA.previaNaoEncontrada]: FRASE_PREVIA_FALHOU,
  [CODIGOS_ZERAR_EMPRESA.idEmUso]: 'Identificador já usado. Tente de novo.',
  [CODIGOS_ZERAR_EMPRESA.zerarEmAndamento]: 'Os dados desta empresa já estão sendo zerados.',
  [CODIGOS_ZERAR_EMPRESA.codigoNaoConfere]: 'Código não confere.',
  [CODIGOS_ZERAR_EMPRESA.volumeAlto]: 'Esta empresa tem dados demais para zerar pelo portal. Avise o suporte da Macuxi.',
  [CODIGOS_ZERAR_EMPRESA.hubProcessando]: 'A integração está processando uma carga desta empresa. Tente de novo em alguns minutos.',
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

/** Frase do `erro_codigo` da prévia que falhou: `ZERAR_FALHOU` é a contagem (não o zerar); os outros como em `mensagemDoZerar`. */
export function mensagemDaPreviaZerar(codigo: string): string | null {
  return codigo === ERROS_WORKER_ZERAR.falhou ? FRASE_PREVIA_FALHOU : mensagemDoZerar(codigo);
}

// ---------- pedido e situação ----------
/**
 * `POST …/zerar` (202). `id` gerado no portal (idempotente: o mesmo id devolve o mesmo zerar). `codigo_confirmacao` = código da
 * empresa digitado (sem diferença de maiúsculas; `codigoDeConfirmacaoConfere`); `senha` = a do super-admin (nunca volta nem vai
 * a log); `entidades` = só estas entidades do ERP (aba Integração), `null` ou ausente = a empresa inteira (menu ⋯).
 */
export const PedirZerarEmpresaSchema = z
  .object({
    id: Uuid,
    codigo_confirmacao: z.string().trim().min(2).max(40),
    senha: z.string().min(1).max(200),
    entidades: EntidadesZerarSchema.default(null),
  })
  .strict();
export type PedirZerarEmpresa = z.output<typeof PedirZerarEmpresaSchema>;

export const SITUACOES_ZERAR = ['em_andamento', 'concluido', 'falhou'] as const;
export type SituacaoZerar = (typeof SITUACOES_ZERAR)[number];

export const ZerarEmpresaSchema = z
  .object({
    id: Uuid,
    tenant_id: Uuid,
    codigo: z.string(),
    /** `null` = a empresa inteira. */
    entidades: z.array(EntidadeZerarSchema).min(1).nullable(),
    /** Entidades com linhas que saíram (as pedidas e as que vieram pela cascata): as que o ERP precisa reenviar. Só no concluído. */
    entidades_afetadas: z.array(EntidadeZerarSchema).nullable(),
    /** Chave da cópia; é o lote do `restaurar` do workflow. */
    lote: z.string().regex(LOTE_LIMPEZA_FORMATO),
    situacao: z.enum(SITUACOES_ZERAR),
    pedido_em: Instante,
    concluido_em: Instante.nullable(),
    /** Soft + físico (`linhasQueSaem`). */
    linhas_apagadas: Contagem.nullable(),
    contagem: ResultadoLimpeza.nullable(),
    /** Até quando a cópia das linhas fica para desfazer (RN-PLA-12). */
    copia_expira_em: Instante.nullable(),
    erro_codigo: ErroCodigo.nullable(),
  })
  .strict()
  .superRefine((x, ctx) => {
    const concluidoIncompleto =
      x.concluido_em === null ||
      x.linhas_apagadas === null ||
      x.contagem === null ||
      x.copia_expira_em === null ||
      x.entidades_afetadas === null;
    const problema =
      x.situacao === 'concluido' && concluidoIncompleto
        ? 'zerar concluído tem concluido_em, linhas_apagadas, contagem, entidades_afetadas e copia_expira_em'
        : x.situacao !== 'concluido' && x.entidades_afetadas !== null
          ? 'entidades_afetadas só no zerar concluído'
          : x.situacao === 'em_andamento' && x.concluido_em !== null
          ? 'zerar em andamento não tem concluido_em'
          : (x.situacao === 'falhou') !== (x.erro_codigo !== null)
            ? 'erro_codigo só (e sempre) no zerar que falhou'
            : x.contagem !== null && x.linhas_apagadas !== null && linhasQueSaem(x.contagem) !== x.linhas_apagadas
              ? 'linhas_apagadas é a soma das linhas soft e fisico da contagem'
              : null;
    if (problema) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problema, path: ['situacao'] });
  });
export type ZerarEmpresa = z.infer<typeof ZerarEmpresaSchema>;

// ---------- prévia (trabalho do worker) ----------
/** `POST …/zerar/previa`: `id` gerado no portal (idempotente); `entidades` como no pedido (`null` ou ausente = a empresa inteira). */
export const PedirPreviaZerarSchema = z.object({ id: Uuid, entidades: EntidadesZerarSchema.default(null) }).strict();
export type PedirPreviaZerar = z.output<typeof PedirPreviaZerarSchema>;

export const SITUACOES_PREVIA_ZERAR = ['em_andamento', 'pronta', 'falhou'] as const;
export type SituacaoPreviaZerar = (typeof SITUACOES_PREVIA_ZERAR)[number];

/**
 * Uma linha da prévia: a ordem e a tabela da `limpar_cadastros` e quantas linhas (só as com contagem). Sem `modo`: as linhas de
 * `core.filial`, `plataforma.sync_pacote` e `plataforma.tenant` mudam e não saem; as outras saem.
 */
export const LinhaPreviaZerarSchema = z.object({ ordem: Contagem, tabela: Tabela, linhas: Contagem }).strict();
export type LinhaPreviaZerar = z.infer<typeof LinhaPreviaZerarSchema>;

/**
 * `POST …/zerar/previa` (202) e `GET …/zerar/previa/:previa_id` (200): a MESMA `limpar_cadastros` contada (modo simular) e
 * desfeita pelo worker (`executar_previa_zerar`), só as tabelas com contagem, e o bloqueio do banco no instante da leitura
 * (`zerar_bloqueado`; null = liberado). A prévia vale 1 hora. A contagem é do momento: o worker refaz na transação do zerar.
 */
export const PreviaZerarSchema = z
  .object({
    id: Uuid,
    situacao: z.enum(SITUACOES_PREVIA_ZERAR),
    /** `null` = a empresa inteira. */
    entidades: z.array(EntidadeZerarSchema).min(1).nullable(),
    /** Só na `pronta`. */
    linhas: z.array(LinhaPreviaZerarSchema).max(MAX_TABELAS_ZERAR).nullable(),
    /** Entidades com linhas que sairiam (as pedidas e as da cascata): a tela pede o reenvio de todas. Só na `pronta`. */
    entidades_afetadas: z.array(EntidadeZerarSchema).nullable(),
    /** Linhas que saem (soft + físico). Só na `pronta`. */
    total: Contagem.nullable(),
    bloqueio: z.enum(VALORES_CODIGOS_ZERAR).nullable(),
    erro_codigo: ErroCodigo.nullable(),
    criado_em: Instante,
  })
  .strict()
  .superRefine((p, ctx) => {
    const pronta = p.situacao === 'pronta';
    const comConta = p.linhas !== null && p.entidades_afetadas !== null && p.total !== null;
    const problema =
      pronta && !comConta
        ? 'prévia pronta tem linhas, entidades_afetadas e total'
        : (p.situacao === 'falhou') !== (p.erro_codigo !== null)
          ? 'erro_codigo só (e sempre) na prévia que falhou'
          : p.linhas !== null && p.total !== null && somaQueSai(p.linhas) !== p.total
            ? 'total é a soma das linhas que saem'
            : null;
    if (problema) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problema, path: ['situacao'] });
  });
export type PreviaZerar = z.infer<typeof PreviaZerarSchema>;

// ---------- agrupamento da prévia para a tela ----------
/**
 * Grupos da confirmação (só apresentação; a regra do que sai é do banco). Ordem fixa. `usuarios`: os usuários que não são
 * administradores saem no zerar da empresa inteira e no da entidade `vendedor` (rotina do #675); a tela não promete mantê-los.
 */
export const GRUPOS_ZERAR = ['cadastros', 'usuarios', 'pedidos', 'registros', 'integracao', 'sistema', 'arquivos'] as const;
export type GrupoZerar = (typeof GRUPOS_ZERAR)[number];
/** Rótulo de cada grupo na confirmação (texto final do designer-ux). */
export const ROTULO_GRUPO_ZERAR: Readonly<Record<GrupoZerar, string>> = Object.freeze({
  cadastros: 'Cadastros',
  usuarios: 'Usuários não administradores',
  pedidos: 'Pedidos',
  registros: 'Registros de campo',
  integracao: 'Integração com o ERP',
  sistema: 'Fila do sistema',
  arquivos: 'Fotos e arquivos',
});

const USUARIOS = new Set(['core.usuario', 'plataforma.usuario_perfil', 'plataforma.usuario_modulo']);
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

/** Grupo de uma tabela da prévia (só apresentação). Tabela nova cai em `cadastros`. */
export function grupoDaTabelaZerar(tabela: string): GrupoZerar {
  const esquema = tabela.slice(0, tabela.indexOf('.'));
  if (tabela === 'plataforma.arquivo') return 'arquivos';
  if (USUARIOS.has(tabela)) return 'usuarios';
  if (PEDIDOS.has(tabela) || tabela === 'vendedor.pedido' || tabela.startsWith('vendedor.pedido_')) return 'pedidos';
  if (esquema === 'integracao') return 'integracao';
  if (SISTEMA.has(tabela)) return 'sistema';
  if (REGISTROS_CORE.has(tabela) || ['promotor', 'pesquisa', 'treinamento', 'gestor'].includes(esquema)) return 'registros';
  return 'cadastros';
}

/**
 * Soma, por grupo, das linhas que saem (soft e físico; sem `modo`, menos as tabelas que só mudam), na ordem de `GRUPOS_ZERAR`,
 * só os grupos com linhas. Recebe as `linhas` da prévia pronta ou a `contagem` do zerar concluído.
 */
export function resumirPreviaPorGrupo(
  tabelas: readonly { tabela: string; modo?: ModoLimpeza | undefined; linhas: number }[],
): { grupo: GrupoZerar; rotulo: string; linhas: number }[] {
  const soma = new Map<GrupoZerar, number>();
  for (const t of tabelas) {
    if (!sai(t)) continue;
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
 * Sem consumidor: é o `detalhes` da linha `tenant.zerado` de `plataforma.auditoria_plataforma` (histórico da empresa), gravada
 * pela `executar_zerar`. O aparelho percebe pelo giro da `geracao_base`.
 */
export const EVENTO_TENANT_ZERADO = definirEvento(
  'plataforma.tenant.zerado@1',
  z
    .object({
      tenant_id: Uuid,
      codigo: z.string(),
      zerar_id: Uuid,
      lote: z.string().regex(LOTE_LIMPEZA_FORMATO),
      entidades: z.array(EntidadeZerarSchema).min(1).nullable(),
      linhas_apagadas: Contagem,
      copia_expira_em: Instante,
      zerado_em: Instante,
    })
    .strict(),
);
