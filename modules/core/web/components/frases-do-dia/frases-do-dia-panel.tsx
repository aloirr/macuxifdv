'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, ErrorBlock, LoadingBlock, Notice, Panel } from '@macuxi/ui/web';
import { FRASE_TEXTO_MAX, type FraseDiaSync } from '../../../contracts/frases';
import { fraseDoDia, validarFrase } from '../../../domain/frase-avatar/frase-do-dia';
import { useHojeDoTenant } from '../../lib/queries';
import { CHAVE_FRASES, criarApiFrases, type ApiFrases } from './api';
import { MENSAGEM_ERRO_FRASE, mensagemDoErroFrase, moverFrase } from './frases';

const CAMPO = 'h-[44px] w-full rounded-xl border border-field bg-surface px-3 text-[15px] font-normal text-ink';

type Acao = { tipo: 'criar'; texto: string } | { tipo: 'editar'; id: string; texto: string } | { tipo: 'ativa'; id: string; ativa: boolean } | { tipo: 'remover'; id: string } | { tipo: 'ordem'; ids: string[] };

/**
 * Parâmetros › Início › "Frases do dia" (RN-CORE-41; desenho `docs/desenho/inicio-frase-avatar-pedidos.md` §1.1, §2.1 e §3):
 * as 30 padrão e as do tenant, com adicionar, editar, desativar, reordenar e remover. A linha "Frase de hoje" usa o mesmo
 * `fraseDoDia` do aparelho e é recalculada a cada salvamento (a frase do dia pode mudar quando a lista muda, §3).
 * Ação `frase_dia.editar` (analista e admin); a API revalida e audita.
 * testIDs: `frases.painel` · `.hoje` · `.nova` · `.nova.erro` · `.adicionar` · `.linha.<id>` · `.subir|descer|editar|ativa|remover.<id>`
 * · `.editar.texto` · `.editar.erro` · `.editar.salvar` · `.remover.confirmar` · `.erro`.
 */
export function FrasesDoDiaPanel({ cliente, hoje }: { cliente?: ApiFrases; hoje?: string }) {
  const apiFrases = useMemo(() => cliente ?? criarApiFrases(), [cliente]);
  const pode = usePode('frase_dia.editar');
  const hojeDoTenant = useHojeDoTenant();
  const qc = useQueryClient();
  const [nova, setNova] = useState('');
  const [erroNova, setErroNova] = useState<string | null>(null);
  const [edicao, setEdicao] = useState<{ id: string; texto: string; erro: string | null } | null>(null);
  const [remover, setRemover] = useState<FraseDiaSync | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const q = useQuery({ queryKey: CHAVE_FRASES, queryFn: apiFrases.listar, enabled: pode });

  const gravar = useMutation({
    mutationFn: async (a: Acao) => {
      if (a.tipo === 'criar') return apiFrases.criar({ texto: a.texto, ativa: true });
      if (a.tipo === 'editar') return apiFrases.editar(a.id, { texto: a.texto });
      if (a.tipo === 'ativa') return apiFrases.editar(a.id, { ativa: a.ativa });
      if (a.tipo === 'remover') return apiFrases.remover(a.id);
      return apiFrases.reordenar(a.ids);
    },
    onSuccess: async (_r, a) => {
      setAviso(null);
      if (a.tipo === 'criar') setNova('');
      if (a.tipo === 'editar') setEdicao(null);
      if (a.tipo === 'remover') setRemover(null);
      await qc.invalidateQueries({ queryKey: CHAVE_FRASES });
    },
    onError: (e, a) => {
      const m = mensagemDoErroFrase(e);
      if (a.tipo === 'criar') setErroNova(m);
      else if (a.tipo === 'editar') setEdicao((ed) => (ed ? { ...ed, erro: m } : ed));
      else {
        setRemover(null);
        setAviso(m);
      }
    },
  });

  if (!pode) return null;
  const frases = q.data ?? [];
  const deHoje = q.data ? fraseDoDia(frases, hoje ?? hojeDoTenant()) : null;
  const ids = frases.map((f) => f.id);
  const ocupado = gravar.isPending;

  const adicionar = () => {
    const v = validarFrase(nova, frases);
    if (!v.ok) return setErroNova(MENSAGEM_ERRO_FRASE[v.motivo]);
    setErroNova(null);
    gravar.mutate({ tipo: 'criar', texto: v.texto });
  };
  const salvarEdicao = () => {
    if (!edicao) return;
    const v = validarFrase(edicao.texto, frases, { id: edicao.id });
    if (!v.ok) return setEdicao({ ...edicao, erro: MENSAGEM_ERRO_FRASE[v.motivo] });
    gravar.mutate({ tipo: 'editar', id: edicao.id, texto: v.texto });
  };
  const mover = (id: string, delta: -1 | 1) => {
    const ordem = moverFrase(ids, id, delta);
    if (ordem) gravar.mutate({ tipo: 'ordem', ids: ordem });
  };

  return (
    <Panel title="Frases do dia">
      <div className="flex flex-col gap-4 text-[13px]" data-testid="frases.painel">
        {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
        {q.isPending && <LoadingBlock label="Carregando as frases…" />}
        {aviso && (
          <Notice tone="danger" onClose={() => setAviso(null)}>
            <span data-testid="frases.erro">{aviso}</span>
          </Notice>
        )}
        {q.data && (
          <>
            <p className="m-0 rounded-xl bg-neutral-soft px-3 py-2.5 text-[15px] text-ink" data-testid="frases.hoje">
              {deHoje ? (
                <>
                  <span className="font-semibold">Frase de hoje: </span>
                  {deHoje.texto}
                </>
              ) : (
                'Nenhuma frase ativa.'
              )}
            </p>
            <div className="flex flex-col gap-1">
              <div className="flex gap-2">
                <input
                  value={nova}
                  maxLength={FRASE_TEXTO_MAX}
                  placeholder="Nova frase"
                  aria-label="Nova frase"
                  aria-invalid={erroNova ? true : undefined}
                  aria-describedby={erroNova ? 'frases.nova.erro' : undefined}
                  onChange={(e) => setNova(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && adicionar()}
                  className={CAMPO}
                  data-testid="frases.nova"
                />
                <Button variant="primary" disabled={ocupado} onClick={adicionar} data-testid="frases.adicionar">
                  Adicionar
                </Button>
              </div>
              {erroNova && (
                <span id="frases.nova.erro" className="text-danger" data-testid="frases.nova.erro">
                  {erroNova}
                </span>
              )}
            </div>
            <ol className="m-0 flex list-none flex-col p-0">
              {frases.map((f, i) => (
                <li key={f.id} className="flex flex-wrap items-center gap-2 border-b border-line-2 py-2 last:border-b-0" data-testid={`frases.linha.${f.id}`}>
                  <span className="w-7 shrink-0 text-right tabular-nums text-ink-2">{i + 1}</span>
                  {edicao?.id === f.id ? (
                    <div className="flex min-w-[240px] flex-1 flex-col gap-1">
                      <div className="flex gap-2">
                        <input
                          value={edicao.texto}
                          maxLength={FRASE_TEXTO_MAX}
                          aria-label="Texto da frase"
                          aria-invalid={edicao.erro ? true : undefined}
                          aria-describedby={edicao.erro ? 'frases.editar.erro' : undefined}
                          onChange={(e) => setEdicao({ ...edicao, texto: e.target.value })}
                          className={CAMPO}
                          data-testid="frases.editar.texto"
                        />
                        <Button variant="primary" disabled={ocupado} onClick={salvarEdicao} data-testid="frases.editar.salvar">
                          Salvar
                        </Button>
                        <Button onClick={() => setEdicao(null)}>Cancelar</Button>
                      </div>
                      {edicao.erro && (
                        <span id="frases.editar.erro" className="text-danger" data-testid="frases.editar.erro">
                          {edicao.erro}
                        </span>
                      )}
                    </div>
                  ) : (
                    <>
                      <span className={`min-w-[240px] flex-1 text-[15px] ${f.ativa ? 'text-ink' : 'text-ink-2'}`}>{f.texto}</span>
                      {!f.ativa && <Badge tone="neutral">Desativada</Badge>}
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" disabled={ocupado || i === 0} aria-label={`Subir a frase ${i + 1}`} onClick={() => mover(f.id, -1)} data-testid={`frases.subir.${f.id}`}>
                          ↑
                        </Button>
                        <Button size="sm" disabled={ocupado || i === frases.length - 1} aria-label={`Descer a frase ${i + 1}`} onClick={() => mover(f.id, 1)} data-testid={`frases.descer.${f.id}`}>
                          ↓
                        </Button>
                        <Button size="sm" disabled={ocupado} onClick={() => setEdicao({ id: f.id, texto: f.texto, erro: null })} data-testid={`frases.editar.${f.id}`}>
                          Editar
                        </Button>
                        <Button size="sm" disabled={ocupado} onClick={() => gravar.mutate({ tipo: 'ativa', id: f.id, ativa: !f.ativa })} data-testid={`frases.ativa.${f.id}`}>
                          {f.ativa ? 'Desativar' : 'Ativar'}
                        </Button>
                        <Button size="sm" disabled={ocupado} onClick={() => setRemover(f)} data-testid={`frases.remover.${f.id}`}>
                          Remover
                        </Button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </>
        )}
      </div>
      {remover && (
        <Dialog
          open
          title="Remover a frase?"
          onClose={() => setRemover(null)}
          footer={
            <>
              <Button onClick={() => setRemover(null)}>Voltar</Button>
              <Button variant="danger" disabled={ocupado} onClick={() => gravar.mutate({ tipo: 'remover', id: remover.id })} data-testid="frases.remover.confirmar">
                Remover
              </Button>
            </>
          }
        >
          <p className="m-0">{remover.texto}</p>
          {remover.padrao_codigo && <p className="mb-0 mt-2 text-ink-2">Frase padrão removida não volta. Para só tirar do rodízio, use Desativar.</p>}
        </Dialog>
      )}
    </Panel>
  );
}
