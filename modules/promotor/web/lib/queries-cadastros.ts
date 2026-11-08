'use client';

/**
 * Consultas e comandos dos cadastros de trade no BKO (`/v1/promotor/cadastros/*`, T-0069). Toda resposta é validada pelo
 * contrato. Licença, perfil (ação do manifesto) e tenant são checados pela API; a UI só esconde o que o perfil não faz.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, useSession } from '@macuxi/platform-sdk/web';
import { z } from 'zod';
import { CAMINHO_CADASTRO, CAMINHO_PARAMETROS_TRADE, LINHA_CADASTRO, ParametrosTradeApi, type CadastroBko, type MarcaConcorrenteLista } from '../../contracts';

export const qkCadastro = (c: CadastroBko, removidos: boolean) => ['promotor', 'cadastro', c, removidos] as const;
const rota = (caminho: string) => `/promotor/${caminho}`;

export type LinhaDoCadastro = Record<string, unknown> & { id: string; deleted_at: string | null; updated_at: string };

function useAutenticado() {
  return useSession().status === 'authenticated';
}

export function useListaCadastro(c: CadastroBko, incluirRemovidos: boolean) {
  const enabled = useAutenticado();
  return useQuery<LinhaDoCadastro[]>({
    queryKey: qkCadastro(c, incluirRemovidos),
    enabled,
    placeholderData: (anterior) => anterior,
    queryFn: async ({ signal }): Promise<LinhaDoCadastro[]> => {
      const r = z.object({ itens: z.array(LINHA_CADASTRO[c]) }).parse(await api<unknown>(rota(CAMINHO_CADASTRO[c]), { query: { incluir_removidos: String(incluirRemovidos) }, signal }));
      // marcas concorrentes (Catálogo, ADR 0034): sem datas; a inativa aparece só com `incluirRemovidos` e fica marcada `ativo: false`
      if (c === 'concorrente') return (r.itens as MarcaConcorrenteLista[]).map((m) => ({ ...m, deleted_at: null, updated_at: '' }));
      return r.itens as unknown as LinhaDoCadastro[];
    },
  });
}

/** Faixas de validade e peso do parcial: do tenant, somente leitura nesta versão. */
export function useParametrosTrade() {
  const enabled = useAutenticado();
  return useQuery({ queryKey: ['promotor', 'cadastro', 'parametros'], enabled, queryFn: async ({ signal }) => ParametrosTradeApi.parse(await api<unknown>(rota(CAMINHO_PARAMETROS_TRADE), { signal })) });
}

function useInvalidar() {
  const qc = useQueryClient();
  // concorrente e categoria alimentam os seletores de outras abas: invalida todo o grupo de cadastros
  return () => qc.invalidateQueries({ queryKey: ['promotor', 'cadastro'], predicate: (q) => q.queryKey[2] !== 'parametros' });
}

/** Salvar: POST no cadastro novo (id do cliente, idempotente) e PUT no existente. */
export function useGravarCadastro(c: CadastroBko) {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async ({ corpo, nova }: { corpo: { id: string } & Record<string, unknown>; nova: boolean }) =>
      LINHA_CADASTRO[c].parse(await api<unknown>(nova ? rota(CAMINHO_CADASTRO[c]) : `${rota(CAMINHO_CADASTRO[c])}/${corpo.id}`, { method: nova ? 'POST' : 'PUT', body: corpo })),
    onSuccess: invalidar,
  });
}

/** Desativar (lógico): o cadastro some das listas e do app no próximo pull; nada é apagado. */
export function useDesativarCadastro(c: CadastroBko) {
  const invalidar = useInvalidar();
  return useMutation({
    mutationFn: async (id: string) => LINHA_CADASTRO[c].parse(await api<unknown>(`${rota(CAMINHO_CADASTRO[c])}/${id}`, { method: 'DELETE' })),
    onSuccess: invalidar,
  });
}
