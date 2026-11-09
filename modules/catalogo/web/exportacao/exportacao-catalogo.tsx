'use client';

/**
 * Painel de exportação do catálogo em PDF e Excel (RF-CAT-09, T-0085, T-0142). Segue o nível aberto na hierarquia: na raiz
 * o catálogo inteiro (com a escolha do sistema); com sistema, grupo ou linha aberto, só esse recorte. A proteção real é na API.
 */
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage, imprimirHtml, useSession } from '@macuxi/platform-sdk/web';
import { Button, DEFAULT_TZ, ErrorBlock, LoadingBlock, Notice, Panel, SelectField } from '@macuxi/ui/web';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { csvDoCatalogo } from './excel';
import { LIMITE_EXPORTACAO } from '../../domain/exportacao';
import { DadosExportacao, ROTA_EXPORTACAO } from './formato';
import { montarCatalogo, rotuloDoEscopo, sistemasDisponiveis, type EscopoExportacao } from './layout';
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

export function ExportacaoCatalogo({ nivel = {} }: { nivel?: EscopoExportacao }) {
  const sessao = useSession<{ perfil?: string | null; fuso?: string; empresa?: string }>();
  const tz = sessao.user?.fuso ?? DEFAULT_TZ;
  const empresa = sessao.user?.empresa ?? '';
  const { permitido, autenticado, dados } = useDadosExportacao();
  const [sistemaEscolhido, setSistema] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const aberto = rotuloDoEscopo(nivel); // nível aberto na hierarquia: o recorte vem dele; na raiz vale a escolha do sistema
  const escopo: EscopoExportacao = aberto ? nivel : sistemaEscolhido ? { sistema: sistemaEscolhido } : {};
  const sistemas = useMemo(() => (dados.data ? sistemasDisponiveis(dados.data) : []), [dados.data]);
  if (!permitido) return null;

  const gerar = (acao: (c: ReturnType<typeof montarCatalogo>, gerado_em: string, nome: string) => void | Promise<void>) => {
    if (!dados.data) return;
    setErro(null);
    const gerado_em = new Date().toISOString();
    const c = montarCatalogo(dados.data, escopo);
    void Promise.resolve(acao(c, gerado_em, nomeArquivoCatalogo({ escopo: escopo.linha ?? escopo.grupo ?? escopo.sistema, tz, gerado_em }))).catch((e: unknown) => setErro(errorMessage(e)));
  };

  return (
    <Panel label="Exportação" title="Exportar catálogo">
      {dados.isError && <ErrorBlock message={errorMessage(dados.error)} onRetry={() => void dados.refetch()} />}
      {dados.isPending && autenticado && <LoadingBlock label="Carregando o cadastro…" />}
      {dados.data?.truncado && (
        <Notice tone="warning">
          O catálogo passa do teto de {LIMITE_EXPORTACAO.toLocaleString('pt-BR')} produtos: a exportação sai só com os primeiros {LIMITE_EXPORTACAO.toLocaleString('pt-BR')}, por código. Exporte um sistema por vez.
        </Notice>
      )}
      {dados.data && (
        <div className="flex flex-wrap items-end gap-3">
          {aberto ? (
            <span className="text-[13px] text-ink-2" data-testid="catalogo.exportacao.nivel">
              Exporta: <strong className="text-ink">{aberto}</strong>
            </span>
          ) : (
            <SelectField label="Sistema" value={sistemaEscolhido} onChange={(e) => setSistema(e.target.value)} data-testid="catalogo.exportacao.sistema">
              <option value="">Todos</option>
              {sistemas.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </SelectField>
          )}
          <Button size="sm" data-testid="catalogo.exportacao.pdf" onClick={() => gerar((c, g, nome) => imprimirHtml(htmlDoCatalogo(c, { empresa, tz, gerado_em: g }), nome))}>
            Catálogo em PDF
          </Button>
          <Button size="sm" data-testid="catalogo.exportacao.excel" onClick={() => gerar((c, _g, nome) => downloadBlob(new Blob([csvDoCatalogo(c)], { type: 'text/csv;charset=utf-8' }), `${nome}.csv`))}>
            Catálogo em Excel
          </Button>
        </div>
      )}
      {erro && <Notice tone="danger">{erro}</Notice>}
    </Panel>
  );
}
