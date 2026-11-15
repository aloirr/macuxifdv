/**
 * Servidor de sync simulado (rede injetável) para testes do motor, dos shells e das telas dos módulos.
 * Aplica as mesmas regras da API real que já estão no SDK: `rejeitarItensInvalidos` (entidade
 * desconhecida, MODULO_INATIVO, payload inválido) e `paginar` (cursor `(updated_at, id)`, inclui removidos).
 * ADR 0009: `versoesEscopo` (versão do conjunto visível por entidade), `semProvedor` (pull 501) e `semReceptor`
 * (push `rejeitado/SYNC_NAO_IMPLEMENTADO`), como a API real. D-3: com `relogio`, o aceito leva `em` e a página leva
 * `horizonte` (`relogio() - margemHorizonteMs`), como a API real. ADR 0021: `geracao_base` vai em toda página e nas novidades.
 * ADR 0054: com `comPacotes`, serve o manifesto `GET /v1/sync/pacotes` (`manifestoPacotes`); `conteudoDoPacoteSimulado`
 * monta as linhas e as entidades de um pacote como o gerador da API (só vivas abaixo do horizonte, cursor com o UUID nulo).
 */
import type { ModuloId } from './nomes';
import { codificarCursorNovidades, decodificarCursorNovidades, UUID_NIL, type NovidadesResposta } from './novidades';
import type { EntidadePacoteSync, PacotesSyncResposta } from './pacotes-sync';
import type { TransporteSync } from './motor-sync';
import type { ItemPush, LinhaSync, RegistroSync, ResultadoItemPush } from './sync';
import {
  codificarCursor,
  MENSAGEM_ENVIO_INDISPONIVEL,
  paginar,
  PushRequestSchema,
  rejeitarItensInvalidos,
  SYNC_NAO_IMPLEMENTADO,
} from './sync';

export class ErroRedeSimulada extends Error {
  constructor() {
    super('Sem conexão com o servidor.');
    this.name = 'ErroRedeSimulada';
  }
}

/** 501 `SYNC_NAO_IMPLEMENTADO` da API real (o transporte do app lança o `HttpError` com o mesmo status e código). */
export class ErroSyncNaoImplementadoSimulado extends Error {
  readonly status = 501;
  readonly codigo = SYNC_NAO_IMPLEMENTADO;
  constructor(entidade: string) {
    super(`O pull de ${entidade} ainda não está disponível no servidor.`);
    this.name = 'ErroSyncNaoImplementadoSimulado';
  }
}

export interface ServidorSyncSimulado extends TransporteSync {
  /** `false` = toda chamada falha como falta de rede. */
  online: boolean;
  /** Módulos efetivos do usuário no servidor (licença checada por requisição). */
  modulosAtivos: ModuloId[];
  /** Linhas por entidade servidas no pull. */
  linhas: Record<string, LinhaSync[]>;
  /** Itens aceitos, por id (idempotente: reenvio não duplica). */
  recebidos: Map<string, ItemPush>;
  /** Rejeição forçada por id (ex.: regra de negócio RN-VEN-...). */
  rejeitar: Map<string, { codigo: string; mensagem: string }>;
  /** `novidades` só existe com `comNovidades` (os testes antigos comparam `{ push, pull }`). */
  chamadas: { push: number; pull: number; novidades?: number; pacotes?: number };
  tamanhoPagina: number;
  /** `versao_escopo` devolvida em toda página da entidade (ausente = escopo sem versão). */
  versoesEscopo: Record<string, string>;
  /** Entidades sem provedor de pull no servidor: o pull lança 501 `SYNC_NAO_IMPLEMENTADO`. */
  semProvedor: Set<string>;
  /** Entidades sem `receber`: o push devolve `rejeitado/SYNC_NAO_IMPLEMENTADO` por item. */
  semReceptor: Set<string>;
  /** Relógio do "banco" (D-3): com ele, o aceito leva `em` e a página `horizonte`. `null` = servidor sem os campos. */
  relogio: (() => Date) | null;
  /** Margem do horizonte (padrão 2 s, como a API). */
  margemHorizonteMs: number;
  /** Parâmetros do tenant por módulo devolvidos em `novidades().modulos` (como `GET /v1/me/modulos`). */
  parametros: Partial<Record<ModuloId, Record<string, unknown>>>;
  /** Geração da base (ADR 0021) em toda página do pull e nas novidades; `null` = servidor sem o campo. */
  geracao_base: string | null;
  /** ADR 0054 (`comPacotes`): manifesto devolvido por `pacotes()`; sem `geracao_base`, vai a do servidor. */
  manifestoPacotes: PacotesSyncResposta;
  /** ADR 0054: `pacotes()` lança este erro (ex.: 500 do servidor); `null` = responde o manifesto. */
  falhaPacotes: Error | null;
}

/**
 * ADR 0054: o que o gerador da API poria no pacote das `entidades` com o `horizonte`: só linhas vivas com `updated_at`
 * abaixo dele, `linhas` contadas, cursor `(horizonte, UUID nulo)` e a `versao_escopo` do servidor.
 */
export function conteudoDoPacoteSimulado(
  s: Pick<ServidorSyncSimulado, 'linhas' | 'versoesEscopo'>,
  entidades: readonly string[],
  horizonte: string,
): { entidades: EntidadePacoteSync[]; linhas: Record<string, LinhaSync[]> } {
  const limite = Date.parse(horizonte);
  const linhas: Record<string, LinhaSync[]> = {};
  for (const e of entidades)
    linhas[e] = (s.linhas[e] ?? []).filter((l) => !l.deleted_at && Date.parse(l.updated_at) < limite);
  return {
    linhas,
    entidades: entidades.map((nome) => ({
      nome,
      linhas: linhas[nome]!.length,
      cursor: codificarCursor({ updated_at: horizonte, id: UUID_NIL }),
      ...(s.versoesEscopo[nome] === undefined ? {} : { versao_escopo: s.versoesEscopo[nome] }),
    })),
  };
}

/** Hash curto (djb2, hex) só para o cursor simulado: o SDK roda no aparelho, sem `node:crypto`. */
function hashCurto(texto: string): string {
  let h = 5381;
  for (let i = 0; i < texto.length; i++) h = ((h << 5) + h + texto.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export function criarServidorSyncSimulado(
  registro: RegistroSync,
  inicial: Partial<Pick<ServidorSyncSimulado, 'modulosAtivos' | 'linhas' | 'tamanhoPagina'>> & {
    /** RN-CORE-23 (ADR 0018): serve `novidades` como `GET /v1/sync/novidades` (exige `relogio` para o horizonte). */
    comNovidades?: boolean;
    /** ADR 0054: serve `pacotes` (`GET /v1/sync/pacotes`) com `manifestoPacotes`. */
    comPacotes?: boolean;
  } = {},
): ServidorSyncSimulado {
  const s: ServidorSyncSimulado = {
    online: true,
    modulosAtivos: inicial.modulosAtivos ?? [],
    linhas: inicial.linhas ?? {},
    recebidos: new Map(),
    rejeitar: new Map(),
    chamadas: {
      push: 0,
      pull: 0,
      ...(inicial.comNovidades ? { novidades: 0 } : {}),
      ...(inicial.comPacotes ? { pacotes: 0 } : {}),
    },
    tamanhoPagina: inicial.tamanhoPagina ?? 1000,
    versoesEscopo: {},
    semProvedor: new Set(),
    semReceptor: new Set(),
    relogio: null,
    margemHorizonteMs: 2_000,
    parametros: {},
    geracao_base: null,
    manifestoPacotes: { pacotes: [] },
    falhaPacotes: null,
    async push(itens) {
      s.chamadas.push++;
      if (!s.online) throw new ErroRedeSimulada();
      const req = PushRequestSchema.parse({ itens });
      const { validos, rejeitados } = rejeitarItensInvalidos(req, registro, s.modulosAtivos);
      const saida: ResultadoItemPush[] = [...rejeitados];
      for (const it of validos) {
        const forcado = s.rejeitar.get(it.id);
        if (s.semReceptor.has(it.entidade))
          saida.push({
            id: it.id,
            status: 'rejeitado',
            codigo: SYNC_NAO_IMPLEMENTADO,
            mensagem: MENSAGEM_ENVIO_INDISPONIVEL,
          });
        else if (forcado) saida.push({ id: it.id, status: 'rejeitado', ...forcado });
        else {
          s.recebidos.set(it.id, it);
          saida.push(s.relogio ? { id: it.id, status: 'aceito', em: s.relogio().toISOString() } : { id: it.id, status: 'aceito' });
        }
      }
      return itens.map((i) => saida.find((r) => r.id === i.id)!).filter(Boolean);
    },
    async pull(entidade, cursor) {
      s.chamadas.pull++;
      if (!s.online) throw new ErroRedeSimulada();
      if (s.semProvedor.has(entidade)) throw new ErroSyncNaoImplementadoSimulado(entidade);
      const horizonte = s.relogio ? new Date(s.relogio().getTime() - s.margemHorizonteMs) : null;
      // como a API: só linhas abaixo do horizonte
      const visiveis = (s.linhas[entidade] ?? []).filter((l) => !horizonte || Date.parse(l.updated_at) < horizonte.getTime());
      const pagina = paginar(visiveis, cursor, s.tamanhoPagina);
      const versao = s.versoesEscopo[entidade];
      return {
        ...pagina,
        ...(versao === undefined ? {} : { versao_escopo: versao }),
        ...(horizonte ? { horizonte: horizonte.toISOString() } : {}),
        ...(s.geracao_base ? { geracao_base: s.geracao_base } : {}),
      };
    },
  };
  if (inicial.comPacotes) {
    s.pacotes = async (): Promise<PacotesSyncResposta> => {
      s.chamadas.pacotes = (s.chamadas.pacotes ?? 0) + 1;
      if (!s.online) throw new ErroRedeSimulada();
      if (s.falhaPacotes) throw s.falhaPacotes;
      return {
        ...(s.geracao_base ? { geracao_base: s.geracao_base } : {}),
        ...s.manifestoPacotes,
      };
    };
  }
  if (inicial.comNovidades) {
    s.novidades = async (desde): Promise<NovidadesResposta> => {
      s.chamadas.novidades = (s.chamadas.novidades ?? 0) + 1;
      if (!s.online) throw new ErroRedeSimulada();
      const horizonte = new Date((s.relogio?.() ?? new Date()).getTime() - s.margemHorizonteMs).toISOString();
      const ativos = [...s.modulosAtivos].sort();
      const licencas = hashCurto(JSON.stringify(ativos.map((m) => [m, s.parametros[m] ?? {}])));
      const elegiveis = registro
        .entidadesAtivas(s.modulosAtivos, 'pull')
        .map((e) => e.nome)
        .filter((e) => !s.semProvedor.has(e));
      const escopo = hashCurto(JSON.stringify(elegiveis.map((e) => s.versoesEscopo[e] ?? '')));
      const c = decodificarCursorNovidades(desde);
      const modulosMudaram = !c || c.licencas !== licencas;
      const todas = modulosMudaram || c.escopo !== escopo;
      const limite = Date.parse(horizonte);
      const entidades = todas
        ? elegiveis
        : elegiveis.filter((e) =>
            (s.linhas[e] ?? []).some((l) => {
              const t = Date.parse(l.updated_at);
              return t >= Date.parse(c.horizonte) && t < limite;
            }),
          );
      return {
        entidades,
        cursor: codificarCursorNovidades({ horizonte, licencas, escopo }),
        horizonte,
        modulos_mudaram: modulosMudaram,
        ...(modulosMudaram
          ? { modulos: { modulos: ativos.map((id) => ({ id, parametros: s.parametros[id] ?? {} })), versao_licencas: licencas } }
          : {}),
        ...(s.geracao_base ? { geracao_base: s.geracao_base } : {}),
      };
    };
  }
  return s;
}
