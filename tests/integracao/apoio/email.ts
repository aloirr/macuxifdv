/**
 * Apoio da T-0094 (ADR 0032; desenho docs/desenho/T-0094.md §10): e-mail transacional nos testes de ponta do agente `testes`.
 *
 * A porta `ServicoEmail` do §10 (`disponivel()` + `enfileirar(db, m)`) chega às rotas pelo `ctx.email` (fatia S + frente N5).
 * Este apoio NÃO inventa API: só usa a interface combinada no §10 e embrulha o `executar` das rotas do Core para pôr no
 * contexto um ESPIÃO da porta:
 *  - com a porta real no contexto e disponível (S + N5 no working tree, adaptador configurado), o espião só anota a mensagem
 *    (o "arquivo do e-mail" do teste: é o único lugar em que a senha em claro existe) e repassa ao `enfileirar` real (carga
 *    cifrada de verdade, `plataforma.email_saida` real);
 *  - sem a porta real (antes da S/N5) ou com ela indisponível, faz o que o §10 manda o `enfileirar` fazer: um `insert` em
 *    `plataforma.email_saida` PELA CONEXÃO RECEBIDA (a da transação do tenant), com a carga cifrada em AES-256-GCM (chave do
 *    teste, AAD = id|tenant|modelo) e `on conflict do nothing` pela `chave_idempotencia`;
 *  - `desligar()` simula o servidor sem adaptador (`disponivel() = false`, `enfileirar` devolve `indisponivel` sem gravar);
 *  - `falharNaProxima()` faz o próximo `enfileirar` lançar DEPOIS do insert: prova que senha e e-mail estão na mesma
 *    transação (a rota desfaz os dois).
 * `entregues(admin)` devolve só as mensagens cuja linha da outbox foi confirmada (transação desfeita = mensagem que não existe).
 * Fatia S (R-20261108-005709-engenheiro-software): `portaRealDeTeste` monta a porta REAL da API (`criarServicoEmail` com a chave
 * HKDF do JWT, como o servidor) ligada/desligada junto com o espião, para o `createApp({ email })` (rotas de módulo e o portal
 * que redefine a senha do admin); `cargaDaOutbox` decifra uma linha com a mesma chave (o "arquivo do e-mail" sem despachar);
 * `despacharParaArquivo` roda o despachante REAL (papel `macuxi_worker`) com o adaptador de arquivo (`MACUXI_EMAIL_ARQUIVO_DIR`)
 * até a fila esvaziar, e `lerArquivosEmail` lê os `.eml` gravados (texto e HTML decodificados).
 */
import crypto from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CargaEmail, ClienteBanco, LogRota, ModeloEmail as ModeloEmailSdk, ModuloApi } from '@macuxi/platform-sdk';
import pg from 'pg';
import {
  criarCifraEmail,
  criarDespachanteEmail,
  criarServicoEmail,
  criarTransporteArquivo,
  derivarChaveEmail,
  type CifraEmail,
  type ResumoCicloEmail,
  type ServicoEmailDaApi,
} from '../../../apps/api/src/email';
import { decodificarPartes } from '../../../apps/api/src/email/apoio-teste';

export type ModeloEmail = 'acesso_inicial' | 'nova_senha';

/** `MensagemEmail` do §10 (estrutural: o tipo do SDK chega com a N5). */
export interface MensagemEmail {
  modelo: ModeloEmail;
  usuario_id: string;
  para: string;
  dados: {
    nome: string;
    empresa_nome: string;
    codigo_empresa: string;
    login: string;
    senha: string;
    validade_horas: number | null;
    apps: readonly string[];
    motivo?: 'esqueci' | 'redefinida';
  };
  chave_idempotencia: string;
}

export interface ServicoEmail {
  disponivel(): boolean;
  enfileirar(db: ClienteBanco, m: MensagemEmail): Promise<'enfileirado' | 'indisponivel'>;
}

export interface EmailAnotado extends MensagemEmail {
  /** id da linha em `plataforma.email_saida` (do insert do dublê, ou lido pela chave depois do `enfileirar` real). */
  id: string | null;
  tenant_id: string;
  caminho: 'real' | 'duble';
}

export interface EspiaoEmail extends ServicoEmail {
  /** Tudo o que as rotas pediram para enviar (inclusive o que a transação desfez). */
  readonly anotados: readonly EmailAnotado[];
  /** Só as mensagens com a linha confirmada na outbox (lida pela administração). */
  entregues(admin: pg.Pool): Promise<EmailAnotado[]>;
  /** Último e-mail confirmado para o usuário (ou undefined). */
  ultimoPara(admin: pg.Pool, usuarioId: string): Promise<EmailAnotado | undefined>;
  desligar(): void;
  ligar(): void;
  falharNaProxima(): void;
  /** Quantas vezes a porta REAL foi usada (0 = dublê em todas). */
  readonly usosDaReal: number;
}

const CHAVE = crypto.randomBytes(32);

function cifrar(texto: string, aad: string): Buffer {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', CHAVE, iv);
  c.setAAD(Buffer.from(aad, 'utf8'));
  const corpo = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), corpo]);
}

function portaDe(ctx: unknown): ServicoEmail | null {
  const e = (ctx as { email?: ServicoEmail } | null)?.email;
  return e && typeof e.enfileirar === 'function' && typeof e.disponivel === 'function' ? e : null;
}

/**
 * Espião da porta. `real` é a porta que o contexto trouxe (resolvida a cada chamada pelo `comEmail`); o espião anota e repassa
 * quando ela está disponível, senão grava pelo caminho do §10.
 */
export function criarEspiaoEmail(): EspiaoEmail & { comReal(real: ServicoEmail | null): ServicoEmail } {
  const anotados: EmailAnotado[] = [];
  let ligado = true;
  let falhar = false;
  let usosDaReal = 0;

  const enfileirarCom = async (real: ServicoEmail | null, db: ClienteBanco, m: MensagemEmail): Promise<'enfileirado' | 'indisponivel'> => {
    if (!ligado) return 'indisponivel';
    const tenant = (await db.query<{ t: string }>('select plataforma.tenant_atual()::text as t')).rows[0]!.t;
    let id: string | null = null;
    let caminho: EmailAnotado['caminho'] = 'duble';
    if (real && real.disponivel()) {
      caminho = 'real';
      usosDaReal += 1;
      const r = await real.enfileirar(db, m);
      if (r !== 'enfileirado') return r;
      id = (await db.query<{ id: string }>('select id::text as id from plataforma.email_saida where chave_idempotencia = $1', [m.chave_idempotencia])).rows[0]?.id ?? null;
    } else {
      const novo = crypto.randomUUID();
      const carga = cifrar(JSON.stringify({ para: m.para, dados: m.dados }), `${novo}|${tenant}|${m.modelo}`);
      const r = await db.query<{ id: string }>(
        `insert into plataforma.email_saida (id, tenant_id, usuario_id, modelo, chave_idempotencia, carga)
         values ($1, plataforma.tenant_atual(), $2, $3, $4, $5)
         on conflict (tenant_id, chave_idempotencia) do nothing
         returning id::text as id`,
        [novo, m.usuario_id, m.modelo, m.chave_idempotencia, carga],
      );
      id = r.rows[0]?.id ?? null;
    }
    if (id) anotados.push({ ...m, dados: { ...m.dados }, id, tenant_id: tenant, caminho });
    if (falhar) {
      falhar = false;
      throw new Error('falha simulada depois do enfileirar (teste da mesma transação)');
    }
    return 'enfileirado';
  };

  const confirmados = async (admin: pg.Pool): Promise<EmailAnotado[]> => {
    const ids = anotados.map((a) => a.id).filter((x): x is string => !!x);
    if (ids.length === 0) return [];
    const r = await admin.query<{ id: string }>('select id::text as id from plataforma.email_saida where id = any($1::uuid[])', [ids]);
    const existe = new Set(r.rows.map((x) => x.id));
    return anotados.filter((a) => a.id && existe.has(a.id));
  };

  const espiao = {
    get anotados() {
      return anotados;
    },
    get usosDaReal() {
      return usosDaReal;
    },
    disponivel: () => ligado,
    enfileirar: (db: ClienteBanco, m: MensagemEmail) => enfileirarCom(null, db, m),
    entregues: confirmados,
    async ultimoPara(admin: pg.Pool, usuarioId: string) {
      return (await confirmados(admin)).filter((a) => a.usuario_id === usuarioId).at(-1);
    },
    desligar() {
      ligado = false;
    },
    ligar() {
      ligado = true;
    },
    falharNaProxima() {
      falhar = true;
    },
    comReal(real: ServicoEmail | null): ServicoEmail {
      return { disponivel: () => ligado, enfileirar: (db, m) => enfileirarCom(real, db, m) };
    },
  };
  return espiao;
}

/** O módulo com o espião no `ctx.email` de todas as rotas (de módulo e públicas). A porta real do contexto, se houver, vai junto. */
export function comEmail(m: ModuloApi, espiao: ReturnType<typeof criarEspiaoEmail>): ModuloApi {
  const embrulhar = <T extends { executar: (ctx: never) => Promise<unknown> }>(r: T): T =>
    ({
      ...r,
      executar: (ctx: never) => r.executar({ ...(ctx as object), email: espiao.comReal(portaDe(ctx)) } as never),
    }) as T;
  return {
    ...m,
    ...(m.rotas ? { rotas: m.rotas.map(embrulhar) } : {}),
    ...(m.rotasPublicas ? { rotasPublicas: m.rotasPublicas.map(embrulhar) } : {}),
  };
}

/** Linhas da outbox de e-mail (pela administração), com o texto da linha inteira para varredura (a carga sai em hex). */
export async function outboxDeEmail(admin: pg.Pool): Promise<{ id: string; tenant_id: string; usuario_id: string; modelo: string; chave_idempotencia: string; tem_carga: boolean; bruto: string }[]> {
  const r = await admin.query<{ id: string; tenant_id: string; usuario_id: string; modelo: string; chave_idempotencia: string; tem_carga: boolean; bruto: string }>(
    `select id::text, tenant_id::text, usuario_id::text, modelo, chave_idempotencia, carga is not null as tem_carga, row_to_json(e)::text as bruto
       from plataforma.email_saida e order by created_at, id`,
  );
  return r.rows;
}

/** Algum dos textos aparece em claro dentro da carga (bytes) de alguma linha da outbox? Devolve os que aparecem. */
export async function textosNaCarga(admin: pg.Pool, textos: readonly string[]): Promise<string[]> {
  const achados: string[] = [];
  for (const t of new Set(textos)) {
    const r = await admin.query<{ n: number }>("select count(*)::int as n from plataforma.email_saida where carga is not null and position(convert_to($1, 'UTF8') in carga) > 0", [t]);
    if (r.rows[0]!.n > 0) achados.push(t);
  }
  return achados;
}

// ---------------------------------------------------------------------------------------------------------------------
// fatia S + N5: porta real, outbox decifrada, despachante e arquivo

/** Log que guarda cada linha em JSON (para a varredura de dado pessoal). */
export function logEmMemoria(destino: string[]): LogRota {
  const gravar = (nivel: string) => (o: Record<string, unknown>, m?: string) => void destino.push(JSON.stringify({ nivel, ...o, msg: m ?? '' }));
  return { info: gravar('info'), warn: gravar('warn'), error: gravar('error') };
}

/**
 * Porta REAL da API (como o `servidor.ts`: `criarServicoEmail({ cifra: criarCifraEmail(derivarChaveEmail(JWT)) })`), disponível
 * só enquanto o espião estiver ligado (`espiao.desligar()` = servidor sem adaptador também para o portal). Devolve a cifra para
 * o teste decifrar a outbox e para o despachante.
 */
export function portaRealDeTeste(espiao: Pick<EspiaoEmail, 'disponivel'>, op: { segredoJwt: string; log: LogRota }): { porta: ServicoEmailDaApi; cifra: CifraEmail } {
  const cifra = criarCifraEmail(derivarChaveEmail(op.segredoJwt));
  const real = criarServicoEmail({ cifra, log: op.log });
  const porta: ServicoEmailDaApi = {
    disponivel: () => espiao.disponivel() && real.disponivel(),
    enfileirar: (db, m) => real.enfileirar(db, m),
    cifrar: (carga, aad) => real.cifrar(carga, aad),
  };
  return { porta, cifra };
}

/** Uma linha da outbox decifrada com a chave da porta (o conteúdo do e-mail, sem passar pelo despachante). */
export async function cargaDaOutbox(admin: pg.Pool, id: string, cifra: CifraEmail): Promise<CargaEmail & { modelo: ModeloEmailSdk; tenant_id: string }> {
  const r = await admin.query<{ tenant_id: string; modelo: ModeloEmailSdk; carga: Buffer | null }>('select tenant_id::text, modelo, carga from plataforma.email_saida where id = $1', [id]);
  const l = r.rows[0];
  if (!l?.carga) throw new Error(`outbox: linha ${id} sem carga`);
  return { ...cifra.decifrar(l.carga, { id, tenant_id: l.tenant_id, modelo: l.modelo }), modelo: l.modelo, tenant_id: l.tenant_id };
}

/** Despachante REAL (papel `macuxi_worker`) com o adaptador de arquivo: ciclos até a fila esvaziar (teto de 50 ciclos). */
export async function despacharParaArquivo(op: { urlWorker: string; cifra: CifraEmail; pasta: string; log: LogRota; agora?: () => Date }): Promise<ResumoCicloEmail> {
  const worker = new pg.Pool({ connectionString: op.urlWorker, max: 1 });
  try {
    const despachante = criarDespachanteEmail({
      worker,
      transporte: criarTransporteArquivo({ pasta: op.pasta, log: op.log }),
      cifra: op.cifra,
      remetente: { email: 'nao-responda@exemplo.com.br', nome: 'Macuxi FDV' },
      log: op.log,
      ...(op.agora ? { agora: op.agora } : {}),
    });
    const total: ResumoCicloEmail = { lidos: 0, enviados: 0, adiados: 0, falhos: 0 };
    for (let i = 0; i < 50; i++) {
      const r = await despachante.ciclo();
      total.lidos += r.lidos;
      total.enviados += r.enviados;
      total.adiados += r.adiados;
      total.falhos += r.falhos;
      if (r.lidos === 0) break;
    }
    return total;
  } finally {
    await worker.end();
  }
}

export interface ArquivoEmail {
  nome: string;
  /** `email_saida.id` tirado do nome `<AAAAMMDDTHHMMSSZ>-<id>.eml`. */
  id: string;
  bruto: string;
  texto: string;
  html: string;
}

/** Os `.eml` gravados pelo adaptador de arquivo, com texto e HTML decodificados (base64). */
export async function lerArquivosEmail(pasta: string): Promise<ArquivoEmail[]> {
  const nomes = (await readdir(pasta).catch(() => [] as string[])).filter((n) => n.endsWith('.eml')).sort();
  const saida: ArquivoEmail[] = [];
  for (const nome of nomes) {
    const bruto = await readFile(join(pasta, nome), 'utf8');
    const { texto, html } = decodificarPartes(bruto);
    saida.push({ nome, id: /^\d{8}T\d{6}Z-([0-9a-f-]{36})\.eml$/.exec(nome)?.[1] ?? '', bruto, texto, html });
  }
  return saida;
}

const PALAVRA_CODIFICADA = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;

/**
 * O `Subject` de um `.eml`, desdobrado (RFC 5322 §2.2.3) e com as encoded-words decodificadas (RFC 2047, `B` e `Q`): o mesmo
 * texto vale para o assunto em texto puro e em encoded-word. Espaço entre duas encoded-words seguidas some (RFC 2047 §6.2).
 * Sem `Subject` no cabeçalho: `undefined`.
 */
export function assuntoDoEml(bruto: string): string | undefined {
  const cabecalho = bruto.split(/\r?\n\r?\n/, 1)[0] ?? '';
  const achado = /^Subject:[ \t]*(.*(?:\r?\n[ \t].*)*)/im.exec(cabecalho);
  if (!achado) return undefined;
  const desdobrado = (achado[1] ?? '').replace(/\r?\n(?=[ \t])/g, '');
  return desdobrado
    .replace(/(\?=)[ \t]+(?==\?[^?]+\?[BbQq]\?)/g, '$1')
    .replace(PALAVRA_CODIFICADA, (_p, charset: string, modo: string, texto: string) => {
      const bytes =
        modo.toUpperCase() === 'B'
          ? Buffer.from(texto, 'base64')
          : Buffer.from(texto.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_h, hex: string) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
      return new TextDecoder(charset).decode(bytes);
    });
}
