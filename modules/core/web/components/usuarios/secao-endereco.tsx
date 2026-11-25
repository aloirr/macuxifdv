'use client';

import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { LoadingBlock, Notice } from '@macuxi/ui/web';
import { corpoDaCasa, ENDERECO_VAZIO, enderecoEmBranco, errosDoEndereco, type FormEndereco, formDoEndereco } from '../../lib/endereco';
import { gravarCasaDoUsuario, useCasaDoUsuario } from '../../lib/rotas-criar-api';
import { EnderecoCampos } from '../endereco/endereco-campos';

/** O que a gaveta chama ao salvar: `validar` (mostra os erros) e `gravar` (só se a pessoa mexeu no endereço). */
export interface EnderecoDaGaveta {
  validar: () => boolean;
  /** `usuarioId` só no Novo usuário (a pessoa nasce depois de salvar); no Editar vale o id da seção. */
  gravar: (usuarioId?: string) => Promise<void>;
}

/**
 * Seção "Endereço" da gaveta Novo e Editar usuário, para vendedor e promotor (T-0191, RN-CORE-75): a casa, usada como base das rotas.
 * CEP com "Pesquisar CEP", rua, número, bairro, cidade e UF; o ponto no mapa não se edita aqui (o já gravado é preservado).
 * Grava junto com o Salvar da gaveta; apagar todos os campos remove a casa. `usuarioId` nulo = Novo usuário (começa vazio).
 */
export function SecaoEndereco({ usuarioId, registrar }: { usuarioId: string | null; registrar: (h: EnderecoDaGaveta | null) => void }) {
  const qc = useQueryClient();
  const casa = useCasaDoUsuario(usuarioId);
  const [form, setForm] = useState<FormEndereco>(ENDERECO_VAZIO);
  const [mexeu, setMexeu] = useState(false);
  const [mostrarErros, setMostrarErros] = useState(false);
  const atual = useRef({ form, mexeu });
  atual.current = { form, mexeu };

  useEffect(() => {
    if (usuarioId && casa.isSuccess && !atual.current.mexeu) setForm(formDoEndereco(casa.data));
  }, [usuarioId, casa.isSuccess, casa.data]);

  useEffect(() => {
    registrar({
      validar: () => {
        const { form: f, mexeu: m } = atual.current;
        if (!m || enderecoEmBranco(f)) return true;
        setMostrarErros(true);
        return Object.keys(errosDoEndereco(f, { exigePonto: false })).length === 0;
      },
      gravar: async (idNovo) => {
        const { form: f, mexeu: m } = atual.current;
        const id = idNovo ?? usuarioId;
        if (!m || !id) return;
        await gravarCasaDoUsuario(id, enderecoEmBranco(f) ? null : corpoDaCasa(f));
        setMexeu(false);
        await Promise.all([qc.invalidateQueries({ queryKey: ['core', 'casa', id] }), qc.invalidateQueries({ queryKey: ['core', 'base', id] }), qc.invalidateQueries({ queryKey: ['routes'] })]);
      },
    });
    return () => registrar(null);
  }, [registrar, usuarioId, qc]);

  const erros = mostrarErros && !enderecoEmBranco(form) ? errosDoEndereco(form, { exigePonto: false }) : {};

  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" data-testid="usuarios.endereco">
      <legend className="mb-1 p-0 text-[13px] font-semibold text-ink">Endereço</legend>
      {usuarioId && casa.isPending && <LoadingBlock />}
      {usuarioId && casa.isError && <Notice tone="danger">{errorMessage(casa.error)}</Notice>}
      {(!usuarioId || casa.isSuccess) && (
        <EnderecoCampos
          value={form}
          onChange={(v) => {
            setForm(v);
            setMexeu(true);
          }}
          erros={erros}
          semMapa
          testId="usuarios.endereco-campos"
        />
      )}
    </fieldset>
  );
}
