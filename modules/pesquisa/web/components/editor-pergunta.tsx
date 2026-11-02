'use client';

/**
 * Editor de uma pergunta no construtor do BKO (RF-PES-01): enunciado, tipo, obrigatória, configuração do tipo e as
 * regras "mostrar/ocultar se…" que olham para perguntas ANTERIORES. Só edita o estado da tela; quem valida é o domain.
 */
import { Button, cx } from '@macuxi/ui/web';
import { TIPOS_PERGUNTA, type Operador, type Pergunta, type RegraCondicional, type TipoPergunta } from '../../contracts';
import { adicionarOpcao, ajustarRegra, alterarOpcao, mudarTipo, novaRegra, operadoresPara, removerOpcao, ROTULO_OPERADOR, ROTULO_TIPO } from '../lib/construtor';

const campo = 'h-[38px] rounded-[10px] border border-field px-3 text-[14px] text-ink disabled:bg-ground';
const rotulo = 'flex flex-col gap-1 text-[12px] font-semibold text-ink-2';

const numOuNada = (s: string): number | undefined => {
  if (s.trim() === '') return undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
};

/** Troca um campo numérico opcional (vazio apaga a chave). */
function comNumero<T extends object>(obj: T, chave: string, valor: string): T {
  const n = numOuNada(valor);
  const novo = { ...obj } as Record<string, unknown>;
  if (n === undefined) delete novo[chave];
  else novo[chave] = n;
  return novo as T;
}

export interface PropsEditor {
  pergunta: Pergunta;
  indice: number;
  perguntas: readonly Pergunta[];
  regras: readonly RegraCondicional[];
  somenteLeitura: boolean;
  problemas: readonly string[];
  novoId: () => string;
  onChange: (p: Pergunta, regras?: RegraCondicional[]) => void;
  onRegras: (regras: RegraCondicional[]) => void;
  onMover: (delta: -1 | 1) => void;
  onRemover: () => void;
}

function ValorDaRegra({ origem, regra, disabled, onChange }: { origem: Pergunta | undefined; regra: RegraCondicional; disabled: boolean; onChange: (v: RegraCondicional['valor']) => void }) {
  if (!origem || regra.operador === 'respondida' || regra.operador === 'nao_respondida') return null;
  if (origem.tipo === 'sim_nao')
    return (
      <select className={campo} disabled={disabled} value={String(regra.valor)} onChange={(e) => onChange(e.target.value === 'true')} aria-label="Valor">
        <option value="true">Sim</option>
        <option value="false">Não</option>
      </select>
    );
  if (origem.tipo === 'unica' || origem.tipo === 'multipla')
    return (
      <select className={campo} disabled={disabled} value={String(regra.valor ?? '')} onChange={(e) => onChange(e.target.value)} aria-label="Opção">
        {origem.opcoes.map((o) => (
          <option key={o.id} value={o.id}>
            {o.rotulo}
          </option>
        ))}
      </select>
    );
  if (origem.tipo === 'numero' || origem.tipo === 'escala') return <input className={cx(campo, 'w-[110px]')} disabled={disabled} type="number" value={String(regra.valor ?? '')} onChange={(e) => onChange(numOuNada(e.target.value) ?? 0)} aria-label="Valor" />;
  if (origem.tipo === 'data') return <input className={campo} disabled={disabled} type="date" value={String(regra.valor ?? '')} onChange={(e) => onChange(e.target.value)} aria-label="Data" />;
  return <input className={campo} disabled={disabled} value={String(regra.valor ?? '')} onChange={(e) => onChange(e.target.value)} aria-label="Valor" />;
}

export function EditorPergunta({ pergunta: p, indice, perguntas, regras, somenteLeitura: ro, problemas, novoId, onChange, onRegras, onMover, onRemover }: PropsEditor) {
  const anteriores = perguntas.slice(0, indice);
  const minhas = regras.filter((r) => r.pergunta_id === p.id);
  const trocarRegra = (id: string, r: RegraCondicional) => onRegras(regras.map((x) => (x.id === id ? r : x)));

  return (
    <div className={cx('flex flex-col gap-3 rounded-2xl border bg-surface p-4', problemas.length ? 'border-danger' : 'border-line')} data-testid={`construtor.pergunta-${indice + 1}`}>
      <div className="flex flex-wrap items-end gap-3">
        <span className="pb-2 text-[13px] font-bold text-ink-3">{indice + 1}.</span>
        <label className={cx(rotulo, 'min-w-[280px] flex-1')}>
          Enunciado
          <input className={campo} disabled={ro} value={p.enunciado} maxLength={500} onChange={(e) => onChange({ ...p, enunciado: e.target.value })} data-testid={`construtor.pergunta-${indice + 1}.enunciado`} />
        </label>
        <label className={rotulo}>
          Tipo
          <select className={campo} disabled={ro} value={p.tipo} onChange={(e) => onChange(mudarTipo(p, e.target.value as TipoPergunta, novoId), regras.filter((r) => r.origem_id !== p.id))} data-testid={`construtor.pergunta-${indice + 1}.tipo`}>
            {TIPOS_PERGUNTA.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="flex h-[38px] items-center gap-2 text-[13px] font-semibold text-ink-2">
          <input type="checkbox" disabled={ro} checked={p.obrigatoria} onChange={(e) => onChange({ ...p, obrigatoria: e.target.checked })} />
          Obrigatória
        </label>
        {!ro ? (
          <div className="flex gap-1">
            <Button size="sm" onClick={() => onMover(-1)} disabled={indice === 0} aria-label="Subir pergunta">
              ↑
            </Button>
            <Button size="sm" onClick={() => onMover(1)} disabled={indice === perguntas.length - 1} aria-label="Descer pergunta">
              ↓
            </Button>
            <Button size="sm" variant="link" onClick={onRemover}>
              Remover
            </Button>
          </div>
        ) : null}
      </div>

      <label className={rotulo}>
        Ajuda (opcional)
        <input className={campo} disabled={ro} value={p.ajuda ?? ''} maxLength={500} onChange={(e) => onChange(e.target.value ? { ...p, ajuda: e.target.value } : (({ ajuda: _a, ...resto }) => resto as Pergunta)(p))} />
      </label>

      {p.tipo === 'unica' || p.tipo === 'multipla' ? (
        <div className="flex flex-col gap-2">
          {p.opcoes.map((o, i) => (
            <div key={o.id} className="flex items-center gap-2">
              <input className={cx(campo, 'flex-1')} disabled={ro} value={o.rotulo} maxLength={200} onChange={(e) => onChange(alterarOpcao(p, o.id, e.target.value))} aria-label={`Opção ${i + 1}`} />
              {!ro ? (
                <Button
                  size="sm"
                  variant="link"
                  onClick={() => {
                    const r = removerOpcao(p, regras, o.id);
                    onChange(r.pergunta, r.regras);
                  }}>
                  Remover
                </Button>
              ) : null}
            </div>
          ))}
          {!ro ? (
            <Button size="sm" onClick={() => onChange(adicionarOpcao(p, novoId))} className="self-start">
              + Opção
            </Button>
          ) : null}
          {p.tipo === 'multipla' ? (
            <div className="flex gap-3">
              <label className={rotulo}>
                Mínimo de marcadas
                <input className={cx(campo, 'w-[110px]')} disabled={ro} type="number" min={1} value={p.min_selecoes ?? ''} onChange={(e) => onChange(comNumero(p, 'min_selecoes', e.target.value))} />
              </label>
              <label className={rotulo}>
                Máximo de marcadas
                <input className={cx(campo, 'w-[110px]')} disabled={ro} type="number" min={1} value={p.max_selecoes ?? ''} onChange={(e) => onChange(comNumero(p, 'max_selecoes', e.target.value))} />
              </label>
            </div>
          ) : null}
        </div>
      ) : null}

      {p.tipo === 'numero' ? (
        <div className="flex flex-wrap gap-3">
          <label className={rotulo}>
            Mínimo
            <input className={cx(campo, 'w-[110px]')} disabled={ro} type="number" value={p.minimo ?? ''} onChange={(e) => onChange(comNumero(p, 'minimo', e.target.value))} />
          </label>
          <label className={rotulo}>
            Máximo
            <input className={cx(campo, 'w-[110px]')} disabled={ro} type="number" value={p.maximo ?? ''} onChange={(e) => onChange(comNumero(p, 'maximo', e.target.value))} />
          </label>
          <label className={rotulo}>
            Unidade
            <input className={cx(campo, 'w-[110px]')} disabled={ro} value={p.unidade ?? ''} maxLength={20} onChange={(e) => onChange(e.target.value ? { ...p, unidade: e.target.value } : (({ unidade: _u, ...r }) => r as Pergunta)(p))} />
          </label>
          <label className="flex h-[38px] items-center gap-2 self-end text-[13px] font-semibold text-ink-2">
            <input type="checkbox" disabled={ro} checked={p.inteiro} onChange={(e) => onChange({ ...p, inteiro: e.target.checked })} />
            Só inteiro
          </label>
        </div>
      ) : null}

      {p.tipo === 'texto' ? (
        <label className={rotulo}>
          Máximo de caracteres (vazio = limite da empresa)
          <input className={cx(campo, 'w-[160px]')} disabled={ro} type="number" min={1} value={p.max_caracteres ?? ''} onChange={(e) => onChange(comNumero(p, 'max_caracteres', e.target.value))} />
        </label>
      ) : null}

      {p.tipo === 'escala' ? (
        <div className="flex flex-wrap gap-3">
          <label className={rotulo}>
            De
            <input className={cx(campo, 'w-[90px]')} disabled={ro} type="number" value={p.minimo} onChange={(e) => onChange({ ...p, minimo: Math.trunc(numOuNada(e.target.value) ?? 1) })} />
          </label>
          <label className={rotulo}>
            Até
            <input className={cx(campo, 'w-[90px]')} disabled={ro} type="number" value={p.maximo} onChange={(e) => onChange({ ...p, maximo: Math.trunc(numOuNada(e.target.value) ?? 5) })} />
          </label>
          <label className={rotulo}>
            Rótulo do início
            <input className={campo} disabled={ro} value={p.rotulo_minimo ?? ''} maxLength={200} onChange={(e) => onChange(e.target.value ? { ...p, rotulo_minimo: e.target.value } : (({ rotulo_minimo: _x, ...r }) => r as Pergunta)(p))} />
          </label>
          <label className={rotulo}>
            Rótulo do fim
            <input className={campo} disabled={ro} value={p.rotulo_maximo ?? ''} maxLength={200} onChange={(e) => onChange(e.target.value ? { ...p, rotulo_maximo: e.target.value } : (({ rotulo_maximo: _x, ...r }) => r as Pergunta)(p))} />
          </label>
        </div>
      ) : null}

      {p.tipo === 'data' ? (
        <div className="flex gap-3">
          <label className={rotulo}>
            Data mínima
            <input className={campo} disabled={ro} type="date" value={p.minima ?? ''} onChange={(e) => onChange(e.target.value ? { ...p, minima: e.target.value } : (({ minima: _x, ...r }) => r as Pergunta)(p))} />
          </label>
          <label className={rotulo}>
            Data máxima
            <input className={campo} disabled={ro} type="date" value={p.maxima ?? ''} onChange={(e) => onChange(e.target.value ? { ...p, maxima: e.target.value } : (({ maxima: _x, ...r }) => r as Pergunta)(p))} />
          </label>
        </div>
      ) : null}

      {p.tipo === 'foto' ? (
        <div className="flex gap-3">
          <label className={rotulo}>
            Mínimo de fotos
            <input className={cx(campo, 'w-[110px]')} disabled={ro} type="number" min={1} value={p.min_fotos} onChange={(e) => onChange({ ...p, min_fotos: Math.max(1, Math.trunc(numOuNada(e.target.value) ?? 1)) })} />
          </label>
          <label className={rotulo}>
            Máximo de fotos
            <input className={cx(campo, 'w-[110px]')} disabled={ro} type="number" min={1} value={p.max_fotos} onChange={(e) => onChange({ ...p, max_fotos: Math.max(1, Math.trunc(numOuNada(e.target.value) ?? 1)) })} />
          </label>
        </div>
      ) : null}

      {/* RF-PES-01 / RN-PES-05: "mostrar" em OU; "ocultar" vence */}
      {anteriores.length > 0 && (minhas.length > 0 || !ro) ? (
        <div className="flex flex-col gap-2 rounded-xl bg-ground p-3">
          <span className="text-[12px] font-semibold text-ink-2">Lógica condicional</span>
          {minhas.map((r) => {
            const origem = anteriores.find((x) => x.id === r.origem_id);
            return (
              <div key={r.id} className="flex flex-wrap items-center gap-2 text-[13px]">
                <select className={campo} disabled={ro} value={r.acao} onChange={(e) => trocarRegra(r.id, ajustarRegra(r, perguntas, { acao: e.target.value as RegraCondicional['acao'] }))} aria-label="Ação">
                  <option value="mostrar">Mostrar esta pergunta</option>
                  <option value="ocultar">Ocultar esta pergunta</option>
                </select>
                <span>se</span>
                <select className={campo} disabled={ro} value={r.origem_id} onChange={(e) => trocarRegra(r.id, ajustarRegra(r, perguntas, { origem_id: e.target.value }))} aria-label="Pergunta de origem">
                  {anteriores.map((a, i) => (
                    <option key={a.id} value={a.id}>
                      {i + 1}. {a.enunciado.slice(0, 40)}
                    </option>
                  ))}
                </select>
                <select className={campo} disabled={ro} value={r.operador} onChange={(e) => trocarRegra(r.id, ajustarRegra(r, perguntas, { operador: e.target.value as Operador }))} aria-label="Operador">
                  {(origem ? operadoresPara(origem.tipo) : [r.operador]).map((o) => (
                    <option key={o} value={o}>
                      {ROTULO_OPERADOR[o]}
                    </option>
                  ))}
                </select>
                <ValorDaRegra origem={origem} regra={r} disabled={ro} onChange={(valor) => trocarRegra(r.id, { ...r, ...(valor === undefined ? {} : { valor }) })} />
                {!ro ? (
                  <Button size="sm" variant="link" onClick={() => onRegras(regras.filter((x) => x.id !== r.id))}>
                    Remover regra
                  </Button>
                ) : null}
              </div>
            );
          })}
          {!ro ? (
            <Button
              size="sm"
              className="self-start"
              onClick={() => {
                const r = novaRegra(perguntas, p.id, novoId);
                if (r) onRegras([...regras, r]);
              }}>
              + Regra
            </Button>
          ) : null}
        </div>
      ) : null}

      {problemas.map((m) => (
        <p key={m} className="text-[13px] text-danger">
          {m}
        </p>
      ))}
    </div>
  );
}
