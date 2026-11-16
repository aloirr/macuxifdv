'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Drawer, Notice } from '@macuxi/ui/web';
import type { EquipeOpcao } from '../../../contracts';
import { TAREFA_DESCRICAO_MAX, TAREFA_TITULO_MAX, TIPOS_TAREFA, type TipoTarefa } from '../../../contracts/tarefa';
import { novoId } from '../../lib/visitas';
import { CHAVE_QUESTIONARIOS, CHAVE_TAREFAS, type ApiTarefas, type ConsultorOpcao, type QuestionarioParaTarefa } from './api';
import { corpoDaTarefa, errosDaApi, formTarefaVazio, ROTULO_TIPO, type AlvoTarefa, type CampoTarefa, type ErrosTarefa, type FormTarefa } from './tarefas';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';

/** Folha "Nova tarefa" (§7.1). O `id` nasce ao abrir a folha: reenviar depois de uma falha não duplica a tarefa. */
export function NovaTarefa({
  cliente,
  hoje,
  consultores,
  equipes,
  onClose,
  onCriada,
}: {
  cliente: ApiTarefas;
  hoje: string;
  consultores: readonly ConsultorOpcao[];
  equipes: readonly EquipeOpcao[] | null;
  onClose: () => void;
  onCriada: (aviso: string) => void;
}) {
  const qc = useQueryClient();
  const id = useMemo(() => novoId(), []);
  const [form, setForm] = useState<FormTarefa>(() => formTarefaVazio(hoje));
  const [erros, setErros] = useState<ErrosTarefa>({});
  const [aviso, setAviso] = useState<string | null>(null);
  // sem o módulo Pesquisa a consulta falha e o tipo some (RN-CORE-03)
  const questionarios = useQuery({ queryKey: CHAVE_QUESTIONARIOS, queryFn: cliente.questionarios, retry: false });

  const criar = useMutation({
    mutationFn: cliente.criar,
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: CHAVE_TAREFAS });
      onCriada(r.destinatarios === 1 ? 'Tarefa criada para 1 pessoa.' : `Tarefa criada para ${r.destinatarios} pessoas.`);
    },
    onError: (e) => {
      const r = errosDaApi(e);
      setErros(r.campos);
      setAviso(r.aviso);
    },
  });

  const enviar = () => {
    const r = corpoDaTarefa(form, id, hoje);
    setAviso(null);
    if (!r.ok) return setErros(r.erros);
    setErros({});
    criar.mutate(r.corpo);
  };

  return (
    <Drawer open title="Nova tarefa" onClose={onClose}>
      <FormNovaTarefa
        form={form}
        erros={erros}
        aviso={aviso}
        hoje={hoje}
        consultores={consultores}
        equipes={equipes}
        questionarios={questionarios.data && questionarios.data.length > 0 ? questionarios.data : null}
        enviando={criar.isPending}
        onChange={(patch) => setForm((f) => ({ ...f, ...patch }))}
        onEnviar={enviar}
        onCancelar={onClose}
      />
    </Drawer>
  );
}

function Erro({ campo, erros }: { campo: CampoTarefa; erros: ErrosTarefa }) {
  const texto = erros[campo];
  return texto ? (
    <span id={`nova-tarefa.${campo}.erro`} className="text-[13px] font-normal text-danger" data-testid={`nova-tarefa.${campo}.erro`}>
      {texto}
    </span>
  ) : null;
}

const descrito = (campo: CampoTarefa, erros: ErrosTarefa) => (erros[campo] ? { 'aria-invalid': true, 'aria-describedby': `nova-tarefa.${campo}.erro` } : {});

const ALVOS: ReadonlyArray<readonly [AlvoTarefa, string]> = [
  ['usuarios', 'Pessoas'],
  ['equipe', 'Equipe'],
  ['todos', 'Todos'],
];

/** Formulário da nova tarefa, sem estado próprio além da busca de pessoas (renderizável no teste). */
export function FormNovaTarefa({
  form,
  erros,
  aviso,
  hoje,
  consultores,
  equipes,
  questionarios,
  enviando,
  onChange,
  onEnviar,
  onCancelar,
}: {
  form: FormTarefa;
  erros: ErrosTarefa;
  aviso: string | null;
  hoje: string;
  consultores: readonly ConsultorOpcao[];
  equipes: readonly EquipeOpcao[] | null;
  /** Nulo: sem a Pesquisa ou sem questionário publicado; o tipo Pesquisa não aparece. */
  questionarios: readonly QuestionarioParaTarefa[] | null;
  enviando: boolean;
  onChange: (patch: Partial<FormTarefa>) => void;
  onEnviar: () => void;
  onCancelar: () => void;
}) {
  const [busca, setBusca] = useState('');
  const tipos = TIPOS_TAREFA.filter((t) => t !== 'pesquisa' || questionarios);
  const alvos = ALVOS.filter(([a]) => a !== 'equipe' || equipes);
  const termo = busca.trim().toLowerCase();
  const visiveis = termo ? consultores.filter((c) => c.nome.toLowerCase().includes(termo)) : consultores;
  const marcar = (uid: string, sim: boolean) => onChange({ usuario_ids: sim ? [...form.usuario_ids, uid] : form.usuario_ids.filter((x) => x !== uid) });

  return (
    <form
      className="flex flex-col gap-4 text-[13px] font-semibold text-ink"
      data-testid="nova-tarefa.form"
      onSubmit={(e) => {
        e.preventDefault();
        onEnviar();
      }}
    >
      {aviso && <Notice tone="danger">{aviso}</Notice>}
      <label className="flex flex-col gap-1">
        Título
        <input value={form.titulo} maxLength={TAREFA_TITULO_MAX} onChange={(e) => onChange({ titulo: e.target.value })} className={CLASSE_CAMPO_BKO} data-testid="nova-tarefa.titulo" {...descrito('titulo', erros)} />
        <Erro campo="titulo" erros={erros} />
      </label>
      <label className="flex flex-col gap-1">
        Descrição (opcional)
        <textarea
          value={form.descricao}
          maxLength={TAREFA_DESCRICAO_MAX}
          rows={3}
          onChange={(e) => onChange({ descricao: e.target.value })}
          className="rounded-xl border border-field bg-surface p-3 text-[15px] font-normal text-ink"
          data-testid="nova-tarefa.descricao"
          {...descrito('descricao', erros)}
        />
        <Erro campo="descricao" erros={erros} />
      </label>
      <label className="flex flex-col gap-1">
        Prazo
        <input type="date" value={form.prazo} min={hoje} onChange={(e) => onChange({ prazo: e.target.value })} className={CLASSE_CAMPO_BKO} data-testid="nova-tarefa.prazo" {...descrito('prazo', erros)} />
        <Erro campo="prazo" erros={erros} />
      </label>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1">Tipo</legend>
        <div className="flex flex-wrap gap-4 font-normal">
          {tipos.map((t) => (
            <label key={t} className="flex min-h-[44px] items-center gap-2">
              <input type="radio" name="nova-tarefa.tipo" checked={form.tipo === t} onChange={() => onChange({ tipo: t as TipoTarefa })} className="h-5 w-5" data-testid={`nova-tarefa.tipo.${t}`} />
              {ROTULO_TIPO[t]}
            </label>
          ))}
        </div>
      </fieldset>
      {form.tipo === 'pesquisa' && questionarios && (
        <label className="flex flex-col gap-1">
          Questionário
          <select value={form.questionario_id} onChange={(e) => onChange({ questionario_id: e.target.value })} className={CLASSE_CAMPO_BKO} data-testid="nova-tarefa.questionario" {...descrito('questionario_id', erros)}>
            <option value="">Escolha</option>
            {questionarios.map((q) => (
              <option key={q.questionario_id} value={q.questionario_id}>
                {q.titulo}
              </option>
            ))}
          </select>
          <Erro campo="questionario_id" erros={erros} />
        </label>
      )}
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" {...descrito('destino', erros)}>
        <legend className="mb-1">Para quem</legend>
        <div className="flex flex-wrap gap-4 font-normal">
          {alvos.map(([a, rotulo]) => (
            <label key={a} className="flex min-h-[44px] items-center gap-2">
              <input type="radio" name="nova-tarefa.alvo" checked={form.alvo === a} onChange={() => onChange({ alvo: a })} className="h-5 w-5" data-testid={`nova-tarefa.alvo.${a}`} />
              {rotulo}
            </label>
          ))}
        </div>
        {form.alvo === 'usuarios' && (
          <div className="flex flex-col gap-2">
            <input type="search" value={busca} placeholder="Buscar pelo nome" aria-label="Buscar pelo nome" onChange={(e) => setBusca(e.target.value)} className={CLASSE_CAMPO_BKO} data-testid="nova-tarefa.busca" />
            <span className="font-normal text-ink-2" data-testid="nova-tarefa.escolhidas">
              {form.usuario_ids.length === 1 ? '1 escolhida' : `${form.usuario_ids.length} escolhidas`}
            </span>
            <ul className="m-0 flex max-h-[280px] list-none flex-col overflow-y-auto rounded-xl border border-line bg-surface p-0">
              {visiveis.map((c) => (
                <li key={c.id} className="border-b border-line-2 last:border-b-0">
                  <label className="flex min-h-[44px] items-center gap-2 px-3 font-normal">
                    <input type="checkbox" checked={form.usuario_ids.includes(c.id)} onChange={(e) => marcar(c.id, e.target.checked)} className="h-5 w-5" data-testid={`nova-tarefa.pessoa.${c.id}`} />
                    {c.nome}
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        {form.alvo === 'equipe' && equipes && (
          <select value={form.equipe_id} aria-label="Equipe" onChange={(e) => onChange({ equipe_id: e.target.value })} className={CLASSE_CAMPO_BKO} data-testid="nova-tarefa.equipe">
            <option value="">Escolha a equipe</option>
            {equipes.map((q) => (
              <option key={q.id} value={q.id}>
                {q.nome}
              </option>
            ))}
          </select>
        )}
        <Erro campo="destino" erros={erros} />
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={onCancelar}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={enviando} data-testid="nova-tarefa.criar">
          Criar tarefa
        </Button>
      </div>
    </form>
  );
}
