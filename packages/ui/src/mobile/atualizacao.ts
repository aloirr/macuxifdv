/**
 * RN-CORE-23 — sincronização no app (docs/produto/03 seção 3; R-20261102-121135, R-20261102-124413 e R-20261102-124628).
 * Substitui a "atualização automática de 3–5 min" (o R-20261102-123955 foi cancelado): nenhuma tela consulta o servidor
 * sozinha; quem atualiza é o MOTOR de sync, por um único agendador do app.
 *
 * Parte pura (sem react-native nem expo): o agendador recebe relógio e temporizador por injeção, para o teste com relógio
 * simulado. O shell (apps/mobile) cria UM agendador e liga ao AppState; as telas usam `useAtualizacaoAutomatica` e o
 * `BotaoSincronizar` (sincronizacao.tsx), que leem o mesmo agendador pelo `SincronizacaoProvider`.
 *
 * Quando sincroniza:
 * 1. ao abrir o app (atualização leve);
 * 2. ao voltar ao primeiro plano, se a última sincronização tem 30 min ou mais (leve);
 * 3. a cada `sync_auto_min` (padrão 30, mínimo 15) com o app em uso e com sinal (leve);
 * 4. aviso do servidor (push, com ou sem a lista de entidades): leve, só das entidades indicadas;
 * 5. toque no botão "Sincronizar", puxar para baixo ou selo: parcial (envio da fila + pedidos e clientes), com proteção
 *    de 30 s; a completa é o segurar 10 s no botão (sincronizacao-completa.ts; R-20261115-100000).
 * Nada roda com o app em segundo plano (a tarefa do ADR 0017 é outra, de 15 min). Uma sincronização que falha espera o
 * intervalo inteiro antes da próxima automática (nada de repetir em laço sem sinal).
 */
import { dentroDoIntervaloManual, VOLTA_PRIMEIRO_PLANO_MS } from '../comum/sincronizacao';
import { formatHHMM } from './time';

export * from '../comum/sincronizacao';

/** Por que o app sincroniza (RN-CORE-23). `manual` = toque no botão Sincronizar, puxar para baixo ou selo (parcial). */
export type MotivoSync = 'abertura' | 'volta' | 'periodico' | 'aviso' | 'manual';

/** `ignorado` = caiu no intervalo mínimo entre disparos manuais (nada foi feito nem mostrado); `falhou` = terminou com erro. */
export type ResultadoPuxar = 'sincronizou' | 'ignorado' | 'falhou';

type Temporizador = unknown;

export interface OpcoesAgendadorSync {
  /** Intervalo da automática (ms), lido a cada agendamento: o parâmetro do tenant pode mudar numa sincronização. */
  intervaloMs: () => number;
  /**
   * Dispara o motor. `manual` = parcial (fila + pedidos e clientes); os outros = leve (novidades; `entidades` no aviso do servidor).
   * Devolve `false` quando falhou (o motor guarda o erro no estado).
   */
  sincronizar: (motivo: MotivoSync, entidades?: readonly string[]) => Promise<unknown>;
  /** Instante (ms) da última sincronização concluída (`sincronizado_em` do motor) ou null. */
  ultimaSincronizacao: () => number | null;
  /** Sessão aberta, carga inicial feita e sinal (modo sem sinal desligado). Sem isso, nenhuma automática. */
  podeSincronizar: () => boolean;
  /** `false` = o app abriu sem precisar sincronizar já (ex.: acabou de fazer a carga inicial). Padrão: true. */
  sincronizarAoAbrir?: boolean;
  aoMudar?: (estado: EstadoAgendadorSync) => void;
  agora?: () => number;
  agendar?: (fn: () => void, ms: number) => Temporizador;
  cancelar?: (t: Temporizador) => void;
}

export interface EstadoAgendadorSync {
  /** true durante a sincronização pedida pelo puxar/botão (liga o indicador do topo). A automática é silenciosa. */
  puxando: boolean;
}

export interface AgendadorSync {
  /** App em primeiro plano: na primeira vez é a abertura; depois, a volta (só sincroniza com 30 min sem sincronizar). */
  primeiroPlano(): void;
  /** App em segundo plano: cancela o próximo disparo (nenhuma consulta até voltar). */
  segundoPlano(): void;
  /** Puxar para baixo / botão Sincronizar / selo. Dentro do intervalo mínimo (R-20261115-125500): `ignorado`, em silêncio. */
  puxar(): Promise<ResultadoPuxar>;
  /**
   * Completa (segurar 10 s): confere o mesmo intervalo mínimo do `puxar`. `true` = livre, e o disparo fica registrado (conta
   * para o próximo toque); `false` = dentro do intervalo, quem chamou não faz nada. Não muda o estado.
   */
  liberarManual(): boolean;
  /** Aviso do servidor (push): leve, só das entidades indicadas (sem lista = novidades). Ignorado sem sinal. */
  aviso(entidades?: readonly string[]): Promise<void>;
  /** Recalcula o próximo disparo (ex.: o parâmetro mudou, ou o sinal voltou). */
  reprogramar(): void;
  /** Desliga de vez (logout, troca de usuário). */
  parar(): void;
  estado(): EstadoAgendadorSync;
}

export function criarAgendadorSync(op: OpcoesAgendadorSync): AgendadorSync {
  const agora = op.agora ?? (() => Date.now());
  const agendar = op.agendar ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancelar = op.cancelar ?? ((t: Temporizador) => clearTimeout(t as ReturnType<typeof setTimeout>));
  let ativo = false;
  let parado = false;
  let aberto = false;
  let timer: Temporizador | null = null;
  let emCurso: Promise<boolean> | null = null;
  /** Início da última tentativa (automática ou manual): base do próximo disparo quando a sincronização falha. */
  let ultimaTentativa: number | null = null;
  let ultimoManual: number | null = null;
  let st: EstadoAgendadorSync = { puxando: false };

  const mudar = (parcial: Partial<EstadoAgendadorSync>) => {
    const novo = { ...st, ...parcial };
    if (novo.puxando === st.puxando) return;
    st = novo;
    op.aoMudar?.(st);
  };
  const limpar = () => {
    if (timer !== null) cancelar(timer);
    timer = null;
  };
  const programar = () => {
    limpar();
    if (!ativo || parado) return;
    const base = Math.max(op.ultimaSincronizacao() ?? 0, ultimaTentativa ?? 0) || agora();
    const falta = Math.max(0, base + op.intervaloMs() - agora());
    timer = agendar(() => {
      timer = null;
      if (!ativo || parado) return;
      if (op.podeSincronizar()) void rodar('periodico');
      else {
        // sem sinal: tenta de novo só depois de mais um intervalo inteiro
        ultimaTentativa = agora();
        programar();
      }
    }, falta);
  };
  const liberarManual = (): boolean => {
    const t = agora();
    if (parado || dentroDoIntervaloManual(ultimoManual, t)) return false;
    ultimoManual = t;
    return true;
  };
  const rodar = (motivo: MotivoSync, entidades?: readonly string[]): Promise<boolean> => {
    if (parado) return Promise.resolve(false);
    if (emCurso) {
      // o aviso do servidor pode ter chegado depois do pull da entidade: roda de novo quando a atual terminar
      if (motivo === 'aviso' || motivo === 'manual') return emCurso.then(() => rodar(motivo, entidades));
      return emCurso;
    }
    limpar();
    ultimaTentativa = agora();
    const p: Promise<boolean> = (async () => {
      try {
        return (await op.sincronizar(motivo, entidades)) !== false;
      } catch {
        // o motor guarda o erro no estado; a tela mostra pelo estado, o agendador só segue o ritmo
        return false;
      } finally {
        emCurso = null;
        programar();
      }
    })();
    emCurso = p;
    return p;
  };

  return {
    primeiroPlano() {
      if (ativo || parado) return;
      ativo = true;
      if (!aberto) {
        aberto = true;
        if (op.sincronizarAoAbrir !== false && op.podeSincronizar()) {
          void rodar('abertura');
          return;
        }
        programar();
        return;
      }
      const ult = op.ultimaSincronizacao();
      if (op.podeSincronizar() && (ult === null || agora() - ult >= VOLTA_PRIMEIRO_PLANO_MS)) void rodar('volta');
      else programar();
    },
    segundoPlano() {
      ativo = false;
      limpar();
    },
    async puxar() {
      if (!liberarManual()) return 'ignorado';
      mudar({ puxando: true });
      try {
        return (await rodar('manual')) ? 'sincronizou' : 'falhou';
      } finally {
        mudar({ puxando: false });
      }
    },
    liberarManual,
    async aviso(entidades) {
      if (parado || !op.podeSincronizar()) return;
      await rodar('aviso', entidades);
    },
    reprogramar() {
      if (!emCurso) programar();
    },
    parar() {
      parado = true;
      ativo = false;
      limpar();
    },
    estado() {
      return st;
    },
  };
}

/** "Última sincronização hh:mm · N na fila" (RN-CORE-23 item 1), hora no fuso do tenant. */
export function textoUltimaSincronizacao(sincronizadoEm: number | string | Date | null | undefined, naFila: number, tz?: string): string {
  const fila = `${naFila} na fila`;
  if (sincronizadoEm === null || sincronizadoEm === undefined || sincronizadoEm === '') return `Ainda não sincronizado · ${fila}`;
  return `Última sincronização ${formatHHMM(sincronizadoEm, tz)} · ${fila}`;
}

/**
 * Textos do `BotaoSincronizar` (T-0076, referência R-20261104-164000-alexandre): botão curto ("Sincronizar"; sem sinal,
 * "Sem sinal", desabilitado) e, abaixo, centralizada, a linha "Última sincronização hh:mm · N na fila". O motivo do
 * desabilitado vai numa linha própria: o rótulo do botão é de uma linha só e o texto longo cortava em 360 dp.
 *
 * RD-0008 (T-0124, R-20261108-164227-engenheiro-apps): `avisoDados` é o ÚNICO aviso de dado antigo da tela ("Dados de 06/11,
 * 6h28", "Sincronize para ver as vendas"; o shell passa o texto pronto, no fuso do tenant). Com ele, a linha de situação vira
 * "{aviso} · N na fila" em tom de atenção, no lugar de "Última sincronização…". O "· N na fila" fica: é a redundância útil da RN-CORE-23. Não
 * repete "Sincronizar": o botão logo acima já diz.
 */
export function desenhoBotaoSincronizar(s: {
  semSinal: boolean;
  sincronizadoEm: number | string | Date | null | undefined;
  naFila: number;
  tz?: string;
  avisoDados?: string | null;
}): { rotulo: string; situacao: string; tom: 'neutro' | 'atencao'; aviso: string | null } {
  const avisoDados = s.avisoDados?.trim();
  return {
    rotulo: s.semSinal ? 'Sem sinal' : 'Sincronizar',
    situacao: avisoDados ? `${avisoDados} · ${s.naFila} na fila` : textoUltimaSincronizacao(s.sincronizadoEm, s.naFila, s.tz),
    tom: avisoDados ? 'atencao' : 'neutro',
    aviso: s.semSinal ? 'Desligue o modo sem sinal para sincronizar' : null,
  };
}

/**
 * Rodapé das listas: "Atualizado às hh:mm · puxe para sincronizar" (toque dentro do intervalo mínimo não muda nada, R-20261115-125500).
 * Modo sem sinal (T-0071, revisão de UX): só a hora, sem o convite a puxar (o puxar não sincroniza; a tela mostra o motivo).
 */
export function rodapeAtualizacao(atualizadoEm: number | string | Date | null | undefined, tz?: string, opcoes: { semSinal?: boolean } = {}): string {
  const semHora = atualizadoEm === null || atualizadoEm === undefined || atualizadoEm === '';
  if (opcoes.semSinal) return semHora ? 'Ainda não sincronizado' : `Atualizado às ${formatHHMM(atualizadoEm, tz)}`;
  if (semHora) return 'Puxe para sincronizar';
  return `Atualizado às ${formatHHMM(atualizadoEm, tz)} · puxe para sincronizar`;
}

/** Estado do `SeloAtualizacao` (cabeçalho das listas): um só indicador de sincronização por tela (RD-0076, RN-VEN-42). */
export type EstadoSeloAtualizacao = 'ok' | 'atualizando' | 'sem_sinal' | 'sem_resposta';

/** O que o toque no selo faz: Sincronizar (= puxar para baixo), abrir o Perfil (modo sem sinal ligado) ou nada (atualizando). */
export type AcaoSeloAtualizacao = 'sincronizar' | 'perfil' | 'nenhuma';

export interface DesenhoSeloAtualizacao {
  estado: EstadoSeloAtualizacao;
  /** Texto visível, curto: "06:30", "Sincronizar", "Atualizando…", "Sem sinal", "Sem resposta". */
  texto: string;
  tom: 'neutro' | 'atencao';
  icone: 'sync' | 'alert';
  /** Leitura completa para o leitor de tela (o que a lista mostra). */
  rotuloAcessivel: string;
  /** Dica do leitor de tela para o toque; null quando o toque não faz nada. */
  dica: string | null;
  acao: AcaoSeloAtualizacao;
}

/**
 * RD-0076 (T-0153, R-20261110-104300; regra "uma informação, um lugar" e "nenhum aviso solto", RN-VEN-42): o estado da
 * sincronização da lista fica num ÚNICO selo no cabeçalho, ao lado do título (o "↻ 06:30" da imagem T-0153). Ele substitui
 * as faixas "Sem sinal: mostrando só o que o aparelho tem deste período.", "Sem resposta do servidor. Mostrando o que está no
 * aparelho.", o texto "Buscando o restante no servidor…" e o rodapé ("Atualizado às hh:mm · puxe para sincronizar",
 * "Modo sem sinal ligado · desligue no Perfil" e o erro do motor). A fila não entra: está no selo "Na fila" da linha.
 *
 * Prioridade: sem sinal (nada atualiza) > atualizando (o toque ou a consulta estão rodando) > sem resposta > ok.
 * Sem sinal com o modo sem sinal ligado, o toque abre o Perfil, onde ele é desligado; sem rede, o toque tenta sincronizar.
 */
export function desenhoSeloAtualizacao(s: {
  atualizadoEm: number | string | Date | null | undefined;
  tz?: string;
  /** Modo sem sinal ligado no Perfil. */
  modoSemSinal: boolean;
  /** Aparelho sem rede (com o modo sem sinal desligado). */
  semRede: boolean;
  /** Puxar/Sincronizar em andamento ou a tela consultando o servidor. */
  atualizando: boolean;
  /** A última sincronização ou a consulta da tela falhou. */
  semResposta: boolean;
}): DesenhoSeloAtualizacao {
  const semHora = s.atualizadoEm === null || s.atualizadoEm === undefined || s.atualizadoEm === '';
  const hora = semHora ? null : formatHHMM(s.atualizadoEm as number | string | Date, s.tz);
  const daHora = hora ? `, atualizado às ${hora}` : ', ainda não sincronizado';
  if (s.modoSemSinal || s.semRede) {
    return {
      estado: 'sem_sinal',
      texto: 'Sem sinal',
      tom: 'atencao',
      icone: 'alert',
      rotuloAcessivel: `Sem sinal. A lista mostra o que está no aparelho${daHora}.`,
      dica: s.modoSemSinal ? 'Abre o Perfil para desligar o modo sem sinal' : 'Tenta sincronizar',
      acao: s.modoSemSinal ? 'perfil' : 'sincronizar',
    };
  }
  if (s.atualizando) {
    return { estado: 'atualizando', texto: 'Atualizando…', tom: 'neutro', icone: 'sync', rotuloAcessivel: 'Atualizando a lista', dica: null, acao: 'nenhuma' };
  }
  if (s.semResposta) {
    return {
      estado: 'sem_resposta',
      texto: 'Sem resposta',
      tom: 'atencao',
      icone: 'alert',
      rotuloAcessivel: `Sem resposta do servidor. A lista mostra o que está no aparelho${daHora}.`,
      dica: 'Tenta de novo',
      acao: 'sincronizar',
    };
  }
  return {
    estado: 'ok',
    texto: hora ?? 'Sincronizar',
    tom: 'neutro',
    icone: 'sync',
    rotuloAcessivel: hora ? `Atualizado às ${hora}` : 'Ainda não sincronizado',
    dica: 'Sincroniza agora',
    acao: 'sincronizar',
  };
}
