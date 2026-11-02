'use client';

/**
 * Consultas das páginas da Pesquisa no BKO, só na API nova (`/v1/pesquisa/*`). A sessão vem de `useSession` (perfil e
 * fuso do login do Core). A proteção real é na API (licença, perfil, escopo); a tela só reflete.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, apiFetch, useSession } from '@macuxi/platform-sdk/web';
import { DEFAULT_TZ } from '@macuxi/ui/web';
import {
  ExportacaoResponse,
  Galeria,
  ListaQuestionarios,
  ListaRespostas,
  PublicarResponse,
  QuestionarioDetalhe,
  ResultadoResponse,
  type CriarQuestionarioRequest,
  type SalvarRascunhoRequest,
} from '../../contracts';
import { queryDoResultado, type FiltrosLista, type FiltrosResultado } from './filtros-url';

const BASE = '/pesquisa/questionarios';

export const qk = {
  lista: (f: FiltrosLista) => ['pesquisa', 'questionarios', f] as const,
  detalhe: (id: string) => ['pesquisa', 'questionario', id] as const,
  resultado: (id: string, f: FiltrosResultado) => ['pesquisa', 'resultado', id, f] as const,
  respostas: (id: string, f: FiltrosResultado) => ['pesquisa', 'respostas', id, f] as const,
  galeria: (id: string, f: FiltrosResultado) => ['pesquisa', 'galeria', id, f] as const,
};

function useAutenticado() {
  return useSession().status === 'authenticated';
}

/** Fuso do tenant (do login) para mostrar datas e montar a vigência. */
export function useFusoDoTenant(): string {
  const s = useSession<{ fuso?: string }>();
  return s.user?.fuso ?? DEFAULT_TZ;
}

export function useQuestionarios(f: FiltrosLista) {
  const enabled = useAutenticado();
  return useQuery({ queryKey: qk.lista(f), queryFn: async ({ signal }) => ListaQuestionarios.parse(await api<unknown>(BASE, { query: { ...f }, signal })), enabled });
}

export function useQuestionario(id: string | undefined) {
  const enabled = useAutenticado() && Boolean(id);
  return useQuery({ queryKey: qk.detalhe(id ?? ''), queryFn: async ({ signal }) => QuestionarioDetalhe.parse(await api<unknown>(`${BASE}/${id}`, { signal })), enabled });
}

export function useResultado(id: string | undefined, f: FiltrosResultado) {
  const enabled = useAutenticado() && Boolean(id);
  return useQuery({ queryKey: qk.resultado(id ?? '', f), queryFn: async ({ signal }) => ResultadoResponse.parse(await api<unknown>(`${BASE}/${id}/resultado`, { query: queryDoResultado(f), signal })), enabled });
}

export function useRespostas(id: string | undefined, f: FiltrosResultado) {
  const enabled = useAutenticado() && Boolean(id);
  return useQuery({ queryKey: qk.respostas(id ?? '', f), queryFn: async ({ signal }) => ListaRespostas.parse(await api<unknown>(`${BASE}/${id}/respostas`, { query: queryDoResultado(f), signal })), enabled });
}

export function useGaleria(id: string | undefined, f: FiltrosResultado) {
  const enabled = useAutenticado() && Boolean(id);
  return useQuery({ queryKey: qk.galeria(id ?? '', f), queryFn: async ({ signal }) => Galeria.parse(await api<unknown>(`${BASE}/${id}/galeria`, { query: queryDoResultado(f), signal })), enabled });
}

export function useCriarQuestionario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (corpo: CriarQuestionarioRequest) => QuestionarioDetalhe.parse(await api<unknown>(BASE, { method: 'POST', body: corpo })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['pesquisa', 'questionarios'] }),
  });
}

/** Salvar rascunho, publicar e arquivar: atualizam o detalhe e a lista. */
export function useAcoesDoQuestionario(id: string) {
  const qc = useQueryClient();
  const depois = (d?: QuestionarioDetalhe) => {
    if (d) qc.setQueryData(qk.detalhe(id), d);
    void qc.invalidateQueries({ queryKey: ['pesquisa'] });
  };
  return {
    salvar: useMutation({ mutationFn: async (corpo: SalvarRascunhoRequest) => QuestionarioDetalhe.parse(await api<unknown>(`${BASE}/${id}/rascunho`, { method: 'PUT', body: corpo })), onSuccess: depois }),
    publicar: useMutation({ mutationFn: async () => PublicarResponse.parse(await api<unknown>(`${BASE}/${id}/publicar`, { method: 'POST', body: {} })), onSuccess: () => depois() }),
    arquivar: useMutation({ mutationFn: async () => QuestionarioDetalhe.parse(await api<unknown>(`${BASE}/${id}/arquivar`, { method: 'POST', body: {} })), onSuccess: depois }),
  };
}

/** RF-PES-06: baixa o CSV (Excel pt-BR) gerado pela API, no escopo e nos filtros da tela. */
export async function baixarCsv(id: string, f: FiltrosResultado): Promise<void> {
  const r = ExportacaoResponse.parse(await api<unknown>(`${BASE}/${id}/exportar`, { query: queryDoResultado(f) }));
  const url = URL.createObjectURL(new Blob([r.conteudo], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = r.nome_arquivo;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Foto da galeria: `GET /v1/arquivos/:id` com a sessão (ADR 0010); `null` se ainda não subiu do aparelho. */
export async function urlDaFoto(fotoId: string): Promise<string | null> {
  try {
    const res = await apiFetch(`/arquivos/${fotoId}`);
    return URL.createObjectURL(await res.blob());
  } catch {
    return null;
  }
}
