'use client';

import { useEffect, useState } from 'react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoSenha, Dialog, ErrorBlock, LoadingBlock } from '@macuxi/ui/web';
import { useAutorizadores, useReprocessarLote } from '../lib/queries';

/**
 * Popup de autorização (RN-INT-16; spec docs/design/integracao-simples §6): quem não tem `lote.reprocessar` escolhe quem autoriza
 * (admin ou analista, vem o primeiro) e digita a SENHA dessa pessoa. A senha fica só neste estado, vai uma vez no corpo da chamada e
 * é apagada a cada erro; nunca vai para URL, log nem cache.
 */
export function AutorizarReprocessamento({ loteId, onClose, onAutorizado }: { loteId: string | null; onClose: () => void; onAutorizado: () => void }) {
  const aberto = loteId !== null;
  const autorizadores = useAutorizadores(aberto);
  const reprocessar = useReprocessarLote();
  const [quem, setQuem] = useState('');
  const [senha, setSenha] = useState('');
  const [visivel, setVisivel] = useState(false);
  const [erro, setErro] = useState('');
  const itens = autorizadores.data?.itens ?? [];

  useEffect(() => {
    if (!aberto) {
      setSenha('');
      setVisivel(false);
      setErro('');
    }
  }, [aberto]);
  useEffect(() => {
    if (!quem && itens[0]) setQuem(itens[0].id);
  }, [quem, itens]);

  const autorizar = () => {
    if (!loteId || !quem || !senha) return;
    setErro('');
    reprocessar.mutate(
      { loteId, autorizadorId: quem, senha },
      {
        onSuccess: () => {
          setSenha('');
          onAutorizado();
        },
        onError: (e) => {
          setSenha('');
          setErro(errorMessage(e));
          document.getElementById('integracao-autorizar-senha')?.focus();
        },
      },
    );
  };

  return (
    <Dialog
      open={aberto}
      title="Autorizar reprocessamento"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} data-testid="integracao.autorizar.voltar">
            Voltar
          </Button>
          <Button variant="primary" onClick={autorizar} disabled={!senha || !quem || reprocessar.isPending} data-testid="integracao.autorizar.confirmar">
            {reprocessar.isPending ? 'Autorizando…' : 'Autorizar'}
          </Button>
        </>
      }
    >
      {autorizadores.isPending && <LoadingBlock />}
      {autorizadores.isError && <ErrorBlock message={errorMessage(autorizadores.error)} onRetry={() => void autorizadores.refetch()} />}
      {autorizadores.data && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            autorizar();
          }}
        >
          <div className="flex items-center gap-2 text-[12px] font-semibold text-ink-2">
            <label htmlFor="integracao-autorizar-quem">Senha de</label>
            <select id="integracao-autorizar-quem" className="h-11 rounded-xl border border-field bg-surface px-3 text-[15px] text-ink" value={quem} onChange={(e) => setQuem(e.target.value)} data-testid="integracao.autorizar.quem">
              {itens.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </select>
          </div>
          <CampoSenha
            id="integracao-autorizar-senha"
            rotulo=""
            className="[&>label]:hidden"
            aria-label={`Senha de ${itens.find((a) => a.id === quem)?.nome ?? 'quem autoriza'}`}
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            visivel={visivel}
            onAlternar={() => setVisivel((v) => !v)}
            erro={erro || null}
            testId="integracao.autorizar.senha"
          />
        </form>
      )}
    </Dialog>
  );
}
