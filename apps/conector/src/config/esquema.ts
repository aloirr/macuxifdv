/**
 * Esquema Zod do arquivo de configuração do Conector (JSON ou YAML).
 * Regras: objetos estritos (chave desconhecida é erro, com a lista do que existe); segredos NUNCA no arquivo
 * (chaves `senha`, `password`, `token`… são recusadas com orientação); a consulta de cada entidade precisa dos
 * parâmetros do cursor (`:cursor_alterado_em`, `:cursor_external_id`) e do `:limite`.
 */
import { LIMITE_LINHAS_INVALIDAS_PADRAO, LIMITE_REGISTROS_LOTE } from '@macuxi/integracao/contracts';
import { z } from 'zod';
import { campoAceitaNulo, camposDoContrato, ehEntidade, PERIODICIDADE_PADRAO, type Entidade } from './entidades';

export const TRANSFORMACOES = [
  'texto',
  'inteiro',
  'numero',
  'booleano',
  'data_hora_utc',
  'data_civil',
  'centavos_de_decimal',
  'json',
] as const;
export type Transformacao = (typeof TRANSFORMACOES)[number];

/**
 * O que fazer com o NULL da coluna (T-0099): `omite` (padrão, comportamento da v1) tira o campo do registro — campo ausente não
 * altera o que o Macuxi já tem; `limpa` envia `null` e o Hub LIMPA o campo. Só vale para campo que o contrato aceita nulo.
 */
export const MODOS_NULO = ['omite', 'limpa'] as const;
export type ModoNulo = (typeof MODOS_NULO)[number];

const Coluna = z.union([
  z.string().min(1, 'informe o nome da coluna'),
  z.object({ coluna: z.string().min(1), transformar: z.enum(TRANSFORMACOES).optional(), nulo: z.enum(MODOS_NULO).optional() }).strict(),
  z.object({ valor: z.union([z.string(), z.number(), z.boolean()]) }).strict(),
]);
export type ColunaConfig = z.infer<typeof Coluna>;

const PARAMS_CURSOR = ['cursor_alterado_em', 'cursor_external_id', 'limite'] as const;

/** Nomes `:param` de uma consulta, ignorando literais entre aspas simples, `::` (cast do PostgreSQL) e comentários `--`. */
export function parametrosDaConsulta(sql: string): string[] {
  const nomes = new Set<string>();
  trocarParametros(sql, (nome) => {
    nomes.add(nome);
    return `:${nome}`;
  });
  return [...nomes];
}

/** Percorre o SQL substituindo cada `:nome` por `troca(nome, ordem)`; respeita literais, identificadores entre aspas e comentários. */
export function trocarParametros(sql: string, troca: (nome: string) => string): string {
  let saida = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i] as string;
    const prox = sql[i + 1];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < sql.length && !(sql[j] === c && sql[j + 1] !== c)) j += sql[j] === c ? 2 : 1;
      saida += sql.slice(i, j + 1);
      i = j + 1;
    } else if (c === '-' && prox === '-') {
      const fim = sql.indexOf('\n', i);
      const j = fim === -1 ? sql.length : fim;
      saida += sql.slice(i, j);
      i = j;
    } else if (c === '/' && prox === '*') {
      const fim = sql.indexOf('*/', i + 2);
      const j = fim === -1 ? sql.length : fim + 2;
      saida += sql.slice(i, j);
      i = j;
    } else if (c === ':' && prox === ':') {
      saida += '::';
      i += 2;
    } else if (c === ':' && prox !== undefined && /[A-Za-z_]/.test(prox)) {
      let j = i + 1;
      while (j < sql.length && /\w/.test(sql[j] as string)) j++;
      saida += troca(sql.slice(i + 1, j));
      i = j;
    } else {
      saida += c;
      i++;
    }
  }
  return saida;
}

const Consulta = z.string().trim().min(1, 'informe a consulta SQL');

export const EntidadeConfig = z
  .object({
    ativa: z.boolean().default(true),
    periodicidadeSegundos: z.number().int().min(10, 'mínimo de 10 segundos').optional(),
    consulta: Consulta,
    campos: z.record(z.string(), Coluna),
    /** `enviar` (padrão): linha com problema de campo vai ao Hub, que a mostra no BKO; `descartar`: fica só no log local. */
    linhasInvalidas: z.enum(['enviar', 'descartar']).default('enviar'),
    maxLinhas: z.number().int().positive().max(LIMITE_REGISTROS_LOTE).optional(),
    /** Consulta de reconciliação diária (RN-INT-07): colunas `contagem` e `soma` (soma pode ser nula). */
    reconciliacao: z.object({ consulta: Consulta }).strict().optional(),
  })
  .strict();
export type EntidadeConfig = z.infer<typeof EntidadeConfig>;

const MapaStatus = z.record(z.string(), z.enum(['integrado', 'rejeitado_erp', 'faturado_parcial', 'faturado_total', 'cancelado']));

export const PedidosConfig = z
  .object({
    ativo: z.boolean().default(true),
    consultaSegundos: z.number().int().min(10).default(60),
    statusSegundos: z.number().int().min(10).default(120),
    maxTentativasGravacao: z.number().int().min(1).max(10).default(3),
    gravacao: z
      .object({
        /** INSERT/EXEC do cabeçalho. Parâmetros: pedido_uuid, cliente_external_id, vendedor_external_id, condicao_pagamento_erp, criado_em, aprovado_em, observacao, desconto_total_cents, total_cents, tentativa. */
        cabecalho: Consulta,
        /** Executado uma vez por item. Parâmetros: pedido_uuid, sequencia, produto_external_id, quantidade, preco_unitario_cents, desconto_cents, total_cents. */
        itens: Consulta.optional(),
        /** Devolve a coluna `numero_erp` do pedido gravado (parâmetro: pedido_uuid). */
        numeroErp: Consulta,
      })
      .strict(),
    status: z
      .object({
        /**
         * Parâmetro: pedido_uuid. Colunas: status (código do ERP), numero_erp, motivo, nota_numero, nota_serie,
         * nota_emitida_em, nota_total_cents, ocorrido_em. Uma linha por situação/nota.
         */
        consulta: Consulta,
        /** Itens faturados de uma nota. Parâmetros: pedido_uuid, nota_numero, nota_serie. Colunas: sequencia, quantidade. */
        consultaItensNota: Consulta.optional(),
        /** Código do ERP → status do contrato. */
        mapaStatus: MapaStatus,
      })
      .strict(),
    /**
     * T-0114 (opcional; exceção da RN-INT-08): cancelamento feito no Macuxi devolvido ao ERP. Só é chamado quando o Hub entrega
     * `cancelamentos` (o conector precisa estar cadastrado com "aceita cancelamento" no BKO). INSERT/EXEC/UPDATE (view ou procedure)
     * executado numa transação, uma vez por pedido. Parâmetros: pedido_uuid, numero_erp (nulo se ainda não gravado), motivo, cancelado_em.
     * Sem esta chave o cancelamento recebido fica pendente e o log avisa (`cancelamento_sem_configuracao`).
     */
    cancelamento: z.object({ executar: Consulta }).strict().optional(),
  })
  .strict();
export type PedidosConfig = z.infer<typeof PedidosConfig>;

/**
 * Atualização automática (T-0116). DESLIGADA por padrão: só roda com `ativa: true`, com a `pasta` de instalação e com o download
 * do pacote (T-0098, bucket privado) ligado ao Conector. A política do Hub é quem anuncia o pacote e a versão.
 */
export const AtualizacaoConfig = z
  .object({
    ativa: z.boolean().default(false),
    /** Pasta de instalação do Conector (onde ficam `atualizacao/nova` e `atualizacao/anterior`); obrigatória com `ativa: true`. */
    pasta: z.string().min(1).optional(),
    /** De quanto em quanto tempo olha a política atrás de pacote novo (5 min a 24 h). */
    verificarMinutos: z.number().int().min(5).max(1440).default(60),
    /** Quanto espera a versão nova responder à saúde antes de voltar à anterior. */
    limiteSaudeSegundos: z.number().int().min(10).max(600).default(60),
  })
  .strict()
  .superRefine((a, ctx) => {
    if (a.ativa && !a.pasta) ctx.addIssue({ code: 'custom', path: ['pasta'], message: 'atualizacao.pasta é obrigatória com atualizacao.ativa = true' });
  });
export type AtualizacaoConfig = z.infer<typeof AtualizacaoConfig>;

const Erp = z
  .object({
    tipo: z.enum(['sqlserver', 'postgres', 'oracle']),
    host: z.string().min(1),
    /** Padrões: SQL Server 1433, PostgreSQL 5432, Oracle 1521 (TLS: 2484). */
    porta: z.number().int().positive().optional(),
    /** Banco (SQL Server/PostgreSQL) ou NOME DO SERVIÇO (Oracle, ex.: `ORCLPDB1`; não é o SID). */
    banco: z.string().min(1),
    usuario: z.string().min(1),
    /** SQL Server: `encrypt`; PostgreSQL: `ssl`; Oracle: `tcps://` (TLS). Oracle on-premise sem TLS: `false`. */
    criptografar: z.boolean().default(true),
    confiarCertificado: z.boolean().default(false),
    instancia: z.string().optional(),
    /** Só Oracle: `offset` (12c+, `OFFSET/FETCH`) ou `rownum` (11g). Vale quando a consulta NÃO traz `:limite`. */
    paginacao: z.enum(['offset', 'rownum']).default('offset'),
    /** Só Oracle: pasta do wallet PEM (`ewallet.pem`) para TLS com certificado próprio. */
    carteira: z.string().min(1).optional(),
    timeoutSegundos: z.number().int().positive().default(30),
  })
  .strict();

const Hub = z
  .object({
    /** Raiz do Hub (o prefixo `/integracao/v1` é do contrato). HTTPS obrigatório; HTTP só para localhost (testes). */
    /**
     * Identificador deste Conector no Hub (cadastrado no BKO junto com a chave de API). Vai no cabeçalho `X-Macuxi-Conector-Id`,
     * no lote e no sinal de vida. Não é segredo; a chave fica fora do arquivo (`hub_chave`).
     */
    conectorId: z
      .string()
      .min(1, 'informe o identificador do Conector (hub.conectorId)')
      .max(100)
      .regex(/^[A-Za-z0-9._-]+$/, 'use só letras, números, ponto, hífen e sublinhado em hub.conectorId'),
    url: z
      .string()
      .url('url do Hub inválida')
      .refine((u) => {
        const x = new URL(u);
        return x.protocol === 'https:' || (x.protocol === 'http:' && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(x.hostname));
      }, 'o Hub precisa de HTTPS (http só é aceito para localhost)'),
    timeoutSegundos: z.number().int().positive().default(30),
    retry: z
      .object({
        tentativas: z.number().int().min(1).max(10).default(4),
        baseMs: z.number().int().positive().default(500),
        maxMs: z.number().int().positive().default(30_000),
      })
      .strict()
      .default({}),
  })
  .strict();

export const ConfigConector = z
  .object({
    dadosDir: z.string().min(1).default('./dados'),
    hub: Hub,
    erp: Erp,
    segredos: z.object({ provedor: z.enum(['auto', 'env', 'windows']).default('auto') }).strict().default({}),
    lote: z
      .object({
        maxLinhas: z.number().int().positive().max(LIMITE_REGISTROS_LOTE).default(LIMITE_REGISTROS_LOTE),
        maxBytes: z.number().int().min(10_000).default(4 * 1024 * 1024),
        /**
         * Linhas inválidas informadas ao Hub por lote (com o motivo); as que passarem disso só entram na contagem. Até [500]
         * (RN-INT-03 emenda, T-0048): é o que o Hub detalha por entidade e lote; acima disso ele só contaria.
         */
        maxLinhasInvalidas: z.number().int().min(0).max(LIMITE_LINHAS_INVALIDAS_PADRAO).default(LIMITE_LINHAS_INVALIDAS_PADRAO),
      })
      .strict()
      .default({}),
    fila: z
      .object({
        maxLotesPendentesPorEntidade: z.number().int().positive().default(20),
        consultaResultadoSegundos: z.number().int().positive().default(5),
        backoffBaseSegundos: z.number().positive().default(5),
        backoffMaxSegundos: z.number().positive().default(900),
        retencaoDias: z.number().int().positive().default(7),
        /** Quantas vezes reenviar linhas que o Hub recusou por falha transitória (`falha_processamento`). */
        reenviosFalhaProcessamento: z.number().int().min(0).default(3),
      })
      .strict()
      .default({}),
    logs: z
      .object({
        nivel: z.enum(['debug', 'info', 'aviso', 'erro']).default('info'),
        retencaoDias: z.number().int().positive().default(30),
        maxMegabytes: z.number().positive().default(10),
      })
      .strict()
      .default({}),
    sinalSegundos: z.number().int().positive().default(60),
    /** Folga ao voltar da carga completa para o delta: relê o que mudou durante a carga (idempotente pelo hash). */
    margemDeltaSegundos: z.number().int().min(0).default(120),
    reconciliacaoHora: z.string().regex(/^\d{2}:\d{2}$/, 'use HH:MM').default('02:00'),
    entidades: z.record(z.string(), EntidadeConfig),
    pedidos: PedidosConfig.optional(),
    atualizacao: AtualizacaoConfig.optional(),
  })
  .strict()
  .superRefine((cfg, ctx) => {
    if (cfg.erp.tipo !== 'oracle') {
      for (const campo of ['carteira'] as const) {
        if (cfg.erp[campo] !== undefined) ctx.addIssue({ code: 'custom', path: ['erp', campo], message: `erp.${campo} só vale para o Oracle` });
      }
    }
    for (const [nome, e] of Object.entries(cfg.entidades)) {
      const caminho = ['entidades', nome];
      if (!ehEntidade(nome)) {
        ctx.addIssue({ code: 'custom', path: caminho, message: `entidade "${nome}" não existe no contrato (use: vendedor, cliente, produto, preco, estoque, titulo, nota, rota)` });
        continue;
      }
      const params = parametrosDaConsulta(e.consulta);
      // Oracle: sem `:limite` o Conector aplica a paginação (erp.paginacao); com `:limite` a consulta pagina por conta própria
      const exigidos = cfg.erp.tipo === 'oracle' ? PARAMS_CURSOR.filter((p) => p !== 'limite') : PARAMS_CURSOR;
      for (const p of exigidos) {
        if (!params.includes(p)) {
          ctx.addIssue({ code: 'custom', path: [...caminho, 'consulta'], message: `a consulta precisa do parâmetro :${p} (cursor do delta; veja o exemplo)` });
        }
      }
      for (const obrigatorio of ['external_id', 'alterado_em']) {
        if (!(obrigatorio in e.campos)) {
          ctx.addIssue({ code: 'custom', path: [...caminho, 'campos'], message: `mapeie o campo "${obrigatorio}" (obrigatório para o cursor)` });
        }
      }
      const conhecidos = new Set(camposDoContrato(nome));
      for (const [campo, spec] of Object.entries(e.campos)) {
        const raiz = campo.split('.')[0] as string;
        if (!conhecidos.has(raiz)) {
          ctx.addIssue({ code: 'custom', path: [...caminho, 'campos', campo], message: `o contrato de "${nome}" não tem o campo "${raiz}" (campos: ${[...conhecidos].join(', ')})` });
          continue;
        }
        // `nulo: limpa` (T-0099) só onde o contrato aceita null: num campo obrigatório o null tornaria a linha inválida
        if (typeof spec === 'object' && 'coluna' in spec && spec.nulo === 'limpa' && !campoAceitaNulo(nome, campo)) {
          ctx.addIssue({
            code: 'custom',
            path: [...caminho, 'campos', campo, 'nulo'],
            message: `"nulo": "limpa" só vale para campo que o contrato aceita nulo; "${campo}" de "${nome}" é obrigatório (tire o "nulo" ou use "omite")`,
          });
        }
      }
    }
  });
export type ConfigConector = z.infer<typeof ConfigConector>;

export function periodicidadeDe(cfg: ConfigConector, entidade: Entidade): number {
  return cfg.entidades[entidade]?.periodicidadeSegundos ?? PERIODICIDADE_PADRAO[entidade];
}
