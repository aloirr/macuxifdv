/**
 * RN-CORE-78 e RN-CORE-79: pré-cadastro de cliente (o FDV só pré-cadastra; o ERP aprova). Funções puras; a API revalida.
 * Razão social e CPF/CNPJ são sempre obrigatórios; a empresa marca os demais em Parâmetros.
 */
import { mascararDadoPessoal } from '@macuxi/comum';
import { ERRO_CAMPO_LIMITES, ERROS_RECUSA_MAX, } from '../contracts/cliente-pre-cadastro';
/** Motivo da recusa do ERP guardado até 500 caracteres (RN-CORE-78); vazio vira nulo. */
export const MOTIVO_RECUSA_MAX = 500;
export function motivoRecusaCortado(motivo) {
    const m = (motivo ?? '').trim();
    return m === '' ? null : m.slice(0, MOTIVO_RECUSA_MAX);
}
/**
 * Criação com o CPF/CNPJ de outro cliente vivo (RN-CORE-78): pendente, aprovado ou sem situação (legado) bloqueia com 409. Recusado não
 * bloqueia: é o `id` novo do APK v1.0.28 substituindo o recusado (ADR 0069 §4). O recusado sai (`remover`, deleted_at na mesma
 * transação) e o novo herda o histórico dele como revisão seguinte (`substituir`: o de maior revisão; pelo índice único há no máximo um).
 * Sai quando a versão mínima do Campo passar de 1.0.28 (volta a só bloquear).
 */
export function decidirDocumentoDuplicado(iguais) {
    const bloqueia = iguais.some((c) => c.status_cadastro !== 'recusado');
    if (bloqueia || iguais.length === 0)
        return { bloqueia, remover: [], substituir: null };
    const alvo = iguais.reduce((a, b) => ((b.revisao_cadastro ?? 1) > (a.revisao_cadastro ?? 1) ? b : a));
    return { bloqueia, remover: iguais.map((c) => c.id), substituir: { id: alvo.id, revisao: alvo.revisao_cadastro ?? 1 } };
}
/** RN-CORE-78: o motivo e os erros por campo da recusa do ERP só vão ao vendedor. */
export function perfilVeRecusa(perfil) {
    return perfil === 'vendedor';
}
/**
 * Chaves do hash v1, em ordem lexicográfica por ponto de código (ADR 0069 §2), que são também as colunas de dados do pré-cadastro em
 * `core.cliente` (fonte única da API). Mudar qualquer regra = ADR nova.
 */
export const COLUNAS_DADOS_PRE_CADASTRO = ['bairro', 'cep', 'cidade', 'documento', 'email', 'filial_id', 'inscricao_estadual', 'latitude', 'logradouro', 'longitude', 'nome_fantasia', 'numero', 'razao_social', 'telefone', 'uf'];
const SO_DIGITOS = new Set(['documento', 'cep', 'telefone']);
const MAIUSCULAS = new Set(['uf', 'inscricao_estadual']);
function texto(v) {
    if (v === null || v === undefined)
        return null;
    const t = String(v).trim();
    return t === '' ? null : t;
}
/** Casas das coordenadas no banco (`numeric(9, 6)`). */
const CASAS_COORDENADA = 6;
/**
 * Arredonda o texto decimal em 6 casas como o `numeric(9, 6)` do Postgres: o meio vai para longe do zero (-3.1234565 -> -3.123457), sobre
 * os dígitos do texto que chega ao banco, sem o erro do binário (`Math.round` levaria o meio negativo para +∞ e o hash divergiria do Hub).
 */
function arredondarComoPostgres(n, bruto) {
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(bruto) ?? /^(-?)(\d+)(?:\.(\d*))?$/.exec(n.toFixed(20));
    if (!m)
        return n;
    const [, sinal, inteiro = '', fracao = ''] = m;
    if (fracao.length <= CASAS_COORDENADA)
        return n;
    const escala = BigInt(`${inteiro || '0'}${fracao.slice(0, CASAS_COORDENADA)}`) + (fracao[CASAS_COORDENADA] >= '5' ? 1n : 0n);
    const digitos = escala.toString().padStart(CASAS_COORDENADA + 1, '0');
    const r = Number(`${digitos.slice(0, -CASAS_COORDENADA)}.${digitos.slice(-CASAS_COORDENADA)}`);
    return sinal === '-' && r !== 0 ? -r : r;
}
function coordenada(v) {
    const bruto = typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '';
    const n = bruto === '' ? NaN : Number(bruto);
    return Number.isFinite(n) ? arredondarComoPostgres(n, bruto) : null;
}
function valorCanonico(chave, v) {
    if (chave === 'latitude' || chave === 'longitude')
        return coordenada(v);
    const t = texto(v);
    if (t === null)
        return null;
    if (SO_DIGITOS.has(chave))
        return t.replace(/\D/g, '') || null;
    if (MAIUSCULAS.has(chave))
        return t.toUpperCase();
    if (chave === 'email' || chave === 'filial_id')
        return t.toLowerCase();
    return t;
}
function objetoCanonico(dados) {
    return Object.fromEntries(COLUNAS_DADOS_PRE_CADASTRO.map((k) => [k, valorCanonico(k, dados[k])]));
}
/**
 * RN-CORE-78 (ADR 0069 §2, versão 1): texto canônico dos dados do pré-cadastro; a API faz o sha256 dele (`node:crypto`). Todas as chaves
 * presentes, em ordem fixa; texto com trim e vazio nulo; documento, CEP e telefone só dígitos; UF e IE em maiúsculas; e-mail e filial em
 * minúsculas; coordenadas em 6 casas. Fora do hash: id, origem, revisao_base e o que não é dado do cliente.
 */
export function canonicalPreCadastro(dados) {
    return JSON.stringify(objetoCanonico(dados));
}
/** RN-CORE-78: nomes dos campos que mudaram entre duas revisões (pelos valores canônicos), na ordem canônica; nunca os valores. */
export function camposAlteradosPreCadastro(antes, depois) {
    const a = objetoCanonico(antes);
    const d = objetoCanonico(depois);
    return COLUNAS_DADOS_PRE_CADASTRO.filter((k) => a[k] !== d[k]);
}
/**
 * RN-CORE-78: correção do recusado com a `revisao_base` que a pessoa viu. Igual à atual (e recusado) = revisão nova; a anterior com o
 * mesmo hash da atual = repetição idempotente; outra = 409 REVISAO_DESATUALIZADA (dois corretores ao mesmo tempo); na revisão atual sem
 * estar recusado = 422 CADASTRO_NAO_RECUSADO; sem cliente = 404.
 */
export function decidirReenvioPreCadastro(atual, pedido) {
    if (!atual)
        return { acao: 'recusar', http: 404, codigo: 'NAO_ENCONTRADO' };
    if (pedido.revisao_base === atual.revisao_cadastro - 1 && atual.hash_atual !== null && pedido.hash === atual.hash_atual)
        return { acao: 'repetido' };
    if (pedido.revisao_base !== atual.revisao_cadastro)
        return { acao: 'recusar', http: 409, codigo: 'REVISAO_DESATUALIZADA' };
    if (atual.status_cadastro !== 'recusado')
        return { acao: 'recusar', http: 422, codigo: 'CADASTRO_NAO_RECUSADO' };
    return { acao: 'nova_revisao', revisao: atual.revisao_cadastro + 1 };
}
/**
 * RN-CORE-78 (ADR 0069 §5): 23505 no insert do pré-cadastro, decidido pela restrição depois da reconsulta. `cliente_pkey`: id vivo no
 * tenant = o outro pedido gravou primeiro (ja_existia); apagado ou invisível pela RLS = CADASTRO_INDISPONIVEL. `cliente_documento_uk`:
 * mesmo id = ja_existia; outro (ou já sumiu) = DOCUMENTO_JA_CADASTRADO. Outra restrição relança. Sem laço de nova tentativa.
 */
export function decidirConflitoUnicidade(e) {
    const vivo = e.porId && !e.porId.apagado ? e.porId : null;
    if (e.restricao === 'cliente_pkey')
        return vivo ? { resposta: 'ja_existia', status_cadastro: vivo.status_cadastro ?? 'aprovado' } : { resposta: 'erro', codigo: 'CADASTRO_INDISPONIVEL' };
    if (e.restricao === 'cliente_documento_uk') {
        return e.porDocumento?.id === e.id ? { resposta: 'ja_existia', status_cadastro: vivo?.status_cadastro ?? 'pendente' } : { resposta: 'erro', codigo: 'DOCUMENTO_JA_CADASTRADO' };
    }
    return { resposta: 'relancar' };
}
/**
 * RN-CORE-78: situação na lista de recusados do BKO (só clientes com ao menos uma tentativa recusada). Recusado = recusado; pendente
 * depois de corrigido (revisão > 1) = reenviado; aprovado = aceito. Fora disso (pendente da 1ª revisão, sem situação) = nulo.
 */
export function situacaoDoRecusado(c) {
    if (c.status_cadastro === 'recusado')
        return 'recusado';
    if (c.status_cadastro === 'aprovado')
        return 'aceito';
    if (c.status_cadastro === 'pendente' && (c.revisao_cadastro ?? 1) > 1)
        return 'reenviado';
    return null;
}
/**
 * RN-CORE-78, RN-INT-22 e regra 8: erros por campo do ERP prontos para gravar. Só itens com campo, código e mensagem em texto; até 50
 * itens; campo, código e mensagem passam por `mascararDadoPessoal` antes do corte nos limites (o corte nunca deixa meio CPF à vista).
 */
export function errosRecusaSeguros(erros) {
    const seguro = (t, max) => mascararDadoPessoal(t.trim()).slice(0, max).trim();
    if (!Array.isArray(erros))
        return [];
    const seguros = [];
    for (const e of erros) {
        if (seguros.length >= ERROS_RECUSA_MAX)
            break;
        if (typeof e !== 'object' || e === null)
            continue;
        const { campo, codigo, mensagem } = e;
        if (typeof campo !== 'string' || typeof codigo !== 'string' || typeof mensagem !== 'string')
            continue;
        const item = {
            campo: seguro(campo, ERRO_CAMPO_LIMITES.campo),
            codigo: seguro(codigo, ERRO_CAMPO_LIMITES.codigo),
            mensagem: seguro(mensagem, ERRO_CAMPO_LIMITES.mensagem),
        };
        if (item.campo !== '' && item.codigo !== '' && item.mensagem !== '')
            seguros.push(item);
    }
    return seguros;
}
