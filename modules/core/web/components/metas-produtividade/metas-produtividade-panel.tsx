'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice, Panel, TableScroll, td, th } from '@macuxi/ui/web';
import { INDICADORES_PRODUTIVIDADE, type IndicadorProdutividade } from '../../../contracts/performance';
import { metasProdutividadeVigentes, validarMetaProdutividade, type MetaResolvida } from '../../../domain/performance/metas-produtividade';
import { useHojeDoTenant } from '../../lib/queries';
import { CHAVE_CONSULTORES_METAS, CHAVE_EQUIPES, CHAVE_METAS_PRODUTIVIDADE, criarApiMetasProdutividade, type ApiMetasProdutividade } from './api';
import {
  errosDaApi,
  errosNoCampo,
  formatarMeta,
  linhasDoAlvo,
  mudancas,
  regraDo,
  ROTULO_INDICADOR_PRODUTIVIDADE,
  rotuloOrigem,
  sufixoDo,
  textosDasLinhas,
  type AlvoEscolhido,
  type ErrosMetas,
  type TextosMetas,
} from './formato';

const CAMPO = 'h-[44px] rounded-xl border border-field bg-surface px-3 text-[14px] font-normal text-ink';
const ESCOPOS = [
  ['tenant', 'Empresa'],
  ['equipe', 'Equipe'],
  ['usuario', 'Usuário'],
] as const;

/**
 * Metas e RV › aba "Produtividade" (RN-CORE-45; desenho `docs/desenho/performance-produtividade.md` §6.5): para quem as metas
 * valem (empresa, equipe ou usuário) e o mês de início; uma linha por indicador com a regra, o campo e o que vale hoje com a
 * origem. Campo vazio herda; "Voltar a herdar" esvazia o campo e o Salvar apaga a linha própria. Salvar grava as alteradas num
 * `PUT` só. Erros (domain e 422 `META_PRODUTIVIDADE_INVALIDA`) ficam no campo. Edita com `meta_produtividade.editar`; lê com `meta.ver`.
 * testIDs: `metas-prod.painel` · `.escopo.<escopo>` · `.equipe` · `.usuario` · `.vigencia` · `.linha.<indicador>` · `.campo.<indicador>`
 * · `.<campo>.erro` · `.herdar.<indicador>` · `.vale.<indicador>` · `.salvar` · `.aviso`.
 */
export function MetasProdutividadePanel({ cliente, hoje }: { cliente?: ApiMetasProdutividade; hoje?: string }) {
  const apiMetas = useMemo(() => cliente ?? criarApiMetasProdutividade(), [cliente]);
  const podeEditar = usePode('meta_produtividade.editar');
  const podeVer = usePode('meta.ver') || podeEditar;
  const hojeDoTenant = useHojeDoTenant();
  const mesHoje = (hoje ?? hojeDoTenant()).slice(0, 7);
  const qc = useQueryClient();
  const [alvo, setAlvo] = useState<AlvoEscolhido>({ escopo: 'tenant', equipe_id: null, usuario_id: null });
  const [vigencia, setVigencia] = useState(mesHoje);
  const [editados, setEditados] = useState<Partial<TextosMetas>>({});
  const [erros, setErros] = useState<ErrosMetas>({});
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);

  const linhas = useQuery({ queryKey: CHAVE_METAS_PRODUTIVIDADE, queryFn: apiMetas.listar, enabled: podeVer });
  // sem `usuario.ver` (analista) as listas falham: a opção some e a empresa continua editável
  const equipes = useQuery({ queryKey: CHAVE_EQUIPES, queryFn: apiMetas.equipes, enabled: podeVer, retry: false });
  const consultores = useQuery({ queryKey: CHAVE_CONSULTORES_METAS, queryFn: apiMetas.consultores, enabled: podeVer, retry: false });

  const salvar = useMutation({
    mutationFn: async (m: { put: Parameters<ApiMetasProdutividade['salvar']>[0] | null; herdar: string[] }) => {
      if (m.put) await apiMetas.salvar(m.put);
      for (const id of m.herdar) await apiMetas.herdar(id);
    },
    onSuccess: async () => {
      setEditados({});
      setErros({});
      setAviso({ tom: 'success', texto: 'Metas salvas.' });
      await qc.invalidateQueries({ queryKey: CHAVE_METAS_PRODUTIVIDADE });
    },
    onError: (e) => {
      const r = errosDaApi(e);
      setErros(r.campos);
      setAviso(r.soltos.length > 0 ? { tom: 'danger', texto: r.soltos.join(' ') } : null);
    },
  });

  if (!podeVer) return null;
  const todas = linhas.data ?? [];
  const arvore = (equipes.data ?? []).map((e) => ({ id: e.id, equipe_pai_id: e.equipe_pai_id, nome: e.nome }));
  const equipeDoUsuario = consultores.data?.find((c) => c.id === alvo.usuario_id)?.equipe_id ?? null;
  const completo = alvo.escopo === 'tenant' || (alvo.escopo === 'equipe' ? !!alvo.equipe_id : !!alvo.usuario_id);
  const proprias = linhasDoAlvo(todas, alvo, vigencia);
  const textos: TextosMetas = { ...textosDasLinhas(proprias), ...editados };
  const equipeDoAlvo = alvo.escopo === 'equipe' ? alvo.equipe_id : alvo.escopo === 'usuario' ? equipeDoUsuario : null;
  const vigentes = metasProdutividadeVigentes({ linhas: todas, equipes: arvore, alvo: { usuario_id: alvo.usuario_id, equipe_id: equipeDoAlvo }, mes: mesHoje });
  const vale = (i: IndicadorProdutividade, m: MetaResolvida) => ({
    texto: formatarMeta(i, m.valor),
    origem: rotuloOrigem(m.origem, { indicador: i, equipeDoAlvo, linhas: todas, equipes: arvore, mes: mesHoje }),
  });

  const trocarAlvo = (a: AlvoEscolhido) => {
    setAlvo(a);
    setEditados({});
    setErros({});
    setAviso(null);
  };
  const enviar = () => {
    setAviso(null);
    const m = mudancas(textos, proprias, alvo, vigencia);
    if (!m.ok) return setErros(m.erros);
    if (!m.put && m.herdar.length === 0) return setEditados({});
    if (m.put) {
      const v = validarMetaProdutividade({ edicao: m.put, mes_hoje: mesHoje, linhas: todas, equipes: arvore, equipe_do_usuario: equipeDoUsuario });
      if (!v.ok) {
        const r = errosNoCampo(v.erros);
        setErros(r.campos);
        return r.soltos.length > 0 ? setAviso({ tom: 'danger', texto: r.soltos.join(' ') }) : undefined;
      }
    }
    setErros({});
    salvar.mutate({ put: m.put, herdar: m.herdar });
  };

  return (
    <Panel title="Metas de produtividade">
      <div className="flex flex-col gap-4 text-[13px]" data-testid="metas-prod.painel">
        {linhas.isError && <ErrorBlock message={errorMessage(linhas.error)} onRetry={() => void linhas.refetch()} />}
        {linhas.isPending && <LoadingBlock label="Carregando as metas…" />}
        {aviso && (
          <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
            <span data-testid="metas-prod.aviso">{aviso.texto}</span>
          </Notice>
        )}
        <div className="flex flex-wrap items-end gap-4">
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 font-semibold text-ink">Valem para</legend>
            <div className="flex flex-wrap items-center gap-4">
              {ESCOPOS.filter(([e]) => (e === 'equipe' ? equipes.data : e === 'usuario' ? consultores.data : true)).map(([e, rotulo]) => (
                <label key={e} className="flex min-h-[44px] items-center gap-2 text-[14px]">
                  <input type="radio" name="metas-prod.escopo" checked={alvo.escopo === e} onChange={() => trocarAlvo({ escopo: e, equipe_id: null, usuario_id: null })} className="h-5 w-5" data-testid={`metas-prod.escopo.${e}`} />
                  {rotulo}
                </label>
              ))}
              {alvo.escopo === 'equipe' && equipes.data && (
                <select value={alvo.equipe_id ?? ''} aria-label="Equipe" onChange={(e) => trocarAlvo({ ...alvo, equipe_id: e.target.value || null })} className={CAMPO} data-testid="metas-prod.equipe">
                  <option value="">Escolha a equipe</option>
                  {equipes.data.map((q) => (
                    <option key={q.id} value={q.id}>
                      {q.nome}
                    </option>
                  ))}
                </select>
              )}
              {alvo.escopo === 'usuario' && consultores.data && (
                <select value={alvo.usuario_id ?? ''} aria-label="Usuário" onChange={(e) => trocarAlvo({ ...alvo, usuario_id: e.target.value || null })} className={CAMPO} data-testid="metas-prod.usuario">
                  <option value="">Escolha o usuário</option>
                  {consultores.data.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {erros.alvo && (
              <span className="text-danger" data-testid="metas-prod.alvo.erro">
                {erros.alvo}
              </span>
            )}
          </fieldset>
          <label className="flex flex-col gap-1 font-semibold text-ink">
            A partir de
            <input
              type="month"
              value={vigencia}
              min={mesHoje}
              disabled={!podeEditar}
              aria-invalid={erros.vigencia_inicio ? true : undefined}
              aria-describedby={erros.vigencia_inicio ? 'metas-prod.vigencia_inicio.erro' : undefined}
              onChange={(e) => {
                setVigencia(e.target.value);
                setEditados({});
              }}
              className={CAMPO}
              data-testid="metas-prod.vigencia"
            />
            {erros.vigencia_inicio && (
              <span id="metas-prod.vigencia_inicio.erro" className="font-normal text-danger" data-testid="metas-prod.vigencia_inicio.erro">
                {erros.vigencia_inicio}
              </span>
            )}
          </label>
        </div>
        {linhas.data && completo && (
          <>
            <TabelaMetasProdutividade
              textos={textos}
              erros={erros}
              podeEditar={podeEditar}
              vale={Object.fromEntries(INDICADORES_PRODUTIVIDADE.map((i) => [i, vale(i, vigentes[i])])) as Record<IndicadorProdutividade, { texto: string; origem: string }>}
              onChange={(i, texto) => {
                setAviso(null);
                setEditados((e) => ({ ...e, [i]: texto }));
              }}
            />
            {podeEditar && (
              <div>
                <Button variant="primary" disabled={salvar.isPending || Object.keys(editados).length === 0} onClick={enviar} data-testid="metas-prod.salvar">
                  Salvar
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

/** A tabela das 12 metas, sem estado (renderizável no teste). */
export function TabelaMetasProdutividade({
  textos,
  erros,
  vale,
  podeEditar,
  onChange,
}: {
  textos: TextosMetas;
  erros: ErrosMetas;
  vale: Record<IndicadorProdutividade, { texto: string; origem: string }>;
  podeEditar: boolean;
  onChange: (i: IndicadorProdutividade, texto: string) => void;
}) {
  return (
    <TableScroll minWidth={720}>
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={th}>Indicador</th>
            <th className={th}>Regra</th>
            <th className={th}>Meta</th>
            <th className={th}>Vale hoje</th>
          </tr>
        </thead>
        <tbody>
          {INDICADORES_PRODUTIVIDADE.map((i) => {
            const erro = erros[i];
            const sufixo = sufixoDo(i);
            return (
              <tr key={i} data-testid={`metas-prod.linha.${i}`}>
                <td className={td}>{ROTULO_INDICADOR_PRODUTIVIDADE[i]}</td>
                <td className={td}>{regraDo(i)}</td>
                <td className={td}>
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <input
                        value={textos[i]}
                        inputMode={i === 'primeiro_checkin' || i === 'ultimo_checkin' ? 'numeric' : 'decimal'}
                        placeholder={i === 'primeiro_checkin' || i === 'ultimo_checkin' ? 'hh:mm' : undefined}
                        disabled={!podeEditar}
                        aria-label={`Meta de ${ROTULO_INDICADOR_PRODUTIVIDADE[i]}`}
                        aria-invalid={erro ? true : undefined}
                        aria-describedby={erro ? `metas-prod.${i}.erro` : undefined}
                        onChange={(e) => onChange(i, e.target.value)}
                        className={`${CAMPO} w-[104px]`}
                        data-testid={`metas-prod.campo.${i}`}
                      />
                      {sufixo && <span className="text-ink-2">{sufixo}</span>}
                      {podeEditar && textos[i] !== '' && (
                        <Button variant="link" onClick={() => onChange(i, '')} data-testid={`metas-prod.herdar.${i}`}>
                          Voltar a herdar
                        </Button>
                      )}
                    </div>
                    {erro && (
                      <span id={`metas-prod.${i}.erro`} className="text-danger" data-testid={`metas-prod.${i}.erro`}>
                        {erro}
                      </span>
                    )}
                  </div>
                </td>
                <td className={td} data-testid={`metas-prod.vale.${i}`}>
                  {vale[i].texto}
                  <span className="block text-ink-2">{vale[i].origem}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}

