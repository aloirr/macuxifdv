/**
 * Registro do último erro que derrubaria o app (regra em `lib/erro-de-tela.ts`). Duas portas:
 * - telas de erro (`ErrorBoundary` da raiz e das telas de módulo): `gravarErro` e a tela segue com "Tentar de novo";
 * - erro fatal fora do React (`ErrorUtils`, ligado no `index.ts` antes do roteador): grava e só então deixa o React Native
 *   encerrar (no máximo 600 ms de espera), para o Diagnóstico do Perfil mostrar a causa na próxima abertura.
 */
import { CHAVE_ULTIMO_ERRO, deveGravarErro, registroDoErro, type ErroRegistrado, type OrigemDoErro } from '@/lib/erro-de-tela';
import { readJson, writeJson } from './storage';

export async function gravarErro(e: unknown, origem: OrigemDoErro, onde: string | null = null): Promise<void> {
  try {
    // a mensagem já sai limpa de dado pessoal (`registroDoErro`) e fica só no aparelho (Diagnóstico); no logcat do build de
    // release vai só a origem e o tipo do erro (revisão R-20261108-215731, regra 8)
    const r = registroDoErro(e, origem, new Date(), onde);
    console.warn(`[erro ${origem}] ${e instanceof Error ? e.name : typeof e}`);
    // o não fatal não apaga a causa de um fechamento ainda não visto no Diagnóstico (`deveGravarErro`)
    if (origem === 'nao-fatal' && !deveGravarErro(await lerUltimoErro().catch(() => null), origem)) return;
    await writeJson(CHAVE_ULTIMO_ERRO, r);
  } catch {
    // registrar o erro nunca derruba o app
  }
}

/** T-0144: grava um registro já montado (a queda do processo anterior vista pelo Android, `services/saida-android.ts`). */
export async function gravarErroRegistrado(r: ErroRegistrado): Promise<void> {
  await writeJson(CHAVE_ULTIMO_ERRO, r).catch(() => undefined);
}

export function lerUltimoErro(): Promise<ErroRegistrado | null> {
  return readJson<ErroRegistrado>(CHAVE_ULTIMO_ERRO);
}

type Tratador = (erro: unknown, fatal?: boolean) => void;
interface ErrorUtilsRN {
  getGlobalHandler(): Tratador;
  setGlobalHandler(t: Tratador): void;
}

let ligado = false;

/** Liga uma vez: grava o erro e chama o tratador de antes (que, no fatal, encerra o app como sempre). */
export function ligarRegistroDeErrosFatais(): void {
  const eu = (globalThis as { ErrorUtils?: ErrorUtilsRN }).ErrorUtils;
  if (ligado || !eu) return;
  ligado = true;
  const anterior = eu.getGlobalHandler();
  eu.setGlobalHandler((erro, fatal) => {
    const gravando = gravarErro(erro, fatal ? 'fatal' : 'nao-fatal');
    if (!fatal) {
      anterior(erro, fatal);
      return;
    }
    let chamou = false;
    const seguir = () => {
      if (chamou) return;
      chamou = true;
      anterior(erro, fatal);
    };
    void gravando.then(seguir, seguir);
    setTimeout(seguir, 600);
  });
}
