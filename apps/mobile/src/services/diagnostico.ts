/**
 * T-0158 (ADR 0043): envio do diagnóstico do aparelho à plataforma (regras em `lib/diagnostico-envio.ts`).
 * - Fila própria no AsyncStorage do aparelho (`fv:diagnostico:envios`), fora da fila do motor: a rota é da plataforma
 *   (`POST /v1/diagnosticos`, sessão do app, sem licença de módulo), não um comando de módulo do `/v1/sync/push`.
 * - Cada item guarda o dono (usuário e empresa) e só sai com a sessão dele: sem sessão, espera o próximo login.
 * - Reenvio: na volta ao app, depois de cada sincronização e com a espera crescente da fila (RN-CORE-23 item 2: só com item
 *   pendente, 15 s até 5 min, sem consultar nada).
 * - O print vai pela fila de arquivos do motor (ADR 0010) depois do `POST` aceito, e sai do aparelho quando o servidor aceita.
 * - v1.0.5 (`QUEDA_AUTOMATICA_LIGADA`): depois do login, a queda da abertura anterior entra na fila sozinha.
 */
import { caminhoFoto, type DiagnosticoEnvio, type MotorSync } from '@macuxi/platform-sdk';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { useMemo, useSyncExternalStore } from 'react';
import { AppState, Platform } from 'react-native';

import {
  adicionarNaFila,
  CAMINHO_DIAGNOSTICOS,
  CHAVE_DIAGNOSTICO_AUTOMATICO,
  CHAVE_FILA_DIAGNOSTICOS,
  DIAGNOSTICO_NUVEM_LIGADO,
  diagnosticoNuvemLigado,
  drenarFila,
  filaValida,
  historicoDoUsuario,
  montarEnvio,
  novoRegistro,
  paraEnviar,
  planoAutomatico,
  QUEDA_AUTOMATICA_LIGADA,
  telaDoHistorico,
  type ContextoDiagnostico,
  type DonoDiagnostico,
  type MarcadorAutomatico,
  type RegistroDiagnostico,
} from '@/lib/diagnostico-envio';
import { proximaEsperaFila } from '@/lib/fila-reenvio';
import { obterHistoricoDoShell } from '@/lib/historico-telas';
import { ehQueda } from '@/lib/saida-android';
import { varianteAtual } from '@/lib/variante';

import type { ApiClient } from './api';
import { arquivosLocais } from './arquivos';
import { lerUltimoErro } from './erros';
import { lerSaidasDoAndroid } from './saida-android';
import { idDoBuildAtual } from './segundo-plano';
import { readJson, writeJson } from './storage';

/** v1.0.4: botão e fila ligados (constante da versão ou `EXPO_PUBLIC_DIAGNOSTICO_NUVEM=1` no build de teste). */
export const DIAGNOSTICO_NUVEM = diagnosticoNuvemLigado(DIAGNOSTICO_NUVEM_LIGADO, process.env.EXPO_PUBLIC_DIAGNOSTICO_NUVEM);

/** Espera depois de o motor abrir antes da 1ª passada (não disputa com a abertura e a carga). */
const ESPERA_INICIAL_MS = 5_000;

// ---------- fila (cache em memória + AsyncStorage, mudanças em série) ----------

const VAZIO: readonly RegistroDiagnostico[] = Object.freeze([]);
let cache: RegistroDiagnostico[] | null = null;
const ouvintes = new Set<() => void>();
let serie: Promise<unknown> = Promise.resolve();

function emSerie<T>(fn: () => Promise<T>): Promise<T> {
  const p = serie.then(fn, fn);
  serie = p.catch(() => undefined);
  return p;
}

async function carregar(): Promise<RegistroDiagnostico[]> {
  if (cache === null) {
    cache = filaValida(await readJson<unknown>(CHAVE_FILA_DIAGNOSTICOS));
    ouvintes.forEach((o) => o());
  }
  return cache;
}

const lerFila = () => emSerie(carregar);

function mudarFila(f: (atual: readonly RegistroDiagnostico[]) => RegistroDiagnostico[]): Promise<void> {
  return emSerie(async () => {
    const nova = f(await carregar());
    cache = nova;
    await writeJson(CHAVE_FILA_DIAGNOSTICOS, nova);
    ouvintes.forEach((o) => o());
  });
}

function assinar(ouvir: () => void): () => void {
  ouvintes.add(ouvir);
  void lerFila().catch(() => undefined);
  return () => ouvintes.delete(ouvir);
}

/** Histórico do Diagnóstico (os últimos 10 deste usuário, mais novo primeiro); re-renderiza a cada mudança da fila. */
export function useDiagnosticos(usuarioId: string | null, tenantId: string | null): RegistroDiagnostico[] {
  const lista = useSyncExternalStore(
    assinar,
    () => cache ?? VAZIO,
    () => VAZIO,
  );
  return useMemo(() => (usuarioId ? historicoDoUsuario(lista, { usuarioId, tenantId }) : []), [lista, usuarioId, tenantId]);
}

/** Registro atual de um envio (a folha mostra o protocolo depois do envio). */
export async function registroDoDiagnostico(id: string): Promise<RegistroDiagnostico | null> {
  return (await lerFila()).find((r) => r.id === id) ?? null;
}

// ---------- pacote técnico ----------

/** Versão, build, aparelho e a fila do sync (só a contagem), lidos agora. */
export function contextoDoAparelho(motor: MotorSync | null): ContextoDiagnostico {
  const e = motor?.estado();
  return {
    app: varianteAtual(),
    versao_app: Constants.expoConfig?.version ?? '?',
    build: idDoBuildAtual(),
    aparelho: {
      fabricante: Device.manufacturer ?? '',
      modelo: Device.modelName ?? '',
      android: Device.osVersion ?? Platform.OS,
      api: Device.platformApiLevel ?? 0,
    },
    sync: e ? { pendentes: e.fila.length, ultimo_sync_em: e.sincronizado_em } : null,
  };
}

/**
 * Pacote do botão "Enviar diagnóstico": o `id` é o UUID gerado quando a folha abriu (tocar duas vezes em Enviar não
 * duplica); vai junto o último erro, a queda mais recente vista pelo Android e a tela de módulo em uso.
 */
export async function montarDiagnosticoDoBotao(p: {
  id: string;
  motor: MotorSync | null;
  descricao: string | null;
  printId: string | null;
  agora?: Date;
}): Promise<DiagnosticoEnvio> {
  const erro = await lerUltimoErro().catch(() => null);
  const saida = (lerSaidasDoAndroid() ?? []).find(ehQueda) ?? null;
  return montarEnvio({
    id: p.id,
    origem: 'botao',
    ocorridoEm: p.agora ?? new Date(),
    contexto: contextoDoAparelho(p.motor),
    tela: telaDoHistorico(obterHistoricoDoShell()),
    motivo: null,
    descricao: p.descricao,
    erro,
    saida,
    printId: p.printId,
  });
}

/** Põe o diagnóstico do botão na fila (idempotente pelo id) e tenta enviar na hora. Devolve o registro depois da tentativa. */
export async function enviarDiagnosticoDoBotao(envio: DiagnosticoEnvio, dono: DonoDiagnostico): Promise<RegistroDiagnostico | null> {
  await mudarFila((l) => adicionarNaFila(l, novoRegistro(envio, dono, new Date())));
  await enviarDiagnosticos();
  return registroDoDiagnostico(envio.id);
}

/** O vendedor desistiu do print (ou da folha): apaga o arquivo local que a galeria gravou. */
export async function descartarPrint(id: string): Promise<void> {
  await arquivosLocais().remover?.(caminhoFoto(id)).catch(() => undefined);
}

// ---------- envio ----------

export interface PortasDiagnostico {
  api: () => ApiClient;
  /** Com sinal e com sessão (o modo sem sinal também segura). */
  online: () => boolean;
  dono: () => DonoDiagnostico | null;
  motor: () => MotorSync | null;
}

let portas: PortasDiagnostico | null = null;
let emCurso: Promise<number> | null = null;
let repetir = false;

/** Uma passada pela fila (uma por vez; pedido no meio da passada roda de novo no fim dela). Nunca lança. */
export function enviarDiagnosticos(): Promise<number> {
  const p = portas;
  if (!p) return Promise.resolve(0);
  if (emCurso) {
    repetir = true;
    return emCurso;
  }
  const passada = (async () => {
    let total = 0;
    do {
      repetir = false;
      total += await drenarFila({
        ler: lerFila,
        mudar: mudarFila,
        dono: p.dono,
        online: p.online,
        postar: (envio) => p.api().request<unknown>('POST', CAMINHO_DIAGNOSTICOS, { body: envio, timeoutMs: 15_000 }),
        enfileirarPrint: async (id) => {
          const m = p.motor();
          if (!m) return false;
          // ADR 0010: o print segue a fila de arquivos (`plataforma.arquivo` já criado pelo POST); sai do aparelho ao ser aceito
          await m.enfileirarArquivo({ id, modulo: 'core', caminho: caminhoFoto(id), rotulo: 'Print do diagnóstico', apagarAoEnviar: true });
          void m.enviar().catch(() => undefined);
          return true;
        },
        agora: () => new Date(),
      }).catch(() => 0);
    } while (repetir);
    return total;
  })();
  emCurso = passada.finally(() => {
    emCurso = null;
  });
  return emCurso;
}

/** v1.0.5: a queda (e o último erro de tela) da abertura anterior entram na fila deste usuário, sem toque. */
export async function registrarDiagnosticosAutomaticos(p: Pick<PortasDiagnostico, 'dono' | 'motor'>, agora = Date.now()): Promise<number> {
  const dono = p.dono();
  if (!dono) return 0;
  const [guardado, erro] = await Promise.all([readJson<MarcadorAutomatico>(CHAVE_DIAGNOSTICO_AUTOMATICO), lerUltimoErro().catch(() => null)]);
  const marcador = guardado && typeof guardado === 'object' ? guardado : null;
  const plano = planoAutomatico(lerSaidasDoAndroid(), erro, marcador, agora);
  if (plano.envios.length > 0) {
    const contexto = contextoDoAparelho(p.motor());
    const novos = plano.envios.map((e) => novoRegistro(montarEnvio({ ...e, contexto, descricao: null, printId: null }), dono, new Date(agora)));
    await mudarFila((l) => novos.reduce<RegistroDiagnostico[]>((acc, r) => adicionarNaFila(acc, r), [...l]));
  }
  await writeJson(CHAVE_DIAGNOSTICO_AUTOMATICO, plano.marcador);
  return plano.envios.length;
}

/**
 * Liga o envio para a sessão aberta (chamado pelo estado da plataforma quando o motor do usuário abre; desliga no logout).
 * Na v1.0.5 registra antes a queda da abertura anterior.
 */
export function ligarEnvioDeDiagnosticos(p: PortasDiagnostico): () => void {
  portas = p;
  let vivo = true;
  let tentativas = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const limpar = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const armar = () => {
    void lerFila()
      .then((lista) => {
        limpar();
        const dono = p.dono();
        if (!vivo || !dono || paraEnviar(lista, dono).length === 0 || AppState.currentState !== 'active') return;
        timer = setTimeout(rodar, proximaEsperaFila(tentativas));
      })
      .catch(() => undefined);
  };
  const rodar = () => {
    if (!vivo) return;
    void enviarDiagnosticos().then((aceitos) => {
      if (!vivo) return;
      tentativas = aceitos > 0 ? 0 : tentativas + 1;
      armar();
    });
  };

  const inicio = setTimeout(() => {
    if (!vivo) return;
    const antes = QUEDA_AUTOMATICA_LIGADA ? registrarDiagnosticosAutomaticos(p).catch(() => 0) : Promise.resolve(0);
    void antes.then(rodar);
  }, ESPERA_INICIAL_MS);

  // depois de cada sincronização (o sinal voltou) e na volta ao app
  const m = p.motor();
  let ultimoSync = m?.estado().sincronizado_em ?? null;
  const semMotor = m?.assinar((e) => {
    if (e.sincronizado_em === ultimoSync) return;
    ultimoSync = e.sincronizado_em;
    tentativas = 0;
    rodar();
  });
  // item novo na fila (o botão sem sinal) ou resultado de uma passada: reprograma a próxima tentativa
  const semFila = assinar(armar);
  const sub = AppState.addEventListener('change', (st) => {
    if (st === 'active') {
      tentativas = 0;
      rodar();
    } else limpar();
  });

  return () => {
    vivo = false;
    clearTimeout(inicio);
    limpar();
    semMotor?.();
    semFila();
    sub.remove();
    if (portas === p) portas = null;
  };
}
