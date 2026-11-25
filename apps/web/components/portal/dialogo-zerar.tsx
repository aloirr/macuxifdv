'use client';

/**
 * "Zerar dados" (pedido do dono do produto na v1.0.31; ADR 0068; desenho docs/desenho/empresa-zerar.md; RN-PLA-12), no padrão do
 * Excluir: primeiro a prévia do que sai, por grupo (`resumirPreviaPorGrupo` do SDK); depois o código da empresa e a senha de quem
 * pede. A prévia é trabalho do worker (desenho §3.1): o diálogo a pede ao abrir, com um id gerado aqui, e a lê a cada
 * `CONSULTA_PREVIA_ZERAR_MS` até `pronta` ou `falhou`. "Zerar dados" só com a prévia pronta e sem bloqueio, o código conferindo e a
 * senha preenchida. O pedido roda no worker (202): o diálogo passa ao andamento e consulta a cada 5 s até concluir ou falhar.
 * Frases das recusas e das falhas: `mensagemDoZerar`. A espera pela prévia tem prazo (`PRAZO_PREVIA_ZERAR_MS`): com o worker fora,
 * a tela passa à falha da contagem (`mensagemDaPreviaZerar(ZERAR_FALHOU)`) com "Tentar de novo" (id novo), em vez de girar até 1 h.
 * A senha vai só no corpo do pedido e sai do estado ao enviar e ao fechar.
 * `entidades` (aba Dados, desenho §6.4): a prévia e o pedido levam só elas; a prévia diz as que a cascata leva junto. No
 * concluído, o lote (chave do `restaurar`) e o `conector carga-completa` de cada entidade afetada, para o ERP reenviar.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import {
  CONSULTA_PREVIA_ZERAR_MS,
  ERROS_WORKER_ZERAR,
  mensagemDoZerar,
  resumirPreviaPorGrupo,
  type EntidadeZerar,
  type PreviaZerar,
  type ZerarEmpresa,
} from '@macuxi/platform-sdk';
import { Button, CampoSenha, CLASSE_CAMPO, Dialog, ErrorBlock, LoadingBlock, Notice, cx, formatInt } from '@macuxi/ui/web';

import { ACOMPANHAR_ACAO_MS } from '@/lib/portal-empresa-acoes';
import {
  andamentoDoZerar,
  comandosDeReenvio,
  erroDoZerar,
  fraseDaPreviaFalha,
  fraseDoZerar,
  lerPreviaZerar,
  lerZerar,
  pedirPreviaZerar,
  pedirZerar,
  previaCalculando,
  rotulosDasEntidades,
  TEXTOS_ZERAR as T,
  zerarJaRodando,
  zerarLiberado,
} from '@/lib/portal-empresa-zerar';

/** Chaves do React Query (o teste semeia o cache com elas). */
export const chavePreviaZerar = (tenant: string, entidades?: readonly EntidadeZerar[]) => ['portal', 'empresa-zerar-previa', tenant, entidades?.join(',') ?? ''] as const;
export const chaveZerar = (tenant: string) => ['portal', 'empresa-zerar', tenant] as const;

type ErroDoPedido = { texto: string; senha: boolean };
type EmpresaDoZerar = { id: string; codigo: string; razao_social: string };

/** Título do diálogo: a empresa inteira ou as entidades pedidas. */
const tituloDo = (empresa: EmpresaDoZerar, entidades: readonly EntidadeZerar[] | undefined, andamento: boolean): string =>
  entidades?.length
    ? (andamento ? T.tituloAndamentoEntidades : T.tituloEntidades)(rotulosDasEntidades(entidades), empresa.razao_social)
    : (andamento ? T.tituloAndamento : T.titulo)(empresa.razao_social);

/** Prazo da espera pela prévia na tela (pedido + consultas); estourado, a falha da contagem e "Tentar de novo" (revisão v1.0.31). */
export const PRAZO_PREVIA_ZERAR_MS = 2 * 60_000;

/**
 * Prévia do worker: pede com um id gerado aqui e lê pelo id a cada `CONSULTA_PREVIA_ZERAR_MS` até `pronta`, `falhou` ou o
 * `PRAZO_PREVIA_ZERAR_MS` contado do pedido. `refazer` pede outra (id novo: o mesmo id devolveria a mesma prévia falha) e reabre o
 * prazo. Sai do cache ao fechar, para a próxima abertura contar de novo. `desdeInicial`: só para o teste (início do prazo).
 */
function usePreviaZerar(tenant: string, entidades: readonly EntidadeZerar[] | undefined, desdeInicial?: number) {
  const id = useRef(crypto.randomUUID());
  const pedida = useRef<string | null>(null);
  const [desde, setDesde] = useState(() => desdeInicial ?? Date.now());
  const [, acordar] = useState(0);
  const noPrazo = () => Date.now() - desde < PRAZO_PREVIA_ZERAR_MS;
  const previa = useQuery({
    queryKey: chavePreviaZerar(tenant, entidades),
    queryFn: async () => {
      const atual = id.current;
      if (pedida.current === atual) return lerPreviaZerar(tenant, atual);
      const p = await pedirPreviaZerar(tenant, atual, entidades);
      pedida.current = atual;
      return p;
    },
    // timer-permitido: ver CONSULTA_PREVIA_ZERAR_MS (para no PRAZO_PREVIA_ZERAR_MS)
    refetchInterval: (q) => (previaCalculando(q.state.data) && noPrazo() ? CONSULTA_PREVIA_ZERAR_MS : false),
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });
  const esperando = previa.isPending || previaCalculando(previa.data);
  const estourou = esperando && !previa.isError && !noPrazo();
  useEffect(() => {
    if (!esperando) return;
    // timer-permitido: um disparo só, no fim do prazo da prévia, para a tela passar à falha; sem rede
    const t = setTimeout(() => acordar((n) => n + 1), Math.max(0, desde + PRAZO_PREVIA_ZERAR_MS - Date.now()));
    return () => clearTimeout(t);
  }, [esperando, desde]);
  const refazer = () => {
    id.current = crypto.randomUUID();
    setDesde(Date.now());
    void previa.refetch();
  };
  return { previa, estourou, refazer };
}

export function DialogoZerar({
  empresa,
  entidades,
  aoFechar,
  aoTerminar,
  inicial,
}: {
  empresa: EmpresaDoZerar;
  /** Só estas entidades do ERP (aba Dados); ausente = a empresa inteira (menu ⋯). */
  entidades?: readonly EntidadeZerar[];
  aoFechar: () => void;
  /** O zerar concluiu ou falhou (a lista recarrega). */
  aoTerminar: () => void;
  /** Só para o teste: fase e campos iniciais. */
  inicial?: { fase?: 'confirmar' | 'andamento'; codigo?: string; senha?: string; erro?: ErroDoPedido; previaDesde?: number };
}) {
  const [fase, setFase] = useState(inicial?.fase ?? 'confirmar');
  const { previa, estourou, refazer } = usePreviaZerar(empresa.id, entidades, inicial?.previaDesde);
  const rodando = zerarJaRodando(previa.data);
  useEffect(() => {
    if (rodando) setFase('andamento');
  }, [rodando]);

  return fase === 'andamento' ? (
    <Andamento empresa={empresa} titulo={tituloDo(empresa, entidades, true)} aoFechar={aoFechar} aoTerminar={aoTerminar} />
  ) : (
    <Confirmar empresa={empresa} entidades={entidades} previa={previa} estourou={estourou} refazer={refazer} aoFechar={aoFechar} aoPedir={() => setFase('andamento')} inicial={inicial} />
  );
}

function Confirmar({
  empresa,
  entidades,
  previa,
  estourou,
  refazer,
  aoFechar,
  aoPedir,
  inicial,
}: {
  empresa: EmpresaDoZerar;
  entidades?: readonly EntidadeZerar[];
  previa: UseQueryResult<PreviaZerar>;
  /** A espera passou do `PRAZO_PREVIA_ZERAR_MS`: a falha da contagem no lugar do giro. */
  estourou: boolean;
  refazer: () => void;
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
  // só a prévia pronta conta; em andamento é o giro, e a falha, a frase do worker
  const p = previa.data?.situacao === 'pronta' ? previa.data : undefined;
  const falhou = previa.data?.situacao === 'falhou' ? previa.data : undefined;
  const calculando = !estourou && (previa.isPending || previaCalculando(previa.data));
  const total = p?.total ?? 0;
  const grupos = p ? resumirPreviaPorGrupo(p.linhas ?? []) : [];
  const bloqueio = p?.bloqueio ? mensagemDoZerar(p.bloqueio) : null;
  const pedeConfirmacao = !!p && !bloqueio && total > 0;
  const senhaErrada = !!erro?.senha;
  // "Leva junto:" só as que a cascata leva além das pedidas, que já estão no título (revisão v1.0.31, R2-5)
  const levaJunto = entidades?.length && p ? (p.entidades_afetadas ?? []).filter((e) => !entidades.includes(e)) : [];

  const zerar = async () => {
    setEnviando(true);
    setErro(null);
    try {
      await pedirZerar(empresa.id, { id: pedido.current, codigo_confirmacao: codigo.trim(), senha, ...(entidades?.length ? { entidades } : {}) });
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
      title={tituloDo(empresa, entidades, false)}
      onClose={fechar}
      footer={
        <>
          <Button data-testid="empresa-acao.cancelar" disabled={enviando} onClick={fechar}>
            {pedeConfirmacao ? T.cancelar : T.fechar}
          </Button>
          {pedeConfirmacao && (
            <Button variant="danger" data-testid="empresa-acao.confirmar" disabled={enviando || !zerarLiberado(p, empresa.codigo, codigo, senha)} onClick={() => void zerar()}>
              {enviando ? T.zerando : T.zerar}
            </Button>
          )}
        </>
      }
    >
      <div data-testid="empresa-zerar.dialogo" className="flex flex-col gap-3">
        {calculando && !previa.isError && (
          <div data-testid="empresa-zerar.calculando">
            <LoadingBlock label={T.contando} />
          </div>
        )}
        {previa.isError && <ErrorBlock message={fraseDoZerar(previa.error)} onRetry={refazer} />}
        {(falhou || estourou) && !previa.isError && (
          <div data-testid="empresa-zerar.previa-falhou">
            <ErrorBlock message={fraseDaPreviaFalha(falhou ?? { erro_codigo: ERROS_WORKER_ZERAR.falhou })} onRetry={refazer} />
          </div>
        )}
        {p && total === 0 && <p className="m-0" data-testid="empresa-zerar.vazio">{T.nadaASair}</p>}
        {p && total > 0 && !bloqueio && (
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
            {levaJunto.length > 0 && (
              <div className="flex flex-col gap-1" data-testid="empresa-zerar.entidades">
                <p className="m-0 text-[13px] font-semibold text-ink">{T.levaJunto}</p>
                <p className="m-0 text-ink-2">{rotulosDasEntidades(levaJunto)}</p>
              </div>
            )}
            {!entidades?.length && <p className="m-0 text-ink-2">{T.ficam}</p>}
          </>
        )}
        {bloqueio && p && total > 0 && (
          <div data-testid="empresa-zerar.bloqueio">
            <Notice tone="warning">{bloqueio}</Notice>
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
function Andamento({ empresa, titulo, aoFechar, aoTerminar }: { empresa: { id: string }; titulo: string; aoFechar: () => void; aoTerminar: () => void }) {
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
      title={titulo}
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
        {q.data?.situacao === 'concluido' && <Reenvio z={q.data} />}
      </div>
    </Dialog>
  );
}

/** Concluído: o lote (chave do `restaurar` do workflow) e o comando de reenvio de cada entidade afetada (desenho §3). */
function Reenvio({ z }: { z: ZerarEmpresa }) {
  const comandos = comandosDeReenvio(z.entidades_afetadas);
  return (
    <>
      <p className="m-0 text-ink-2" data-testid="empresa-zerar.lote">
        {T.lote} <span className="font-mono">{z.lote}</span>
      </p>
      {comandos.length > 0 && (
        <div className="flex flex-col gap-1" data-testid="empresa-zerar.reenvio">
          <p className="m-0 text-[13px] font-semibold text-ink">{T.reenvio}</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {comandos.map((c) => (
              <li key={c}>
                <code className="rounded-md bg-ground px-2 py-1 font-mono text-[13px]">{c}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
