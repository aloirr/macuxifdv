'use client';

/**
 * T-0181 (spec docs/design/carga-aviso-frases/spec.md §3; imagens `config-frases.png` e `config-editar.png`): Portal › Frases da
 * carga, só o time da Macuxi (super-admin). O admin do cliente não vê o item no cabeçalho e, no endereço direto, recebe
 * "Esta área é só do time Macuxi." (a API também responde 403).
 * - `PageHeader` "Frases da carga" com a ação única "Incluir frase".
 * - `Panel` com a tabela Nº · Frase · Situação (selo "Ativa"/"Inativa") · "Editar" e "Desativar"/"Ativar" (imediato, sem
 *   confirmação); ativas primeiro pelo Nº, inativas no fim. Sem excluir.
 * - `Dialog` incluir/editar: área de texto que para em 90 caracteres, contador "n de 90"; erros na linha do campo.
 * Regras e textos em `lib/portal-frases-carga.ts`. testIDs: frases.*.
 */
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FraseCargaSchema, FrasesCargaListaSchema, ordenarFrasesDoPortal, type FraseCarga } from '@macuxi/platform-sdk';
import { Badge, Button, CLASSE_CAMPO_ACESSO, cx, Dialog, ErrorBlock, LoadingBlock, Notice, PageHeader, Panel, TableScroll, td, th } from '@macuxi/ui/web';

import { chamarPortal, ErroPortal, mensagemDoErro } from '@/lib/portal-api';
import {
  acaoDaSituacao,
  contadorDaFrase,
  cortarFrase,
  erroDoCampo,
  erroDoFormulario,
  situacaoDaFrase,
  TEXTOS_PORTAL_FRASES as T,
  tituloDoDialogoFrase,
} from '@/lib/portal-frases-carga';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { ehTimeMacuxi } from '@/lib/portal-sessao';
import { MolduraPortal, SemAcessoTimeMacuxi, useSessaoPortal } from './base';

const CHAVE = ['portal', 'frases-carga'] as const;

export function TelaFrasesCarga() {
  const sessao = useSessaoPortal();
  const pode = sessao === undefined || sessao === null ? null : ehTimeMacuxi(sessao);
  // o diálogo: `null` fechado; `{ frase: null }` incluir; `{ frase }` editar
  const [dialogo, setDialogo] = useState<{ frase: FraseCarga | null } | null>(null);
  return (
    <MolduraPortal
      titulo={
        pode ? (
          <PageHeader
            title={T.titulo}
            actions={
              <Button variant="primary" data-testid="frases.incluir" onClick={() => setDialogo({ frase: null })}>
                {T.incluir}
              </Button>
            }
          />
        ) : undefined
      }
    >
      {pode === null ? (
        <LoadingBlock label={T.carregando} />
      ) : pode ? (
        <ListaFrases dialogo={dialogo} setDialogo={setDialogo} />
      ) : (
        <SemAcessoTimeMacuxi testId="frases.sem-acesso" />
      )}
    </MolduraPortal>
  );
}

function ListaFrases({
  dialogo,
  setDialogo,
}: {
  dialogo: { frase: FraseCarga | null } | null;
  setDialogo: (d: { frase: FraseCarga | null } | null) => void;
}) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: CHAVE,
    queryFn: () => chamarPortal(ROTAS_PORTAL.frasesCarga, { schema: FrasesCargaListaSchema }).then((r) => r.itens),
  });
  const lista = useMemo(() => ordenarFrasesDoPortal(q.data ?? []), [q.data]);
  const [mudando, setMudando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  /** Ativar e desativar: imediatos, sem confirmação. */
  const alternar = async (f: FraseCarga) => {
    if (mudando) return;
    setMudando(f.id);
    setAviso(null);
    try {
      const nova = await chamarPortal(ROTAS_PORTAL.fraseCarga(f.id), { metodo: 'PATCH', corpo: { ativa: !f.ativa }, schema: FraseCargaSchema });
      qc.setQueryData<FraseCarga[]>(CHAVE, (atual) => atual?.map((x) => (x.id === nova.id ? nova : x)));
    } catch (e) {
      setAviso(mensagemDoErro(e));
    } finally {
      setMudando(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div aria-live="polite">
        {aviso && (
          <div data-testid="frases.aviso">
            <Notice tone="danger" onClose={() => setAviso(null)}>
              {aviso}
            </Notice>
          </div>
        )}
      </div>
      {q.isPending ? (
        <LoadingBlock label={T.carregando} />
      ) : q.isError ? (
        <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />
      ) : lista.length === 0 ? (
        <Panel>
          <div data-testid="frases.vazio" className="py-4 text-[15px] font-semibold">
            {T.vazio}
          </div>
        </Panel>
      ) : (
        <Panel>
          <TableScroll minWidth={720}>
            <table data-testid="frases.lista" className="w-full border-collapse text-[14px]">
              <thead>
                <tr>
                  <th className={cx(th, 'w-12')}>Nº</th>
                  <th className={th}>Frase</th>
                  <th className={cx(th, 'w-28')}>Situação</th>
                  <th className={cx(th, 'w-40')}>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {lista.map((f) => {
                  const s = situacaoDaFrase(f.ativa);
                  return (
                    <tr key={f.id} data-testid={`frases.linha-${f.numero}`}>
                      <td className={cx(td, 'tabular-nums text-ink-2')}>{f.numero}</td>
                      <td className={td}>{f.texto}</td>
                      <td className={td}>
                        <Badge tone={s.tom}>{s.rotulo}</Badge>
                      </td>
                      <td className={cx(td, 'whitespace-nowrap text-right')}>
                        <span className="inline-flex gap-3">
                          <Button
                            variant="link"
                            data-testid={`frases.editar-${f.numero}`}
                            aria-label={`${T.editar} a frase ${f.numero}`}
                            className="font-semibold"
                            onClick={() => setDialogo({ frase: f })}
                          >
                            {T.editar}
                          </Button>
                          <Button
                            variant="link"
                            data-testid={`frases.situacao-${f.numero}`}
                            aria-label={`${acaoDaSituacao(f.ativa)} a frase ${f.numero}`}
                            className="font-semibold"
                            disabled={mudando === f.id}
                            onClick={() => void alternar(f)}
                          >
                            {acaoDaSituacao(f.ativa)}
                          </Button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
      {dialogo && (
        <DialogoFrase
          frase={dialogo.frase}
          lista={q.data ?? []}
          fechar={() => setDialogo(null)}
          salvou={(nova) => {
            qc.setQueryData<FraseCarga[]>(CHAVE, (atual) =>
              atual ? (atual.some((x) => x.id === nova.id) ? atual.map((x) => (x.id === nova.id ? nova : x)) : [...atual, nova]) : [nova],
            );
            setDialogo(null);
          }}
        />
      )}
    </div>
  );
}

/** Incluir (nasce ativa) ou editar o texto. A frase incluída leva o `id` gerado aqui: o reenvio é idempotente. */
function DialogoFrase({
  frase,
  lista,
  fechar,
  salvou,
}: {
  frase: FraseCarga | null;
  lista: readonly FraseCarga[];
  fechar: () => void;
  salvou: (f: FraseCarga) => void;
}) {
  const [texto, setTexto] = useState(frase?.texto ?? '');
  const [id] = useState(() => frase?.id ?? crypto.randomUUID());
  const [erroCampo, setErroCampo] = useState<string | null>(null);
  const [erroGeral, setErroGeral] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const sair = () => {
    if (!enviando) fechar();
  };
  const salvar = async () => {
    if (enviando) return;
    const e = erroDoFormulario(texto, lista, frase?.id);
    setErroCampo(e);
    setErroGeral(null);
    if (e) return;
    setEnviando(true);
    try {
      const nova = frase
        ? await chamarPortal(ROTAS_PORTAL.fraseCarga(frase.id), { metodo: 'PATCH', corpo: { texto }, schema: FraseCargaSchema })
        : await chamarPortal(ROTAS_PORTAL.frasesCarga, { metodo: 'POST', corpo: { id, texto }, schema: FraseCargaSchema });
      salvou(nova);
    } catch (x) {
      const doCampo = x instanceof ErroPortal ? erroDoCampo(x.codigo) : null;
      if (doCampo) setErroCampo(doCampo);
      else setErroGeral(mensagemDoErro(x));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog
      open
      title={tituloDoDialogoFrase(frase?.numero ?? null)}
      onClose={sair}
      footer={
        <>
          <Button data-testid="frases.cancelar" disabled={enviando} onClick={sair}>
            {T.cancelar}
          </Button>
          <Button variant="primary" data-testid="frases.salvar" disabled={enviando} onClick={() => void salvar()}>
            {enviando ? T.salvando : T.salvar}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <label htmlFor="frase-carga-texto" className="text-[13px] font-semibold text-ink">
          {T.campo}
        </label>
        <textarea
          id="frase-carga-texto"
          data-testid="frases.campo"
          rows={3}
          value={texto}
          aria-invalid={erroCampo ? true : undefined}
          aria-describedby="frase-carga-contador frase-carga-erro"
          onChange={(e) => {
            setTexto(cortarFrase(e.target.value));
            setErroCampo(null);
          }}
          className={cx(CLASSE_CAMPO_ACESSO, 'h-auto resize-none py-2.5 leading-[22px]')}
        />
        <div className="flex items-start justify-between gap-3 text-[13px]">
          <span id="frase-carga-erro" data-testid="frases.erro" className="text-danger" role={erroCampo ? 'alert' : undefined}>
            {erroCampo}
          </span>
          <span id="frase-carga-contador" data-testid="frases.contador" className="shrink-0 text-ink-2 tabular-nums">
            {contadorDaFrase(texto)}
          </span>
        </div>
        {erroGeral && (
          <div data-testid="frases.erro-geral" className="pt-2">
            <Notice tone="danger">{erroGeral}</Notice>
          </div>
        )}
      </div>
    </Dialog>
  );
}
