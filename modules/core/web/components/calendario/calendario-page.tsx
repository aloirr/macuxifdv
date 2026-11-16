'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, LoadingBlock, Notice, SelectField, TableScroll, formatDayMonthLong, td, th } from '@macuxi/ui/web';
import { useHojeDoTenant } from '../../lib/queries';
import { CHAVE_CALENDARIO, criarApiCalendario, type ApiCalendario, type ParametrosCalendario } from './api';
import { FERIADO_NOME_MAX, feriadosDoAno, incluirFeriado, type ErroFeriado, type LinhaFeriado } from './calendario';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';
import { Moldura } from '../moldura';

/**
 * Parâmetros › Calendário, painel Feriados (desenho `docs/desenho/performance-produtividade.md` §1.3, §3.2 e §6.5): os feriados do ano,
 * com os nacionais em leitura e os do tenant com incluir e remover (cada mudança grava na hora). O almoço é o painel próprio
 * (`almoco-padrao-panel.tsx`). Ação `parametro.inicio` (analista e admin); a API revalida e audita.
 * testIDs: `calendario.tela` · `.ano` · `.feriado.data|nome` · `.feriado.<data|nome>.erro` · `.incluir` · `.linha.<data>` ·
 * `.remover.<data>` · `.aviso`.
 */
export function CalendarioPage({ cliente, hoje, semMoldura }: { cliente?: ApiCalendario; hoje?: string; semMoldura?: boolean }) {
  const apiCalendario = useMemo(() => cliente ?? criarApiCalendario(), [cliente]);
  const pode = usePode('parametro.inicio');
  const hojeDoTenant = useHojeDoTenant();
  const anoHoje = Number((hoje ?? hojeDoTenant()).slice(0, 4));
  const qc = useQueryClient();
  const [ano, setAno] = useState(anoHoje);
  const [novo, setNovo] = useState({ data: '', nome: '' });
  const [erroFeriado, setErroFeriado] = useState<ErroFeriado | null>(null);
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);
  const q = useQuery({ queryKey: CHAVE_CALENDARIO, queryFn: apiCalendario.ler, enabled: pode });

  const gravar = useMutation({
    mutationFn: async (p: ParametrosCalendario) => apiCalendario.gravar(p),
    onSuccess: async () => {
      setNovo({ data: '', nome: '' });
      await qc.invalidateQueries({ queryKey: CHAVE_CALENDARIO });
    },
    onError: (e) => setAviso({ tom: 'danger', texto: errorMessage(e) }),
  });

  if (!pode) return null;
  const p = q.data;
  const incluir = () => {
    if (!p) return;
    const r = incluirFeriado(p.feriados, novo);
    if (!r.ok) return setErroFeriado({ campo: r.campo, erro: r.erro });
    setErroFeriado(null);
    setAviso(null);
    gravar.mutate({ ...p, feriados: r.lista });
  };
  const remover = (data: string) => p && gravar.mutate({ ...p, feriados: p.feriados.filter((f) => f.data !== data) });
  return (
    <div className="flex w-full flex-col gap-5" data-testid="calendario.tela">
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando o calendário…" />}
      {aviso && (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          <span data-testid="calendario.aviso">{aviso.texto}</span>
        </Notice>
      )}
      {p && (
        <>
          <Moldura
            sem={semMoldura}
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
            <div className="flex flex-col gap-4 text-[15px]">
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
                    className={CLASSE_CAMPO_BKO}
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
                    className={CLASSE_CAMPO_BKO}
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
          </Moldura>
        </>
      )}
    </div>
  );
}

function ErroCampo({ id, texto }: { id: string; texto?: string }) {
  return texto ? (
    <span id={id} className="text-[13px] font-normal text-danger" data-testid={id}>
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
