/**
 * T-0158 (ADR 0043; desenho docs/desenho/T-0158.md §3): cliente HTTP do repositório de recados (`aloirr/macuxifdv-recados`,
 * ADR 0039) para o SERVIDOR gravar o recado automático do diagnóstico com o remetente de sistema `diagnostico`.
 * - Mesmo mecanismo do `scripts/coord-lib.mjs` (`enviarRecadoNoGitHub`), em versão assíncrona e sem dependência nova
 *   (`fetch` nativo): lê o topo do main e as pastas dos destinos, escolhe o id livre contra ESSE commit e grava um commit
 *   atômico (`createCommitOnBranch` com `expectedHeadOid`) com um arquivo por destino. Se o main mudou, relê e tenta de novo
 *   (até 6 vezes). Com a resposta perdida, confere no GitHub se o commit entrou (hash do blob) antes de decidir.
 * - O token (fine-grained `macuxi-recados-servidor`, só Contents: read and write no repositório de recados) vive só na
 *   memória do processo do worker: nunca vai a log, a mensagem de erro nem a arquivo. Erros levam só HTTP e tipo.
 */
import { createHash } from 'node:crypto';

export const REPO_RECADOS_PADRAO = 'aloirr/macuxifdv-recados';
export const API_GITHUB_PADRAO = 'https://api.github.com';
const BRANCH = 'main';
const TENTATIVAS_PADRAO = 6;

export class ErroRecadosGithub extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroRecadosGithub';
  }
}

/** Hash do git de um blob (o mesmo `shaDoBlob` do coord): confere se o commit perdido entrou. */
export function shaDoBlob(conteudo: string): string {
  const b = Buffer.from(conteudo, 'utf8');
  return createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
}

export interface EnvioRecado {
  /** Pastas de destino (`recados/<destino>/<id>.md`), todas no mesmo commit. */
  destinos: readonly string[];
  /** Escolhe o id livre contra os ids que já existem nas pastas dos destinos (no commit lido). */
  gerarId(existentes: ReadonlySet<string>): string;
  /** Conteúdo do recado para o id escolhido. */
  montar(id: string): string;
}

export interface ClienteRecadosGithub {
  enviar(e: EnvioRecado): Promise<{ id: string; commit: string; tentativas: number }>;
}

export interface OpcoesClienteRecados {
  token: string;
  repo?: string;
  api?: string;
  fetch?: typeof fetch;
  tentativas?: number;
  esperar?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const Q_PASTAS = (n: number) => `query Pastas($dono: String!, $nome: String!, $ref: String!, ${Array.from({ length: n }, (_, i) => `$c${i}: String!`).join(', ')}) {
  repository(owner: $dono, name: $nome) { ref(qualifiedName: $ref) { target { ... on Commit { oid
    ${Array.from({ length: n }, (_, i) => `p${i}: file(path: $c${i}) { object { ... on Tree { entries { name } } } }`).join('\n    ')}
  } } } } }`;
const Q_ARQUIVO = `query Arquivo($dono: String!, $nome: String!, $ref: String!, $caminho: String!) {
  repository(owner: $dono, name: $nome) { ref(qualifiedName: $ref) { target { ... on Commit { oid
    arquivo: file(path: $caminho) { oid }
  } } } } }`;
const M_COMMIT = `mutation CriarCommit($input: CreateCommitOnBranchInput!) { createCommitOnBranch(input: $input) { commit { oid } } }`;

interface Alvo {
  oid?: string;
  arquivo?: { oid: string } | null;
  [k: string]: unknown;
}

export function criarClienteRecadosGithub(op: OpcoesClienteRecados): ClienteRecadosGithub {
  const repo = op.repo ?? REPO_RECADOS_PADRAO;
  const api = (op.api ?? API_GITHUB_PADRAO).replace(/\/+$/, '');
  const [dono, nome] = repo.split('/');
  const base = { dono, nome, ref: `refs/heads/${BRANCH}` };
  const http = op.fetch ?? fetch;
  const tentativas = op.tentativas ?? TENTATIVAS_PADRAO;
  const esperar = op.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const timeoutMs = op.timeoutMs ?? 30_000;

  async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    let resp: Response;
    try {
      resp = await http(`${api}/graphql`, {
        method: 'POST',
        headers: {
          authorization: `bearer ${op.token}`,
          'content-type': 'application/json',
          'user-agent': 'macuxi-api-diagnostico',
          accept: 'application/vnd.github+json',
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      // só o tipo do erro: nunca a requisição (cabeçalho com o token)
      throw new ErroRecadosGithub(`sem acesso ao GitHub (${e instanceof Error ? e.name : 'falha de rede'})`);
    }
    type RespostaGql = { data?: T; errors?: { type?: string; message?: string }[] };
    const j = await resp.json().then(
      (x: unknown) => (x && typeof x === 'object' ? (x as RespostaGql) : null),
      () => null,
    );
    if (resp.status === 401) throw new ErroRecadosGithub('o GitHub recusou o token do servidor (HTTP 401)');
    if (!resp.ok || !j) throw new ErroRecadosGithub(`GitHub: HTTP ${resp.status}`);
    // file(path:) inexistente vem como campo nulo (NOT_FOUND com caminho fundo): não é erro
    const erros = (j.errors ?? []).filter((e) => e?.type !== 'NOT_FOUND');
    if (erros.length || !j.data) throw new ErroRecadosGithub(`GitHub: ${erros.map((e) => e.type ?? 'erro').join(', ') || 'sem dados'}`);
    return j.data;
  }

  const alvo = (d: { repository?: { ref?: { target?: Alvo } | null } | null }): Alvo & { oid: string } => {
    const t = d?.repository?.ref?.target;
    if (!t?.oid) throw new ErroRecadosGithub(`o branch ${BRANCH} do ${repo} não foi encontrado`);
    return t as Alvo & { oid: string };
  };

  async function lerPastas(destinos: readonly string[]): Promise<{ oid: string; ids: Set<string> }> {
    const vars = Object.fromEntries(destinos.map((d, i) => [`c${i}`, `recados/${d}`]));
    const t = alvo(await gql(Q_PASTAS(destinos.length), { ...base, ...vars }));
    const ids = new Set<string>();
    destinos.forEach((_, i) => {
      const p = t[`p${i}`] as { object?: { entries?: { name: string }[] } } | null | undefined;
      for (const e of p?.object?.entries ?? []) if (e.name.endsWith('.md')) ids.add(e.name.slice(0, -3));
    });
    return { oid: t.oid, ids };
  }

  return {
    async enviar(e) {
      if (!e.destinos.length) throw new ErroRecadosGithub('recado sem destino');
      let ultimo: unknown = null;
      for (let t = 1; t <= tentativas; t++) {
        const { oid, ids } = await lerPastas(e.destinos);
        const id = e.gerarId(ids);
        const conteudo = e.montar(id);
        const adicoes = e.destinos.map((d) => ({ path: `recados/${d}/${id}.md`, contents: Buffer.from(conteudo, 'utf8').toString('base64') }));
        try {
          const r = await gql<{ createCommitOnBranch?: { commit?: { oid?: string } } }>(M_COMMIT, {
            input: {
              branch: { repositoryNameWithOwner: repo, branchName: BRANCH },
              expectedHeadOid: oid,
              message: { headline: `recados: ${id}`, body: `de diagnostico para ${e.destinos.join(', ')}` },
              fileChanges: { additions: adicoes },
            },
          });
          const commit = r.createCommitOnBranch?.commit?.oid;
          if (!commit) throw new ErroRecadosGithub('o GitHub não devolveu o commit');
          return { id, commit, tentativas: t };
        } catch (erro) {
          if (!(erro instanceof ErroRecadosGithub)) throw erro;
          ultimo = erro;
          // conferência: com a resposta perdida, o commit pode ter entrado
          const a = alvo(await gql(Q_ARQUIVO, { ...base, caminho: adicoes[0]!.path }));
          if (a.arquivo?.oid === shaDoBlob(conteudo)) return { id, commit: a.oid, tentativas: t };
          if (a.oid !== oid) {
            await esperar(250 * t + Math.floor(Math.random() * 500)); // outro commit entrou antes: relê e tenta de novo
            continue;
          }
          throw erro;
        }
      }
      throw new ErroRecadosGithub(`o main do ${repo} mudou ${tentativas} vezes durante o envio${ultimo instanceof Error ? ` (${ultimo.message})` : ''}`);
    },
  };
}
