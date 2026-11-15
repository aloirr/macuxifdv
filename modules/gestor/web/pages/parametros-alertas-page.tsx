'use client';

/**
 * Parâmetros › Alertas no BKO (T-0180; `alerta_regra.gerenciar`: analista e admin; a proteção real é na API). Duas seções:
 * "Alertas da equipe" (uma regra por cartão, só os campos que ela usa, com unidade escrita e o padrão preenchido) e
 * "Produtividade do dia" (almoço, parado, sem check-in, rota, visita aberta, envio pendente e o teto de lembretes). Cada
 * cartão salva sozinho (Salvar ativo só no alterado). Regra desligada: valores à vista, só leitura, com o selo "Desligada"
 * (exceção D1: o "Parado" de `inicio.parado_min` continua editável). Sem o Promotor, as 3 regras de trade somem (RN-CORE-03).
 * Regras e validações vêm do domain (`campos-regra`, `produtividade-do-dia`); a API revalida.
 */
import { useState, type ReactNode } from 'react';
import { Interruptor } from '@macuxi/ui/web';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CLASSE_CAMPO_BASE, ErrorBlock, LoadingBlock, Notice, PageHeader, Panel, SeloSituacao, cx, type NoticeTone } from '@macuxi/ui/web';
import { SEVERIDADES, type ParametrosAlertasEquipe, type RegraAlerta, type Severidade } from '../../contracts';
import {
  CAMPOS_PRODUTIVIDADE,
  CAMPOS_REGRA,
  FRASE_PRODUTIVIDADE,
  FRASE_REGRA,
  montarSalvamento,
  montarSalvamentoProdutividade,
  montarSalvamentoTeto,
  NOME_PRODUTIVIDADE,
  PARADO_MIN_PADRAO_CORE,
  REGRAS_COM_DESTINOS,
  REGRAS_PRODUTIVIDADE,
  regrasVisiveis,
  type ParametrosAlertasProdutividade,
  type RegraProdutividade,
  type TipoRegraEquipe,
} from '../../domain';
import { TIPO_ALERTA_ROTULO } from '../../app/lib/apresentacao';
import { useAjustarRegra, useRegras } from '../lib/queries';
import {
  useGravarParadoMin,
  useGravarParametrosAlertasEquipe,
  useGravarParametrosProdutividade,
  useModulosAtivos,
  useParametrosAlertasEquipe,
  useParametrosInicio,
  useParametrosProdutividade,
} from '../lib/parametros-alertas';

const SEV: Record<Severidade, string> = { info: 'Informativo', atencao: 'Atenção', critica: 'Crítico' };
const CAMPO = cx(CLASSE_CAMPO_BASE, 'h-[44px] w-full px-3 text-[14px] read-only:border-line read-only:bg-ground aria-[invalid=true]:border-danger');
const numero = (s: string): number | null => (s.trim() === '' ? null : Number(s.replace(',', '.')));

interface Aviso {
  tom: NoticeTone;
  texto: string;
}

/** Campo com rótulo, unidade escrita ao lado do valor e erro embaixo. */
function CampoValor({ id, rotulo, unidade, valor, aoMudar, somenteLeitura, erro, alterado, tipo = 'numero', testId }: { id: string; rotulo: string; unidade: string; valor: string; aoMudar: (v: string) => void; somenteLeitura: boolean; erro?: string; alterado: boolean; tipo?: 'numero' | 'hora'; testId: string }) {
  return (
    <label className="flex min-w-[150px] flex-1 flex-col gap-1 text-[13px] font-semibold text-ink" htmlFor={id}>
      <span>{rotulo}</span>
      <span className="flex items-center gap-2">
        <input
          id={id}
          className={cx(CAMPO, alterado && 'border-2 border-accent')}
          inputMode={tipo === 'hora' ? 'text' : 'numeric'}
          placeholder={tipo === 'hora' ? 'HH:MM' : undefined}
          value={valor}
          readOnly={somenteLeitura}
          aria-invalid={erro ? true : undefined}
          onChange={(e) => aoMudar(e.target.value)}
          data-testid={testId}
        />
        {unidade ? <span className="shrink-0 text-[13px] font-normal text-ink-2">{unidade}</span> : null}
      </span>
      {erro ? (
        <span className="text-[12px] font-normal text-danger" data-testid={`${testId}.erro`}>
          {erro}
        </span>
      ) : null}
    </label>
  );
}

/** Casca do cartão de uma regra: interruptor, nome, frase, selo "Desligada", campos e Salvar. */
function CartaoRegra({ id, nome, frase, ativa, aoLigar, alterado, salvando, aoSalvar, children, bloqueado }: { id: string; nome: string; frase: string; ativa: boolean; aoLigar: (v: boolean) => void; alterado: boolean; salvando: boolean; aoSalvar: () => void; children: ReactNode; bloqueado?: boolean }) {
  return (
    <li className={cx('flex flex-col gap-3 rounded-xl border p-4', alterado ? 'border-2 border-accent' : 'border-line-2', !ativa && 'bg-ground')} data-testid={`gestor.parametros-alertas.${id}`} data-estado={alterado ? 'alterada' : 'salva'}>
      <div className="flex flex-wrap items-center gap-3">
        <Interruptor ligado={ativa} onChange={aoLigar} rotulo={`Ligar ${nome}`} desabilitado={bloqueado} testId={`gestor.parametros-alertas.${id}.ligar`} />
        <div className="flex min-w-[200px] flex-1 flex-col">
          <span className="text-[15px] font-semibold text-ink">{nome}</span>
          <span className="text-[13px] text-ink-2">{frase}</span>
        </div>
        {!ativa ? <SeloSituacao selos={[{ tom: 'neutral', texto: 'Desligada' }]} /> : null}
        <Button variant="primary" size="sm" disabled={!alterado || salvando} onClick={aoSalvar} data-testid={`gestor.parametros-alertas.${id}.salvar`}>
          Salvar
        </Button>
      </div>
      {children}
    </li>
  );
}

/* ---------- Alertas da equipe ---------- */

interface EstadoEquipe {
  ativa: boolean;
  severidade: Severidade;
  valores: Record<string, string>;
}
const valoresDe = (tipo: TipoRegraEquipe, regra: RegraAlerta, p: ParametrosAlertasEquipe): Record<string, string> =>
  Object.fromEntries(CAMPOS_REGRA[tipo].map((c) => [c.id, String(c.origem.tipo === 'parametro' ? p[c.origem.chave] : (regra[c.origem.campo] ?? c.padrao))]));

function CartaoEquipe({ tipo, regra, parametros, aoSalvar }: { tipo: TipoRegraEquipe; regra: RegraAlerta; parametros: ParametrosAlertasEquipe; aoSalvar: (r: ReturnType<typeof montarSalvamento>) => Promise<void> }) {
  const inicial: EstadoEquipe = { ativa: regra.ativa, severidade: regra.severidade, valores: valoresDe(tipo, regra, parametros) };
  const [e, setE] = useState<EstadoEquipe>(inicial);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const alterado = JSON.stringify(e) !== JSON.stringify(inicial);
  const salvar = async () => {
    const r = montarSalvamento(tipo, { ativa: e.ativa, severidade: e.severidade, valores: Object.fromEntries(Object.entries(e.valores).map(([k, v]) => [k, numero(v)])) }, { regra, parametros });
    if (!r.ok) return setErros(r.erros);
    setErros({});
    setSalvando(true);
    try {
      await aoSalvar(r);
    } finally {
      setSalvando(false);
    }
  };
  return (
    <CartaoRegra id={tipo} nome={TIPO_ALERTA_ROTULO[tipo]} frase={FRASE_REGRA[tipo]} ativa={e.ativa} aoLigar={(v) => setE({ ...e, ativa: v })} alterado={alterado} salvando={salvando} aoSalvar={() => void salvar()}>
      <div className="flex flex-wrap items-end gap-3">
        {CAMPOS_REGRA[tipo].map((c) => (
          <CampoValor key={c.id} id={`${tipo}-${c.id}`} rotulo={c.rotulo} unidade={c.unidade} valor={e.valores[c.id] ?? ''} aoMudar={(v) => setE({ ...e, valores: { ...e.valores, [c.id]: v } })} somenteLeitura={!e.ativa} erro={erros[c.id]} alterado={e.valores[c.id] !== inicial.valores[c.id]} testId={`gestor.parametros-alertas.${tipo}.${c.id}`} />
        ))}
        <label className="flex min-w-[150px] flex-col gap-1 text-[13px] font-semibold text-ink">
          <span>Severidade</span>
          <select className={CAMPO} value={e.severidade} disabled={!e.ativa} onChange={(ev) => setE({ ...e, severidade: ev.target.value as Severidade })} data-testid={`gestor.parametros-alertas.${tipo}.severidade`}>
            {SEVERIDADES.map((s) => (
              <option key={s} value={s}>
                {SEV[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
    </CartaoRegra>
  );
}

function SecaoEquipe({ modulos, aviso }: { modulos: ReadonlySet<string>; aviso: (a: Aviso) => void }) {
  const regras = useRegras(true);
  const params = useParametrosAlertasEquipe();
  const ajustar = useAjustarRegra();
  const gravar = useGravarParametrosAlertasEquipe();
  const q = regras.isError ? regras : params;
  const salvar = (tipo: TipoRegraEquipe) => async (r: ReturnType<typeof montarSalvamento>) => {
    if (!r.ok) return;
    try {
      if (r.ajusteRegra) await ajustar.mutateAsync({ tipo, ajuste: r.ajusteRegra });
      if (r.parametros) await gravar.mutateAsync(r.parametros);
      aviso({ tom: 'success', texto: `Regra "${TIPO_ALERTA_ROTULO[tipo]}" salva.` });
    } catch (e) {
      aviso({ tom: 'danger', texto: errorMessage(e) });
    }
  };
  return (
    <Panel title="Alertas da equipe" label="Alertas da equipe">
      {regras.isLoading || params.isLoading ? <LoadingBlock label="Carregando as regras…" /> : null}
      {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void Promise.all([regras.refetch(), params.refetch()])} /> : null}
      {regras.data && params.data ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {regrasVisiveis(modulos).map((tipo) => {
            const regra = regras.data.find((r) => r.tipo === tipo);
            if (!regra) return null;
            return <CartaoEquipe key={`${tipo}:${JSON.stringify(regra)}:${JSON.stringify(params.data)}`} tipo={tipo} regra={regra} parametros={params.data} aoSalvar={salvar(tipo)} />;
          })}
        </ul>
      ) : null}
    </Panel>
  );
}

/* ---------- Produtividade do dia ---------- */

interface EstadoProd {
  ativa: boolean;
  vendedor: boolean;
  gestor: boolean;
  valores: Record<string, string>;
}
const textoValor = (v: unknown): string => (v === undefined || v === null ? '' : String(v));

function CartaoProdutividade({ chave, parametros, paradoMin, aoSalvar }: { chave: RegraProdutividade; parametros: ParametrosAlertasProdutividade; paradoMin: number; aoSalvar: (r: ReturnType<typeof montarSalvamentoProdutividade>) => Promise<void> }) {
  const regra = parametros.regras[chave] as Record<string, unknown>;
  const inicial: EstadoProd = {
    ativa: regra.ativa === true,
    vendedor: regra.vendedor !== false,
    gestor: regra.gestor !== false,
    valores: Object.fromEntries(CAMPOS_PRODUTIVIDADE[chave].map((c) => [c.id, c.origem === 'core_parado_min' ? String(paradoMin) : textoValor(regra[c.id] ?? c.padrao)])),
  };
  const [e, setE] = useState<EstadoProd>(inicial);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const alterado = JSON.stringify(e) !== JSON.stringify(inicial);
  const comDestinos = REGRAS_COM_DESTINOS.has(chave);
  const salvar = async () => {
    const r = montarSalvamentoProdutividade(
      chave,
      { ativa: e.ativa, destinos: comDestinos ? { vendedor: e.vendedor, gestor: e.gestor } : {}, valores: Object.fromEntries(CAMPOS_PRODUTIVIDADE[chave].map((c) => [c.id, c.tipo === 'hora' ? (e.valores[c.id] ?? '') : numero(e.valores[c.id] ?? '')])) },
      { parametros, paradoMin },
    );
    if (!r.ok) return setErros(r.erros);
    setErros({});
    setSalvando(true);
    try {
      await aoSalvar(r);
    } finally {
      setSalvando(false);
    }
  };
  return (
    <CartaoRegra id={chave} nome={NOME_PRODUTIVIDADE[chave]} frase={FRASE_PRODUTIVIDADE[chave]} ativa={e.ativa} aoLigar={(v) => setE({ ...e, ativa: v })} alterado={alterado} salvando={salvando} aoSalvar={() => void salvar()}>
      {comDestinos ? (
        <div className="flex flex-wrap items-center gap-4" role="group" aria-label={`Destinos de ${NOME_PRODUTIVIDADE[chave]}`}>
          <span className="text-[13px] font-semibold text-ink">Destinos</span>
          {(['vendedor', 'gestor'] as const).map((d) => (
            <span key={d} className="inline-flex items-center gap-1 text-[13px] text-ink">
              {d === 'vendedor' ? 'Vendedor' : 'Gestor'}
              <Interruptor ligado={e[d]} onChange={(v) => setE({ ...e, [d]: v })} rotulo={`${d === 'vendedor' ? 'Vendedor' : 'Gestor'} recebe ${NOME_PRODUTIVIDADE[chave]}`} desabilitado={!e.ativa} testId={`gestor.parametros-alertas.${chave}.destino-${d}`} />
            </span>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-end gap-3">
        {CAMPOS_PRODUTIVIDADE[chave].map((c) => {
          // D1: o "parado" (inicio.parado_min) continua editável com a regra desligada; "alerta ao gestor" só com o destino Gestor ligado
          const somenteLeitura = c.origem === 'core_parado_min' ? false : !e.ativa || (c.id === 'gestor_depois_min' && !e.gestor);
          return (
            <CampoValor key={c.id} id={`${chave}-${c.id}`} rotulo={c.rotulo} unidade={c.unidade} tipo={c.tipo} valor={e.valores[c.id] ?? ''} aoMudar={(v) => setE({ ...e, valores: { ...e.valores, [c.id]: v } })} somenteLeitura={somenteLeitura} erro={erros[c.id]} alterado={e.valores[c.id] !== inicial.valores[c.id]} testId={`gestor.parametros-alertas.${chave}.${c.id}`} />
          );
        })}
      </div>
    </CartaoRegra>
  );
}

function CartaoTeto({ parametros, aoSalvar }: { parametros: ParametrosAlertasProdutividade; aoSalvar: (r: ReturnType<typeof montarSalvamentoTeto>) => Promise<void> }) {
  const inicial = String(parametros.teto_lembretes_dia);
  const [v, setV] = useState(inicial);
  const [erro, setErro] = useState<string | undefined>();
  const [salvando, setSalvando] = useState(false);
  const salvar = async () => {
    const r = montarSalvamentoTeto(numero(v), { parametros });
    if (!r.ok) return setErro(r.erros.teto);
    setErro(undefined);
    setSalvando(true);
    try {
      await aoSalvar(r);
    } finally {
      setSalvando(false);
    }
  };
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line-2 p-4" data-testid="gestor.parametros-alertas.teto">
      <CampoValor id="teto" rotulo="Lembretes por pessoa, no máximo" unidade="por dia" valor={v} aoMudar={setV} somenteLeitura={false} erro={erro} alterado={v !== inicial} testId="gestor.parametros-alertas.teto.valor" />
      <Button variant="primary" size="sm" disabled={v === inicial || salvando} onClick={() => void salvar()} data-testid="gestor.parametros-alertas.teto.salvar">
        Salvar
      </Button>
    </div>
  );
}

function SecaoProdutividade({ aviso }: { aviso: (a: Aviso) => void }) {
  const prod = useParametrosProdutividade();
  const inicio = useParametrosInicio();
  const gravarProd = useGravarParametrosProdutividade();
  const gravarParado = useGravarParadoMin();
  const q = prod.isError ? prod : inicio;
  const gravar = async (alvo: string, r: { ok: boolean; parametros?: ParametrosAlertasProdutividade | null; paradoMin?: number | null }) => {
    if (!r.ok) return;
    try {
      if (r.parametros) await gravarProd.mutateAsync(r.parametros);
      if (r.paradoMin != null && inicio.data) await gravarParado.mutateAsync({ atual: inicio.data, parado_min: r.paradoMin });
      aviso({ tom: 'success', texto: `"${alvo}" salvo.` });
    } catch (e) {
      aviso({ tom: 'danger', texto: errorMessage(e) });
    }
  };
  return (
    <Panel title="Produtividade do dia" label="Produtividade do dia">
      {prod.isLoading || inicio.isLoading ? <LoadingBlock label="Carregando a produtividade do dia…" /> : null}
      {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void Promise.all([prod.refetch(), inicio.refetch()])} /> : null}
      {prod.data && inicio.data ? (
        <>
          <CartaoTeto key={prod.data.teto_lembretes_dia} parametros={prod.data} aoSalvar={(r) => gravar('Lembretes por pessoa', r)} />
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {REGRAS_PRODUTIVIDADE.map((chave) => (
              <CartaoProdutividade key={`${chave}:${JSON.stringify(prod.data.regras[chave])}:${inicio.data.parado_min ?? PARADO_MIN_PADRAO_CORE}`} chave={chave} parametros={prod.data} paradoMin={inicio.data.parado_min} aoSalvar={(r) => gravar(NOME_PRODUTIVIDADE[chave], r)} />
            ))}
          </ul>
        </>
      ) : null}
    </Panel>
  );
}

export function ParametrosAlertasPage() {
  const modulos = useModulosAtivos();
  const [aviso, setAviso] = useState<Aviso | null>(null);
  return (
    <div className="flex flex-col gap-4" data-testid="gestor.parametros-alertas">
      <PageHeader title="Alertas" />
      {aviso ? (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          {aviso.texto}
        </Notice>
      ) : null}
      {modulos ? <SecaoEquipe modulos={modulos} aviso={setAviso} /> : <LoadingBlock label="Carregando…" />}
      <SecaoProdutividade aviso={setAviso} />
    </div>
  );
}
