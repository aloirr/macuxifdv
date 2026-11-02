/**
 * Implementação EM MEMÓRIA do repositório (mesma interface do SQL), para os testes do módulo e para a demonstração
 * sem banco. Separa tudo por tenant (o `tenantId` da transação), como a RLS faria. Não é usada pelo `moduloApi` de
 * produção (que falha fechado até a migração 0017 existir).
 */
import { compararCursor, type LinhaSync, type PedidoPull } from '@macuxi/platform-sdk';
import type { MedalhaUsuarioSyncLinha, ProgressoSyncLinha, TentativaSyncLinha, XpLancamentoSyncLinha } from '../contracts/sync';
import type { EntidadeDoAluno, FabricaRepositorio, RepositorioTreinamento, TrilhaGravada, UsuarioTreinamento } from './repositorio';

export interface BancoTreinamentoMemoria {
  trilhas: (TrilhaGravada & { tenant_id: string })[];
  progresso: ProgressoSyncLinha[];
  tentativa: TentativaSyncLinha[];
  xp_lancamento: XpLancamentoSyncLinha[];
  medalha_usuario: MedalhaUsuarioSyncLinha[];
  usuarios: (UsuarioTreinamento & { tenant_id: string })[];
  /** `tenant:usuario` de cada `travarAluno` (prova que a escrita do aluno é serializada). */
  travas: string[];
}

export const criarBancoEmMemoria = (): BancoTreinamentoMemoria => ({ trilhas: [], progresso: [], tentativa: [], xp_lancamento: [], medalha_usuario: [], usuarios: [], travas: [] });

const naJanela = <L extends LinhaSync>(linhas: readonly L[], p: PedidoPull): L[] =>
  linhas.filter((l) => l.updated_at < p.ate && (!p.desde || compararCursor(l, p.desde) > 0)).sort(compararCursor).slice(0, p.limite);

const copia = <T>(x: T): T => structuredClone(x);

export function fabricaEmMemoria(b: BancoTreinamentoMemoria): FabricaRepositorio {
  return {
    doTenant(_db, tenantId, agora): RepositorioTreinamento {
      const meu = <T extends { tenant_id: string }>(xs: readonly T[]) => xs.filter((x) => x.tenant_id === tenantId);
      const doAluno = <T extends { tenant_id: string; usuario_id: string }>(xs: readonly T[], u: string) => meu(xs).filter((x) => x.usuario_id === u);
      const carimbo = () => ({ updated_at: agora().toISOString(), deleted_at: null });
      return {
        async travarAluno(usuarioId) {
          b.travas.push(`${tenantId}:${usuarioId}`);
        },
        async trilhas() {
          return copia(meu(b.trilhas).filter((t) => !t.deleted_at));
        },
        async trilha(id) {
          const t = meu(b.trilhas).find((x) => x.id === id && !x.deleted_at);
          return t ? copia(t) : null;
        },
        async inserirTrilha(t) {
          if (t.tenant_id !== tenantId) throw new Error('trilha de outro tenant (RLS)');
          if (b.trilhas.some((x) => x.id === t.id)) throw Object.assign(new Error('chave duplicada'), { code: '23505' });
          b.trilhas.push({ ...copia(t), deleted_at: null });
        },
        async atualizarTrilha(t) {
          const i = b.trilhas.findIndex((x) => x.id === t.id && x.tenant_id === tenantId);
          if (i < 0) throw new Error('trilha inexistente no tenant');
          b.trilhas[i] = { ...copia(t), deleted_at: b.trilhas[i]!.deleted_at };
        },
        async trilhasDesde(p) {
          return copia(naJanela(meu(b.trilhas), p));
        },
        async estadoDoAluno(u) {
          return copia({
            conclusoes: doAluno(b.progresso, u).map(({ id, trilha_id, licao_id, tempo_gasto_seg, concluida_em }) => ({ id, trilha_id, licao_id, tempo_gasto_seg, concluida_em })),
            tentativas: doAluno(b.tentativa, u).map(({ id, quiz_id, realizada_em, respostas, acertos, total_questoes, nota_pct, aprovada, primeira_tentativa, finalizada }) => ({
              id,
              quiz_id,
              realizada_em,
              respostas,
              acertos,
              total_questoes,
              nota_pct,
              aprovada,
              primeira_tentativa,
              finalizada,
            })),
            lancamentos: doAluno(b.xp_lancamento, u).map(({ updated_at: _u, deleted_at: _d, ...l }) => l),
            conquistas: doAluno(b.medalha_usuario, u).map(({ id, medalha_codigo, conquistada_em }) => ({ id, medalha_codigo, conquistada_em })),
          });
        },
        async gravarAtividade(u, e) {
          const base = { tenant_id: tenantId, usuario_id: u, ...carimbo() };
          if (e.conclusao) b.progresso.push({ ...base, ...copia(e.conclusao) });
          if (e.tentativa) b.tentativa.push({ ...base, ...copia({ ...e.tentativa, respostas: e.tentativa.respostas.map((r) => ({ questao_id: r.questao_id, alternativa_ids: [...r.alternativa_ids] })) }) });
          for (const l of e.lancamentos) {
            // unique (tenant_id, usuario_id, origem, referencia_id) — a chave natural de `chaveDoEvento` (regras.md §8)
            if (b.xp_lancamento.some((x) => x.tenant_id === tenantId && x.usuario_id === u && x.origem === l.origem && x.referencia_id === l.referencia_id)) {
              throw Object.assign(new Error('chave duplicada'), { code: '23505' });
            }
            b.xp_lancamento.push({ ...copia(l), updated_at: base.updated_at, deleted_at: null });
          }
          for (const c of e.conquistas) b.medalha_usuario.push({ ...base, ...copia(c) });
        },
        async linhasDoAluno(entidade: EntidadeDoAluno, u, p) {
          return copia(naJanela(doAluno(b[entidade] as readonly (LinhaSync & { tenant_id: string; usuario_id: string })[], u), p));
        },
        async conclusoesDoTenant() {
          return meu(b.progresso).map(({ usuario_id, trilha_id, licao_id, concluida_em }) => ({ usuario_id, trilha_id, licao_id, concluida_em }));
        },
        async tentativasDoTenant() {
          return meu(b.tentativa).map(({ usuario_id, quiz_id, realizada_em, nota_pct, aprovada }) => ({ usuario_id, quiz_id, realizada_em, nota_pct, aprovada }));
        },
        async lancamentosDoTenant() {
          return meu(b.xp_lancamento).map(({ updated_at: _u, deleted_at: _d, ...l }) => l);
        },
        async usuarios() {
          return meu(b.usuarios).map(({ tenant_id: _t, ...u }) => u);
        },
      };
    },
  };
}
