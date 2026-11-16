/**
 * Porta dos pacotes publicados para download (T-0098; ADR 0037): o instalador do Conector on-premise fica num bucket PRIVADO
 * e a API entrega ao portal um link GET assinado de validade curta (URL pré-assinada SigV4), sem nunca servir os bytes.
 *
 * - `ServicoPacotes` — o que a rota do módulo recebe em `ctx.pacotes`. `linkDoUltimo(produto)` lê o manifesto
 *   `<prefixo><produto>/ultimo.json` (`PacotePublicadoSchema`) e assina o GET de `<prefixo><produto>/<arquivo>`.
 *   Sem pacote publicado → `null` (o módulo responde o próprio 404, ex.: `CONECTOR_SEM_PACOTE`). Armazenamento sem S3,
 *   manifesto inválido ou bucket fora → `ErroHttpModulo` 503 `ARMAZENAMENTO_INDISPONIVEL` (falha fechada).
 * - Quem pode pedir o link é a ROTA (perfil/permissão, licença do módulo, auditoria): a porta não decide acesso.
 *
 * O link é um segredo de curta duração: nunca vai para log, auditoria nem para o aparelho guardado (cada clique gera outro).
 * Puro TypeScript (sem `node:*`): o SDK também roda no app e no navegador.
 */
import { z } from 'zod';
import { ErroHttpModulo } from './api';
/** Produtos com pacote publicado. Lista fechada: a chave do objeto nunca vem do cliente. */
export const PRODUTOS_PACOTE = ['conector'];
/** Validade do link em segundos: padrão 5 min, de 1 a 15 min (`MACUXI_PACOTES_VALIDADE_S`). */
export const VALIDADE_LINK_PACOTE_S = Object.freeze({ padrao: 300, min: 60, max: 900 });
/** 503 do armazenamento (o mesmo código das fotos em `/v1/arquivos`). */
export const CODIGO_ARMAZENAMENTO_INDISPONIVEL = 'ARMAZENAMENTO_INDISPONIVEL';
/** Nome do objeto do pacote: letras sem acento, dígitos, ponto, `_` e `-` (até 100); nada a escapar em cabeçalho ou URL. */
export const NOME_PACOTE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** Versão semântica `X.Y.Z` com sufixo opcional (`-rc.1`). */
export const VERSAO_PACOTE_RE = /^\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.-]{1,32})?$/;
/** Manifesto `<produto>/ultimo.json`, gravado por quem publica (CLI `pnpm --filter api publicar-pacote`). */
export const PacotePublicadoSchema = z.object({
    versao: z.string().regex(VERSAO_PACOTE_RE, 'versão fora do formato X.Y.Z'),
    arquivo: z
        .string()
        .regex(NOME_PACOTE_RE, 'nome de arquivo inválido')
        .refine((n) => n !== 'ultimo.json', 'o pacote não pode se chamar ultimo.json'),
    tamanho_bytes: z.number().int().positive().optional(),
    sha256: z
        .string()
        .regex(/^[0-9a-f]{64}$/, 'sha256 em hexadecimal minúsculo')
        .optional(),
    /** ISO UTC de quando foi publicado (informativo). */
    publicado_em: z.string().datetime().optional(),
});
/** Chave relativa ao prefixo dos pacotes. */
export function chaveDoPacote(produto, arquivo) {
    if (!PRODUTOS_PACOTE.includes(produto))
        throw new Error('produto de pacote inválido');
    if (!NOME_PACOTE_RE.test(arquivo))
        throw new Error('nome de arquivo de pacote inválido');
    return `${produto}/${arquivo}`;
}
/** Chave do manifesto do último pacote, relativa ao prefixo. */
export function chaveUltimoPacote(produto) {
    return chaveDoPacote(produto, 'ultimo.json');
}
export function erroArmazenamentoIndisponivel() {
    return new ErroHttpModulo(503, CODIGO_ARMAZENAMENTO_INDISPONIVEL, 'O download não está disponível neste servidor agora. Tente de novo em instantes ou avise o suporte.');
}
/** Sem S3 configurado (padrão da API e dos contextos de teste): `linkDoUltimo` responde 503. */
export const SERVICO_PACOTES_DESLIGADO = Object.freeze({
    disponivel: () => false,
    linkDoUltimo: () => Promise.reject(erroArmazenamentoIndisponivel()),
});
/**
 * Para testes de módulo: pacotes fixos, link falso `https://pacotes.teste/<produto>/<arquivo>?expira=<iso>`.
 * `agora` e `validadeS` como na API.
 */
export function criarServicoPacotesMemoria(pacotes, op = {}) {
    const agora = op.agora ?? (() => new Date());
    const validadeS = op.validadeS ?? VALIDADE_LINK_PACOTE_S.padrao;
    return {
        disponivel: () => true,
        linkDoUltimo(produto) {
            const bruto = pacotes[produto];
            if (!bruto)
                return Promise.resolve(null);
            const p = PacotePublicadoSchema.parse(bruto);
            const expira = new Date(agora().getTime() + validadeS * 1000).toISOString();
            return Promise.resolve({ ...p, url: `https://pacotes.teste/${chaveDoPacote(produto, p.arquivo)}?expira=${encodeURIComponent(expira)}`, expira_em: expira });
        },
    };
}
