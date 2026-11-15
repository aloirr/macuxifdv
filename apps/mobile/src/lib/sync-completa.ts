/**
 * R-20261115-100000 (aprovada em R-20261115-104500; spec docs/design/sync-completa/spec.md): o botão Sincronizar tem duas
 * sincronizações. Parte PURA do shell (roda em Node nos testes); `state/plataforma.tsx` e `components/sincronizacao-do-shell.tsx`
 * só ligam isto ao motor, ao relógio e às telas.
 *
 * - PARCIAL (toque, puxar para baixo e selo ↻ das listas: o motivo `manual` do agendador): envio com os itens que falharam e
 *   `motor.sincronizar({ modo: 'parcial' })` (ADR 0057: o motor envia a fila e puxa só as entidades marcadas `parcial`).
 * - COMPLETA (segurar 10 s, tela de carga, "Tentar de novo", desligar o modo sem sinal): envio com os falhos, módulos
 *   efetivos e `motor.sincronizar({ modo: 'completa' })` (tudo do zero; o motor espera a sincronização em curso).
 * - LEVE (automática e aviso do servidor): `sincronizarNovidades` (só o que mudou), como antes.
 * Demonstração (sem novidades) e modo sem sinal: o comportamento de antes (manual = completa; sem sinal = `sincronizar`).
 */
import type { EtapaEntrada, ProgressoEntrada } from '@macuxi/core/contracts';

import { ESPERA_PRONTO_MS, rotuloDaBarra, textoDoErro } from './entrada';

export type TipoSync = 'parcial' | 'completa' | 'leve';

export type PedidoSync =
  { tipo: 'parcial' } | { tipo: 'completa' } | { tipo: 'leve'; entidades?: readonly string[] };

/** O motivo do agendador do kit vira o pedido: `manual` = parcial; os outros = leve (com a lista do aviso, se veio). */
export function pedidoDoAgendador(motivo: string, entidades?: readonly string[]): PedidoSync {
  if (motivo === 'manual') return { tipo: 'parcial' };
  return entidades ? { tipo: 'leve', entidades } : { tipo: 'leve' };
}

/** O que o shell usa do motor (o `MotorSync` do platform-sdk atende). */
export interface MotorDoSync {
  enviar(opcoes?: { incluirFalhos?: boolean }): Promise<unknown>;
  sincronizar(opcoes?: { modo?: 'parcial' | 'completa' }): Promise<boolean>;
  sincronizarNovidades(opcoes?: { entidades?: readonly string[] }): Promise<boolean>;
}

export interface ContextoDoSync {
  modo: 'v1' | 'demo' | string;
  offline: boolean;
  /** `GET /v1/me/modulos` e `aplicarModulosAtivos` (só na completa). Falha calada: o motor registra o erro no pull. */
  atualizarModulos: () => Promise<void>;
  /** A sincronização do shell em curso quando a completa foi pedida (a completa espera ela antes do envio e dos módulos). */
  emCurso?: Promise<unknown> | null;
}

/** Os passos de cada sincronização no motor (a trava única e a permissão ficam no shell; "uma por vez", no motor). */
export async function rodarSync(pedido: PedidoSync, m: MotorDoSync, c: ContextoDoSync): Promise<boolean> {
  // cobre só os passos do shell (envio e módulos); a passada do motor já espera a em curso sozinha
  if (c.emCurso) await c.emCurso.catch(() => false);
  if (c.offline) return m.sincronizar();
  if (c.modo === 'v1' && pedido.tipo === 'leve')
    return m.sincronizarNovidades(pedido.entidades ? { entidades: pedido.entidades } : {});
  // spec rota-catalogo-perfil §4: a parcial e a completa reenviam também os itens que falharam (o motor só envia os pendentes)
  await m.enviar({ incluirFalhos: true });
  if (c.modo === 'v1' && pedido.tipo === 'parcial') return m.sincronizar({ modo: 'parcial' });
  // completa (e, na demonstração, também a parcial e a leve: a Fase M não tem novidades)
  try {
    await c.atualizarModulos();
  } catch {
    // sem rede: o motor registra o erro na sincronização abaixo
  }
  return c.modo === 'v1' ? m.sincronizar({ modo: 'completa' }) : m.sincronizar();
}

/**
 * Uma sincronização do shell por vez (T-0059): o pedido junta-se à que está rodando (mesma promessa), menos a completa
 * pedida durante uma parcial ou leve, que roda depois dela (o usuário segurou 10 s: não pode virar a parcial em curso):
 * `rodarSync` espera a em curso (`emCurso`) antes do envio e dos módulos.
 */
export function decidirPedidoSync(pedido: TipoSync, emCurso: TipoSync | null): 'rodar' | 'juntar' {
  return emCurso === null || (pedido === 'completa' && emCurso !== 'completa') ? 'rodar' : 'juntar';
}

// ---------- popup da completa ----------

/** `fechado`; `rodando` (popup sem botões, Voltar bloqueado, tela acesa); `pronto` (100%, fecha sozinho); `erro`. */
export type FaseCompleta = 'fechado' | 'rodando' | 'pronto' | 'erro';

export interface OpcoesPopupCompleta {
  /** A sincronização completa (`sincronizar` da plataforma): `true` = deu certo. */
  executar: () => Promise<boolean>;
  aoMudar: (fase: FaseCompleta, rodada: number) => void;
  definirTempo?: (fn: () => void, ms: number) => unknown;
  limparTempo?: (id: unknown) => void;
}

export interface PopupCompleta {
  /** Segurou 10 s (ou a ação do leitor de tela): abre e roda. Já aberto: nada. */
  abrir(): void;
  /** "Tentar de novo" (só com erro). */
  tentarDeNovo(): void;
  /** "Fechar" e o Voltar (só com erro; rodando, o popup não fecha). */
  fechar(): void;
  /** Desmontou (troca de usuário): para o relógio, sem mudar nada. */
  desligar(): void;
  fase(): FaseCompleta;
}

/** Máquina do popup: abre rodando, fecha sozinho `ESPERA_PRONTO_MS` depois do "Pronto"; com erro, Tentar de novo / Fechar. */
export function criarPopupCompleta(o: OpcoesPopupCompleta): PopupCompleta {
  const definir = o.definirTempo ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const limpar = o.limparTempo ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  let fase: FaseCompleta = 'fechado';
  // cada rodada tem número próprio: a etapa mostrada recomeça do 1 e um resultado atrasado de outra rodada não vale
  let rodada = 0;
  let timer: unknown = null;
  let ligado = true;

  const mudar = (f: FaseCompleta) => {
    fase = f;
    o.aoMudar(f, rodada);
  };
  const pararTimer = () => {
    if (timer !== null) limpar(timer);
    timer = null;
  };
  const rodar = () => {
    pararTimer();
    rodada++;
    const minha = rodada;
    mudar('rodando');
    const fim = (ok: boolean) => {
      if (!ligado || minha !== rodada || fase !== 'rodando') return;
      if (!ok) {
        mudar('erro');
        return;
      }
      mudar('pronto');
      timer = definir(() => {
        timer = null;
        if (ligado && minha === rodada && fase === 'pronto') mudar('fechado');
      }, ESPERA_PRONTO_MS);
    };
    let p: Promise<boolean>;
    try {
      p = o.executar();
    } catch {
      p = Promise.resolve(false);
    }
    void p.then(fim, () => fim(false));
  };

  return {
    abrir() {
      if (fase !== 'fechado') return;
      rodar();
    },
    tentarDeNovo() {
      if (fase === 'erro') rodar();
    },
    fechar() {
      if (fase === 'erro') mudar('fechado');
    },
    desligar() {
      ligado = false;
      pararTimer();
    },
    fase: () => fase,
  };
}

/** Tela acesa (`expo-keep-awake`) só enquanto a completa roda. */
export function telaAcesaNaCompleta(fase: FaseCompleta): boolean {
  return fase === 'rodando';
}

/** O botão Sincronizar fica ocupado e o popup na tela em toda fase menos `fechado`. */
export function completaVisivel(fase: FaseCompleta): boolean {
  return fase !== 'fechado';
}

export interface DesenhoPopupCompleta {
  visivel: boolean;
  /** `Dialogo.bloqueado`: o Voltar não faz nada (rodando e pronto). Com erro, o Voltar fecha. */
  bloqueado: boolean;
  /** Barra (rodando e pronto): "Etapa n de N · nome" ou "Pronto", e o percentual. */
  barra: { rotulo: string; pct: number } | null;
  /** Linha do erro ("Parou na etapa 3 de 5" / "Sem internet na etapa 3 de 5"). */
  erro: string | null;
  /** "Fechar" e "Tentar de novo" (só com erro). */
  botoes: boolean;
}

/** O que o popup mostra, a partir da fase e do progresso da carga (o mesmo `progressoDaEntrada` da tela de carga). */
export function desenhoPopupCompleta(
  fase: FaseCompleta,
  progresso: Pick<ProgressoEntrada, 'atual' | 'total' | 'pronta' | 'percentual'> & {
    parou_em: EtapaEntrada | null;
  },
  semSinal: boolean,
): DesenhoPopupCompleta {
  if (fase === 'fechado') return { visivel: false, bloqueado: true, barra: null, erro: null, botoes: false };
  if (fase === 'erro')
    return {
      visivel: true,
      bloqueado: false,
      barra: null,
      erro: textoDoErro(progresso.parou_em ?? progresso.atual, progresso.total, semSinal),
      botoes: true,
    };
  return {
    visivel: true,
    bloqueado: true,
    barra: { rotulo: rotuloDaBarra(progresso), pct: progresso.percentual },
    erro: null,
    botoes: false,
  };
}

/**
 * Entrada do `progressoDaEntrada` (RN-CORE-48) para o popup: a fase manda (não o `sincronizado_em`, que já existe), e o
 * percentual só conta enquanto o motor está de fato sincronizando (antes, o `progresso` é o da sincronização anterior).
 */
export function entradaDoProgressoCompleta(
  fase: FaseCompleta,
  estado: { sincronizando: boolean; erro: string | null },
  percentualDoMotor: number,
): { progresso: number; sincronizando: boolean; erro: string | null; sincronizado: boolean } {
  return {
    progresso:
      fase === 'pronto' ? 1 : fase === 'rodando' && estado.sincronizando ? percentualDoMotor / 100 : 0,
    sincronizando: fase === 'rodando',
    erro: fase === 'erro' ? (estado.erro ?? 'erro') : null,
    sincronizado: fase === 'pronto',
  };
}
