/**
 * Teste do servidor (R-20261101-023742-alexandre, segurança): o app só salva um endereço, e só envia o login, para um
 * servidor que responde `<endereço>/saude` com 200, JSON e `servico: "macuxi-api"` (`SaudeRespostaSchema` do SDK).
 * Qualquer outra coisa (HTML de outro site, 404, JSON de outro serviço, erro 5xx) é "Este endereço não é um servidor
 * Macuxi". Sem resposta e tempo esgotado são "sem conexão". A mensagem sempre diz o endereço testado e o que falhou.
 *
 * Puro (o `fetch` é injetado) para teste; `ApiClient.health` e `testApiUrl` (state/plataforma.tsx) usam isto.
 */
import { ErroHttp, ErroSemConexao, SaudeRespostaSchema } from '@macuxi/platform-sdk';

import { DICA_V1, problemaNoEndereco } from './api-url';

/** Código do erro quando o endereço não é de um servidor Macuxi (o Core mostra a mensagem certa: `ehServidorInvalido`). */
export const CODIGO_SERVIDOR_INVALIDO = 'SERVIDOR_INVALIDO';

export const TEMPO_TESTE_MS = 8000;

/** Mínimo do `fetch` que o teste usa (o global do React Native/Node serve). */
export type BuscarHttp = (url: string, init: { method: 'GET'; headers: Record<string, string>; signal: AbortSignal }) => Promise<{ status: number; text(): Promise<string> }>;

export type MotivoFalhaServidor = 'endereco' | 'sem_resposta' | 'tempo_esgotado' | 'nao_encontrado' | 'erro_do_servidor' | 'nao_macuxi';

export type ResultadoTesteServidor =
  | { ok: true; testado: string; versao: string; mensagem: string }
  | { ok: false; testado: string; motivo: MotivoFalhaServidor; status?: number; mensagem: string };

export interface OpcoesTesteServidor {
  /** Rota de saúde relativa ao endereço (`rotaDeSaude`: `/saude` na API, `/health` no mock-api). */
  rota: string;
  /** Fora do desenvolvimento: só https. */
  exigirHttps: boolean;
  buscar: BuscarHttp;
  timeoutMs?: number;
}

const NAO_MACUXI = 'Este endereço não é um servidor Macuxi';

function falha(testado: string, motivo: MotivoFalhaServidor, mensagem: string, status?: number): ResultadoTesteServidor {
  return { ok: false, testado, motivo, mensagem, ...(status !== undefined ? { status } : {}) };
}

export async function testarServidor(endereco: string, op: OpcoesTesteServidor): Promise<ResultadoTesteServidor> {
  const base = endereco.trim();
  const testado = `${base}${op.rota}`;
  const problema = problemaNoEndereco(base, { exigirHttps: op.exigirHttps });
  if (problema) return falha(testado, 'endereco', problema);

  const tempo = op.timeoutMs ?? TEMPO_TESTE_MS;
  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), tempo);
  let status: number;
  let texto: string;
  try {
    const res = await op.buscar(testado, { method: 'GET', headers: { Accept: 'application/json' }, signal: controle.signal });
    status = res.status;
    texto = await res.text();
  } catch (e) {
    if (controle.signal.aborted || (e instanceof Error && e.name === 'AbortError'))
      return falha(testado, 'tempo_esgotado', `${testado} não respondeu em ${Math.round(tempo / 1000)} s. ${DICA_V1} Se estiver certo, o servidor pode estar fora do ar.`);
    return falha(testado, 'sem_resposta', `Sem resposta de ${testado}. ${DICA_V1} Confira também a internet do aparelho (endereço inexistente ou certificado inválido também dão este erro).`);
  } finally {
    clearTimeout(timer);
  }

  if (status === 404 || status === 405) return falha(testado, 'nao_encontrado', `${NAO_MACUXI}: ${testado} não existe (erro ${status}). ${DICA_V1}`, status);
  if (status >= 500) return falha(testado, 'erro_do_servidor', `${NAO_MACUXI}: ${testado} respondeu com erro ${status}. ${DICA_V1} Se estiver certo, o servidor pode estar fora do ar.`, status);
  if (status !== 200) return falha(testado, 'nao_macuxi', `${NAO_MACUXI}: ${testado} respondeu com o código ${status}. ${DICA_V1}`, status);

  let corpo: unknown;
  try {
    corpo = JSON.parse(texto);
  } catch {
    return falha(testado, 'nao_macuxi', `${NAO_MACUXI}: ${testado} respondeu com uma página que não é da API Macuxi. ${DICA_V1}`, status);
  }
  const saude = SaudeRespostaSchema.safeParse(corpo);
  if (!saude.success) return falha(testado, 'nao_macuxi', `${NAO_MACUXI}: ${testado} respondeu, mas sem a identificação do Macuxi. ${DICA_V1}`, status);
  return { ok: true, testado, versao: saude.data.versao, mensagem: `Servidor Macuxi respondeu (versão ${saude.data.versao}). Testado: ${testado}` };
}

/**
 * Erro para o login quando o servidor não passou no teste: sem resposta/tempo → `ErroSemConexao`; o resto →
 * `ErroHttp` com `codigo: SERVIDOR_INVALIDO` (formato combinado com o modulo-core, `mensagemDeErroDeLogin`).
 */
export function erroDoTesteServidor(r: Extract<ResultadoTesteServidor, { ok: false }>): Error {
  if (r.motivo === 'sem_resposta' || r.motivo === 'tempo_esgotado') return new ErroSemConexao(r.mensagem);
  return new ErroHttp(r.status ?? 0, CODIGO_SERVIDOR_INVALIDO, r.mensagem, { testado: r.testado, motivo: r.motivo });
}
