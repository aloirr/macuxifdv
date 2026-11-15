/**
 * Porta de interpretação da busca (`PortaInterpretacaoLlm`) sobre HTTP, com tempo limite REAL (RN-CAT-03).
 *
 * - Uma chamada só, sem nova tentativa em cascata.
 * - O `fetch` recebe um `AbortSignal` que soma o tempo limite (`AbortSignal.timeout`) e o cancelamento do chamador
 *   (`AbortSignal.any`): ao estourar, a requisição é cancelada de fato e a conexão liberada.
 * - A espera também compete com o signal (`Promise.race`): mesmo um `fetch` que ignore o signal não prende a busca.
 * - Tempo esgotado ⇒ `ErroTempoEsgotadoIa`; rede, HTTP não-2xx e corpo que não é JSON ⇒ `ErroProvedorIa`.
 *   O domain (`interpretarBusca`) transforma ambos em busca sem IA e decide a cota (só resposta consome).
 * - Nada de texto da pergunta em mensagem de erro (sem dado pessoal em log).
 * O formato do corpo e da resposta é do provedor escolhido: `montarCorpo` e `extrairFiltros` são injetados.
 */
import { ErroTempoEsgotadoIa } from '../../domain';
/** Falha do provedor que não é tempo esgotado. A mensagem nunca carrega o texto da pergunta. */
export class ErroProvedorIa extends Error {
    motivo;
    status;
    constructor(motivo, 
    /** Status HTTP quando `motivo = http`. */
    status) {
        super(motivo === 'http' ? `O provedor de IA respondeu com erro HTTP ${status}.` : `Falha na chamada ao provedor de IA (${motivo}).`);
        this.motivo = motivo;
        this.status = status;
        this.name = 'ErroProvedorIa';
    }
}
const padraoCorpo = (e) => ({ texto: e.texto, marcas: e.marcas, linhas: e.linhas });
export function criarPortaInterpretacaoHttp(config) {
    if (!Number.isFinite(config.timeoutMs) || config.timeoutMs <= 0)
        throw new RangeError('Informe o tempo limite do provedor de IA (use resolverTimeoutIaMs).');
    // Dois AbortSignal coexistem no typecheck (lib DOM x undici-types do @types/node); o objeto é o mesmo em execução.
    const chamar = config.fetch ?? ((url, init) => fetch(url, init));
    const criarSinalTempo = config.criarSinalTempo ?? ((ms) => AbortSignal.timeout(ms));
    const montarCorpo = config.montarCorpo ?? padraoCorpo;
    const extrair = config.extrairFiltros ?? ((r) => r);
    return {
        async interpretar(entrada, opcoes) {
            const tempo = criarSinalTempo(config.timeoutMs);
            const sinal = opcoes?.signal ? AbortSignal.any([opcoes.signal, tempo]) : tempo;
            let aoAbortar;
            const abortada = new Promise((_, rejeitar) => {
                aoAbortar = () => rejeitar(tempo.aborted ? new ErroTempoEsgotadoIa() : new ErroProvedorIa('cancelada'));
                if (sinal.aborted)
                    aoAbortar();
                else
                    sinal.addEventListener('abort', aoAbortar, { once: true });
            });
            abortada.catch(() => undefined); // não vira "unhandled rejection" se a chamada terminar antes
            const executar = async () => {
                const resposta = await chamar(config.url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json', ...config.cabecalhos },
                    body: JSON.stringify(montarCorpo(entrada)),
                    signal: sinal,
                });
                if (!resposta.ok)
                    throw new ErroProvedorIa('http', resposta.status);
                let json;
                try {
                    json = await resposta.json();
                }
                catch (erro) {
                    if (sinal.aborted)
                        throw erro; // o corte veio do tempo/cancelamento, não do corpo
                    throw new ErroProvedorIa('resposta_invalida');
                }
                return extrair(json);
            };
            try {
                return await Promise.race([executar(), abortada]);
            }
            catch (erro) {
                if (erro instanceof ErroTempoEsgotadoIa || erro instanceof ErroProvedorIa)
                    throw erro;
                // O fetch rejeitou por causa do signal (TimeoutError/AbortError) ou por rede.
                if (tempo.aborted)
                    throw new ErroTempoEsgotadoIa();
                if (sinal.aborted)
                    throw new ErroProvedorIa('cancelada');
                throw new ErroProvedorIa('rede');
            }
            finally {
                if (aoAbortar)
                    sinal.removeEventListener('abort', aoAbortar);
            }
        },
    };
}
