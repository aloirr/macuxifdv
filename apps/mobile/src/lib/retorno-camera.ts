/**
 * Volta da câmera e da galeria do sistema (v1.0.34, teste de campo da AM2808, R-20261124-093521: "tirei a foto e a linha
 * continua Falta"). Puro, para teste: o shell (services/camera.ts) liga o expo-image-picker e o AppState.
 * - O Android pode destruir a atividade do app enquanto a câmera está aberta (pouca memória). Com o JS vivo, a promessa do
 *   `launchCameraAsync` nunca resolve e a foto fica guardada no `getPendingResultAsync`. Por isso, a cada volta do app ao
 *   primeiro plano com a câmera aberta, o shell pergunta pelo resultado pendente e usa o primeiro que chegar.
 * - O resultado diz por que não há foto: `cancelada` (a tela não avisa nada), `sem_permissao` (a tela pede para liberar nos
 *   ajustes) ou `erro`.
 */

/** Foto devolvida pelo seletor do sistema (só o que o shell usa). */
export interface ArquivoDoSeletor {
  uri: string;
  width: number;
  height: number;
}

/** O que o expo-image-picker devolve: resultado (`canceled`/`assets`), erro do pendente (`code`) ou nada pendente. */
export type RetornoSeletor = { canceled: true; assets?: null } | { canceled: false; assets: readonly ArquivoDoSeletor[] } | { code: string; message?: string } | null | undefined;

export type ResultadoCaptura<T> = { tipo: 'foto'; foto: T } | { tipo: 'cancelada' } | { tipo: 'sem_permissao' } | { tipo: 'erro' };

/** O retorno do seletor em: a foto, cancelada ou erro (`null`/`undefined` = nada voltou: cancelada). */
export function lerRetornoSeletor(r: RetornoSeletor): ResultadoCaptura<ArquivoDoSeletor> {
  if (!r) return { tipo: 'cancelada' };
  if ('code' in r) return { tipo: 'erro' };
  if (r.canceled) return { tipo: 'cancelada' };
  const foto = r.assets[0];
  return foto ? { tipo: 'foto', foto } : { tipo: 'cancelada' };
}

/** Espera depois da volta do app antes de perguntar pelo pendente: o retorno normal do seletor chega antes. */
export const ESPERA_PENDENTE_MS = 800;
/** Sem retorno nem pendente depois desta espera da volta, a câmera conta como cancelada (a folha não fica presa). */
export const LIMITE_SEM_RETORNO_MS = 10_000;

export interface PortasRetornoCamera {
  /** `ImagePicker.getPendingResultAsync`. */
  pendente: () => Promise<RetornoSeletor>;
  /** Assina a volta do app ao primeiro plano; devolve a função que desfaz a assinatura. */
  aoVoltar: (fn: () => void) => () => void;
  esperar: (ms: number) => Promise<void>;
}

/**
 * Abre o seletor e espera o primeiro retorno: o da promessa do seletor ou, na volta do app, o pendente (atividade destruída
 * com a câmera aberta). Pendente vazio na volta: segue esperando a promessa até `LIMITE_SEM_RETORNO_MS`, depois cancelada.
 * Promessa rejeitada: vale o pendente. Nunca rejeita.
 */
export function esperarRetornoSeletor(abrir: () => Promise<RetornoSeletor>, p: PortasRetornoCamera): Promise<RetornoSeletor> {
  return new Promise((resolve) => {
    let fim = false;
    let desfazer: (() => void) | null = null;
    const terminar = (r: RetornoSeletor) => {
      if (fim) return;
      fim = true;
      desfazer?.();
      resolve(r);
    };
    const pendente = () => p.pendente().catch((): RetornoSeletor => null);
    desfazer = p.aoVoltar(() => {
      void (async () => {
        await p.esperar(ESPERA_PENDENTE_MS);
        if (fim) return;
        const r = await pendente();
        if (r) return terminar(r);
        await p.esperar(LIMITE_SEM_RETORNO_MS);
        if (!fim) terminar(await pendente());
      })();
    });
    abrir().then(terminar, async () => terminar(await pendente()));
  });
}
