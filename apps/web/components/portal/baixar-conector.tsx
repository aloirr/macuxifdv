'use client';

/**
 * `BaixarPacote`: download por link temporário no portal. Um componente para os três produtos (`lib/conector-download.ts`): o
 * Conector na aba Integração (T-0098) e os APKs do Macuxi Campo e do Macuxi Gestão no cartão "Apps" da aba Empresa (T-0190).
 * Cada clique gera um link na API (presign de bucket privado, auditado) e mostra o link real para o operador clicar (gesto dele: o
 * navegador não bloqueia como pop-up), com a versão do pacote e até quando o link vale. Sem a rota neste servidor (ou sem pacote
 * publicado), fica o "em breve"; app sem licença na empresa (403 `APP_SEM_LICENCA`) vira uma linha no lugar do botão.
 * testIDs: `<produto.testId>`, `-gerar` e `-link`.
 */
import { Button, IconDownload, useToast } from '@macuxi/ui/web';
import { useState } from 'react';

import { falhaDoDownload, textoDaValidade, textoDoPacote, type LinkDownloadConector, type ProdutoDownload } from '@/lib/conector-download';
import { chamarPortal } from '@/lib/portal-api';

/** Hora local (fuso do navegador do operador; o portal não é de um tenant). */
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function BaixarPacote({ produto, tenant, inicial = null }: { produto: ProdutoDownload; tenant: string; inicial?: LinkDownloadConector | null }) {
  const toast = useToast();
  const [link, setLink] = useState<LinkDownloadConector | null>(inicial);
  const [linha, setLinha] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const { textos, testId } = produto;

  const gerar = async () => {
    if (gerando) return;
    setGerando(true);
    setLink(null);
    try {
      setLink(await chamarPortal(produto.rota, { metodo: 'POST', tenant, corpo: produto.corpo, schema: produto.schema }));
    } catch (e) {
      const f = falhaDoDownload(e, produto);
      if (f.tipo === 'em-breve') setLinha(textos.emBreve);
      else if (f.tipo === 'sem-licenca') setLinha(textos.semLicenca ?? textos.semAcesso);
      else toast(f.tipo === 'aviso' ? 'warning' : 'danger', f.texto);
    } finally {
      setGerando(false);
    }
  };

  if (linha)
    return (
      <span data-testid={testId}>
        {textos.nome}: <span className="text-ink-2">{linha}</span>
      </span>
    );

  const pacote = link ? textoDoPacote(link) : null;
  return (
    <div data-testid={testId} className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="link" data-testid={`${testId}-gerar`} onClick={() => void gerar()} disabled={gerando}>
          <IconDownload size={14} /> {gerando ? textos.gerando : textos.botao}
        </Button>
      </div>
      {link && (
        <div data-testid={`${testId}-link`} className="flex flex-col gap-0.5 text-[13px]">
          <a href={link.url} target="_blank" rel="noreferrer noopener" className="font-semibold text-accent-ink no-underline hover:underline">
            {textos.baixar(link.arquivo)}
          </a>
          {pacote && <span className="text-ink-2">{pacote}</span>}
          <span className="text-[12px] text-ink-2">{textoDaValidade(link, hora)}</span>
          {link.sha256 && <span className="break-all font-mono text-[12px] text-ink-2">SHA-256 {link.sha256}</span>}
        </div>
      )}
    </div>
  );
}
