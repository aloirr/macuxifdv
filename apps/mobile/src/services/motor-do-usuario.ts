/**
 * Peças do motor de sync do usuário usadas por DOIS chamadores (ADR 0017, T-0059):
 * - o app aberto (`state/plataforma.tsx`, dentro do React);
 * - a tarefa em segundo plano `macuxi-sync-delta` (`services/segundo-plano.ts`), que roda sem interface quando o
 *   Android acorda o app fechado.
 * Ficam aqui para os dois montarem o motor e conferirem módulos e sessão do mesmo jeito.
 */
import { definirCargaOnline, type PortaCargaOnline } from '@macuxi/catalogo/app';
import type { BancoDoTrajeto } from '@macuxi/core/app';
import { MeusModulosRespostaSchema, RefreshRespostaSchema } from '@macuxi/core/contracts';
import {
  criarMotorSync,
  type AmbienteAparelho,
  type ArmazenamentoSync,
  type EtapaSync,
  type ModuloId,
  type MotorSync,
  type OpcoesMotorSync,
  type ParametrosModulos,
  type Perfil,
} from '@macuxi/platform-sdk';

import { efetivosSemServidor } from '@/lib/efetivos-locais';
import { comPontosDoTrajeto } from '@/lib/envio-do-trajeto';
import type { ModoApi } from '@/lib/modo-api';
import type { shellDaVariante } from '@/lib/modulos';
import { essenciaisDoUsuario, ordemDaCargaDoUsuario } from '@/lib/ordem-da-carga';

import { ApiClient, errorMessage, HttpError } from './api';
import { arquivosLocais } from './arquivos';
import { gravarTokens, lerTokens } from './credenciais';
import { uuid } from './device';
import { gravarErro } from './erros';
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
  /**
   * ADR 0054 (solução 5): liga a busca online do Catálogo enquanto ele carrega (`definirCargaOnline`) a este motor. Só o app
   * aberto (padrão); a tarefa em segundo plano passa `false` para não trocar a porta do app por um motor sem tela.
   */
  cargaOnline?: boolean;
  /**
   * T-0156 (RN-CORE-13): SQLite do usuário em que a tarefa `macuxi-trajeto` grava os pontos (`driverDoArquivo`). Depois de
   * cada envio os pontos vão ao servidor pelo `push` do transporte do motor (`lib/envio-do-trajeto.ts`). Sem ele, ou `null`,
   * nada a enviar.
   */
  bancoDoTrajeto?: () => BancoDoTrajeto | null;
}

/** Falha do envio do trajeto: só contagens, no Diagnóstico do Perfil (nenhuma coordenada nem id). */
const registrarEnvioDoTrajeto = (mensagem: string) => void gravarErro(new Error(mensagem), 'nao-fatal', 'envio do trajeto');

/**
 * ADR 0054 (solução 5; desenho T-catalogo-pacote §2.2): porta da busca online do Catálogo durante a carga inicial. Com o
 * Catálogo em `pendentes`, a tela do catálogo, a ficha e as consultas vão à API pelo `ambiente.http` (sessão e modo sem
 * sinal do shell); motor sem `pendentes` = tudo local, como antes.
 */
export function portaCargaOnline(motor: Pick<MotorSync, 'estado'>, ambiente: Pick<AmbienteAparelho, 'http' | 'online'>): PortaCargaOnline {
  return {
    pendentes: () => motor.estado().pendentes,
    online: () => ambiente.online(),
    get: (caminho, query) => ambiente.http.get(caminho, query),
  };
}

/** Motor de sync do usuário (armazenamento isolado por usuário e tenant, já aberto), sem `carregar()`. */
export function criarMotorDoUsuario(o: OpcoesMotorDoUsuario): MotorSync {
  const ref: { m: MotorSync | null } = { m: null };
  const transporte = modoSync(o.modo) === 'v1' ? transporteV1(o.api) : transporteFaseM(o.api);
  const opcoes: OpcoesMotorSync = {
    registro: o.shell.registroSync,
    armazenamento: o.armazenamento,
    transporte,
    online: o.online,
    ambiente: o.ambiente,
    etapas: [...(o.etapasExtras ?? []), ...o.shell.etapasSync],
    mensagemDeErro: errorMessage,
    // ADR 0010 §4: bytes das fotos da fila de arquivos (o transporte v1 faz o PUT /v1/arquivos/:id)
    arquivos: arquivosLocais(),
    // ADR 0012: `ambiente.consultar` (ex.: preço do Catálogo para o Vendedor, offline) sobre as linhas locais do dono
    consultas: o.shell.consultas,
    ordemDaCarga: ordemDaCargaDoUsuario(o.perfil ?? (() => null), () => ref.m?.estado().modulosAtivos ?? []),
    // ADR 0054 (solução 5): o envio e "Clientes e rota" (Campo) ou "Equipe" (Gestão) liberam a entrada (`liberado_em`)
    essenciais: essenciaisDoUsuario(o.perfil ?? (() => null), () => ref.m?.estado().modulosAtivos ?? []),
  };
  // T-0156: os pontos do trajeto vão pelo mesmo transporte depois de cada envio (app aberto e tarefa em segundo plano)
  ref.m = comPontosDoTrajeto(criarMotorSync(opcoes), {
    banco: o.bancoDoTrajeto ?? (() => null),
    push: (itens) => transporte.push(itens),
    online: o.online,
    registrar: registrarEnvioDoTrajeto,
  });
  if (o.cargaOnline !== false) definirCargaOnline(portaCargaOnline(ref.m, o.ambiente));
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
