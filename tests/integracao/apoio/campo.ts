/**
 * Aparelho do app Campo para os testes de integração do agente `testes` (Sprint 1, T-0018/T-0019).
 *
 * Monta o que o shell mobile monta (apps/mobile/src/state/plataforma.tsx) sem React Native: o MOTOR DE SYNC real do
 * platform-sdk com as entidades que o Core declara no app (`entidades-cliente`, `entidades-rota`,
 * `entidades-notificacao`) e as do Vendedor publicadas pelo servidor, um transporte igual ao `transporteV1`
 * (apps/mobile/src/services/transporte.ts: push/pull e `PUT /v1/arquivos/:id` com o JPEG cru), um ambiente com o
 * cliente HTTP da sessão (base `/v1`, como o `api-url.ts` do app) e o leitor de fotos locais (memória no lugar do
 * `expo-file-system`). Tudo conversa com o `createApp` REAL por `inject` (Postgres como macuxi_app, RLS).
 *
 * Controles do teste: `online.valor = false` é o modo avião (nada sai); `rede.push = false` derruba só o envio
 * (rede instável: o pull responde e o push cai), para provar a sobreposição da fila (ADR 0009 §3).
 * `respostaEtapas.valor = { status, codigo }` faz o HTTP das etapas (`ctx.http`) receber esse erro sem ir ao servidor:
 * as rotas REST da Fase M não existem na API real (404 antes da autenticação), então 401/403/423 nas etapas só se
 * provocam assim; é o mesmo erro com `status` que o `ApiClient` do app levanta (D-4).
 */
import { randomUUID } from 'node:crypto';
import { MeusModulosRespostaSchema, type SessaoResposta } from '@macuxi/core/contracts';
import { manifest as manifestoCatalogo } from '@macuxi/catalogo/manifest';
import { manifest as manifestoCore } from '@macuxi/core/manifest';
import { manifest as manifestoPromotor } from '@macuxi/promotor/manifest';
import { manifest as manifestoVendedor } from '@macuxi/vendedor/manifest';
import {
  criarArmazenamentoEmMemoria,
  criarClienteHttp,
  criarMotorSync,
  criarRegistroSync,
  type AmbienteAparelho,
  type EtapaSync,
  type FuncaoRequisitar,
  type ItemPush,
  type LinhaSync,
  type MotorSync,
  type PaginaSync,
  type ResultadoEnvioArquivo,
  type ResultadoItemPush,
  type TransporteSync,
} from '@macuxi/platform-sdk';
import { entidadesCliente } from '../../../modules/core/app/lib/entidades-cliente';
import { entidadesNotificacao } from '../../../modules/core/app/lib/entidades-notificacao';
import { entidadesRota } from '../../../modules/core/app/lib/entidades-rota';
import { A, comToken, type ApiDeTeste, type Tenant } from './api';

export const MANIFESTOS_CAMPO = [manifestoCore, manifestoCatalogo, manifestoVendedor, manifestoPromotor];

/** Erro de transporte com o status HTTP (o `HttpError` do app tem `status`; as etapas usam para tratar 4xx). */
export class ErroHttpTeste extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
    mensagem: string,
  ) {
    super(`${status} ${codigo}: ${mensagem}`);
  }
}

export interface AparelhoCampo {
  motor: MotorSync;
  armazenamento: ReturnType<typeof criarArmazenamentoEmMemoria>;
  sessao: SessaoResposta;
  token: { valor: string };
  /** `false` = modo avião (nada sai do aparelho). */
  online: { valor: boolean };
  /** `push: false` = o envio cai por falha de rede (o pull continua). */
  rede: { push: boolean };
  /** Fotos gravadas pela "câmera" (caminho relativo → bytes), lidas pelo motor no upload. */
  fotos: Map<string, Uint8Array>;
  /** Todo lote que chegou ao servidor (para provar o reenvio do mesmo lote). */
  lotesEnviados: ItemPush[][];
  /** Respostas HTTP das chamadas das etapas (caminho → status), para o relatório de falha. */
  chamadasEtapas: Array<{ caminho: string; status: number }>;
  /** Erro que o HTTP das etapas recebe em toda chamada (`null` = vai ao servidor real). */
  respostaEtapas: { valor: null | { status: number; codigo: string } };
  /** O `sincronizar` do shell: licenças (`GET /v1/me/modulos`) e depois o motor. */
  sincronizar(): Promise<boolean>;
}

export interface OpcoesAparelho {
  tenant?: Tenant;
  /** Etapas de carga dos módulos (as do shell real: `etapasCore`, `etapasVendedor`). Padrão: nenhuma. */
  etapas?: readonly EtapaSync[];
  dispositivo_id?: string;
}

const UTEIS = new Set(['pedido', 'pedido_item']);

export async function aparelhoCampo(api: ApiDeTeste, email: string, op: OpcoesAparelho = {}): Promise<AparelhoCampo> {
  const tenant = op.tenant ?? A;
  const login = await api.entrar(email, { tenant, ...(op.dispositivo_id ? { dispositivo_id: op.dispositivo_id } : {}) });
  if (login.statusCode !== 200) throw new Error(`login de ${email}: ${login.statusCode} ${login.body}`);
  const sessao = login.json() as SessaoResposta;
  const token = { valor: sessao.access_token };
  const online = { valor: true };
  const rede = { push: true };
  const fotos = new Map<string, Uint8Array>();
  const lotesEnviados: ItemPush[][] = [];
  const chamadasEtapas: Array<{ caminho: string; status: number }> = [];
  const respostaEtapas: AparelhoCampo['respostaEtapas'] = { valor: null };

  const registro = criarRegistroSync(MANIFESTOS_CAMPO);
  for (const e of [...entidadesCliente, ...entidadesRota, ...entidadesNotificacao]) registro.registrar(e);
  for (const p of api.modulos.find((m) => m.manifesto.id === 'vendedor')!.sync ?? []) if (UTEIS.has(p.entidade.nome)) registro.registrar(p.entidade);

  const transporte: TransporteSync = {
    async push(itens: ItemPush[]): Promise<ResultadoItemPush[]> {
      if (!rede.push) throw new ErroHttpTeste(0, 'SEM_CONEXAO', 'rede caiu no envio');
      const r = await api.chamar(token.valor, { method: 'POST', url: '/v1/sync/push', payload: { itens } });
      lotesEnviados.push(itens);
      if (r.statusCode === 200) return (r.json() as { resultados: ResultadoItemPush[] }).resultados;
      const e = r.json() as { codigo: string; mensagem: string };
      if (r.statusCode >= 500 || r.statusCode === 401 || r.statusCode === 423) throw new ErroHttpTeste(r.statusCode, e.codigo, e.mensagem);
      return itens.map((i) => ({ id: i.id, status: 'rejeitado' as const, codigo: e.codigo, mensagem: e.mensagem }));
    },
    async pull(entidade: string, cursor: string | null): Promise<PaginaSync<LinhaSync>> {
      const q = new URLSearchParams({ entidade, ...(cursor ? { cursor } : {}) });
      const r = await api.chamar(token.valor, { method: 'GET', url: `/v1/sync/pull?${q}` });
      if (r.statusCode !== 200) {
        const e = r.json() as { codigo: string; mensagem: string };
        throw new ErroHttpTeste(r.statusCode, e.codigo, e.mensagem);
      }
      return r.json() as PaginaSync<LinhaSync>;
    },
    async enviarArquivo(a): Promise<ResultadoEnvioArquivo> {
      if (!rede.push) throw new ErroHttpTeste(0, 'SEM_CONEXAO', 'rede caiu no envio');
      const r = await api.app.inject({
        method: 'PUT',
        url: `/v1/arquivos/${encodeURIComponent(a.id)}`,
        headers: { ...comToken(token.valor), 'content-type': a.tipo },
        payload: Buffer.from(a.bytes),
      });
      if (r.statusCode === 200 || r.statusCode === 201) return { status: 'aceito' };
      const e = r.json() as { codigo: string; mensagem: string };
      // como o transporteV1: 409 ARQUIVO_SEM_REFERENCIA, 401 e 5xx são retentáveis (exceção); o resto é rejeição
      if (r.statusCode >= 500 || r.statusCode === 401 || e.codigo === 'ARQUIVO_SEM_REFERENCIA') throw new ErroHttpTeste(r.statusCode, e.codigo, e.mensagem);
      return { status: 'rejeitado', codigo: e.codigo, mensagem: e.mensagem };
    },
  };

  /** Como o `ApiClient` do app: base `/v1`, sessão no cabeçalho, 4xx/5xx viram erro com `status`. */
  const requisitar: FuncaoRequisitar = async (metodo, caminho, o) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined && v !== null) q.set(k, String(v));
    const url = `/v1${caminho}${q.size > 0 ? `?${q}` : ''}`;
    if (respostaEtapas.valor) {
      chamadasEtapas.push({ caminho: `${metodo} ${caminho}`, status: respostaEtapas.valor.status });
      throw new ErroHttpTeste(respostaEtapas.valor.status, respostaEtapas.valor.codigo, 'resposta provocada pelo teste');
    }
    const r = await api.chamar(token.valor, { method: metodo, url, ...(o.body !== undefined ? { payload: o.body as object } : {}) });
    chamadasEtapas.push({ caminho: `${metodo} ${caminho}`, status: r.statusCode });
    if (r.statusCode >= 400) {
      let e: { codigo?: string; mensagem?: string } = {};
      try {
        e = r.json() as typeof e;
      } catch {
        // corpo sem JSON
      }
      throw new ErroHttpTeste(r.statusCode, e.codigo ?? '?', e.mensagem ?? r.body);
    }
    return r.json();
  };

  const ambiente: AmbienteAparelho = {
    http: criarClienteHttp(requisitar, { online: () => online.valor }),
    online: () => online.valor,
    novoId: () => randomUUID(),
    usuario: () => ({ id: sessao.usuario.id, nome: sessao.usuario.nome, perfil: sessao.usuario.perfil, fuso: sessao.tenant.fuso }),
  };

  const armazenamento = criarArmazenamentoEmMemoria();
  const motor = criarMotorSync({
    registro,
    armazenamento,
    transporte,
    online: () => online.valor,
    ambiente,
    etapas: op.etapas ?? [],
    mensagemDeErro: (e) => (e instanceof Error ? e.message : String(e)),
    arquivos: {
      ler: async (caminho) => fotos.get(caminho) ?? null,
      remover: async (caminho) => void fotos.delete(caminho),
    },
  });
  await motor.carregar();

  return {
    motor,
    armazenamento,
    sessao,
    token,
    online,
    rede,
    fotos,
    lotesEnviados,
    chamadasEtapas,
    respostaEtapas,
    async sincronizar() {
      if (online.valor) {
        const r = await api.app.inject({ method: 'GET', url: '/v1/me/modulos', headers: comToken(token.valor) });
        if (r.statusCode === 200) await motor.aplicarModulosAtivos(MeusModulosRespostaSchema.parse(r.json()).modulos.map((m) => m.id));
      }
      return motor.sincronizar();
    },
  };
}

/** JPEG mínimo válido para o servidor (começa com FF D8 FF e termina com FF D9); `marca` muda o sha256. */
export function jpeg(marca: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, marca & 255, 0x00, 0xff, 0xd9]);
}

/** Espera o horizonte seguro do pull (`updated_at < now() − 2 s`, desenho T-0004 §5) depois de uma escrita. */
export const esperarHorizonte = () => new Promise((r) => setTimeout(r, 2_300));
