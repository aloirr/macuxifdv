'use client';

/**
 * Exportação do catálogo em PDF e Excel (RF-CAT-09, T-0085, T-0142), agora como itens do menu "⋯" da página (revisão do BKO
 * §P1/§P3). Segue o nível aberto na hierarquia: na raiz o catálogo inteiro; com sistema, grupo ou linha aberto, só esse
 * recorte. A proteção real é na API.
 */
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage, imprimirHtml, useSession } from '@macuxi/platform-sdk/web';
import { DEFAULT_TZ, useToast, type AcaoDoMenu } from '@macuxi/ui/web';
import { useQuery } from '@tanstack/react-query';
import { csvDoCatalogo } from './excel';
import { LIMITE_EXPORTACAO } from '../../domain/exportacao';
import { DadosExportacao, ROTA_EXPORTACAO } from './formato';
import { montarCatalogo, type EscopoExportacao } from './layout';
import { htmlDoCatalogo, nomeArquivoCatalogo } from './pdf';
import { podeExportarCatalogo } from './permissao';

/** Dados do cadastro para exportar e para a coluna "Caminho" da busca; só quem pode exportar (a API revalida). */
export function useDadosExportacao() {
  const visao = useVisaoShell();
  const permitido = podeExportarCatalogo({ perfil: visao.perfil, modulosAtivos: visao.modulosAtivos });
  const autenticado = useSession().status === 'authenticated';
  const dados = useQuery({
    queryKey: ['catalogo', 'exportacao'],
    queryFn: async () => DadosExportacao.parse(await api<unknown>(ROTA_EXPORTACAO)),
    enabled: permitido && autenticado,
    retry: false,
  });
  return { permitido, autenticado, dados };
}

/**
 * Itens "Catálogo em PDF" e "Catálogo em Excel" do menu da página (lista vazia sem permissão). `nivel` é o recorte do nível
 * aberto. Erro e aviso de teto saem em toast na hora de exportar; a falha de carregar o cadastro também sai em toast ao escolher o item (e recarrega).
 */
export function useAcoesExportacao(nivel: EscopoExportacao): { acoes: AcaoDoMenu[] } {
  const sessao = useSession<{ perfil?: string | null; fuso?: string; empresa?: string }>();
  const tz = sessao.user?.fuso ?? DEFAULT_TZ;
  const empresa = sessao.user?.empresa ?? '';
  const toast = useToast();
  const { permitido, dados } = useDadosExportacao();
  if (!permitido) return { acoes: [] };

  const gerar = (acao: (c: ReturnType<typeof montarCatalogo>, gerado_em: string, nome: string) => void | Promise<void>) => {
    if (dados.isError) {
      toast('danger', `${errorMessage(dados.error)} Tente de novo em instantes.`);
      void dados.refetch();
      return;
    }
    if (!dados.data) return;
    if (dados.data.truncado) toast('warning', `O catálogo passa de ${LIMITE_EXPORTACAO.toLocaleString('pt-BR')} produtos: a exportação sai só com os primeiros ${LIMITE_EXPORTACAO.toLocaleString('pt-BR')}, por código. Exporte um sistema por vez.`);
    const gerado_em = new Date().toISOString();
    const c = montarCatalogo(dados.data, nivel);
    void Promise.resolve(acao(c, gerado_em, nomeArquivoCatalogo({ escopo: nivel.linha ?? nivel.grupo ?? nivel.sistema, tz, gerado_em }))).catch((e: unknown) => toast('danger', errorMessage(e)));
  };
  const desligada = dados.isPending;
  return {
    acoes: [
      { id: 'pdf', rotulo: 'Catálogo em PDF', desligada, testId: 'catalogo.exportacao.pdf', aoEscolher: () => gerar((c, g, nome) => imprimirHtml(htmlDoCatalogo(c, { empresa, tz, gerado_em: g }), nome)) },
      { id: 'excel', rotulo: 'Catálogo em Excel', desligada, testId: 'catalogo.exportacao.excel', aoEscolher: () => gerar((c, _g, nome) => downloadBlob(new Blob([csvDoCatalogo(c)], { type: 'text/csv;charset=utf-8' }), `${nome}.csv`)) },
    ],
  };
}
