/**
 * Repositório da Pesquisa em memória (T-0057), atrás de `RepositorioPesquisa`. Serve aos testes e à API enquanto a
 * migração 0016 não chega: os dados ficam no processo (somem ao reiniciar) e separados por tenant. `updated_at` é
 * estritamente crescente por tenant (microssegundos), como o gatilho do banco, para o cursor do pull não perder linha.
 */
import type { Questionario, QuestionarioVersao, QuestionarioVersaoSync, RespostaPesquisa, RespostaPesquisaSync } from '../contracts';
import type { FabricaRepositorio, JanelaPull, QuestionarioCarregado, RepositorioPesquisa } from './repositorio';

interface Linha<T> {
  dado: T;
  created_at: string;
  updated_at: string;
}

interface DadosTenant {
  questionarios: Map<string, Linha<Questionario>>;
  versoes: Map<string, Linha<QuestionarioVersao>>;
  respostas: Map<string, Linha<RespostaPesquisa>>;
  ultimoMicros: number;
}

const copia = <T>(x: T): T => structuredClone(x);

/** Instante ISO com microssegundos (`...SSS000Z`), estritamente maior que o último do tenant. */
function carimbo(d: DadosTenant, agora: string): string {
  const micros = Math.max(Date.parse(agora) * 1000, d.ultimoMicros + 1);
  d.ultimoMicros = micros;
  const ms = Math.floor(micros / 1000);
  const resto = String(micros % 1000).padStart(3, '0');
  return `${new Date(ms).toISOString().slice(0, 23)}${resto}Z`;
}

const cursorDepois = (l: { updated_at: string; id: string }, j: JanelaPull) =>
  l.updated_at < j.ate && (j.desde === null || l.updated_at > j.desde.updated_at || (l.updated_at === j.desde.updated_at && l.id > j.desde.id));

const ordemCursor = (a: { updated_at: string; id: string }, b: { updated_at: string; id: string }) =>
  a.updated_at < b.updated_at ? -1 : a.updated_at > b.updated_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** Cria o armazenamento e devolve a fábrica (`tenantId` → repositório). O `db` é ignorado aqui. */
export function criarRepositorioEmMemoria(): FabricaRepositorio & { limpar(): void } {
  const porTenant = new Map<string, DadosTenant>();
  const dados = (t: string): DadosTenant => {
    let d = porTenant.get(t);
    if (!d) {
      d = { questionarios: new Map(), versoes: new Map(), respostas: new Map(), ultimoMicros: 0 };
      porTenant.set(t, d);
    }
    return d;
  };

  const fabrica = (tenantId: string): RepositorioPesquisa => {
    const d = dados(tenantId);
    const versoesDe = (qid: string) =>
      [...d.versoes.values()]
        .filter((l) => l.dado.questionario_id === qid)
        .sort((a, b) => a.dado.numero - b.dado.numero);
    const carregado = (qid: string): QuestionarioCarregado | null => {
      const q = d.questionarios.get(qid);
      if (!q) return null;
      const vs = versoesDe(qid);
      const atualizado_em = [q.updated_at, ...vs.map((v) => v.updated_at)].reduce((a, b) => (b > a ? b : a));
      return { questionario: copia(q.dado), versoes: vs.map((v) => copia(v.dado)), atualizado_em };
    };
    const contar = (qid: string) => [...d.respostas.values()].filter((r) => r.dado.questionario_id === qid).length;

    return {
      async listarQuestionarios() {
        return [...d.questionarios.keys()].map((id) => ({ ...carregado(id)!, respostas: contar(id) }));
      },
      async carregar(id) {
        return carregado(id);
      },
      async criarQuestionario(q, primeira, agora) {
        if (d.questionarios.has(q.id)) throw new Error(`Questionário ${q.id} já existe.`);
        const t = carimbo(d, agora);
        d.questionarios.set(q.id, { dado: copia(q), created_at: t, updated_at: t });
        d.versoes.set(primeira.id, { dado: copia(primeira), created_at: t, updated_at: t });
      },
      async gravarVersao(v, agora) {
        const atual = d.versoes.get(v.id);
        if (atual && atual.dado.status === 'publicada') throw new Error(`Versão ${v.id} publicada não pode ser alterada (RN-PES-01).`);
        const t = carimbo(d, agora);
        d.versoes.set(v.id, { dado: copia(v), created_at: atual?.created_at ?? t, updated_at: t });
      },
      async arquivar(id, agora) {
        const q = d.questionarios.get(id);
        if (!q || q.dado.arquivado_em !== null) return;
        const t = carimbo(d, agora);
        q.dado = { ...q.dado, arquivado_em: agora };
        q.updated_at = t;
        // a linha do pull repete o arquivado_em: as versões publicadas mudam junto para descer ao aparelho
        for (const v of versoesDe(id)) if (v.dado.status === 'publicada') v.updated_at = carimbo(d, agora);
      },
      async contarRespostas(qid) {
        return contar(qid);
      },
      async obterResposta(id) {
        const r = d.respostas.get(id);
        return r ? copia(r.dado) : null;
      },
      async inserirResposta(r, agora) {
        if (d.respostas.has(r.id)) throw new Error(`Resposta ${r.id} já existe (somente inserção, RF-PES-04).`);
        const t = carimbo(d, agora);
        d.respostas.set(r.id, { dado: copia(r), created_at: t, updated_at: t });
      },
      async listarRespostas(qid) {
        return [...d.respostas.values()].filter((r) => r.dado.questionario_id === qid).map((r) => copia(r.dado));
      },
      async respostasParaCheckout(f) {
        const desde = Date.parse(f.desde);
        return [...d.respostas.values()]
          .map((r) => r.dado)
          .filter(
            (r) =>
              f.questionario_ids.includes(r.questionario_id) &&
              (r.visita_id === f.visita_id || ((r.cliente_id === f.cliente_id || r.usuario_id === f.usuario_id) && Date.parse(r.respondida_em) >= desde)),
          )
          .map((r) => ({ questionario_id: r.questionario_id, usuario_id: r.usuario_id, cliente_id: r.cliente_id, visita_id: r.visita_id, respondida_em: r.respondida_em }));
      },
      async puxarVersoes(janela) {
        const linhas: QuestionarioVersaoSync[] = [];
        for (const v of d.versoes.values()) {
          if (v.dado.status !== 'publicada') continue;
          const q = d.questionarios.get(v.dado.questionario_id);
          if (!q) continue;
          const l = { id: v.dado.id, updated_at: v.updated_at };
          if (!cursorDepois(l, janela)) continue;
          linhas.push({
            id: v.dado.id,
            updated_at: v.updated_at,
            deleted_at: null,
            questionario_id: v.dado.questionario_id,
            numero: v.dado.numero,
            status: v.dado.status,
            arquivado_em: q.dado.arquivado_em,
            questionario_criado_em: q.dado.criado_em,
            versao: copia(v.dado),
          });
        }
        return linhas.sort(ordemCursor).slice(0, janela.limite);
      },
      async puxarRespostas(janela, noEscopo) {
        const linhas: RespostaPesquisaSync[] = [];
        for (const r of d.respostas.values()) {
          if (!cursorDepois({ id: r.dado.id, updated_at: r.updated_at }, janela) || !noEscopo(r.dado)) continue;
          linhas.push({
            id: r.dado.id,
            updated_at: r.updated_at,
            deleted_at: null,
            questionario_id: r.dado.questionario_id,
            versao_id: r.dado.versao_id,
            usuario_id: r.dado.usuario_id,
            cliente_id: r.dado.cliente_id,
            visita_id: r.dado.visita_id,
            respondida_em: r.dado.respondida_em,
            recebida_em: r.dado.recebida_em,
          });
        }
        return linhas.sort(ordemCursor).slice(0, janela.limite);
      },
    };
  };
  return Object.assign(fabrica, { limpar: () => porTenant.clear() });
}
