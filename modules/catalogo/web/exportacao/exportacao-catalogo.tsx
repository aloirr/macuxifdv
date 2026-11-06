'use client';

/** Painel de exportação do catálogo em PDF e Excel (RF-CAT-09, T-0085). A proteção real é na API. */
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { api, ApiRequestError, downloadBlob, errorMessage, imprimirHtml, useSession } from '@macuxi/platform-sdk/web';
import { Button, DEFAULT_TZ, ErrorBlock, LoadingBlock, Notice, Panel, SelectField } from '@macuxi/ui/web';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { csvDoCatalogo } from './excel';
import { DadosExportacao, ROTA_EXPORTACAO } from './formato';
import { montarCatalogo, sistemasDisponiveis } from './layout';
import { htmlDoCatalogo, nomeArquivoCatalogo } from './pdf';
import { podeExportarCatalogo } from './permissao';

export function ExportacaoCatalogo() {
  const visao = useVisaoShell();
  const permitido = podeExportarCatalogo({ perfil: visao.perfil, modulosAtivos: visao.modulosAtivos });
  const sessao = useSession<{ perfil?: string | null; fuso?: string; empresa?: string }>();
  const autenticado = sessao.status === 'authenticated';
  const tz = sessao.user?.fuso ?? DEFAULT_TZ;
  const empresa = sessao.user?.empresa ?? '';
  const [sistema, setSistema] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const dados = useQuery({
    queryKey: ['catalogo', 'exportacao'],
    queryFn: async () => DadosExportacao.parse(await api<unknown>(ROTA_EXPORTACAO)),
    enabled: permitido && autenticado,
    retry: false,
  });
  const sistemas = useMemo(() => (dados.data ? sistemasDisponiveis(dados.data) : []), [dados.data]);
  if (!permitido) return null;

  const naoPublicado = dados.error instanceof ApiRequestError && dados.error.status === 404;
  const gerar = (acao: (c: ReturnType<typeof montarCatalogo>, gerado_em: string, nome: string) => void | Promise<void>) => {
    if (!dados.data) return;
    setErro(null);
    const gerado_em = new Date().toISOString();
    const c = montarCatalogo(dados.data, sistema ? { sistema } : {});
    void Promise.resolve(acao(c, gerado_em, nomeArquivoCatalogo({ sistema: sistema || undefined, tz, gerado_em }))).catch((e: unknown) => setErro(errorMessage(e)));
  };

  return (
    <Panel label="Exportação" title="Exportar catálogo">
      {naoPublicado && <Notice tone="info">A exportação fica disponível quando o servidor publicar o cadastro do catálogo (T-0085).</Notice>}
      {dados.isError && !naoPublicado && <ErrorBlock message={errorMessage(dados.error)} onRetry={() => void dados.refetch()} />}
      {dados.isPending && autenticado && <LoadingBlock label="Carregando o cadastro…" />}
      {dados.data && (
        <div className="flex flex-wrap items-end gap-3">
          <SelectField label="Sistema" value={sistema} onChange={(e) => setSistema(e.target.value)} data-testid="catalogo.exportacao.sistema">
            <option value="">Todos</option>
            {sistemas.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </SelectField>
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
