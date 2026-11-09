'use client';

/**
 * T-0098: "Baixar o Conector" da aba Integração. Cada clique gera um link temporário na API (presign de bucket privado,
 * auditado) e mostra o link real para o operador clicar (gesto dele: o navegador não bloqueia como pop-up), com a versão do
 * pacote e até quando o link vale. Sem a rota neste servidor (ou sem pacote publicado), fica o "em breve" de antes.
 * Regras e textos: `lib/conector-download.ts`. testIDs: integracao.baixar-conector*.
 */
import { Button, IconDownload, useToast } from '@macuxi/ui/web';
import { useState } from 'react';

import { falhaDoDownload, LinkDownloadConectorResposta, TEXTOS_DOWNLOAD_CONECTOR, textoDaValidade, textoDoPacote, type LinkDownloadConector } from '@/lib/conector-download';
import { chamarPortal } from '@/lib/portal-api';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';

/** Hora local (fuso do navegador do operador; o portal não é de um tenant). */
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

export function BaixarConector({ tenant, inicial = null }: { tenant: string; inicial?: LinkDownloadConector | null }) {
  const toast = useToast();
  const [link, setLink] = useState<LinkDownloadConector | null>(inicial);
  const [emBreve, setEmBreve] = useState(false);
  const [gerando, setGerando] = useState(false);

  const gerar = async () => {
    if (gerando) return;
    setGerando(true);
    setLink(null);
    try {
      setLink(await chamarPortal(ROTAS_PORTAL.conectorDownload, { metodo: 'POST', tenant, corpo: {}, schema: LinkDownloadConectorResposta }));
    } catch (e) {
      const f = falhaDoDownload(e);
      if (f.tipo === 'em-breve') setEmBreve(true);
      else toast(f.tipo === 'aviso' ? 'warning' : 'danger', f.texto);
    } finally {
      setGerando(false);
    }
  };

  if (emBreve)
    return (
      <span data-testid="integracao.baixar-conector">
        Baixar o Conector: <span className="text-ink-2">{TEXTOS_DOWNLOAD_CONECTOR.emBreve}</span>
      </span>
    );

  const pacote = link ? textoDoPacote(link) : null;
  return (
    <div data-testid="integracao.baixar-conector" className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="link" data-testid="integracao.baixar-conector-gerar" onClick={() => void gerar()} disabled={gerando}>
          <IconDownload size={14} /> {gerando ? TEXTOS_DOWNLOAD_CONECTOR.gerando : TEXTOS_DOWNLOAD_CONECTOR.botao}
        </Button>
      </div>
      {link && (
        <div data-testid="integracao.baixar-conector-link" className="flex flex-col gap-0.5 text-[13px]">
          <a href={link.url} target="_blank" rel="noreferrer noopener" className="font-semibold text-accent-ink no-underline hover:underline">
            {TEXTOS_DOWNLOAD_CONECTOR.baixar(link.arquivo)}
          </a>
          {pacote && <span className="text-ink-2">{pacote}</span>}
          <span className="text-[12px] text-ink-2">{textoDaValidade(link, hora)}</span>
          {link.sha256 && <span className="break-all font-mono text-[11px] text-ink-2">SHA-256 {link.sha256}</span>}
        </div>
      )}
    </div>
  );
}
