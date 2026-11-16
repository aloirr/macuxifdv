'use client';

/**
 * Parâmetros › Alertas no BKO (T-0180; `alerta_regra.gerenciar`: analista e admin; a proteção real é na API). Duas seções:
 * "Alertas da equipe" (uma regra por cartão, só os campos que ela usa, com a unidade dentro do campo e o padrão preenchido) e
 * "Produtividade do dia" (almoço, parado, sem check-in, rota, visita aberta, envio pendente e o teto de lembretes). Cada
 * cartão salva sozinho (Salvar ativo só no alterado). Regra desligada: valores à vista, só leitura com fundo Pérola, com o
 * "Desligada" escrito pelo interruptor (exceção D1: o "Parado" de `inicio.parado_min` continua editável). Sem o Promotor, as 3
 * regras de trade somem (RN-CORE-03). Formato, faixas e padrões são os do contrato do Core; regras e validações vêm do domain
 * (`campos-regra`, `produtividade-do-dia`); a API revalida.
 */
import { useState, type ReactNode } from 'react';
import { CHAVES_REGRA_PRODUTIVIDADE, NOME_REGRA_PRODUTIVIDADE, textoDoMinuto, type ChaveRegraProdutividade, type ParametrosAlertasProdutividade } from '@macuxi/core/contracts';
import { Button, CLASSE_CAMPO_BASE, ErrorBlock, Interruptor, LoadingBlock, Notice, PageHeader, Panel, cx, type NoticeTone } from '@macuxi/ui/web';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { ROTULO_SEVERIDADE, SEVERIDADES, type ParametrosAlertasEquipe, type RegraAlerta, type Severidade, type TipoRegraEquipe } from '../../contracts';
import {
  CAMPOS_PRODUTIVIDADE,
  CAMPOS_REGRA,
  FRASE_PRODUTIVIDADE,
  FRASE_REGRA,
  montarSalvamento,
  montarSalvamentoProdutividade,
  montarSalvamentoTeto,
  REGRAS_COM_DESTINOS,
  regrasVisiveis,
} from '../../domain';
import { TIPO_ALERTA_ROTULO } from '../../app/lib/apresentacao';
import { useAjustarRegra, useRegras } from '../lib/queries';
import {
  useGravarParadoMin,
  useGravarParametrosAlertasEquipe,
  useGravarParametrosProdutividade,
  useModulosAtivos,
  useParadoMin,
  useParametrosAlertasEquipe,
  useParametrosProdutividade,
} from '../lib/parametros-alertas';

const SELECT = cx(CLASSE_CAMPO_BASE, 'h-[44px] w-full px-3 text-[15px] disabled:border-line disabled:bg-ground disabled:text-ink disabled:opacity-100');
const numero = (s: string): number | null => (s.trim() === '' || Number.isNaN(Number(s.replace(',', '.'))) ? null : Number(s.replace(',', '.')));

interface Aviso {
  tom: NoticeTone;
  texto: string;
}

/** Campo com rótulo em cima, a unidade escrita DENTRO da caixa (à direita do número) e o erro embaixo. Só leitura: fundo Pérola. */
function CampoValor({ id, rotulo, unidade, valor, aoMudar, somenteLeitura, erro, alterado, tipo = 'numero', testId }: { id: string; rotulo: string; unidade: string; valor: string; aoMudar: (v: string) => void; somenteLeitura: boolean; erro?: string; alterado: boolean; tipo?: 'numero' | 'hora'; testId: string }) {
  return (
    <div className="flex min-w-[150px] flex-1 flex-col gap-1">
      <label className="text-[15px] font-semibold text-ink" htmlFor={id}>
        {rotulo}
      </label>
      <div
        data-leitura={somenteLeitura}
        className={cx(
          CLASSE_CAMPO_BASE,
          'flex h-[44px] w-full items-center gap-2 px-3 text-[15px] focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent data-[leitura=true]:border-line data-[leitura=true]:bg-ground',
          alterado && 'border-2 border-accent',
          erro && 'border-danger',
        )}
      >
        <input
          id={id}
          className="min-w-0 flex-1 bg-transparent text-[15px] font-normal text-ink outline-none"
          inputMode={tipo === 'hora' ? 'text' : 'numeric'}
          placeholder={tipo === 'hora' ? 'HH:MM' : undefined}
          value={valor}
          readOnly={somenteLeitura}
          aria-invalid={erro ? true : undefined}
          onChange={(e) => aoMudar(e.target.value)}
          data-testid={testId}
        />
        {unidade ? <span className="shrink-0 text-[13px] font-normal text-ink-2">{unidade}</span> : null}
      </div>
      {erro ? (
        <span className="text-[12px] font-normal text-danger" data-testid={`${testId}.erro`}>
          {erro}
        </span>
      ) : null}
    </div>
  );
}

/** Casca do cartão de uma regra: interruptor (com "Desligada" escrito por ele), nome, frase, campos e Salvar. */
function CartaoRegra({ id, nome, frase, ativa, aoLigar, alterado, salvando, aoSalvar, children }: { id: string; nome: string; frase: string; ativa: boolean; aoLigar: (v: boolean) => void; alterado: boolean; salvando: boolean; aoSalvar: () => void; children: ReactNode }) {
  return (
    <li className={cx('flex flex-col gap-3 rounded-xl border p-4', alterado ? 'border-2 border-accent' : 'border-line-2', !ativa && 'bg-ground')} data-testid={`gestor.parametros-alertas.${id}`} data-estado={alterado ? 'alterada' : 'salva'}>
      <div className="flex flex-wrap items-center gap-3">
        <Interruptor ligado={ativa} onChange={aoLigar} rotulo={`Ligar ${nome}`} estadoEscrito="so-desligada" testId={`gestor.parametros-alertas.${id}.ligar`} />
        <div className="flex min-w-[200px] flex-1 flex-col">
          <span className="text-[15px] font-semibold text-ink">{nome}</span>
          <span className="text-[13px] text-ink-2">{frase}</span>
        </div>
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
        <label className="flex min-w-[150px] flex-1 flex-col gap-1 text-[15px] font-semibold text-ink">
          <span>Severidade</span>
          <select className={SELECT} value={e.severidade} disabled={!e.ativa} onChange={(ev) => setE({ ...e, severidade: ev.target.value as Severidade })} data-testid={`gestor.parametros-alertas.${tipo}.severidade`}>
            {SEVERIDADES.map((s) => (
              <option key={s} value={s}>
                {ROTULO_SEVERIDADE[s]}
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

function CartaoProdutividade({ chave, parametros, paradoMin, aoSalvar }: { chave: ChaveRegraProdutividade; parametros: ParametrosAlertasProdutividade; paradoMin: number; aoSalvar: (r: ReturnType<typeof montarSalvamentoProdutividade>) => Promise<void> }) {
  const regra = parametros[chave] as Record<string, unknown>;
  const inicial: EstadoProd = {
    ativa: regra.ativa === true,
    vendedor: regra.vendedor !== false,
    gestor: regra.gestor !== false,
    valores: Object.fromEntries(CAMPOS_PRODUTIVIDADE[chave].map((c) => [c.id, c.origem === 'core_parado_min' ? String(paradoMin) : c.tipo === 'hora' ? textoDoMinuto(Number(regra[c.id])) : String(regra[c.id])])),
  };
  const [e, setE] = useState<EstadoProd>(inicial);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const alterado = JSON.stringify(e) !== JSON.stringify(inicial);
  const comDestinos = REGRAS_COM_DESTINOS.has(chave);
  const salvar = async () => {
    const r = montarSalvamentoProdutividade(chave, { ativa: e.ativa, destinos: comDestinos ? { vendedor: e.vendedor, gestor: e.gestor } : {}, valores: Object.fromEntries(CAMPOS_PRODUTIVIDADE[chave].map((c) => [c.id, c.tipo === 'hora' ? (e.valores[c.id] ?? '') : numero(e.valores[c.id] ?? '')])) }, { parametros, paradoMin });
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
    <CartaoRegra id={chave} nome={NOME_REGRA_PRODUTIVIDADE[chave]} frase={FRASE_PRODUTIVIDADE[chave]} ativa={e.ativa} aoLigar={(v) => setE({ ...e, ativa: v })} alterado={alterado} salvando={salvando} aoSalvar={() => void salvar()}>
      <div className="flex flex-wrap items-end gap-3">
        {/* Destinos em duas colunas só onde há dois; nas outras o espaço fica vazio e os campos alinham na mesma coluna */}
        {comDestinos ? (
          <div className="flex w-[300px] shrink-0 gap-3" role="group" aria-label={`Quem recebe: ${NOME_REGRA_PRODUTIVIDADE[chave]}`}>
            {(['vendedor', 'gestor'] as const).map((d) => (
              <div key={d} className="flex flex-1 flex-col gap-1">
                <span className="text-[15px] font-semibold text-ink">{d === 'vendedor' ? 'Vendedor' : 'Gestor'}</span>
                <Interruptor ligado={e[d]} onChange={(v) => setE({ ...e, [d]: v })} rotulo={`${d === 'vendedor' ? 'Vendedor' : 'Gestor'} recebe: ${NOME_REGRA_PRODUTIVIDADE[chave]}`} desabilitado={!e.ativa} testId={`gestor.parametros-alertas.${chave}.destino-${d}`} />
              </div>
            ))}
          </div>
        ) : (
          <div className="hidden w-[300px] shrink-0 lg:block" aria-hidden="true" />
        )}
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
  const parado = useParadoMin();
  const gravarProd = useGravarParametrosProdutividade();
  const gravarParado = useGravarParadoMin();
  const q = prod.isError ? prod : parado;
  const gravar = async (alvo: string, r: { ok: boolean; parametros?: ParametrosAlertasProdutividade | null; paradoMin?: number | null }) => {
    if (!r.ok) return;
    try {
      if (r.parametros) await gravarProd.mutateAsync(r.parametros);
      if (r.paradoMin != null) await gravarParado.mutateAsync(r.paradoMin);
      aviso({ tom: 'success', texto: `"${alvo}" salvo.` });
    } catch (e) {
      aviso({ tom: 'danger', texto: errorMessage(e) });
    }
  };
  return (
    <Panel title="Produtividade do dia" label="Produtividade do dia">
      {prod.isLoading || parado.isLoading ? <LoadingBlock label="Carregando a produtividade do dia…" /> : null}
      {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void Promise.all([prod.refetch(), parado.refetch()])} /> : null}
      {prod.data && parado.data !== undefined ? (
        <>
          <CartaoTeto key={prod.data.teto_lembretes_dia} parametros={prod.data} aoSalvar={(r) => gravar('Lembretes por pessoa', r)} />
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {CHAVES_REGRA_PRODUTIVIDADE.map((chave) => (
              <CartaoProdutividade key={`${chave}:${JSON.stringify(prod.data[chave])}:${parado.data}`} chave={chave} parametros={prod.data} paradoMin={parado.data} aoSalvar={(r) => gravar(NOME_REGRA_PRODUTIVIDADE[chave], r)} />
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
      <PageHeader eyebrow="Parâmetros" title="Alertas" />
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
