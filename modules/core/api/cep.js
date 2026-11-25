/**
 * `GET /v1/core/cep?cep=69053000` (RN-CORE-75): pesquisa de CEP para o endereço do usuário no BKO. A chamada sai do servidor: BrasilAPI
 * primeiro, ViaCEP de reserva, 3 s cada. O CEP e o endereço que voltam são dado pessoal em potencial: nada vai para log: o CEP vai na query
 * (não no caminho) porque o serializador do log de acesso corta a query (`url.split('?')[0]`); no caminho ele iria para o log.
 */
import { normalizarCep } from '@macuxi/comum/endereco';
import { CepEncontradoSchema, CepQuerySchema, cepTemOitoDigitos, CODIGOS_CEP, ERRO_CEP_INVALIDO } from '../contracts';
import { cepDaBrasilApi, cepDoViaCep } from '../domain';
import { erroHttp } from './erros';
export const TEMPO_CEP_MS = 3000;
async function consultar(fetcher, url, normalizar) {
    try {
        const r = await fetcher(url, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(TEMPO_CEP_MS),
        });
        if (r.status === 404 || r.status === 400)
            return { tipo: 'nao_achou' };
        if (!r.ok)
            return { tipo: 'fora' };
        const cep = normalizar(await r.json());
        return cep ? { tipo: 'achou', cep } : { tipo: 'nao_achou' };
    }
    catch {
        return { tipo: 'fora' };
    }
}
/** Fábrica com `fetch` injetável (os testes não usam rede). */
export function criarRotaDeCep(fetcher = (...a) => fetch(...a)) {
    return {
        metodo: 'GET',
        caminho: 'cep',
        superficie: 'bko',
        acao: 'usuario.ver',
        carteira: 'nao_se_aplica',
        query: CepQuerySchema,
        executar: async (ctx) => {
            if (!cepTemOitoDigitos(ctx.query.cep))
                throw erroHttp(422, CODIGOS_CEP.invalido, ERRO_CEP_INVALIDO);
            const cep = normalizarCep(ctx.query.cep);
            const a = await consultar(fetcher, `https://brasilapi.com.br/api/cep/v1/${cep}`, cepDaBrasilApi);
            if (a.tipo === 'achou')
                return CepEncontradoSchema.parse(a.cep);
            const b = await consultar(fetcher, `https://viacep.com.br/ws/${cep}/json/`, cepDoViaCep);
            if (b.tipo === 'achou')
                return CepEncontradoSchema.parse(b.cep);
            if (a.tipo === 'fora' && b.tipo === 'fora')
                throw erroHttp(503, CODIGOS_CEP.indisponivel, 'Não foi possível pesquisar agora. Tente de novo ou preencha à mão.');
            throw erroHttp(404, CODIGOS_CEP.naoEncontrado, 'CEP não encontrado. Confira o número ou preencha à mão.');
        },
    };
}
export const rotasDeCep = [criarRotaDeCep()];
