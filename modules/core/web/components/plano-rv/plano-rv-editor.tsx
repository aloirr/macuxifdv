'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Badge, Button, Notice, Panel, td, tdNum, th, thNum, TableScroll } from '@macuxi/ui/web';
import { formatBRL } from '@macuxi/comum';
import type { PlanoRvPut } from '../../../contracts';
import { INDICADORES_META } from '../../../contracts';
import type { IndicadorRv } from '../../../domain';
import {
  corpoDoFormulario,
  formularioAlterado,
  ROTULO_INDICADOR_RV,
  ROTULO_MODO,
  ROTULO_PERFIL_RV,
  simularRv,
  somaDosPesos,
  textoDasFaixas,
  textoDoGatilho,
  textoDosPesos,
  type FormFaixa,
  type FormPlano,
  type FormRegra,
} from '../../lib/plano-rv';

const CAMPO = 'h-[44px] rounded-xl border border-field bg-surface px-3 text-[14px] font-normal text-ink';
const CAMPO_CURTO = `${CAMPO} w-[96px] text-right`;

function Rotulado({ rotulo, children, ajuda }: { rotulo: string; children: React.ReactNode; ajuda?: string }) {
  return (
    <label className="flex flex-col gap-1 text-[14px] font-semibold text-ink">
      {rotulo}
      {ajuda && <span className="text-[13px] font-normal text-ink-2">{ajuda}</span>}
      {children}
    </label>
  );
}

function RegraEditor({ regra, onChange }: { regra: FormRegra; onChange: (r: FormRegra) => void }) {
  const id = regra.indicador;
  const mudarFaixa = (i: number, patch: Partial<FormFaixa>) => onChange({ ...regra, faixas: regra.faixas.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-3 rounded-xl border border-line p-3" data-testid={`plano-rv.regra.${id}`}>
      <legend className="px-1 text-[14px] font-semibold text-ink">{ROTULO_INDICADOR_RV[id]}</legend>
      <label className="flex min-h-[44px] items-center gap-2 text-[14px] font-semibold text-ink">
        <input type="checkbox" className="h-5 w-5" checked={regra.ativo} onChange={(e) => onChange({ ...regra, ativo: e.target.checked })} data-testid={`plano-rv.${id}.ativo`} />
        Usar {ROTULO_INDICADOR_RV[id]} no plano
      </label>
      {regra.ativo && (
        <>
          <div className="flex flex-wrap items-end gap-4">
            <label className="flex min-h-[44px] items-center gap-2 text-[14px] text-ink">
              <input type="checkbox" className="h-5 w-5" checked={regra.gatilho} onChange={(e) => onChange({ ...regra, gatilho: e.target.checked })} data-testid={`plano-rv.${id}.gatilho`} />
              É gatilho: abaixo da meta, a RV do mês zera
            </label>
            {!regra.gatilho && (
              <Rotulado rotulo="Peso (%)">
                <input className={CAMPO_CURTO} inputMode="numeric" value={regra.peso} onChange={(e) => onChange({ ...regra, peso: e.target.value.replace(/\D/g, '') })} data-testid={`plano-rv.${id}.peso`} />
              </Rotulado>
            )}
          </div>
          {!regra.gatilho && (
            <>
              <div className="flex flex-col gap-2">
                {regra.faixas.map((f, i) => (
                  <div key={i} className="flex flex-wrap items-end gap-3" data-testid={`plano-rv.${id}.faixa.${i}`}>
                    <Rotulado rotulo={`Faixa ${i + 1}: a partir de (%)`}>
                      <input className={CAMPO_CURTO} inputMode="numeric" value={f.de} onChange={(e) => mudarFaixa(i, { de: e.target.value.replace(/\D/g, '') })} />
                    </Rotulado>
                    <Rotulado rotulo={`Faixa ${i + 1}: paga`}>
                      <select className={`${CAMPO} w-[240px]`} value={f.modo} onChange={(e) => mudarFaixa(i, { modo: e.target.value as FormFaixa['modo'] })}>
                        {(Object.keys(ROTULO_MODO) as Array<FormFaixa['modo']>).map((m) => (
                          <option key={m} value={m}>
                            {ROTULO_MODO[m]}
                          </option>
                        ))}
                      </select>
                    </Rotulado>
                    {f.modo === 'fixo' && (
                      <Rotulado rotulo={`Faixa ${i + 1}: percentual do peso pago (%)`}>
                        <input className={CAMPO_CURTO} inputMode="numeric" value={f.pagamento} onChange={(e) => mudarFaixa(i, { pagamento: e.target.value.replace(/\D/g, '') })} />
                      </Rotulado>
                    )}
                    <Button onClick={() => onChange({ ...regra, faixas: regra.faixas.filter((_, j) => j !== i) })} disabled={regra.faixas.length <= 1} aria-label={`Remover a faixa ${i + 1} de ${ROTULO_INDICADOR_RV[id]}`} style={{ minHeight: 44 }}>
                      Remover
                    </Button>
                  </div>
                ))}
                <div>
                  <Button onClick={() => onChange({ ...regra, faixas: [...regra.faixas, { de: '', modo: 'fixo', pagamento: '100' }] })} disabled={regra.faixas.length >= 10} style={{ minHeight: 44 }}>
                    Adicionar faixa
                  </Button>
                </div>
              </div>
              <p className="m-0 text-[13px] text-ink-2" data-testid={`plano-rv.${id}.descricao`}>
                {textoDasFaixas(regra.faixas)}
              </p>
            </>
          )}
        </>
      )}
    </fieldset>
  );
}

/** Simulador: atingimento digitado por indicador -> RV pelo mesmo domain da API (sem chamada). */
type Ating = Partial<Record<IndicadorRv, string>>;
function Simulador({ corpo, motivo, ating, setAting }: { corpo: PlanoRvPut | null; motivo: string | null; ating: Ating; setAting: (a: Ating) => void }) {
  const plano = useMemo(() => (corpo ? { id: 'simulado', ...corpo } : null), [corpo]);
  if (!plano) {
    return (
      <Panel title="Simulador">
        <Notice tone="info">{`Complete o plano para simular${motivo ? `: ${motivo}` : '.'}`}</Notice>
      </Panel>
    );
  }
  const r = simularRv(plano, ating);
  return (
    <Panel title="Simulador">
      <div className="flex flex-col gap-3" data-testid="plano-rv.simulador">
        <p className="m-0 text-[13px] text-ink-2">Digite o atingimento de cada indicador, em %, para ver quanto o plano pagaria no mês fechado. Indicador em branco conta como sem meta.</p>
        <TableScroll minWidth={560}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>Indicador</th>
                <th className={thNum}>Atingimento (%)</th>
                <th className={thNum}>Paga (%)</th>
                <th className={thNum}>Valor</th>
              </tr>
            </thead>
            <tbody>
              {plano.regras.map((reg) => {
                const linha = r.linhas.find((l) => l.indicador === reg.indicador);
                return (
                  <tr key={reg.indicador}>
                    <td className={td}>
                      {ROTULO_INDICADOR_RV[reg.indicador]} {reg.gatilho && <Badge tone="neutral">Gatilho</Badge>}
                    </td>
                    <td className={tdNum}>
                      <input
                        className={CAMPO_CURTO}
                        inputMode="decimal"
                        value={ating[reg.indicador] ?? ''}
                        onChange={(e) => setAting({ ...ating, [reg.indicador]: e.target.value.replace(/[^\d,.]/g, '') })}
                        aria-label={`Atingimento de ${ROTULO_INDICADOR_RV[reg.indicador]} em porcentagem`}
                        data-testid={`plano-rv.simulador.${reg.indicador}`}
                      />
                    </td>
                    <td className={tdNum}>{reg.gatilho ? textoDoGatilho(linha?.gatilho_ok ?? null, r.bloqueada) : `${linha?.pagamento_pct ?? 0}%`}</td>
                    <td className={tdNum}>{reg.gatilho ? '—' : formatBRL(linha?.valor_cents ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
        <p className="m-0 text-[15px] font-semibold text-ink" data-testid="plano-rv.simulador.total">
          RV simulada: {formatBRL(r.rv_cents)}
          {r.bloqueada && ' (gatilho não atingido: a RV zera)'}
        </p>
      </div>
    </Panel>
  );
}

/**
 * Formulário do plano e da vigência (RN-CORE-30). A validação é a do domain (a API repete). Sem escrita aqui: `aoSalvar` recebe o
 * corpo pronto do PUT. `somenteLeitura` mostra o plano de mês fechado sem permitir alterar (a mudança vira versão nova).
 * testIDs: `plano-rv.editor` · `plano-rv.nome` · `plano-rv.vigencia` · `plano-rv.valor` · `plano-rv.<indicador>.*` · `plano-rv.salvar`.
 */
export function PlanoRvEditor({
  inicial,
  titulo,
  ajudaTitulo,
  aoSalvar,
  aoCancelar,
  salvando,
  erroApi,
  motivoLeitura,
  aoMudarSujo,
}: {
  inicial: FormPlano;
  titulo: string;
  ajudaTitulo?: string;
  aoSalvar: (c: PlanoRvPut) => void;
  aoCancelar: () => void;
  salvando: boolean;
  erroApi: string | null;
  /** plano só para consulta: 'fechado' = já valeu para mês fechado; 'permissao' = o perfil não altera planos */
  motivoLeitura?: 'fechado' | 'permissao';
  /** avisa a página quando o formulário passa a diferir do que foi aberto (e quando volta): a página pede confirmação ao sair */
  aoMudarSujo?: (sujo: boolean) => void;
}) {
  const [form, setForm] = useState<FormPlano>(inicial);
  const [erros, setErros] = useState<string[]>([]);
  const [ating, setAting] = useState<Ating>({});
  const raiz = useRef<HTMLDivElement>(null);
  const nome = useRef<HTMLInputElement>(null);
  const aviso = useRef<HTMLDivElement>(null);
  const lock = Boolean(motivoLeitura);
  const validacao = corpoDoFormulario(form);
  const mudar = (patch: Partial<FormPlano>) => setForm((f) => ({ ...f, ...patch }));
  const salvar = () => {
    const v = corpoDoFormulario(form);
    if (!v.ok) return setErros(v.erros);
    setErros([]);
    aoSalvar(v.corpo);
  };
  const sujo = !motivoLeitura && formularioAlterado(inicial, form);
  useEffect(() => {
    aoMudarSujo?.(sujo);
    return () => aoMudarSujo?.(false);
  }, [sujo]);
  // ao abrir: rola até o editor e leva o foco ao primeiro campo (ou ao próprio editor, no modo consulta)
  useEffect(() => {
    const menos = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    raiz.current?.scrollIntoView?.({ block: 'start', behavior: menos ? 'auto' : 'smooth' });
    (lock ? raiz.current : nome.current)?.focus({ preventScroll: true });
  }, [lock]);
  // ao falhar (digitação ou API), o foco vai para o aviso
  const mensagens = erros.length > 0 ? erros : erroApi ? erroApi.split('\n').filter(Boolean) : [];
  useEffect(() => {
    if (mensagens.length > 0) aviso.current?.focus();
  }, [erros, erroApi]);
  return (
    <div ref={raiz} tabIndex={-1} className="flex flex-col gap-5 outline-none" data-testid="plano-rv.editor">
      <Panel title={titulo}>
        <fieldset disabled={lock} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
          {ajudaTitulo && <p className="m-0 text-[13px] text-ink-2">{ajudaTitulo}</p>}
          {motivoLeitura === 'fechado' && <Notice tone="info">Este plano já valeu para um mês fechado e não pode mudar. Para alterar, crie uma versão nova com início no mês aberto.</Notice>}
          {motivoLeitura === 'permissao' && <Notice tone="info">Você pode consultar este plano. Quem altera é o analista ou o administrador.</Notice>}
          <h3 className="m-0 text-[15px] font-semibold text-ink">Dados do plano</h3>
          <div className="flex flex-wrap gap-6">
            <Rotulado rotulo="Nome do plano">
              <input ref={nome} className={`${CAMPO} w-[280px]`} maxLength={80} value={form.nome} onChange={(e) => mudar({ nome: e.target.value })} data-testid="plano-rv.nome" />
            </Rotulado>
            <Rotulado rotulo="Vale a partir de" ajuda="Vale até o mês anterior ao início do próximo plano.">
              <input type="month" className={`${CAMPO} w-[180px]`} value={form.vigencia_inicio} onChange={(e) => mudar({ vigencia_inicio: e.target.value })} data-testid="plano-rv.vigencia" />
            </Rotulado>
            <Rotulado rotulo="Valor da RV com 100% em tudo (R$)" ajuda="Cada indicador paga a parte do seu peso. Faixas acima de 100% pagam mais que este valor.">
              <input className={`${CAMPO} w-[180px] text-right`} inputMode="decimal" placeholder="2.000,00" value={form.valor_maximo} onChange={(e) => mudar({ valor_maximo: e.target.value.replace(/[^\d,.]/g, '') })} data-testid="plano-rv.valor" />
            </Rotulado>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <span className="text-[14px] font-semibold text-ink">Vale para</span>
            {(['vendedor', 'promotor'] as const).map((p) => (
              <label key={p} className="flex min-h-[44px] items-center gap-2 text-[14px] text-ink">
                <input type="checkbox" className="h-5 w-5" checked={form.perfis[p]} onChange={(e) => mudar({ perfis: { ...form.perfis, [p]: e.target.checked } })} data-testid={`plano-rv.perfil.${p}`} />
                {ROTULO_PERFIL_RV[p]}
              </label>
            ))}
          </div>
          <h3 className="m-0 text-[15px] font-semibold text-ink">Indicadores, pesos e faixas</h3>
          <div className="flex flex-col gap-3">
            {INDICADORES_META.map((ind) => {
              const regra = form.regras.find((r) => r.indicador === ind)!;
              return <RegraEditor key={ind} regra={regra} onChange={(r) => mudar({ regras: form.regras.map((x) => (x.indicador === ind ? r : x)) })} />;
            })}
          </div>
          <p className={`m-0 text-[14px] font-semibold ${somaDosPesos(form) === 100 ? 'text-ink' : 'text-danger'}`} data-testid="plano-rv.pesos" role="status">
            {textoDosPesos(form)}
          </p>
          {mensagens.length > 0 && (
            <div ref={aviso} tabIndex={-1} className="outline-none" data-testid="plano-rv.erros">
              <Notice tone="danger">
                {mensagens.length === 1 ? (
                  mensagens[0]
                ) : (
                  <ul className="m-0 list-disc pl-4">
                    {mensagens.map((m) => (
                      <li key={m}>{m}</li>
                    ))}
                  </ul>
                )}
              </Notice>
            </div>
          )}
        </fieldset>
        <div className="mt-4 flex flex-wrap gap-3">
          {!lock && (
            <Button variant="primary" onClick={salvar} disabled={salvando} style={{ minHeight: 44 }} data-testid="plano-rv.salvar">
              {salvando ? 'Salvando…' : 'Salvar plano'}
            </Button>
          )}
          <Button onClick={aoCancelar} style={{ minHeight: 44 }} data-testid="plano-rv.cancelar">
            {lock ? 'Fechar' : 'Cancelar'}
          </Button>
        </div>
      </Panel>
      <Simulador corpo={validacao.ok ? validacao.corpo : null} motivo={validacao.ok ? null : (validacao.erros[0] ?? null)} ating={ating} setAting={setAting} />
    </div>
  );
}
