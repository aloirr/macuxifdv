'use client';

/**
 * Cartão "Administradores" da aba Empresa do portal (T-0094 fatia S; R-20261108-005744; RN-CORE-32, RN-CORE-34), só para o time
 * da Macuxi: lista os admins da empresa e, por admin ativo e não bloqueado, "Redefinir senha" com confirmação. A senha temporária
 * nova vai só por e-mail (vale 72 h; a pessoa cria a dela no próximo acesso; as sessões dela caem): o portal nunca a vê. Sem e-mail
 * configurado a API recusa antes de mudar nada (503), e a tela diz isso. Regras e textos em `lib/portal-admins.ts`.
 * O `email_id` (idempotência) nasce ao abrir o diálogo e só muda quando a API pede; sem rede, tentar de novo reusa o mesmo.
 * Quem só entra pelo app (admin + vendedor etc., `entra_no_portal = false`, RN-CORE-35) ganha a etiqueta "Entra só pelo app",
 * com a explicação no `title`; o "Redefinir senha" continua, e o diálogo fala do "próximo acesso ao app".
 * testIDs: empresa-admins.*.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListaAdminsDaEmpresaSchema, RedefinirSenhaAdminRespostaSchema, type AdminDaEmpresa } from '@macuxi/platform-sdk';
import { Badge, Button, Dialog, ErrorBlock, LoadingBlock, Notice, Panel } from '@macuxi/ui/web';

import {
  acaoDoErro,
  etiquetasDoAdmin,
  podeRedefinir,
  textoDoResultado,
  TEXTOS_ADMINS,
  tituloDoDialogo,
} from '@/lib/portal-admins';
import { chamarPortal, ehRotaAusente, mensagemDoErro } from '@/lib/portal-api';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';

const chaveAdmins = (tenant: string) => ['portal', tenant, 'admins'] as const;

export function CartaoAdmins({ tenant, fuso }: { tenant: string; fuso: string }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: chaveAdmins(tenant),
    queryFn: () => chamarPortal(ROTAS_PORTAL.adminsDaEmpresa(tenant), { schema: ListaAdminsDaEmpresaSchema }).then((r) => r.itens),
  });
  const [alvo, setAlvo] = useState<AdminDaEmpresa | null>(null);
  const [emailId, setEmailId] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroDialogo, setErroDialogo] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: 'success' | 'warning'; texto: string } | null>(null);

  const abrir = (a: AdminDaEmpresa) => {
    setAlvo(a);
    setEmailId(crypto.randomUUID());
    setErroDialogo(null);
  };
  const fechar = () => {
    if (enviando) return;
    setAlvo(null);
    setErroDialogo(null);
  };

  const confirmar = async () => {
    if (!alvo || enviando) return;
    setEnviando(true);
    setErroDialogo(null);
    try {
      const r = await chamarPortal(ROTAS_PORTAL.redefinirSenhaAdmin(tenant, alvo.usuario_id), {
        metodo: 'POST',
        corpo: { email_id: emailId },
        schema: RedefinirSenhaAdminRespostaSchema,
      });
      setAviso({ tom: 'success', texto: textoDoResultado(alvo.email, r, fuso) });
      setAlvo(null);
      void qc.invalidateQueries({ queryKey: chaveAdmins(tenant) });
    } catch (x) {
      const a = acaoDoErro(x);
      if (a.novoId) setEmailId(crypto.randomUUID());
      if (a.recarregar) void qc.invalidateQueries({ queryKey: chaveAdmins(tenant) });
      if (a.fechar) {
        setAlvo(null);
        setAviso({ tom: 'warning', texto: a.mensagem });
      } else setErroDialogo(a.mensagem);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Panel title={TEXTOS_ADMINS.titulo} label={TEXTOS_ADMINS.titulo}>
      <div data-testid="empresa-admins" className="flex flex-col gap-3">
        <span className="text-[13px] text-ink-2">{TEXTOS_ADMINS.ajuda}</span>
        <div aria-live="polite">
          {aviso && (
            <div data-testid="empresa-admins.aviso">
              <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
                {aviso.texto}
              </Notice>
            </div>
          )}
        </div>
        {q.isPending && <LoadingBlock label={TEXTOS_ADMINS.carregando} />}
        {q.isError &&
          (ehRotaAusente(q.error) ? (
            <span className="text-[13px] text-ink-2">{TEXTOS_ADMINS.emBreve}</span>
          ) : (
            <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />
          ))}
        {q.isSuccess && q.data.length === 0 && <span className="text-[13px] text-ink-2">{TEXTOS_ADMINS.vazio}</span>}
        {q.isSuccess && q.data.length > 0 && (
          <ul data-testid="empresa-admins.lista" className="m-0 flex list-none flex-col p-0">
            {q.data.map((a) => (
              <li key={a.usuario_id} data-testid={`empresa-admins.item-${a.usuario_id}`} className="flex flex-wrap items-center justify-between gap-2 border-b border-line-2 py-2 last:border-b-0">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[15px] font-semibold">{a.nome}</span>
                  <span className="break-all text-[13px] text-ink-2">{a.email}</span>
                  {etiquetasDoAdmin(a, Date.now(), fuso).length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {etiquetasDoAdmin(a, Date.now(), fuso).map((e) => (
                        <span key={e.texto} title={e.dica}>
                          <Badge tone={e.tom}>{e.texto}</Badge>
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                {podeRedefinir(a) && (
                  <Button size="sm" data-testid="empresa-admins.redefinir" aria-label={`${TEXTOS_ADMINS.botao} de ${a.nome}`} onClick={() => abrir(a)}>
                    {TEXTOS_ADMINS.botao}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <Dialog
        open={alvo !== null}
        title={alvo ? tituloDoDialogo(alvo.nome) : ''}
        onClose={fechar}
        footer={
          <>
            <Button data-testid="empresa-admins.cancelar" disabled={enviando} onClick={fechar}>
              {TEXTOS_ADMINS.cancelar}
            </Button>
            <Button variant="primary" data-testid="empresa-admins.confirmar" disabled={enviando} onClick={() => void confirmar()}>
              {enviando ? TEXTOS_ADMINS.confirmando : TEXTOS_ADMINS.confirmar}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="m-0">{alvo ? TEXTOS_ADMINS.dialogoTexto(alvo) : null}</p>
          {erroDialogo && (
            <div data-testid="empresa-admins.erro">
              <Notice tone="danger">{erroDialogo}</Notice>
            </div>
          )}
        </div>
      </Dialog>
    </Panel>
  );
}
