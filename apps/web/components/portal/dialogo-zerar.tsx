'use client';

/**
 * "Zerar dados" (pedido do dono do produto na v1.0.30; ADR 0068; desenho docs/desenho/empresa-zerar.md; RN-PLA-12), no padrão do
 * Excluir: primeiro a prévia do que sai, por grupo (`resumirPreviaPorGrupo` do SDK); depois o código da empresa e a senha de quem
 * pede. "Zerar dados" só com a prévia sem bloqueio, o código conferindo e a senha preenchida. O pedido roda no worker (202): o
 * diálogo passa ao andamento e consulta a cada 5 s até concluir ou falhar. Frases das recusas e das falhas: `mensagemDoZerar`.
 * A senha vai só no corpo do pedido e sai do estado ao enviar e ao fechar.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { mensagemDoZerar, resumirPreviaPorGrupo, type PreviaZerarEmpresa } from '@macuxi/platform-sdk';
import { Button, CampoSenha, CLASSE_CAMPO, Dialog, ErrorBlock, LoadingBlock, Notice, cx, formatInt } from '@macuxi/ui/web';

import { ACOMPANHAR_ACAO_MS } from '@/lib/portal-empresa-acoes';
import {
  andamentoDoZerar,
  erroDoZerar,
  fraseDoZerar,
  lerPreviaZerar,
  lerZerar,
  pedirZerar,
  TEXTOS_ZERAR as T,
  zerarJaRodando,
  zerarLiberado,
} from '@/lib/portal-empresa-zerar';

/** Chaves do React Query (o teste semeia o cache com elas). */
export const chavePreviaZerar = (tenant: string) => ['portal', 'empresa-zerar-previa', tenant] as const;
export const chaveZerar = (tenant: string) => ['portal', 'empresa-zerar', tenant] as const;

type ErroDoPedido = { texto: string; senha: boolean };

export function DialogoZerar({
  empresa,
  aoFechar,
  aoTerminar,
  inicial,
}: {
  empresa: { id: string; codigo: string; razao_social: string };
  aoFechar: () => void;
  /** O zerar concluiu ou falhou (a lista recarrega). */
  aoTerminar: () => void;
  /** Só para o teste: fase e campos iniciais. */
  inicial?: { fase?: 'confirmar' | 'andamento'; codigo?: string; senha?: string; erro?: ErroDoPedido };
}) {
  const [fase, setFase] = useState(inicial?.fase ?? 'confirmar');
  const previa = useQuery({ queryKey: chavePreviaZerar(empresa.id), queryFn: () => lerPreviaZerar(empresa.id), retry: false, staleTime: 0 });
  const rodando = zerarJaRodando(previa.data);
  useEffect(() => {
    if (rodando) setFase('andamento');
  }, [rodando]);

  return fase === 'andamento' ? (
    <Andamento empresa={empresa} aoFechar={aoFechar} aoTerminar={aoTerminar} />
  ) : (
    <Confirmar empresa={empresa} previa={previa} aoFechar={aoFechar} aoPedir={() => setFase('andamento')} inicial={inicial} />
  );
}

function Confirmar({
  empresa,
  previa,
  aoFechar,
  aoPedir,
  inicial,
}: {
  empresa: { id: string; codigo: string; razao_social: string };
  previa: UseQueryResult<PreviaZerarEmpresa>;
  aoFechar: () => void;
  aoPedir: () => void;
  inicial?: { codigo?: string; senha?: string; erro?: ErroDoPedido };
}) {
  const id = useId();
  const idSenha = `${id}-senha`;
  const pedido = useRef(crypto.randomUUID());
  const [codigo, setCodigo] = useState(inicial?.codigo ?? '');
  const [senha, setSenha] = useState(inicial?.senha ?? '');
  const [senhaVisivel, setSenhaVisivel] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<ErroDoPedido | null>(inicial?.erro ?? null);
  const p = previa.data;
  const grupos = p ? resumirPreviaPorGrupo(p.tabelas) : [];
  const bloqueio = p?.bloqueio ? mensagemDoZerar(p.bloqueio) : null;
  const pedeConfirmacao = !!p && !bloqueio && p.total_linhas > 0;
  const senhaErrada = !!erro?.senha;

  const zerar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      await pedirZerar(empresa.id, { id: pedido.current, codigo_confirmacao: codigo.trim(), senha });
      setSenha('');
      aoPedir();
    } catch (err) {
      const e = erroDoZerar(err);
      setErro(e);
      setEnviando(false);
      if (e.senha) {
        setSenha('');
        queueMicrotask(() => document.getElementById(idSenha)?.focus());
      }
    }
  };
  const fechar = () => {
    if (enviando) return;
    setSenha('');
    setSenhaVisivel(false);
    aoFechar();
  };

  return (
    <Dialog
      open
      title={T.titulo(empresa.razao_social)}
      onClose={fechar}
      footer={
        <>
          <Button data-testid="empresa-acao.cancelar" disabled={enviando} onClick={fechar}>
            {T.cancelar}
          </Button>
          {pedeConfirmacao && (
            <Button variant="danger" data-testid="empresa-acao.confirmar" disabled={enviando || !zerarLiberado(p, codigo, senha)} onClick={() => void zerar()}>
              {enviando ? T.zerando : T.zerar}
            </Button>
          )}
        </>
      }
    >
      <div data-testid="empresa-zerar.dialogo" className="flex flex-col gap-3">
        {previa.isPending && <LoadingBlock label={T.contando} />}
        {previa.isError && <ErrorBlock message={fraseDoZerar(previa.error)} onRetry={() => void previa.refetch()} />}
        {p && p.total_linhas === 0 && <p className="m-0" data-testid="empresa-zerar.vazio">{T.nadaASair}</p>}
        {p && p.total_linhas > 0 && (
          <>
            <div className="flex flex-col gap-1">
              <p className="m-0 text-[13px] font-semibold text-ink">{T.sai}</p>
              <dl data-testid="empresa-zerar.previa" className="m-0 grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
                {grupos.map((g) => (
                  <div key={g.grupo} className="contents" data-testid={`empresa-zerar.grupo-${g.grupo}`}>
                    <dt className="text-ink-2">{g.rotulo}</dt>
                    <dd className="m-0 text-right tabular-nums">{formatInt(g.linhas)}</dd>
                  </div>
                ))}
              </dl>
            </div>
            <p className="m-0 text-ink-2">{T.ficam}</p>
          </>
        )}
        {bloqueio && (
          <div data-testid="empresa-zerar.bloqueio">
            <Notice tone="danger">{bloqueio}</Notice>
          </div>
        )}
        {pedeConfirmacao && (
          <>
            <div className="flex flex-col gap-1">
              <label htmlFor={`${id}-codigo`} className="text-[13px] font-semibold text-ink">
                Digite <span className="font-mono font-medium">{empresa.codigo}</span> {T.sufixoCodigo}
              </label>
              <input
                id={`${id}-codigo`}
                type="text"
                value={codigo}
                onChange={(ev) => setCodigo(ev.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={enviando}
                data-testid="empresa-zerar.codigo"
                className={cx(CLASSE_CAMPO, 'font-mono tracking-[1px]')}
              />
            </div>
            <CampoSenha
              id={idSenha}
              rotulo={T.senha}
              testId="empresa-zerar.senha"
              visivel={senhaVisivel}
              onAlternar={() => setSenhaVisivel((v) => !v)}
              value={senha}
              onChange={(ev) => {
                setSenha(ev.target.value);
                if (senhaErrada) setErro(null);
              }}
              disabled={enviando}
              erro={senhaErrada ? erro.texto : null}
            />
          </>
        )}
        {erro && !senhaErrada && (
          <div data-testid="empresa-acao.erro">
            <ErrorBlock message={erro.texto} />
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** Andamento do zerar: consulta a cada 5 s até concluir ou falhar; fechar não cancela (o worker segue). */
function Andamento({ empresa, aoFechar, aoTerminar }: { empresa: { id: string; razao_social: string }; aoFechar: () => void; aoTerminar: () => void }) {
  const q = useQuery({
    queryKey: chaveZerar(empresa.id),
    queryFn: () => lerZerar(empresa.id),
    // timer-permitido: ver ACOMPANHAR_ACAO_MS
    refetchInterval: (x) => (x.state.data && x.state.data.situacao !== 'em_andamento' ? false : ACOMPANHAR_ACAO_MS),
    retry: false,
  });
  const situacao = q.data?.situacao;
  const a = andamentoDoZerar(q.data);
  useEffect(() => {
    if (situacao && situacao !== 'em_andamento') aoTerminar();
    // aoTerminar muda a cada render; só a situação decide
  }, [situacao]);

  return (
    <Dialog
      open
      title={T.titulo(empresa.razao_social)}
      onClose={aoFechar}
      footer={
        <Button data-testid="empresa-acao.cancelar" onClick={aoFechar}>
          {T.fechar}
        </Button>
      }
    >
      <div data-testid="empresa-zerar.andamento" className="flex flex-col gap-3">
        {q.isError ? (
          <ErrorBlock message={fraseDoZerar(q.error)} onRetry={() => void q.refetch()} />
        ) : a.tom === 'andamento' ? (
          <LoadingBlock label={a.texto} />
        ) : (
          <div data-testid={`empresa-zerar.${a.tom === 'success' ? 'concluido' : 'falhou'}`}>
            <Notice tone={a.tom}>{a.texto}</Notice>
          </div>
        )}
      </div>
    </Dialog>
  );
}
