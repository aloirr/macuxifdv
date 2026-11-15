'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, LoadingBlock, Notice, PageHeader, Panel, SelectField, TableScroll, formatDayMonthLong, td, th } from '@macuxi/ui/web';
import { textoDaHora } from '../metas-produtividade/formato';
import { useHojeDoTenant } from '../../lib/queries';
import { CHAVE_CALENDARIO, criarApiCalendario, type ApiCalendario, type ParametrosCalendario } from './api';
import { FERIADO_NOME_MAX, feriadosDoAno, incluirFeriado, lerAlmoco, type ErroFeriado, type ErrosAlmoco, type LinhaFeriado } from './calendario';

const CAMPO = 'h-[44px] rounded-xl border border-field bg-surface px-3 text-[15px] font-normal text-ink';

/** Campo do 422 da API → campo da tela. */
const CAMPO_DA_API: Readonly<Record<string, keyof ErrosAlmoco>> = { almoco_corte: 'corte', almoco_janela: 'janela' };

/**
 * Parâmetros › Calendário (desenho `docs/desenho/performance-produtividade.md` §1.3, §3.2 e §6.5): os feriados do ano, com os
 * nacionais em leitura e os do tenant com incluir e remover (cada mudança grava na hora), e o corte e a janela do almoço da
 * Produtividade. Ação `parametro.inicio` (analista e admin); a API revalida e audita.
 * testIDs: `calendario.tela` · `.ano` · `.feriado.data|nome` · `.feriado.<data|nome>.erro` · `.incluir` · `.linha.<data>` ·
 * `.remover.<data>` · `.almoco.corte|inicio|fim` · `.almoco.<corte|janela>.erro` · `.almoco.salvar` · `.aviso`.
 */
export function CalendarioPage({ cliente, hoje }: { cliente?: ApiCalendario; hoje?: string }) {
  const apiCalendario = useMemo(() => cliente ?? criarApiCalendario(), [cliente]);
  const pode = usePode('parametro.inicio');
  const hojeDoTenant = useHojeDoTenant();
  const anoHoje = Number((hoje ?? hojeDoTenant()).slice(0, 4));
  const qc = useQueryClient();
  const [ano, setAno] = useState(anoHoje);
  const [novo, setNovo] = useState({ data: '', nome: '' });
  const [erroFeriado, setErroFeriado] = useState<ErroFeriado | null>(null);
  const [almoco, setAlmoco] = useState<Partial<Record<'corte' | 'inicio' | 'fim', string>>>({});
  const [errosAlmoco, setErrosAlmoco] = useState<ErrosAlmoco>({});
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);
  const q = useQuery({ queryKey: CHAVE_CALENDARIO, queryFn: apiCalendario.ler, enabled: pode });

  const gravar = useMutation({
    mutationFn: async (m: { p: ParametrosCalendario; origem: 'feriado' | 'almoco' }) => apiCalendario.gravar(m.p),
    onSuccess: async (_r, m) => {
      if (m.origem === 'feriado') setNovo({ data: '', nome: '' });
      else {
        setAlmoco({});
        setAviso({ tom: 'success', texto: 'Almoço salvo.' });
      }
      await qc.invalidateQueries({ queryKey: CHAVE_CALENDARIO });
    },
    onError: (e) => {
      const lista = e instanceof ApiRequestError && e.status === 422 && Array.isArray(e.details?.erros) ? (e.details.erros as Array<{ campo?: unknown; mensagem?: unknown }>) : [];
      const campos: ErrosAlmoco = {};
      for (const x of lista) {
        const campo = typeof x.campo === 'string' ? CAMPO_DA_API[x.campo] : undefined;
        if (campo && typeof x.mensagem === 'string') campos[campo] = x.mensagem;
      }
      setErrosAlmoco(campos);
      setAviso(Object.keys(campos).length > 0 ? null : { tom: 'danger', texto: errorMessage(e) });
    },
  });

  if (!pode) return null;
  const p = q.data;
  const incluir = () => {
    if (!p) return;
    const r = incluirFeriado(p.feriados, novo);
    if (!r.ok) return setErroFeriado({ campo: r.campo, erro: r.erro });
    setErroFeriado(null);
    setAviso(null);
    gravar.mutate({ p: { ...p, feriados: r.lista }, origem: 'feriado' });
  };
  const remover = (data: string) => p && gravar.mutate({ p: { ...p, feriados: p.feriados.filter((f) => f.data !== data) }, origem: 'feriado' });
  const textoAlmoco = p ? { corte: textoDaHora(p.almoco_corte), inicio: textoDaHora(p.almoco_janela[0]), fim: textoDaHora(p.almoco_janela[1]), ...almoco } : null;
  const salvarAlmoco = () => {
    if (!p || !textoAlmoco) return;
    const r = lerAlmoco(textoAlmoco.corte, textoAlmoco.inicio, textoAlmoco.fim);
    if (!r.ok) return setErrosAlmoco(r.erros);
    setErrosAlmoco({});
    setAviso(null);
    gravar.mutate({ p: { ...p, almoco_corte: r.corte, almoco_janela: r.janela }, origem: 'almoco' });
  };

  return (
    <div className="flex w-full max-w-[860px] flex-col gap-5" data-testid="calendario.tela">
      <PageHeader title="Calendário" />
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando o calendário…" />}
      {aviso && (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          <span data-testid="calendario.aviso">{aviso.texto}</span>
        </Notice>
      )}
      {p && textoAlmoco && (
        <>
          <Panel
            title="Feriados"
            aside={
              <SelectField label="Ano" value={String(ano)} onChange={(e) => setAno(Number(e.target.value))} data-testid="calendario.ano">
                {[anoHoje, anoHoje + 1].map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </SelectField>
            }
          >
            <div className="flex flex-col gap-4 text-[13px]">
              <div className="flex flex-wrap items-start gap-2">
                <label className="flex flex-col gap-1 font-semibold text-ink">
                  Data
                  <input
                    type="date"
                    value={novo.data}
                    min={`${ano}-01-01`}
                    max={`${ano}-12-31`}
                    aria-invalid={erroFeriado?.campo === 'data' ? true : undefined}
                    aria-describedby={erroFeriado?.campo === 'data' ? 'calendario.feriado.data.erro' : undefined}
                    onChange={(e) => setNovo({ ...novo, data: e.target.value })}
                    className={CAMPO}
                    data-testid="calendario.feriado.data"
                  />
                  <ErroCampo id="calendario.feriado.data.erro" texto={erroFeriado?.campo === 'data' ? erroFeriado.erro : undefined} />
                </label>
                <label className="flex min-w-[220px] flex-1 flex-col gap-1 font-semibold text-ink">
                  Nome
                  <input
                    value={novo.nome}
                    maxLength={FERIADO_NOME_MAX}
                    aria-invalid={erroFeriado?.campo === 'nome' ? true : undefined}
                    aria-describedby={erroFeriado?.campo === 'nome' ? 'calendario.feriado.nome.erro' : undefined}
                    onChange={(e) => setNovo({ ...novo, nome: e.target.value })}
                    className={CAMPO}
                    data-testid="calendario.feriado.nome"
                  />
                  <ErroCampo id="calendario.feriado.nome.erro" texto={erroFeriado?.campo === 'nome' ? erroFeriado.erro : undefined} />
                </label>
                <Button variant="primary" className="mt-[21px]" disabled={gravar.isPending} onClick={incluir} data-testid="calendario.incluir">
                  Incluir
                </Button>
              </div>
              <TabelaFeriados linhas={feriadosDoAno(ano, p.feriados)} ocupado={gravar.isPending} onRemover={remover} />
            </div>
          </Panel>
          <Panel title="Almoço">
            <div className="flex flex-wrap items-start gap-4 text-[13px]">
              <label className="flex flex-col gap-1 font-semibold text-ink">
                Corte
                <input
                  value={textoAlmoco.corte}
                  inputMode="numeric"
                  aria-invalid={errosAlmoco.corte ? true : undefined}
                  aria-describedby={errosAlmoco.corte ? 'calendario.almoco.corte.erro' : undefined}
                  onChange={(e) => setAlmoco({ ...almoco, corte: e.target.value })}
                  className={`${CAMPO} w-[96px]`}
                  data-testid="calendario.almoco.corte"
                />
                <ErroCampo id="calendario.almoco.corte.erro" texto={errosAlmoco.corte} />
              </label>
              <fieldset className="m-0 flex flex-col gap-1 border-0 p-0" aria-describedby={errosAlmoco.janela ? 'calendario.almoco.janela.erro' : undefined}>
                <legend className="mb-1 font-semibold text-ink">Janela</legend>
                <div className="flex items-center gap-2">
                  <input value={textoAlmoco.inicio} inputMode="numeric" aria-label="Início da janela" aria-invalid={errosAlmoco.janela ? true : undefined} onChange={(e) => setAlmoco({ ...almoco, inicio: e.target.value })} className={`${CAMPO} w-[96px]`} data-testid="calendario.almoco.inicio" />
                  até
                  <input value={textoAlmoco.fim} inputMode="numeric" aria-label="Fim da janela" aria-invalid={errosAlmoco.janela ? true : undefined} onChange={(e) => setAlmoco({ ...almoco, fim: e.target.value })} className={`${CAMPO} w-[96px]`} data-testid="calendario.almoco.fim" />
                </div>
                <ErroCampo id="calendario.almoco.janela.erro" texto={errosAlmoco.janela} />
              </fieldset>
              <Button variant="primary" className="mt-[21px]" disabled={gravar.isPending || Object.keys(almoco).length === 0} onClick={salvarAlmoco} data-testid="calendario.almoco.salvar">
                Salvar
              </Button>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}

function ErroCampo({ id, texto }: { id: string; texto?: string }) {
  return texto ? (
    <span id={id} className="font-normal text-danger" data-testid={id}>
      {texto}
    </span>
  ) : null;
}

/** Feriados do ano, nacionais (só leitura) e do tenant (com Remover); renderizável no teste. */
export function TabelaFeriados({ linhas, ocupado, onRemover }: { linhas: readonly LinhaFeriado[]; ocupado: boolean; onRemover: (data: string) => void }) {
  return (
    <TableScroll minWidth={480}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>Data</th>
            <th className={th}>Feriado</th>
            <th className={th}>
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((f) => (
            <tr key={`${f.data}-${f.nacional}`} data-testid={`calendario.linha.${f.data}`}>
              <td className={td}>{formatDayMonthLong(f.data)}</td>
              <td className={td}>{f.nome}</td>
              <td className={td}>
                {f.nacional ? (
                  <Badge tone="neutral">Nacional</Badge>
                ) : (
                  <Button size="sm" disabled={ocupado} onClick={() => onRemover(f.data)} data-testid={`calendario.remover.${f.data}`}>
                    Remover
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
