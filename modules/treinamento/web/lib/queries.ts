'use client';

/**
 * Consultas e comandos do Treinamento no BKO (`/v1/treinamento/*`, desenho T-0058). Toda resposta é validada pelo
 * contrato. Licença, perfil (ação do manifesto) e escopo da equipe (RN-CORE-04) são checados pela API; a UI só esconde.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, useSession } from '@macuxi/platform-sdk/web';
import { DEFAULT_TZ } from '@macuxi/ui/web';
import { AdesaoResposta, BkoTrilhaDetalhe, BkoTrilhasResposta, PessoasResposta, type TrilhaEdicaoEntrada } from '../../contracts';
import { type FiltrosTrilhas, queryDasTrilhas, queryDoPainel } from './filtros-url';
import { apiTreinamento } from './rotas';

export const qk = {
  adesao: (q: Record<string, string>) => ['treinamento', 'adesao', q] as const,
  pessoas: (q: Record<string, string>) => ['treinamento', 'pessoas', q] as const,
  trilhas: (q: Record<string, string>) => ['treinamento', 'bko-trilhas', q] as const,
  trilha: (id: string) => ['treinamento', 'bko-trilha', id] as const,
};

function useAutenticado() {
  return useSession().status === 'authenticated';
}

/** Fuso do tenant (do login do Core) para exibir datas. */
export function useFusoDoBko(): string {
  return useSession<{ fuso?: string }>().user?.fuso ?? DEFAULT_TZ;
}

/** RF-TRE-05: adesão do mês e conclusão por trilha (ação `adesao.ver`). */
export function useAdesao(f: FiltrosTrilhas, pode: boolean) {
  const q = queryDoPainel(f);
  const enabled = useAutenticado() && pode;
  return useQuery({ queryKey: qk.adesao(q), queryFn: async ({ signal }) => AdesaoResposta.parse(await api<unknown>(apiTreinamento.adesao, { query: q, signal })), enabled, placeholderData: (prev) => prev });
}

/** RF-TRE-05: notas e atividade por pessoa (ação `notas.ver`). */
export function usePessoas(f: FiltrosTrilhas, pode: boolean) {
  const q = queryDoPainel(f);
  const enabled = useAutenticado() && pode;
  return useQuery({ queryKey: qk.pessoas(q), queryFn: async ({ signal }) => PessoasResposta.parse(await api<unknown>(apiTreinamento.adesaoPessoas, { query: q, signal })), enabled, placeholderData: (prev) => prev });
}

/** RF-TRE-01: cadastro de trilhas (ação `trilha.editar`). */
export function useTrilhasBko(f: FiltrosTrilhas, pode: boolean) {
  const q = queryDasTrilhas(f);
  const enabled = useAutenticado() && pode;
  return useQuery({ queryKey: qk.trilhas(q), queryFn: async ({ signal }) => BkoTrilhasResposta.parse(await api<unknown>(apiTreinamento.bkoTrilhas, { query: q, signal })).itens, enabled, placeholderData: (prev) => prev });
}

export function useTrilhaBko(id: string | null) {
  const enabled = useAutenticado() && !!id;
  return useQuery({ queryKey: qk.trilha(id ?? ''), queryFn: async ({ signal }) => BkoTrilhaDetalhe.parse(await api<unknown>(apiTreinamento.bkoTrilha(id!), { signal })), enabled });
}

/** Grava o detalhe devolvido no cache e invalida as listas (a lista do cadastro e o painel mudam juntos). */
function useAoGravar() {
  const qc = useQueryClient();
  return async (d: BkoTrilhaDetalhe) => {
    qc.setQueryData(qk.trilha(d.id), d);
    await qc.invalidateQueries({ queryKey: ['treinamento', 'bko-trilhas'] });
    await qc.invalidateQueries({ queryKey: ['treinamento', 'adesao'] });
  };
}

/** Salvar: POST na trilha nova (id do cliente, idempotente), PUT na existente (só rascunho; a API recusa o resto). */
export function useSalvarTrilha() {
  const aoGravar = useAoGravar();
  return useMutation({
    mutationFn: async ({ corpo, nova }: { corpo: TrilhaEdicaoEntrada; nova: boolean }) =>
      BkoTrilhaDetalhe.parse(await api<unknown>(nova ? apiTreinamento.bkoTrilhas : apiTreinamento.bkoTrilha(corpo.id), { method: nova ? 'POST' : 'PUT', body: corpo })),
    onSuccess: aoGravar,
  });
}

/** Publicar ou arquivar (auditado na API, RN-AUD-01). */
export function useMudarStatus() {
  const aoGravar = useAoGravar();
  return useMutation({
    mutationFn: async ({ id, acao }: { id: string; acao: 'publicar' | 'arquivar' }) =>
      BkoTrilhaDetalhe.parse(await api<unknown>(acao === 'publicar' ? apiTreinamento.bkoPublicar(id) : apiTreinamento.bkoArquivar(id), { method: 'POST' })),
    onSuccess: aoGravar,
  });
}
