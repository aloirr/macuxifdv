'use client';

/**
 * Cartão "Apps" da aba Empresa (T-0190; R-20261124-090942 item 04), na coluna da esquerda, logo abaixo do Plano: uma linha por
 * app (Macuxi Campo e Macuxi Gestão) com o nome e "Gerar link" (nome acessível = o texto visível; o app vai na descrição). Com o
 * link gerado: "Baixar <arquivo>" (secundário: a única ação principal da aba é "Trocar de plano"; abre em nova aba, sem `opener`), o tamanho, "Copiar link", a validade com data e hora no fuso da empresa (o link vale 24 h, ADR 0074) e o SHA-256
 * recolhido, com "Copiar SHA-256". Sem pacote ou sem a rota: "em breve"; app sem licença: a linha do "sem licença".
 * testIDs: empresa-pagina.apps e, por app, empresa-pagina.baixar-<variante>{,-gerar,-link,-copiar,-sha}.
 */
import { useId } from 'react';
import { Button, classesDoBotao, cx, formatDateTime, IconDownload, Panel, useToast } from '@macuxi/ui/web';

import { DOWNLOAD_APPS, TEXTOS_CARTAO_APPS as T, textoDaValidade, textoDoPacote, type LinkDownloadConector, type ProdutoDownload } from '@/lib/conector-download';

import { useLinkDoPacote } from './baixar-conector';

/** `iniciais`: links já gerados, por `testId` do app (teste). */
export function CartaoApps({ tenant, fuso, iniciais }: { tenant: string; fuso: string; iniciais?: Readonly<Record<string, LinkDownloadConector>> }) {
  return (
    <Panel title={T.titulo} label={T.titulo}>
      <ul data-testid="empresa-pagina.apps" className="m-0 flex list-none flex-col divide-y divide-line-2 p-0">
        {DOWNLOAD_APPS.map((p) => (
          <LinhaDoApp key={p.testId} produto={p} tenant={tenant} fuso={fuso} inicial={iniciais?.[p.testId] ?? null} />
        ))}
      </ul>
    </Panel>
  );
}

function LinhaDoApp({ produto, tenant, fuso, inicial }: { produto: ProdutoDownload; tenant: string; fuso: string; inicial: LinkDownloadConector | null }) {
  const toast = useToast();
  const { link, linha, gerando, gerar } = useLinkDoPacote(produto, tenant, inicial);
  const { textos, testId } = produto;
  const idNome = useId();

  const copiar = async (texto: string, ok: string) => {
    try {
      await navigator.clipboard.writeText(texto);
      toast('success', ok);
    } catch {
      toast('warning', T.naoCopiou);
    }
  };

  const tamanho = link ? textoDoPacote(link) : null;
  return (
    <li data-testid={testId} className="flex flex-col gap-2.5 py-3 first:pt-0 last:pb-0">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-2">
        <span id={idNome} className="text-[15px] font-semibold text-ink">
          {textos.nome}
        </span>
        {linha ? (
          <span className="text-[14px] text-ink-2">{linha}</span>
        ) : (
          <Button size="sm" data-testid={`${testId}-gerar`} aria-describedby={idNome} disabled={gerando} onClick={() => void gerar()}>
            {gerando ? textos.gerando : link ? T.gerarOutro : T.gerar}
          </Button>
        )}
      </div>
      {link && (
        <div data-testid={`${testId}-link`} className="flex flex-col gap-2 rounded-xl border border-line bg-ground px-3 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <a href={link.url} target="_blank" rel="noreferrer noopener" className={cx(classesDoBotao('secondary', 'sm'), 'no-underline')}>
              <IconDownload size={14} /> {textos.baixar(link.arquivo)}
            </a>
            <Button size="sm" data-testid={`${testId}-copiar`} onClick={() => void copiar(link.url, T.copiado)}>
              {T.copiar}
            </Button>
            {tamanho && <span className="text-[13px] tabular-nums text-ink-2">{tamanho}</span>}
          </div>
          <span className="text-[13px] text-ink-2">{textoDaValidade(link, (iso) => formatDateTime(iso, fuso))}</span>
          {link.sha256 && (
            <details data-testid={`${testId}-sha`} className="text-[12px] text-ink-2">
              <summary className="cursor-pointer font-semibold select-none">{T.sha}</summary>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <code className="min-w-0 font-mono break-all">{link.sha256}</code>
                <Button size="sm" onClick={() => void copiar(link.sha256 ?? '', T.shaCopiado)}>
                  {T.copiarSha}
                </Button>
              </div>
            </details>
          )}
        </div>
      )}
    </li>
  );
}
