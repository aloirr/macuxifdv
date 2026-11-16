import { caminhoConectorParaRoteador, problemasApiConector } from './conector';
import { problemasCookieSessao } from './cookie-sessao';
import { ehChavePlataforma, pode } from './permissoes-perfil';
import { MODOS_SUPER_ADMIN } from './plataforma';
import { ehAcaoDeEscritaDePedido, ehAcaoDeLeituraDePedido, ehAcaoDePedido, } from './nomes';
import { ESCOPOS_SYNC, } from './sync';
import { TIPOS_PARTICAO_PACOTE } from './pacotes-sync';
import { problemasLiberadoSemFilial } from './sem-filial';
/** Implementação na API (`ModuloApi.consultas` do dono): `implementarConsulta(def, async (entrada, ctx) => saida)`. */
export function implementarConsulta(consulta, executar) {
    return { consulta, executar };
}
/**
 * Tipos de resposta aceitos em `RotaModulo.tipoConteudo` (T-0087). Lista fechada de propósito: a API é servida pela mesma
 * origem do BKO e do portal (`/api-proxy`), então nenhum tipo que o navegador renderize como página ou script entra.
 */
export const TIPOS_CONTEUDO_ROTA = [
    'application/json',
    'text/csv; charset=utf-8',
    'text/plain; charset=utf-8',
    'text/markdown; charset=utf-8',
    'application/yaml; charset=utf-8',
];
/** Nome de arquivo aceito no `Content-Disposition` (sem aspas, barra, espaço nem acento: nada a escapar no cabeçalho). */
export const NOME_ARQUIVO_ROTA_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/**
 * Problemas de `tipoConteudo`/`nomeArquivo` de uma rota de módulo (vazio = ok). Usado por `definirModuloApi` e pela montagem
 * da API (fixture sem `definirModuloApi` também passa).
 */
export function problemasConteudoRota(rotulo, r) {
    const p = [];
    if (r.tipoConteudo !== undefined && !TIPOS_CONTEUDO_ROTA.includes(r.tipoConteudo))
        p.push(`${rotulo}: tipoConteudo ${String(r.tipoConteudo)} fora de ${TIPOS_CONTEUDO_ROTA.join(', ')}`);
    if (typeof r.nomeArquivo === 'string' && !NOME_ARQUIVO_ROTA_RE.test(r.nomeArquivo))
        p.push(`${rotulo}: nomeArquivo ${r.nomeArquivo} inválido (letras sem acento, dígitos, ponto, _ e -; até 100)`);
    if (r.nomeArquivo !== undefined && typeof r.nomeArquivo !== 'string' && typeof r.nomeArquivo !== 'function')
        p.push(`${rotulo}: nomeArquivo deve ser texto ou função`);
    return p;
}
/** Teto de bytes do corpo das rotas sem `limiteCorpoBytes` (o padrão do Fastify: 1 MiB). */
export const LIMITE_CORPO_ROTA_PADRAO = 1024 * 1024;
/** Teto global de `limiteCorpoBytes` numa rota de módulo (32 MiB, o mesmo do lote do Conector, ADR 0013). */
export const LIMITE_CORPO_ROTA_MAX = 32 * 1024 * 1024;
/** Código do 413 de corpo acima do limite (bytes ou elementos de array). */
export const CODIGO_CORPO_GRANDE = 'CORPO_GRANDE_DEMAIS';
/** Bytes em MB para mensagem (base 1024, pt-BR): 1048576 → "1", 1572864 → "1,5", 500 KiB → "0,49". */
export function megabytesParaMensagem(bytes) {
    const mb = bytes / (1024 * 1024);
    const casas = Number.isInteger(mb) ? 0 : mb >= 1 ? 1 : 2;
    // sem Intl (o SDK também roda no Hermes): arredonda, tira zeros à direita e usa vírgula decimal
    return String(Number(mb.toFixed(casas))).replace('.', ',');
}
/**
 * Corpo do 413 de corpo acima do limite em bytes (padrão de erro da API: `{ codigo, mensagem, detalhes }`).
 * `arquivo: true` (rota com `limiteCorpoBytes`, que recebe arquivo) → "Arquivo grande demais: o limite é X MB.";
 * senão → "Envio grande demais: o limite é X MB. Divida em partes menores.".
 */
export function erroCorpoGrande(limiteBytes, arquivo) {
    const mb = megabytesParaMensagem(limiteBytes);
    return {
        codigo: CODIGO_CORPO_GRANDE,
        mensagem: arquivo ? `Arquivo grande demais: o limite é ${mb} MB.` : `Envio grande demais: o limite é ${mb} MB. Divida em partes menores.`,
        detalhes: { limite_bytes: limiteBytes },
    };
}
/** Problemas do `limiteCorpoBytes` de uma rota de módulo (vazio = ok). Usado por `definirModuloApi` e pela montagem da API. */
export function problemasLimiteCorpo(rotulo, r) {
    if (r.limiteCorpoBytes === undefined)
        return [];
    const p = [];
    if (!(Number.isInteger(r.limiteCorpoBytes) && r.limiteCorpoBytes > 0 && r.limiteCorpoBytes <= LIMITE_CORPO_ROTA_MAX))
        p.push(`${rotulo}: limiteCorpoBytes entre 1 e ${LIMITE_CORPO_ROTA_MAX}`);
    if (r.metodo === 'GET')
        p.push(`${rotulo}: limiteCorpoBytes só vale em rota com corpo (não GET)`);
    return p;
}
/**
 * T-0091 (condição da ADR 0029): problemas da `conexao` de uma rota pública (vazio = ok). Usado por `definirModuloApi` e
 * pela montagem da API. `'portal'` só no manifesto `core` e só em `plataforma/...`; todo `plataforma/...` exige `'portal'`
 * (a sessão do super-admin nunca roda no `macuxi_app`).
 */
export function problemasConexaoRotaPublica(modulo, r) {
    const rotulo = `${r.metodo} /v1/${r.caminho}`;
    const doPortal = /^plataforma(\/|$)/.test(r.caminho);
    if (r.conexao !== undefined && r.conexao !== 'portal')
        return [`${rotulo}: conexao só aceita 'portal'`];
    const p = [];
    if (r.conexao === 'portal' && modulo !== 'core')
        p.push(`${rotulo}: conexao 'portal' só no manifesto core`);
    if (r.conexao === 'portal' && !doPortal)
        p.push(`${rotulo}: conexao 'portal' só em caminho plataforma/...`);
    if (doPortal && r.conexao !== 'portal')
        p.push(`${rotulo}: caminho plataforma/... exige conexao 'portal' (T-0091)`);
    return p;
}
/**
 * Id do usuário de sistema que a implementação de uma consulta (`ContextoConsulta.usuario.id`) recebe quando quem
 * consulta é um consumidor de evento (não há pessoa). Nunca existe em `core.usuario`; não grave como autor.
 */
export const USUARIO_SISTEMA_ID = '00000000-0000-0000-0000-000000000000';
/** Ajuda de tipo: o payload do `executar` sai do schema do evento. */
export function definirConsumidor(c) {
    return c;
}
/**
 * Tarefas periódicas do módulo (ADR 0022): rodam no worker (`apps/api/src/agendador.ts`), POR TENANT ativo com o módulo
 * efetivo (licença, RN-CORE-02/03), cada uma na sua transação `comTenant` (macuxi_app, RLS). O agendador acorda a cada
 * `INTERVALO_MINIMO_TAREFA_MIN` e nenhum período é menor que isso (RN-CORE-23: nenhum timer abaixo de 15 min).
 * Dois processos não rodam a mesma tarefa no mesmo tenant ao mesmo tempo (trava consultiva), mas a tarefa TEM de ser
 * idempotente: reinício do worker roda de novo, e uma falha só volta no período seguinte.
 */
export const INTERVALO_MINIMO_TAREFA_MIN = 15;
const NOME_TAREFA_RE = /^[a-z][a-z0-9_]*$/;
/** Problemas de uma tarefa periódica (vazio = válida). Usado por `definirTarefa` e `definirModuloApi`. */
export function problemasTarefa(t) {
    const p = [];
    if (!NOME_TAREFA_RE.test(t.nome))
        p.push(`tarefa ${t.nome}: nome inválido (minúsculas, dígitos e _)`);
    if (!Number.isInteger(t.cadaMin) || t.cadaMin < INTERVALO_MINIMO_TAREFA_MIN || t.cadaMin % INTERVALO_MINIMO_TAREFA_MIN !== 0)
        p.push(`tarefa ${t.nome}: cadaMin ${t.cadaMin} precisa ser múltiplo de ${INTERVALO_MINIMO_TAREFA_MIN} min (RN-CORE-23)`);
    return p;
}
/** Declara uma tarefa periódica (falha na subida se o nome ou o período forem inválidos). */
export function definirTarefa(t) {
    const p = problemasTarefa(t);
    if (p.length > 0)
        throw new Error(p.join('; '));
    return t;
}
/**
 * ADR 0058 §2: trabalho SOB DEMANDA, longo, em fatias com checkpoint (ex.: processar o ZIP do lote de fotos). O módulo
 * publica um evento próprio (`disparadoPor`, em `publica` e em `consome` do manifesto) na transação que pede o trabalho;
 * a plataforma grava UMA linha em `plataforma.trabalho` por (tenant, módulo, nome, `alvo(payload)`) e o laço do worker
 * (`apps/api/src/trabalhos.ts`) chama `executarFatia` até devolver `'concluido'`. Uma fatia dura até `PRAZO_FATIA_MS`
 * (`ctx.deveParar()`); o checkpoint é do módulo, no banco (ex.: item `pendente` → final, cada um na sua transação curta),
 * então a fatia seguinte, outro processo ou o reinício do worker retomam de onde parou. A fatia TEM de ser reexecutável:
 * a trava vence e outra execução pode repetir o último item. Exceção conta tentativa (espera crescente); esgotadas as
 * `TENTATIVAS_TRABALHO_MAX`, a plataforma chama `aoFalhar` (marque o alvo como falho) e o trabalho para. Só roda com o
 * módulo licenciado no tenant (sem licença, espera e tenta depois sem contar tentativa).
 */
export const PRAZO_FATIA_MS = 20_000;
export const TENTATIVAS_TRABALHO_MAX = 5;
/** Problemas do trabalho isolado (vazio = válido). O resto (evento no manifesto) é conferido por `definirModuloApi`. */
export function problemasTrabalho(t) {
    return NOME_TAREFA_RE.test(t.nome) ? [] : [`trabalho ${t.nome}: nome inválido (minúsculas, dígitos e _)`];
}
/** Declara um trabalho sob demanda (o tipo do payload de `alvo` sai do schema do evento). */
export function definirTrabalho(t) {
    const p = problemasTrabalho(t);
    if (p.length > 0)
        throw new Error(p.join('; '));
    return t;
}
/**
 * T-0087 (R-20261106-010602): lista FECHADA de cabeçalhos que a rota pública recebe. Hoje só `authorization` (token de
 * plataforma em `renovar`/`sair`/`recuperacao/regerar`). Cookie, `x-macuxi-*` e o resto nunca chegam à rota. Acrescentar
 * um nome aqui é mudança de plataforma (revisão do engenheiro-software), não do módulo.
 */
export const CABECALHOS_PUBLICOS = ['authorization'];
const CENSURA_CABECALHO = '[omitido]';
/**
 * Filtra os cabeçalhos brutos da requisição para a lista fechada (`CABECALHOS_PUBLICOS`). O objeto devolvido é congelado
 * e, serializado (`JSON.stringify`, pino), sai com os valores trocados por `[omitido]`: registrar `ctx.cabecalhos` por
 * engano nunca vaza o token. A leitura direta (`cabecalhos.authorization`) devolve o valor real.
 */
export function cabecalhosPublicos(brutos) {
    const saida = {};
    for (const [nome, valor] of Object.entries(brutos)) {
        const n = nome.toLowerCase();
        if (!CABECALHOS_PUBLICOS.includes(n))
            continue;
        const v = Array.isArray(valor) ? valor[0] : valor;
        if (typeof v === 'string' && saida[n] === undefined)
            saida[n] = v;
    }
    Object.defineProperty(saida, 'toJSON', {
        enumerable: false,
        value: () => Object.fromEntries(Object.keys(saida).map((k) => [k, CENSURA_CABECALHO])),
    });
    return Object.freeze(saida);
}
/** Teto do `max-age` da rota pública com cache (1 dia): documento novo chega aos clientes no mesmo dia. */
export const CACHE_ROTA_PUBLICA_MAX_SEGUNDOS = 86_400;
/** URL da rota pública: core em `/v1/<caminho>`; outro módulo em `/<modulo>/v1/<caminho>` (T-0092). */
export function caminhoDaRotaPublica(modulo, caminho) {
    return modulo === 'core' ? `/v1/${caminho}` : `/${modulo}/v1/${caminho}`;
}
/**
 * Problemas de uma rota pública (vazio = ok), além do caminho e do limite que `definirModuloApi` confere: a `conexao`
 * (T-0091) e o `cache` (T-0092). Usado por `definirModuloApi` e pela montagem da API (fixture sem `definirModuloApi`).
 * Regras do `cache`: só `GET`, sem `corpo`, status 200, sem `conexao`, `maxAgeSegundos` inteiro de 1 a 1 dia. Fora do core,
 * rota pública só existe com `cache` (documento público), sem prefixo reservado a checar: o espaço `/<modulo>/v1` é do módulo.
 */
export function problemasRotaPublica(modulo, r) {
    const rotulo = `${r.metodo} ${caminhoDaRotaPublica(modulo, r.caminho)}`;
    const p = [...problemasConexaoRotaPublica(modulo, r), ...problemasCookieSessao(modulo, rotulo, r)];
    if (modulo !== 'core' && r.cache === undefined)
        p.push(`${rotulo}: rota pública fora do core só serve documento com cache (T-0092)`);
    if (r.cache === undefined)
        return p;
    const s = r.cache?.maxAgeSegundos;
    if (!(Number.isInteger(s) && s > 0 && s <= CACHE_ROTA_PUBLICA_MAX_SEGUNDOS))
        p.push(`${rotulo}: cache.maxAgeSegundos inteiro entre 1 e ${CACHE_ROTA_PUBLICA_MAX_SEGUNDOS}`);
    if (r.metodo !== 'GET')
        p.push(`${rotulo}: cache só em GET`);
    if (r.corpo !== undefined)
        p.push(`${rotulo}: rota com cache não recebe corpo`);
    if (r.status !== undefined && r.status !== 200)
        p.push(`${rotulo}: rota com cache responde 200 (ou 304)`);
    if (r.conexao !== undefined)
        p.push(`${rotulo}: rota com cache não usa a conexão do portal`);
    return p;
}
/**
 * Status que um módulo pode devolver por erro próprio. Ficam de fora os da plataforma: 400 (Zod, o createApp
 * valida) e 5xx além de 503 (erro inesperado vira 500 sem detalhes). 429 é dos dois: a plataforma limita as rotas
 * públicas contra abuso e o módulo pode ter limite próprio (ex.: tentativas de login erradas no Core, T-0026); com
 * `detalhes.retry_after_s` (inteiro > 0) a API manda também o cabeçalho `retry-after`.
 */
export const STATUS_ERRO_MODULO = [401, 403, 404, 409, 410, 422, 423, 429, 503];
/**
 * Erro HTTP de módulo (rota autenticada ou pública): a API responde `status` com `{ codigo, mensagem, detalhes? }`.
 * Ex.: login — `throw new ErroHttpModulo(401, 'CREDENCIAIS_INVALIDAS', '...')`; `(423, 'USUARIO_BLOQUEADO', ...)`;
 * `(503, 'AUTENTICACAO_INDISPONIVEL', ...)`. `detalhes` vai ao cliente: nunca coloque dado pessoal nem segredo.
 */
export class ErroHttpModulo extends Error {
    status;
    codigo;
    detalhes;
    constructor(status, codigo, mensagem, detalhes) {
        super(mensagem);
        this.status = status;
        this.codigo = codigo;
        this.detalhes = detalhes;
        this.name = 'ErroHttpModulo';
        if (!STATUS_ERRO_MODULO.includes(status))
            throw new Error(`ErroHttpModulo: status ${String(status)} não é de módulo (${STATUS_ERRO_MODULO.join(', ')})`);
    }
}
/** Erro de regra de negócio: a API responde 422 `{ codigo, mensagem, detalhes? }` (codigo = id da RN). */
export class ErroRegraNegocio extends ErroHttpModulo {
    // Sem `declare` em campo de classe: o Babel do Metro o rejeita e o build EAS cai (T-0004 §7; regra no eslint).
    status = 422;
    constructor(codigo, mensagem, detalhes) {
        super(422, codigo, mensagem, detalhes);
        this.name = 'ErroRegraNegocio';
    }
}
/**
 * Recurso inexistente OU fora do escopo do usuário: a API responde 404 `{ codigo, mensagem }` e não revela se existe
 * (RN-CORE-04). Ex.: `throw new ErroNaoEncontrado('PEDIDO_NAO_ENCONTRADO', 'Pedido não encontrado na sua carteira.')`.
 */
export class ErroNaoEncontrado extends ErroHttpModulo {
    status = 404;
    constructor(codigo, mensagem) {
        super(404, codigo, mensagem);
        this.name = 'ErroNaoEncontrado';
    }
}
/**
 * ADR 0033: recusa com 403 `PERFIL_SEM_ACESSO` se os perfis do usuário não dão `chave` (sobre `alvo`, quando a ação recai num
 * usuário, ex.: `senha.redefinir`). Para a rota inteira, prefira `acao` na `RotaModulo`; use esta no meio do `executar`.
 */
export function exigirPermissao(usuario, chave, alvo) {
    if (!pode(usuario.perfis, chave, alvo))
        throw new ErroHttpModulo(403, 'PERFIL_SEM_ACESSO', 'Seu perfil não tem acesso a esta ação.');
}
/** Corpo `ErroApiSchema` do erro do módulo (o mesmo que a API envia). */
export function corpoDoErroModulo(e) {
    return { codigo: e.codigo, mensagem: e.message, ...(e.detalhes ? { detalhes: e.detalhes } : {}) };
}
/** Segundos do cabeçalho `retry-after` de um `ErroHttpModulo` 429 (`detalhes.retry_after_s` inteiro > 0), ou `null`. */
export function retryAfterDoErroModulo(e) {
    if (e.status !== 429)
        return null;
    const s = e.detalhes?.retry_after_s;
    return typeof s === 'number' && Number.isInteger(s) && s > 0 ? s : null;
}
/**
 * ADR 0012: consultas em `ofereceConsultas` sem implementação em `ModuloApi.consultas`, no conjunto instalado. A API real
 * (`createApp` com os módulos do produto) não sobe com alguma; com módulos de fixture, a consulta faltante só fica
 * `ConsultaIndisponivel` em tempo de execução.
 */
export function consultasSemImplementacao(modulos) {
    return modulos.flatMap((m) => {
        const feitas = new Set((m.consultas ?? []).map((c) => c.consulta.nome));
        return m.manifesto.ofereceConsultas.filter((n) => !feitas.has(n)).map((n) => `${m.manifesto.id}: consulta ${n} oferecida no manifesto sem implementação em "consultas"`);
    });
}
/** Módulo → `depende` do manifesto, para `ctx.dependencias` (RN-CORE-03). */
export function dependenciasDosManifestos(manifestos) {
    const d = {};
    for (const m of manifestos)
        d[m.id] = Object.freeze([...m.depende]);
    return Object.freeze(d);
}
/**
 * Segmento do caminho: literal (`[a-z0-9_-]`, com pontos internos: `openapi.json`) ou parâmetro `:nome` com sufixo literal
 * opcional depois de ponto (`:entidade.csv`, T-0087; o roteador do Fastify termina o parâmetro no ponto). Sem ponto no
 * início, no fim nem dois seguidos.
 */
const SEGMENTO_RE = '(?:[a-z0-9_-]+(?:\\.[a-z0-9_-]+)*|:[a-z][a-zA-Z0-9_]*(?:\\.[a-z0-9_-]+)*)';
const CAMINHO_RE = new RegExp(`^${SEGMENTO_RE}(?:/${SEGMENTO_RE})*$`);
/** Nome do parâmetro no caminho, para a chave de rota repetida (`:id.csv` e `:x.csv` são a mesma rota; `.json` não). */
const PARAMETRO_RE = /:[a-z][a-zA-Z0-9_]*/g;
/** Caminho válido de rota de módulo e de rota pública (sem barra inicial; minúsculas; `:param`, com `.ext` opcional). */
export function caminhoDeRotaValido(caminho) {
    return CAMINHO_RE.test(caminho);
}
/**
 * Rota que toca pedido (`pedido`, `pedidos`, `pedido_item`, `pedidos-sugeridos`… em algum segmento do caminho). O sufixo
 * depois do ponto não muda nada: `pedidos.csv` também é caminho de pedido (RN-PRO-01).
 */
export function ehCaminhoDePedido(caminho) {
    return caminho.split('/').some((s) => /^pedidos?([_-][a-z0-9_-]+)?$/.test(s.split('.')[0] ?? ''));
}
/**
 * RN-PRO-01 na API, valendo mesmo que a rota se declare errada: o promotor é barrado em toda ação de escrita de
 * pedido e em todo caminho de pedido, EXCETO `GET` com ação de leitura de pedido (`pedido.ver`). Nesse caso a
 * leitura não é liberada aqui: segue para a permissão por ação do manifesto (ADR 0004) e o escopo de carteira
 * (RN-CORE-04) — doc 03 §2 "Ver pedidos" e esclarecimento O-3.
 */
export function promotorBarradoNaRota(rota) {
    if (rota.acao && ehAcaoDeEscritaDePedido(rota.acao))
        return true;
    const leitura = rota.metodo === 'GET' && !!rota.acao && ehAcaoDeLeituraDePedido(rota.acao);
    return ehCaminhoDePedido(rota.caminho) && !leitura;
}
/**
 * Valida e devolve a definição da API do módulo. Falha cedo (no import) se:
 * caminho fora do padrão ou repetido; rota de escrita sem `acao`; ação não declarada no manifesto do
 * próprio módulo; `perfis` fora dos perfis do módulo; rota de pedido aceitando promotor por `perfis` (RN-PRO-01;
 * a leitura do promotor só vem por `acao` de leitura); ação de leitura de pedido em método que não é GET;
 * entidade de sync fora do `sync` do manifesto ou de outro módulo; consumidor de evento fora de `consome` ou repetido;
 * consulta implementada fora de `ofereceConsultas`, de outro módulo ou repetida (ADR 0012); rotas de Conector em módulo sem
 * `apps.conector`, com id ou método+caminho repetido (ADR 0013). Consulta oferecida sem
 * implementação é checada na montagem da API real (`consultasSemImplementacao`), não aqui: teste que troca um módulo por
 * uma fixture com rotas de exemplo não precisa reimplementar as consultas dele.
 */
export function definirModuloApi(m) {
    const id = m.manifesto.id;
    const problemas = [];
    const vistas = new Set();
    for (const r of m.rotas ?? []) {
        const rotulo = `${r.metodo} /v1/${id}${r.caminho ? `/${r.caminho}` : ''}`;
        if (r.caminho !== '' && !CAMINHO_RE.test(r.caminho))
            problemas.push(`${rotulo}: caminho inválido (sem barra inicial, minúsculas, parâmetros :nome)`);
        const chave = `${r.metodo} ${r.caminho.replace(PARAMETRO_RE, ':')}`;
        if (vistas.has(chave))
            problemas.push(`${rotulo}: rota repetida`);
        vistas.add(chave);
        if (r.metodo !== 'GET' && !r.acao)
            problemas.push(`${rotulo}: rota de escrita precisa de "acao" do manifesto (ADR 0004)`);
        // ADR 0033: as chaves da plataforma (usuario.criar, senha.redefinir...) são do core; só as rotas dele as declaram em `acao`
        const chaveDaPlataforma = !!r.acao && id === 'core' && ehChavePlataforma(r.acao);
        if (r.acao && !chaveDaPlataforma && !Object.hasOwn(m.manifesto.acoes, r.acao))
            problemas.push(`${rotulo}: ação ${r.acao} não está em "acoes" do manifesto de ${id}`);
        if (r.acao && r.perfis)
            problemas.push(`${rotulo}: use "acao" ou "perfis", não os dois`);
        for (const p of r.perfis ?? [])
            if (!m.manifesto.perfis.includes(p))
                problemas.push(`${rotulo}: perfil ${p} fora dos perfis do módulo`);
        if ((ehCaminhoDePedido(r.caminho) || (r.acao && ehAcaoDePedido(r.acao))) &&
            r.perfis?.includes('promotor')) {
            problemas.push(`${rotulo}: RN-PRO-01 — promotor nunca acessa rota de pedido por "perfis" (leitura só por "acao" pedido.ver)`);
        }
        if (r.acao && ehAcaoDeLeituraDePedido(r.acao) && r.metodo !== 'GET')
            problemas.push(`${rotulo}: ação de leitura ${r.acao} só em GET (RN-PRO-01)`);
        if (r.carteira === undefined)
            problemas.push(`${rotulo}: declare o escopo de carteira (RN-CORE-04)`);
        problemas.push(...problemasLimiteCorpo(rotulo, r));
        problemas.push(...problemasConteudoRota(rotulo, r));
        problemas.push(...problemasLiberadoSemFilial(id, rotulo, r.liberadaSemFilial));
        if (r.superAdmin !== undefined && !MODOS_SUPER_ADMIN.includes(r.superAdmin))
            problemas.push(`${rotulo}: superAdmin ${String(r.superAdmin)} inválido (${MODOS_SUPER_ADMIN.join(', ')})`);
    }
    const entidades = new Set();
    for (const p of m.sync ?? []) {
        const e = p.entidade;
        if (e.modulo !== id)
            problemas.push(`sync ${e.nome}: entidade de ${e.modulo} servida por ${id}`);
        if (!m.manifesto.sync.includes(e.nome))
            problemas.push(`sync ${e.nome}: não está em "sync" do manifesto de ${id}`);
        if (entidades.has(e.nome))
            problemas.push(`sync ${e.nome}: provedor repetido`);
        entidades.add(e.nome);
        if (!p.puxar && !p.receber)
            problemas.push(`sync ${e.nome}: informe puxar e/ou receber`);
        if (p.receber && e.direcao === 'pull')
            problemas.push(`sync ${e.nome}: direção pull não recebe push`);
        if (p.puxar && e.direcao === 'push')
            problemas.push(`sync ${e.nome}: direção push não serve pull`);
        const escopos = p.escopo === undefined ? [] : typeof p.escopo === 'string' ? [p.escopo] : p.escopo;
        for (const x of escopos)
            if (!ESCOPOS_SYNC.includes(x))
                problemas.push(`sync ${e.nome}: escopo ${String(x)} inválido (${ESCOPOS_SYNC.join(', ')})`);
        if (p.escopo !== undefined && escopos.length === 0)
            problemas.push(`sync ${e.nome}: lista de escopo vazia`);
        if (p.escopo !== undefined && !p.puxar)
            problemas.push(`sync ${e.nome}: escopo só vale para provedor com puxar`);
        problemas.push(...problemasLiberadoSemFilial(id, `sync ${e.nome}`, p.liberadoSemFilial));
        if (p.liberadoSemFilial && !p.puxar)
            problemas.push(`sync ${e.nome}: liberadoSemFilial só vale para provedor com puxar`);
        if (e.schemaLinha && e.direcao === 'push')
            problemas.push(`sync ${e.nome}: schemaLinha só vale para entidade com pull`);
        if (p.pacote) {
            if (!TIPOS_PARTICAO_PACOTE.includes(p.pacote.particao))
                problemas.push(`sync ${e.nome}: partição de pacote ${String(p.pacote.particao)} inválida (${TIPOS_PARTICAO_PACOTE.join(', ')})`);
            if (!p.puxar)
                problemas.push(`sync ${e.nome}: pacote exige puxar (o incremental continua pelo pull)`);
            if (p.escopo !== 'tenant')
                problemas.push(`sync ${e.nome}: pacote só em provedor de escopo tenant (ADR 0054)`);
            if (p.pacote.particao === 'filial' && !m.particoesPacote)
                problemas.push(`sync ${e.nome}: pacote por filial exige particoesPacote no módulo ${id}`);
        }
    }
    const assinados = new Set();
    for (const c of m.consumidores ?? []) {
        const nome = c.evento.nome;
        if (!m.manifesto.consome.includes(nome))
            problemas.push(`consumidor ${nome}: não está em "consome" do manifesto de ${id}`);
        if (assinados.has(nome))
            problemas.push(`consumidor ${nome}: repetido (um por evento e módulo)`);
        assinados.add(nome);
    }
    const implementadas = new Set();
    for (const c of m.consultas ?? []) {
        const nome = c.consulta.nome;
        if (c.consulta.modulo !== id)
            problemas.push(`consulta ${nome}: é de ${c.consulta.modulo}, implementada por ${id}`);
        else if (!m.manifesto.ofereceConsultas.includes(nome))
            problemas.push(`consulta ${nome}: não está em "ofereceConsultas" do manifesto de ${id}`);
        if (implementadas.has(nome))
            problemas.push(`consulta ${nome}: implementação repetida`);
        implementadas.add(nome);
    }
    const tarefas = new Set();
    for (const t of m.tarefas ?? []) {
        problemas.push(...problemasTarefa(t));
        if (tarefas.has(t.nome))
            problemas.push(`tarefa ${t.nome}: repetida`);
        tarefas.add(t.nome);
    }
    const trabalhos = new Set();
    for (const t of m.trabalhos ?? []) {
        problemas.push(...problemasTrabalho(t));
        const ev = t.disparadoPor.nome;
        if (trabalhos.has(t.nome))
            problemas.push(`trabalho ${t.nome}: repetido`);
        trabalhos.add(t.nome);
        if (t.disparadoPor.modulo !== id)
            problemas.push(`trabalho ${t.nome}: ${ev} é evento de outro módulo`);
        if (!m.manifesto.consome.includes(ev))
            problemas.push(`trabalho ${t.nome}: ${ev} não está em "consome" do manifesto de ${id}`);
        if (!m.manifesto.publica.includes(ev))
            problemas.push(`trabalho ${t.nome}: ${ev} não está em "publica" do manifesto de ${id}`);
        // o trabalho é o consumo do evento pelo módulo (evento_consumo por módulo): não pode haver os dois
        if (assinados.has(ev))
            problemas.push(`trabalho ${t.nome}: ${ev} já tem consumidor no módulo`);
        assinados.add(ev);
    }
    if (id !== 'core' && m.servicos)
        problemas.push('só o core declara serviços de plataforma');
    const publicas = new Set();
    for (const r of m.rotasPublicas ?? []) {
        const rotulo = `${r.metodo} ${caminhoDaRotaPublica(id, r.caminho)}`;
        if (!CAMINHO_RE.test(r.caminho))
            problemas.push(`${rotulo}: caminho inválido`);
        // `plataforma/*` é da API (portal, ADR 0029); do Core, só a autenticação do super-admin em `plataforma/auth/*`
        if (id === 'core' && (/^(sync|saude|me|arquivos)(\/|$)/.test(r.caminho) || (/^plataforma(\/|$)/.test(r.caminho) && !r.caminho.startsWith('plataforma/auth/'))))
            problemas.push(`${rotulo}: prefixo reservado à plataforma`);
        if (!(r.limite?.max > 0) || !(r.limite?.janelaMs > 0))
            problemas.push(`${rotulo}: rota pública exige limite de tentativas`);
        problemas.push(...problemasRotaPublica(id, r));
        // fora do core a rota divide `/<modulo>/v1` com as rotas de Conector (ADR 0013): mesmo método e caminho = conflito
        if (id !== 'core' && m.conector?.rotas.some((c) => c.metodo === r.metodo && caminhoConectorParaRoteador(c.caminho) === `/${r.caminho}`))
            problemas.push(`${rotulo}: já é rota de Conector do módulo`);
        if (publicas.has(rotulo))
            problemas.push(`${rotulo}: rota pública repetida`);
        publicas.add(rotulo);
    }
    problemas.push(...problemasApiConector(m.manifesto, m.conector));
    if (problemas.length > 0)
        throw new Error(`API do módulo ${id} inválida: ${problemas.join('; ')}`);
    return m;
}
