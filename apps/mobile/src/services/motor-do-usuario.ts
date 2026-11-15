/**
 * Peças do motor de sync do usuário usadas por DOIS chamadores (ADR 0017, T-0059):
 * - o app aberto (`state/plataforma.tsx`, dentro do React);
 * - a tarefa em segundo plano `macuxi-sync-delta` (`services/segundo-plano.ts`), que roda sem interface quando o
 *   Android acorda o app fechado.
 * Ficam aqui para os dois montarem o motor e conferirem módulos e sessão do mesmo jeito.
 */
import { cargaDiariaDevida, HORA_CARGA_DIARIA_PADRAO, MeusModulosRespostaSchema, RefreshRespostaSchema } from '@macuxi/core/contracts';
import { criarMotorSync, type AmbienteAparelho, type ArmazenamentoSync, type EtapaSync, type ModuloId, type MotorSync, type ParametrosModulos, type Perfil } from '@macuxi/platform-sdk';

import { efetivosSemServidor } from '@/lib/efetivos-locais';
import type { ModoApi } from '@/lib/modo-api';
import type { shellDaVariante } from '@/lib/modulos';
import { ordemDaCargaDoUsuario } from '@/lib/ordem-da-carga';

import { ApiClient, errorMessage, HttpError } from './api';
import { arquivosLocais } from './arquivos';
import { gravarTokens, lerTokens } from './credenciais';
import { uuid } from './device';
import { readJson, writeJson } from './storage';
import { modoSync, transporteFaseM, transporteV1 } from './transporte';

/** UUID do aparelho (gerado aqui, uma vez): bloqueio remoto de aparelho (RF-CORE-01). */
export const CHAVE_DISPOSITIVO = 'fv:dispositivo';

export async function dispositivoId(): Promise<string> {
  let id = await readJson<string>(CHAVE_DISPOSITIVO);
  if (!id) {
    id = uuid();
    await writeJson(CHAVE_DISPOSITIVO, id);
  }
  return id;
}

/**
 * Troca o refresh guardado por um par novo (`POST /v1/auth/refresh`) e grava os tokens. Devolve o acesso novo, `null`
 * sem refresh guardado; erros da API sobem (quem chama decide: o app encerra a sessão; a tarefa só desiste).
 */
export async function trocarRefresh(apiUrl: string): Promise<string | null> {
  const t = await lerTokens();
  if (!t?.refresh) return null;
  const dispositivo_id = await dispositivoId();
  const r = RefreshRespostaSchema.parse(
    (await new ApiClient(apiUrl, null).request<unknown>('POST', '/auth/refresh', { body: { refresh_token: t.refresh, dispositivo_id } })).data,
  );
  await gravarTokens({ access: r.access_token, refresh: r.refresh_token });
  return r.access_token;
}

type Shell = ReturnType<typeof shellDaVariante>;

export interface OpcoesMotorDoUsuario {
  usuarioId: string;
  /**
   * Armazenamento já aberto (T-0088: `abrirArmazenamentoDoUsuario`, SQLite do usuário e tenant ou o AsyncStorage de
   * reserva), a MESMA instância da tarefa em segundo plano.
   */
  armazenamento: ArmazenamentoSync;
  shell: Shell;
  modo: ModoApi;
  api: () => ApiClient;
  online: () => boolean;
  ambiente: AmbienteAparelho;
  /** Etapas de plataforma antes das dos módulos (ex.: `GET /me` da demonstração). */
  etapasExtras?: readonly EtapaSync[];
  /** Perfil do usuário logado, lido a cada carga (RN-CORE-48: ordem das etapas da entrada). Sem ele, a ordem do Campo. */
  perfil?: () => string | null | undefined;
  /** Fuso IANA do tenant (login v1), lido a cada consulta; sem ele (ou inválido), `America/Manaus` (RN-CORE-61). */
  fuso?: () => string | null | undefined;
}

/** Parâmetro do Catálogo com a hora da carga diária do estoque (`HH:MM`, no fuso do tenant; ADR 0057). */
export const PARAMETRO_CARGA_ESTOQUE = 'estoque_carga_hora';

/**
 * ADR 0057 (RN-CORE-61): a carga diária do estoque está devida? Fuso do tenant e hora do parâmetro
 * `catalogo.estoque_carga_hora` lidos a cada consulta (o parâmetro chega com os módulos efetivos); sem parâmetro, 06:00.
 */
export function cargaDiariaDoUsuario(
  fuso: () => string | null | undefined,
  parametrosCatalogo: () => Readonly<Record<string, unknown>> | null | undefined,
): (ultima: string | null, agora: Date) => boolean {
  return (ultima, agora) => {
    const hora = parametrosCatalogo()?.[PARAMETRO_CARGA_ESTOQUE];
    return cargaDiariaDevida({
      ultima,
      agora,
      fuso: fuso() ?? '',
      hora: typeof hora === 'string' ? hora : HORA_CARGA_DIARIA_PADRAO,
    });
  };
}

/** Motor de sync do usuário (armazenamento isolado por usuário e tenant, já aberto), sem `carregar()`. */
export function criarMotorDoUsuario(o: OpcoesMotorDoUsuario): MotorSync {
  const ref: { m: MotorSync | null } = { m: null };
  ref.m = criarMotorSync({
    registro: o.shell.registroSync,
    armazenamento: o.armazenamento,
    transporte: modoSync(o.modo) === 'v1' ? transporteV1(o.api) : transporteFaseM(o.api),
    online: o.online,
    ambiente: o.ambiente,
    etapas: [...(o.etapasExtras ?? []), ...o.shell.etapasSync],
    mensagemDeErro: errorMessage,
    // ADR 0010 §4: bytes das fotos da fila de arquivos (o transporte v1 faz o PUT /v1/arquivos/:id)
    arquivos: arquivosLocais(),
    // ADR 0012: `ambiente.consultar` (ex.: preço do Catálogo para o Vendedor, offline) sobre as linhas locais do dono
    consultas: o.shell.consultas,
    ordemDaCarga: ordemDaCargaDoUsuario(o.perfil ?? (() => null), () => ref.m?.estado().modulosAtivos ?? []),
    // ADR 0057: estoque 1x por dia (o motor grava `estado.carga_diaria_em`, que os módulos leem pelo estado)
    cargaDiariaDevida: cargaDiariaDoUsuario(o.fuso ?? (() => null), () => ref.m?.parametros('catalogo')),
  });
  return ref.m;
}

/**
 * Módulos efetivos e parâmetros do tenant (`GET /v1/me/modulos`; licença checada no servidor por requisição —
 * RN-CORE-01/02, T-0029 E3). Só o mock-api da demonstração não tem a rota (404): valem os efetivos locais.
 */
export async function consultarModulosEfetivos(
  api: ApiClient,
  modo: ModoApi,
  perfil: Perfil | null,
): Promise<{ efetivos: ModuloId[]; parametros?: ParametrosModulos }> {
  try {
    const r = MeusModulosRespostaSchema.parse((await api.request<unknown>('GET', '/me/modulos')).data);
    return {
      efetivos: r.modulos.map((m) => m.id),
      parametros: Object.fromEntries(r.modulos.map((m) => [m.id, m.parametros ?? {}])) as ParametrosModulos,
    };
  } catch (e) {
    if (modo !== 'demo' || !(e instanceof HttpError) || e.status !== 404) throw e;
    return { efetivos: efetivosSemServidor(modo, perfil) };
  }
}
