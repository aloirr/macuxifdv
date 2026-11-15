/**
 * Trabalhos sob demanda dos módulos (ADR 0054 §2; `ModuloApi.trabalhos`, `TrabalhoSobDemanda` do SDK), no processo do worker.
 *
 * 1. Disparo: o módulo publica `disparadoPor` (evento próprio) na transação que pede o trabalho. Para o despachante da outbox,
 *    cada trabalho é um consumidor do módulo (`consumidoresDosTrabalhos`) que só grava UMA linha em `plataforma.trabalho`
 *    (`on conflict do nothing`: um vivo por tenant, módulo, nome e alvo), com o `evento_consumo` na mesma transação.
 * 2. Laço (`criarLacoTrabalhos`): `plataforma.trabalho_reservar` (papel `macuxi_worker`, SECURITY DEFINER, `skip locked`,
 *    trava com prazo) entrega um trabalho por vez; licença do módulo no tenant (`licencasDoTenantNoBanco`): sem ela,
 *    `adiar` 15 min sem contar tentativa. `executarFatia` roda até `PRAZO_FATIA_MS` (`ctx.deveParar()`); cada
 *    `ctx.emTransacao` é uma transação curta nova (`macuxi_app`, RLS, autor = sistema) e renova a trava a cada 30 s.
 *    `continua` → volta já; `concluido` → fim; exceção → tentativa + 1 com espera de 30 s × 2^(n−1); na última
 *    (`TENTATIVAS_TRABALHO_MAX`) a plataforma chama `aoFalhar` e o trabalho para (`falhou`). Só o CÓDIGO do erro vai ao banco.
 * 3. Arquivos (`ArquivosDoTrabalho`): `abrirZip` junta as partes num temporário do processo (`MACUXI_TRABALHOS_TMP`, padrão
 *    o temporário do sistema; reaproveitado entre fatias) e abre com `leitor-zip.ts`; `guardarImagem` decodifica
 *    (`decodificadores.ts`), grava o original e a miniatura FORA da transação; `descartar` apaga as partes e marca a linha.
 * Rede e disco nunca dentro da transação (T-0121). Log: tenant_id, modulo, trabalho, alvo_id, fatia e contagens; nunca nome
 * de arquivo, código de produto ou dado pessoal.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, rm, stat } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  definirConsumidor,
  dimensoesImagem,
  ErroHttpModulo,
  fusoDoTenantOuPadrao,
  LIMITES_ZIP_TETO,
  modulosEfetivos,
  partesDoEnvio,
  PARTES_ENVIO_MAX,
  PRAZO_FATIA_MS,
  TENTATIVAS_TRABALHO_MAX,
  USUARIO_SISTEMA_ID,
  type AcessoBanco,
  type ArquivosDoTrabalho,
  type ConsumidorEvento,
  type ContextoTrabalho,
  type LimitesZip,
  type LogRota,
  type ModuloApi,
  type ModuloId,
  type TrabalhoSobDemanda,
  type TransacaoTrabalho,
} from '@macuxi/platform-sdk';
import type pg from 'pg';
import { chaveDaMiniatura, ErroMiniatura } from './miniatura';
import { chaveDaParte, chaveDoArquivo, type ArmazenamentoArquivos } from './arquivos';
import { miniaturaDeImagem, tiposDecodificaveis } from './decodificadores';
import { abrirZipLocal, juntarPartes } from './leitor-zip';
import { licencasDoTenantNoBanco, type LicencasTenant } from './licencas';
import { mensagemSegura } from './log-seguro';
import { infoArquivoNoBanco, publicadorTenant, registrarArquivoNoBanco, registroDeConsultas, transacaoTenant } from './outbox';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Nome do consumidor/trabalho nos logs: `<modulo>.<nome>`. */
const rotulo = (modulo: string, nome: string) => `${modulo}.${nome}`;

/**
 * Consumidores que a plataforma registra para os trabalhos de um módulo (o despachante os trata como do módulo): gravam o
 * pedido em `plataforma.trabalho` e nada mais. `definirModuloApi` já garante que o evento não tem outro consumidor no módulo.
 */
export function consumidoresDosTrabalhos(m: Pick<ModuloApi, 'manifesto' | 'trabalhos'>): ConsumidorEvento[] {
  return (m.trabalhos ?? []).map((t) =>
    definirConsumidor({
      evento: t.disparadoPor,
      async executar(payload, ctx) {
        const alvo = t.alvo(payload);
        if (typeof alvo !== 'string' || !UUID_RE.test(alvo)) throw new Error(`trabalho ${rotulo(m.manifesto.id, t.nome)}: alvo precisa ser UUID`);
        await ctx.db.query(
          `insert into plataforma.trabalho (id, tenant_id, modulo, nome, alvo_id, evento_id) values ($1, $2, $3, $4, $5, $6)
           on conflict (tenant_id, modulo, nome, alvo_id) where deleted_at is null do nothing`,
          [randomUUID(), ctx.envelope.tenant_id, m.manifesto.id, t.nome, alvo.toLowerCase(), ctx.envelope.evento_id],
        );
      },
    }),
  );
}

/** Consumidores de eventos do módulo + os dos trabalhos (o que o despachante entrega). */
export function consumidoresDoModulo(m: Pick<ModuloApi, 'manifesto' | 'consumidores' | 'trabalhos'>): readonly ConsumidorEvento[] {
  return [...(m.consumidores ?? []), ...consumidoresDosTrabalhos(m)];
}

export interface OpcoesTrabalhos {
  /** Pool com o papel `macuxi_worker` (só chama as funções `plataforma.trabalho_*`). */
  worker: Pick<pg.Pool, 'query'>;
  /** Banco `macuxi_app` (`criarBancoApp`): licenças e as transações do trabalho, sempre em `comTenant`. */
  app: AcessoBanco;
  modulos: readonly ModuloApi[];
  /** Bytes dos arquivos; `null` = `abrirZip`/`guardarImagem` falham (o trabalho volta com espera). */
  armazenamento: ArmazenamentoArquivos | null;
  /** Pasta dos temporários (padrão: `MACUXI_TRABALHOS_TMP` ou o temporário do sistema). */
  dirTemp?: string;
  licencasNoTenant?: (tenantId: string) => Promise<LicencasTenant>;
  agora?: () => Date;
  log?: LogRota;
  /** Para testes; padrão `PRAZO_FATIA_MS`. */
  prazoFatiaMs?: number;
}

/** Trava de um trabalho reservado (renovada a cada 30 s de fatia). */
export const TRAVA_TRABALHO_S = 120;
const RENOVAR_A_CADA_MS = 30_000;
/** Módulo sem licença no tenant: volta daqui a 15 min, sem contar tentativa. */
export const ESPERA_SEM_LICENCA_S = 900;
/** Temporários de ZIP guardados por processo (os mais antigos saem). */
const TEMPORARIOS_MAX = 3;
const DIA_MS = 86_400_000;

/** 30 s, 60 s, 120 s… depois da n-ésima falha (n ≥ 1). */
export function esperaTrabalhoS(tentativas: number): number {
  return Math.min(30 * 2 ** Math.max(0, tentativas - 1), 3600);
}

/** Só o código do erro (o CHECK do banco aceita `^[A-Za-z0-9_.:-]{1,100}$`): nunca mensagem nem dado. */
export function codigoDoErro(e: unknown): string {
  const bruto = e instanceof ErroHttpModulo ? e.codigo : e instanceof Error ? e.name : 'ERRO';
  const limpo = bruto.replace(/[^A-Za-z0-9_.:-]/g, '_').slice(0, 100);
  return limpo || 'ERRO';
}

interface LinhaReservada {
  id: string;
  tenant_id: string;
  modulo: string;
  nome: string;
  alvo_id: string;
  tentativas: number;
  fatias: number;
}

type Resultado = 'continua' | 'concluido' | 'adiar' | 'erro';

const semLog: LogRota = { info: () => undefined, warn: () => undefined, error: () => undefined };

export function criarLacoTrabalhos(op: OpcoesTrabalhos) {
  const relogio = op.agora ?? (() => new Date());
  const log = op.log ?? semLog;
  const prazoFatia = op.prazoFatiaMs ?? PRAZO_FATIA_MS;
  const manifestos = op.modulos.map((m) => m.manifesto);
  const instalados = manifestos.map((m) => m.id);
  const consultas = registroDeConsultas(op.modulos);
  const fonteLicencas = op.licencasNoTenant ?? ((tenantId: string) => licencasDoTenantNoBanco(tenantId, op.app));
  const porChave = new Map<string, { modulo: ModuloId; trabalho: TrabalhoSobDemanda }>();
  for (const m of op.modulos) for (const t of m.trabalhos ?? []) porChave.set(rotulo(m.manifesto.id, t.nome), { modulo: m.manifesto.id, trabalho: t });
  const processo = `${hostname().slice(0, 100)}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const raizTemp = join(op.dirTemp ?? (process.env.MACUXI_TRABALHOS_TMP?.trim() || tmpdir()), 'macuxi-trabalhos');
  const dirTemp = join(raizTemp, processo.replace(/[^A-Za-z0-9_.-]/g, '_'));
  /** arquivoId → temporário já juntado (com o SHA) e último uso. */
  const temporarios = new Map<string, { caminho: string; sha256: string; usadoEm: number }>();
  let parando = false;

  async function devolver(id: string, resultado: Resultado, erro: string | null, esperaS: number | null): Promise<boolean> {
    const r = await op.worker.query<{ ok: boolean }>('select plataforma.trabalho_devolver($1, $2, $3, $4, $5) as ok', [id, processo, resultado, erro, esperaS]);
    return r.rows[0]?.ok === true;
  }

  async function guardarTemporario(arquivoId: string, caminho: string, sha256: string): Promise<void> {
    temporarios.set(arquivoId, { caminho, sha256, usadoEm: Date.now() });
    const sobra = [...temporarios.entries()].sort((a, b) => a[1].usadoEm - b[1].usadoEm).slice(0, Math.max(0, temporarios.size - TEMPORARIOS_MAX));
    for (const [id, t] of sobra) {
      temporarios.delete(id);
      await rm(t.caminho, { force: true });
    }
  }

  function arquivosDoTrabalho(tenantId: string, modulo: ModuloId, logT: LogRota): ArquivosDoTrabalho {
    const armazenamento = () => {
      if (!op.armazenamento) throw new Error('armazenamento de arquivos indisponível no worker');
      return op.armazenamento;
    };
    const linha = (arquivoId: string) =>
      op.app.comTenant(tenantId, async (db) =>
        (
          await db.query<{ tipo: string; situacao: string; tamanho_bytes: number | null; chave_armazenamento: string | null }>(
            `select tipo, situacao, tamanho_bytes, chave_armazenamento from plataforma.arquivo where id = $1 and modulo = $2 and deleted_at is null`,
            [arquivoId.toLowerCase(), modulo],
          )
        ).rows[0],
      );
    return {
      async abrirZip(arquivoId, pedidos) {
        // os limites do módulo só baixam o teto da plataforma
        const limites = Object.fromEntries(
          (Object.keys(LIMITES_ZIP_TETO) as (keyof LimitesZip)[]).map((k) => [k, Math.min(pedidos[k], LIMITES_ZIP_TETO[k])]),
        ) as unknown as LimitesZip;
        const l = await linha(arquivoId);
        if (!l || l.tipo !== 'application/zip' || l.situacao !== 'recebido' || !l.chave_armazenamento || l.tamanho_bytes === null)
          return { ok: false, motivo: 'zip_incompleto' };
        const tamanho = Number(l.tamanho_bytes);
        if (tamanho > limites.bytesZipMax) return { ok: false, motivo: 'zip_grande' };
        let t = temporarios.get(arquivoId);
        if (t && !(await stat(t.caminho).catch(() => null))) t = undefined;
        if (!t) {
          await mkdir(dirTemp, { recursive: true });
          const caminho = join(dirTemp, `${arquivoId.toLowerCase()}.zip`);
          const inicio = Date.now();
          const j = await juntarPartes({ armazenamento: armazenamento(), chaveParte1: l.chave_armazenamento, tamanhoBytes: tamanho, destino: caminho });
          if (!j.ok) {
            await rm(caminho, { force: true });
            return j;
          }
          await guardarTemporario(arquivoId, caminho, j.sha256);
          t = temporarios.get(arquivoId)!;
          logT.info({ tamanho_bytes: tamanho, ms: Date.now() - inicio }, 'zip juntado no temporário');
        }
        t.usadoEm = Date.now();
        return abrirZipLocal(t.caminho, limites, { tiposDecodificaveis: tiposDecodificaveis(), sha256: t.sha256 });
      },
      async guardarImagem(e) {
        if (!UUID_RE.test(e.id)) throw new Error('guardarImagem: id precisa ser UUID');
        let mini: Uint8Array;
        const dim = dimensoesImagem(e.bytes, e.tipo);
        try {
          if (!dim) throw new ErroMiniatura('cabeçalho ilegível');
          mini = miniaturaDeImagem(e.bytes, e.tipo).bytes;
        } catch (x) {
          if (x instanceof ErroMiniatura) return { ok: false, motivo: 'foto_ilegivel' };
          throw x;
        }
        const chave = chaveDoArquivo({ tenant_id: tenantId, modulo, id: e.id }, relogio(), e.tipo);
        const a = armazenamento();
        await a.gravar(chave, e.bytes);
        await a.gravar(chaveDaMiniatura(chave), mini);
        return {
          ok: true,
          recebido: {
            sha256: createHash('sha256').update(e.bytes).digest('hex'),
            tamanho_bytes: e.bytes.length,
            largura_px: dim!.largura,
            altura_px: dim!.altura,
            tipo: e.tipo,
            chave,
          },
        };
      },
      async descartar(arquivoId) {
        const l = await linha(arquivoId);
        const t = temporarios.get(arquivoId);
        temporarios.delete(arquivoId);
        if (t) await rm(t.caminho, { force: true });
        if (!l) return;
        if (l.tipo !== 'application/zip') throw new Error('descartar: só o arquivo enviado em partes');
        if (l.chave_armazenamento) {
          const partes = l.tamanho_bytes === null ? PARTES_ENVIO_MAX : partesDoEnvio(Number(l.tamanho_bytes));
          const a = armazenamento();
          for (let n = 1; n <= partes; n += 1) await a.remover(chaveDaParte(l.chave_armazenamento, n));
        }
        await op.app.comTenant(tenantId, (db) =>
          db.query('update plataforma.arquivo set deleted_at = now() where id = $1 and modulo = $2 and deleted_at is null', [arquivoId.toLowerCase(), modulo]),
        );
      },
    };
  }

  /** Um passo: reserva um trabalho e roda uma fatia. `'vazio'` = nada a fazer agora. */
  async function ciclo(): Promise<'vazio' | Resultado> {
    const r = await op.worker.query<LinhaReservada>('select * from plataforma.trabalho_reservar($1, $2)', [processo, TRAVA_TRABALHO_S]);
    const l = r.rows[0];
    if (!l) return 'vazio';
    const inicio = Date.now();
    const campos = { tenant_id: l.tenant_id, modulo: l.modulo, trabalho: l.nome, alvo_id: l.alvo_id, fatia: l.fatias, tentativa: l.tentativas };
    const logT: LogRota = {
      info: (o, msg) => log.info({ ...campos, ...o }, msg),
      warn: (o, msg) => log.warn({ ...campos, ...o }, msg),
      error: (o, msg) => log.error({ ...campos, ...o }, msg),
    };
    const reg = porChave.get(rotulo(l.modulo, l.nome));
    let lic: LicencasTenant;
    let efetivos: ModuloId[];
    try {
      lic = await fonteLicencas(l.tenant_id);
      efetivos = modulosEfetivos({ manifestos, ativosNoTenant: lic.ativosNoTenant, doPerfil: instalados });
    } catch (e) {
      logT.warn({ erro: mensagemSegura(e) }, 'trabalho: licenças do tenant falharam');
      await devolver(l.id, 'adiar', null, 60);
      return 'adiar';
    }
    if (!reg || !efetivos.includes(reg.modulo)) {
      // módulo não instalado neste processo ou sem licença no tenant (RN-CORE-02/03): espera sem contar tentativa
      logT.info({ instalado: !!reg }, 'trabalho adiado: módulo sem licença no tenant');
      await devolver(l.id, 'adiar', null, ESPERA_SEM_LICENCA_S);
      return 'adiar';
    }
    const { modulo, trabalho } = reg;
    const fuso = fusoDoTenantOuPadrao(lic.fuso);
    const parametros = (m: ModuloId) => lic.parametros[m] ?? {};
    let renovadoEm = Date.now();
    const ctx: ContextoTrabalho = {
      tenantId: l.tenant_id,
      alvoId: l.alvo_id,
      fatia: l.fatias,
      tentativa: l.tentativas,
      async emTransacao(fn) {
        if (Date.now() - renovadoEm > RENOVAR_A_CADA_MS) {
          const ok = await op.worker.query<{ ok: boolean }>('select plataforma.trabalho_renovar($1, $2, $3) as ok', [l.id, processo, TRAVA_TRABALHO_S]);
          if (ok.rows[0]?.ok !== true) throw new Error('trava do trabalho perdida');
          renovadoEm = Date.now();
        }
        const requestId = randomUUID();
        return op.app.comTenant(l.tenant_id, (db) => {
          const origem = { manifestos, modulo, tenantId: l.tenant_id, usuarioId: null, requestId, agora: relogio };
          const tx = transacaoTenant(db, {
            ...origem,
            usuario: { id: USUARIO_SISTEMA_ID, tenant_id: l.tenant_id, perfil: 'admin', modulos: efetivos },
            modulosDoTenant: efetivos,
            consultas,
            parametros,
            fuso: () => fuso,
            log: logT,
          });
          const t: TransacaoTrabalho = {
            db,
            publicar: publicadorTenant(db, origem),
            consultar: tx.consultar,
            registrarArquivo: (a) => registrarArquivoNoBanco(db, { tenantId: l.tenant_id, modulo, enviadoPor: a.enviado_por }, a),
            infoArquivo: (id) => infoArquivoNoBanco(db, modulo, id),
          };
          return fn(t);
        });
      },
      arquivos: arquivosDoTrabalho(l.tenant_id, modulo, logT),
      deveParar: () => parando || Date.now() - inicio >= prazoFatia,
      parametros: () => parametros(modulo),
      fuso: () => fuso,
      agora: relogio,
      log: logT,
    };

    const falhar = async (codigo: string): Promise<Resultado> => {
      try {
        await trabalho.aoFalhar(l.alvo_id, ctx, { codigo });
      } catch (e) {
        logT.error({ erro: mensagemSegura(e) }, 'aoFalhar do trabalho falhou; tenta de novo depois');
        await devolver(l.id, 'erro', codigoDoErro(e), esperaTrabalhoS(l.tentativas + 1));
        return 'erro';
      }
      logT.error({ codigo }, 'trabalho falhou: tentativas esgotadas');
      await devolver(l.id, 'erro', codigo, null);
      return 'erro';
    };

    // tentativas já esgotadas (o aoFalhar anterior não confirmou): só tenta marcar a falha
    if (l.tentativas >= TENTATIVAS_TRABALHO_MAX) return falhar('TENTATIVAS_ESGOTADAS');
    try {
      const resultado = await trabalho.executarFatia(l.alvo_id, ctx);
      if (resultado !== 'continua' && resultado !== 'concluido') throw new Error('executarFatia devolveu resultado inválido');
      const ok = await devolver(l.id, resultado, null, null);
      if (!ok) logT.warn({}, 'trava perdida antes de devolver a fatia');
      logT.info({ resultado, ms: Date.now() - inicio }, 'fatia do trabalho');
      return resultado;
    } catch (e) {
      const codigo = codigoDoErro(e);
      logT.warn({ erro: mensagemSegura(e), codigo }, 'fatia do trabalho falhou');
      if (l.tentativas + 1 >= TENTATIVAS_TRABALHO_MAX) return falhar(codigo);
      await devolver(l.id, 'erro', codigo, esperaTrabalhoS(l.tentativas + 1));
      return 'erro';
    }
  }

  /** Remove temporários de processos antigos (mais de 1 dia), deixados por um worker que caiu. */
  async function limparTemporariosAntigos(): Promise<void> {
    const nomes = await readdir(raizTemp).catch(() => [] as string[]);
    for (const n of nomes) {
      const c = join(raizTemp, n);
      const s = await stat(c).catch(() => null);
      if (s && Date.now() - s.mtimeMs > DIA_MS) await rm(c, { recursive: true, force: true });
    }
  }

  return {
    processo,
    /** `modulo.nome` dos trabalhos instalados. */
    trabalhos: (): readonly string[] => [...porChave.keys()],
    ciclo,
    /**
     * Laço do processo: um trabalho por vez; achou trabalho → próximo passo já; nada → espera `intervaloMs` (padrão
     * `MACUXI_TRABALHOS_INTERVALO_MS` ou 2 s). `parar()` pede para a fatia atual parar (`deveParar`) e espera.
     */
    iniciar(o: { intervaloMs?: number } = {}): { parar(): Promise<void> } {
      const intervalo = o.intervaloMs ?? Number(process.env.MACUXI_TRABALHOS_INTERVALO_MS ?? 2_000);
      let timer: ReturnType<typeof setTimeout> | undefined;
      let atual: Promise<void> = limparTemporariosAntigos().catch(() => undefined);
      const passo = async (): Promise<void> => {
        let achou = false;
        try {
          achou = (await ciclo()) !== 'vazio';
        } catch (e) {
          log.error({ erro: mensagemSegura(e) }, 'ciclo dos trabalhos falhou');
        }
        if (!parando) timer = setTimeout(() => (atual = passo()), achou ? 0 : intervalo);
      };
      atual = atual.then(passo);
      return {
        async parar() {
          parando = true;
          if (timer) clearTimeout(timer);
          await atual;
          await rm(dirTemp, { recursive: true, force: true }).catch(() => undefined);
        },
      };
    },
  };
}

export type LacoTrabalhos = ReturnType<typeof criarLacoTrabalhos>;
