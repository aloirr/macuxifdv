/**
 * Pesquisas no aparelho (RF-PES-03, RN-PES-01/02): reconstrói questionário + versões a partir das linhas do pull e
 * calcula o que a aba "Pesquisas" oferece (só avulsas; a obrigatória do checkout fica na etapa, `checkout.ts`).
 * Funções puras: a tela lê do armazenamento local e da fila do motor, e chama estas funções (offline-first).
 */
import type { QuestionarioVersao, QuestionarioVersaoSync, RespostaEnvio, RespostaPesquisaSync } from '../contracts';
import type { PesquisaDoTenant } from './checkout';
import { pesquisaAplicavel, type ClienteAlvo, type MotivoInaplicavel, type RespostaAnterior, type UsuarioAlvo } from './publico';

/** RN-PES-01: agrupa as versões publicadas por questionário (rascunho e linha removida ficam de fora). */
export function montarPesquisasDoAparelho(linhas: readonly QuestionarioVersaoSync[]): PesquisaDoTenant[] {
  const grupos = new Map<string, { linhas: QuestionarioVersaoSync[] }>();
  for (const l of linhas) {
    if (l.deleted_at !== null || l.status !== 'publicada' || l.versao.status !== 'publicada') continue;
    const g = grupos.get(l.questionario_id) ?? { linhas: [] };
    g.linhas.push(l);
    grupos.set(l.questionario_id, g);
  }
  const saida: PesquisaDoTenant[] = [];
  for (const [id, g] of grupos) {
    const ordenadas = g.linhas.slice().sort((a, b) => a.numero - b.numero);
    const maisNova = ordenadas.reduce((a, b) => (b.updated_at > a.updated_at ? b : a));
    saida.push({
      questionario: { id, tenant_id: ordenadas[0]!.versao.tenant_id, criado_em: ordenadas[0]!.questionario_criado_em, arquivado_em: maisNova.arquivado_em },
      versoes: ordenadas.map((l) => l.versao),
    });
  }
  return saida.sort((a, b) => (a.questionario.criado_em < b.questionario.criado_em ? -1 : a.questionario.criado_em > b.questionario.criado_em ? 1 : 0));
}

export interface ItemOferta {
  questionario_id: string;
  versao: QuestionarioVersao;
  titulo: string;
}

export interface ItemIndisponivel {
  questionario_id: string;
  titulo: string;
  motivo: MotivoInaplicavel;
  mensagem: string;
  /** Dia (fuso do tenant) em que volta, quando a frequência segura. */
  liberada_em: string | null;
}

export interface EntradaOferta {
  pesquisas: readonly PesquisaDoTenant[];
  usuario: UsuarioAlvo;
  cliente: ClienteAlvo | null;
  visita_id: string | null;
  agora: string;
  respostas: readonly RespostaAnterior[];
  fuso: string;
}

/** Motivos que a aba mostra como "indisponível agora" (o resto não é para o usuário e some da lista). */
const MOSTRA_INDISPONIVEL: readonly MotivoInaplicavel[] = ['FREQUENCIA', 'CLIENTE_FORA_DO_PUBLICO'];

/**
 * RF-PES-03: avulsas aplicáveis agora (RF-PES-02: público, vigência; RN-PES-02: frequência). Fora do público, da
 * vigência, arquivada ou sem versão: não aparece. Cumprida pela frequência ou pedindo cliente: aparece indisponível.
 */
export function ofertaDePesquisas(e: EntradaOferta): { disponiveis: ItemOferta[]; indisponiveis: ItemIndisponivel[] } {
  const disponiveis: ItemOferta[] = [];
  const indisponiveis: ItemIndisponivel[] = [];
  for (const { questionario, versoes } of e.pesquisas) {
    const ap = pesquisaAplicavel(questionario, versoes, { usuario: e.usuario, cliente: e.cliente, agora: e.agora, visita_id: e.visita_id, respostas_anteriores: e.respostas, fuso: e.fuso });
    if (!ap.versao || ap.versao.modo !== 'avulsa') continue;
    if (ap.aplicavel) {
      disponiveis.push({ questionario_id: questionario.id, versao: ap.versao, titulo: ap.versao.titulo });
    } else if (ap.motivo && MOSTRA_INDISPONIVEL.includes(ap.motivo)) {
      indisponiveis.push({ questionario_id: questionario.id, titulo: ap.versao.titulo, motivo: ap.motivo, mensagem: ap.mensagem ?? '', liberada_em: ap.liberada_em ?? null });
    }
  }
  return { disponiveis, indisponiveis };
}

/**
 * RN-PES-02 / RF-PES-04: respostas que o aparelho conhece — o resumo do pull (de qualquer usuário, nos clientes da
 * carteira) mais as que ainda estão na fila (do próprio usuário). Linha removida fica de fora; o id repetido vale uma vez.
 */
export function respostasConhecidas(a: { linhas: readonly RespostaPesquisaSync[]; fila: readonly RespostaEnvio[]; usuario_id: string }): RespostaAnterior[] {
  const vistos = new Set<string>();
  const saida: RespostaAnterior[] = [];
  for (const l of a.linhas) {
    if (l.deleted_at !== null || vistos.has(l.id)) continue;
    vistos.add(l.id);
    saida.push({ questionario_id: l.questionario_id, usuario_id: l.usuario_id, cliente_id: l.cliente_id, visita_id: l.visita_id, respondida_em: l.respondida_em });
  }
  for (const f of a.fila) {
    if (vistos.has(f.id)) continue;
    vistos.add(f.id);
    saida.push({ questionario_id: f.questionario_id, usuario_id: a.usuario_id, cliente_id: f.cliente_id, visita_id: f.visita_id, respondida_em: f.respondida_em });
  }
  return saida;
}
