'use client';

/**
 * Chamadas da criação de rota por proximidade (T-0191): base e casa do usuário, prévia (não grava), lote e "Gerar coordenada".
 * O servidor revalida tudo (RN-CORE-04, 75, 76 e 77); aqui só a camada de dados do BKO.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, useSession } from '@macuxi/platform-sdk/web';
import {
  BaseDoUsuarioRespostaSchema,
  EnderecoBaseSchema,
  EnderecoCasaRespostaSchema,
  GerarCoordenadaRespostaSchema,
  PreviaRotaRespostaSchema,
  RotasListaSchema,
  SalvarRotasLoteRespostaSchema,
  type PreviaRotaPedido,
  type SalvarBase,
  type SalvarRotasLote,
} from '../../contracts';
import type { Endereco } from '../../contracts';

const useAuthed = () => useSession().status === 'authenticated';

/** A casa e a base do usuário (diálogo "Endereço base"; ação `rota.editar`). */
export function useBaseDoUsuario(usuarioId: string | null) {
  const enabled = useAuthed() && !!usuarioId;
  return useQuery({
    queryKey: ['core', 'base', usuarioId],
    queryFn: async () => BaseDoUsuarioRespostaSchema.parse(await api<unknown>(`/core/usuarios/${usuarioId}/base`)),
    enabled,
  });
}

/** `PUT usuarios/:id/base`: a base vale para o marcador, o km e as próximas rotas do vendedor. */
export function useSalvarBase(usuarioId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (corpo: SalvarBase) => EnderecoBaseSchema.parse(await api<unknown>(`/core/usuarios/${usuarioId}/base`, { method: 'PUT', body: corpo })),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['core', 'base', usuarioId] }), qc.invalidateQueries({ queryKey: ['routes'] }), qc.invalidateQueries({ queryKey: ['core', 'rotas-brutas'] })]);
    },
  });
}

/** `GET usuarios/:id/endereco` (a casa) para a gaveta "Editar usuário". */
export function useCasaDoUsuario(usuarioId: string | null) {
  const enabled = useAuthed() && !!usuarioId;
  return useQuery({
    queryKey: ['core', 'casa', usuarioId],
    queryFn: async () => EnderecoCasaRespostaSchema.parse(await api<unknown>(`/core/usuarios/${usuarioId}/endereco`)).endereco,
    enabled,
  });
}

/** `PUT usuarios/:id/endereco`: grava (ou apaga, com `null`) a casa. */
export async function gravarCasaDoUsuario(usuarioId: string, endereco: Endereco | null) {
  return EnderecoCasaRespostaSchema.parse(await api<unknown>(`/core/usuarios/${usuarioId}/endereco`, { method: 'PUT', body: { endereco } })).endereco;
}

/** As rotas do período como o servidor devolveu (origem e status das paradas), para o conflito do diálogo "Criar rota". */
export function useRotasBrutas(f: { usuario_id: string; de: string; ate: string }, enabled: boolean) {
  const authed = useAuthed();
  return useQuery({
    queryKey: ['core', 'rotas-brutas', f],
    queryFn: async ({ signal }) => RotasListaSchema.parse(await api<unknown>('/core/rotas', { query: { usuario_id: f.usuario_id, de: f.de, ate: f.ate }, signal })),
    enabled: authed && enabled && !!f.usuario_id,
  });
}

/** `POST rotas/previa`: não grava nada. */
export const usePrevia = () => useMutation({ mutationFn: async (pedido: PreviaRotaPedido) => PreviaRotaRespostaSchema.parse(await api<unknown>('/core/rotas/previa', { method: 'POST', body: pedido })) });

/** `POST rotas/lote`: idempotente pelo id de cada rota. */
export function useSalvarLote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (corpo: SalvarRotasLote) => SalvarRotasLoteRespostaSchema.parse(await api<unknown>('/core/rotas/lote', { method: 'POST', body: corpo })),
    onSuccess: async () => {
      await Promise.all([qc.invalidateQueries({ queryKey: ['routes'] }), qc.invalidateQueries({ queryKey: ['core', 'rotas-brutas'] })]);
    },
  });
}

/** `POST clientes/:id/coordenada/gerar`: um clique por cliente (RN-CORE-77). */
export function useGerarCoordenada() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (clienteId: string) => GerarCoordenadaRespostaSchema.parse(await api<unknown>(`/core/clientes/${clienteId}/coordenada/gerar`, { method: 'POST' })),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['core', 'coordenadas-sugeridas'] });
    },
  });
}
