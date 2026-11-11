/**
 * T-0158 (ADR 0043; desenho docs/desenho/T-0158.md §3 e §9): cliente do repositório de recados do servidor (`recados-github.ts`)
 * com `fetch` falso, e o formato do recado automático lido pelo próprio `scripts/coord-lib.mjs` (para nunca se separar do coord).
 */
import { describe, expect, it } from 'vitest';
import { DESTINOS_RECADO_DIAGNOSTICO, idDoRecadoDiagnostico, montarRecadoDiagnostico, montarRecadoResumo, type LinhaAlerta } from '../src/diagnosticos-worker';
import { criarClienteRecadosGithub, ErroRecadosGithub, shaDoBlob } from '../src/recados-github';

const TOKEN = 'github_pat_FALSO_0123456789';
const T0 = new Date('2026-11-11T19:30:12.000Z');

interface Chamada {
  url: string;
  corpo: { query: string; variables: Record<string, unknown> };
  auth: string | null;
}

/** GitHub falso: main com `oids` em sequência, pastas com os nomes dados e commits que podem falhar. */
function githubFalso(op: { pastas?: Record<string, string[]>; recusarCommits?: number; perderResposta?: boolean; status?: number } = {}) {
  const chamadas: Chamada[] = [];
  let oid = 'c0';
  let recusas = op.recusarCommits ?? 0;
  const gravados = new Map<string, string>();
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const corpo = JSON.parse(String(init?.body)) as Chamada['corpo'];
    chamadas.push({ url: String(url), corpo, auth: new Headers(init?.headers).get('authorization') });
    const json = (status: number, j: unknown) => new Response(JSON.stringify(j), { status });
    if (op.status) return json(op.status, { message: 'Bad credentials' });
    if (corpo.query.includes('createCommitOnBranch')) {
      const input = corpo.variables.input as { expectedHeadOid: string; fileChanges: { additions: { path: string; contents: string }[] } };
      if (recusas > 0) {
        recusas--;
        oid = `${oid}x`; // outro agente gravou antes
        return json(200, { data: null, errors: [{ type: 'STALE_DATA', message: 'Expected branch to point to ...' }] });
      }
      if (input.expectedHeadOid !== oid) return json(200, { data: null, errors: [{ type: 'STALE_DATA' }] });
      for (const a of input.fileChanges.additions) gravados.set(a.path, Buffer.from(a.contents, 'base64').toString('utf8'));
      oid = `${oid}+`;
      if (op.perderResposta) throw new TypeError('fetch failed');
      return json(200, { data: { createCommitOnBranch: { commit: { oid } } } });
    }
    if (corpo.query.includes('query Arquivo')) {
      const c = gravados.get(String(corpo.variables.caminho));
      return json(200, { data: { repository: { ref: { target: { oid, arquivo: c === undefined ? null : { oid: shaDoBlob(c) } } } } } });
    }
    // query Pastas
    const alvo: Record<string, unknown> = { oid };
    for (const [k, v] of Object.entries(corpo.variables)) {
      if (!/^c\d+$/.test(k)) continue;
      const pasta = String(v).replace(/^recados\//, '');
      const nomes = [...(op.pastas?.[pasta] ?? []), ...[...gravados.keys()].filter((p) => p.startsWith(`recados/${pasta}/`)).map((p) => p.split('/').pop()!.slice(0, -3))];
      alvo[`p${k.slice(1)}`] = { object: { entries: nomes.map((n) => ({ name: `${n}.md` })) } };
    }
    return json(200, { data: { repository: { ref: { target: alvo } } } });
  }) as typeof fetch;
  return { f, chamadas, gravados };
}

const envio = (montar = (id: string) => `---\nid: ${id}\nde: diagnostico\n---\n# teste\n`) => ({
  destinos: DESTINOS_RECADO_DIAGNOSTICO,
  gerarId: (ids: ReadonlySet<string>) => idDoRecadoDiagnostico(T0, ids),
  montar,
});

describe('cliente de recados do servidor (recados-github.ts)', () => {
  it('um commit atômico com um arquivo por destino; o id é escolhido contra as pastas do mesmo commit', async () => {
    const g = githubFalso({ pastas: { alexandre: ['R-20261111-153012-diagnostico'] } });
    const c = criarClienteRecadosGithub({ token: TOKEN, fetch: g.f, esperar: async () => undefined });
    const r = await c.enviar(envio());
    expect(r.id).toBe('R-20261111-153012-2-diagnostico');
    expect([...g.gravados.keys()]).toEqual([`recados/alexandre/${r.id}.md`, `recados/engenheiro-apps/${r.id}.md`]);
    const commit = g.chamadas.find((x) => x.corpo.query.includes('createCommitOnBranch'))!;
    expect(commit.corpo.variables.input).toMatchObject({ expectedHeadOid: 'c0', branch: { repositoryNameWithOwner: 'aloirr/macuxifdv-recados', branchName: 'main' } });
    expect(g.chamadas.every((x) => x.auth === `bearer ${TOKEN}` && x.url === 'https://api.github.com/graphql')).toBe(true);
  });

  it('main mudou no meio: relê e tenta de novo (até 6 vezes); depois desiste', async () => {
    const g = githubFalso({ recusarCommits: 2 });
    const c = criarClienteRecadosGithub({ token: TOKEN, fetch: g.f, esperar: async () => undefined });
    expect((await c.enviar(envio())).tentativas).toBe(3);
    const g2 = githubFalso({ recusarCommits: 99 });
    const c2 = criarClienteRecadosGithub({ token: TOKEN, fetch: g2.f, esperar: async () => undefined });
    await expect(c2.enviar(envio())).rejects.toThrow(/mudou 6 vezes/);
  });

  it('resposta perdida: confere pelo hash do blob e não duplica', async () => {
    const g = githubFalso({ perderResposta: true });
    const c = criarClienteRecadosGithub({ token: TOKEN, fetch: g.f, esperar: async () => undefined });
    const r = await c.enviar(envio());
    expect(r.tentativas).toBe(1);
    expect(g.chamadas.filter((x) => x.corpo.query.includes('createCommitOnBranch'))).toHaveLength(1);
  });

  it('o token nunca aparece no erro', async () => {
    const g = githubFalso({ status: 401 });
    const c = criarClienteRecadosGithub({ token: TOKEN, fetch: g.f });
    const e = await c.enviar(envio()).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ErroRecadosGithub);
    expect(String((e as Error).message)).not.toContain(TOKEN);
  });
});

describe('formato do recado automático lido pelo coord (scripts/coord-lib.mjs)', () => {
  const linha: LinhaAlerta = {
    id: '0d1a0000-0000-4000-8000-000000000042',
    tenant_id: '0a000000-0000-4000-8000-000000000001',
    protocolo: '42',
    usuario_id: '0b000000-0000-4000-8000-0000000000a1',
    perfil: 'vendedor',
    origem: 'queda',
    app: 'campo',
    versao_app: '1.0.5',
    build: null,
    aparelho_fabricante: 'samsung',
    aparelho_modelo: 'SM-A155M',
    android: '14',
    tela: '/m/novo-pedido',
    motivo: 'crash_nativo',
    print_id: null,
    recebido_em: T0,
    alerta_tentativas: 0,
  };

  it('remetente "diagnostico", destinos e índice iguais aos do coord', async () => {
    // caminho não literal: o coord-lib é .mjs sem tipos e fica fora do grafo de dependências da API (só este teste o lê)
    const caminho = new URL('../../../scripts/coord-lib.mjs', import.meta.url).href;
    const lib = (await import(caminho)) as {
      remetenteDoConteudo(t: string): string | null;
      ehArquivoDoIndice(p: string): boolean;
      recadosDoIndice(idx: { arquivos: Record<string, string>; textos: Record<string, string> }): { destino: string; nome: string; texto: string }[];
      shaDoBlob(t: string): string;
      DESTINOS: string[];
    };
    const id = idDoRecadoDiagnostico(T0, new Set());
    for (const texto of [
      montarRecadoDiagnostico(linha, { id, agora: T0, urlPortal: 'https://config.macuxifdv.com.br' }),
      montarRecadoResumo({ id, agora: T0, quantidade: 3, desde: T0, urlPortal: 'https://config.macuxifdv.com.br' }),
    ]) {
      expect(lib.remetenteDoConteudo(texto)).toBe('diagnostico');
      expect(lib.shaDoBlob(texto)).toBe(shaDoBlob(texto));
      const arquivos = Object.fromEntries(DESTINOS_RECADO_DIAGNOSTICO.map((d) => [`recados/${d}/${id}.md`, shaDoBlob(texto)]));
      expect(Object.keys(arquivos).every((p) => lib.ehArquivoDoIndice(p))).toBe(true);
      const lidos = lib.recadosDoIndice({ arquivos, textos: { [shaDoBlob(texto)]: texto } });
      expect(lidos.map((r) => [r.destino, r.nome])).toEqual(DESTINOS_RECADO_DIAGNOSTICO.map((d) => [d, `${id}.md`]));
      // as caixas de destino existem no coord (ninguém manda PARA "diagnostico")
      expect(DESTINOS_RECADO_DIAGNOSTICO.every((d) => lib.DESTINOS.includes(d))).toBe(true);
      expect(texto).toMatch(/^---\nid: R-20261111-153012-diagnostico\nde: diagnostico\npara: \[alexandre, engenheiro-apps\]\ncc: \[\]\ntipo: aviso\nprioridade: (alta|normal)\ntarefa: T-0158\nresponde_a: null\nencerra: false\ncontrato: null\ncriado_em: 2026-11-11T15:30:12-04:00\n---\n# /);
    }
  });
});
