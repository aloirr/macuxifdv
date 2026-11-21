'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { LoadingBlock, Notice } from '@macuxi/ui/web';
import { centroDosClientes, corpoDoEndereco, ENDERECO_VAZIO, enderecoEmBranco, errosDoEndereco, type FormEndereco, formDoEndereco } from '../../lib/endereco';
import { useSellerCustomers } from '../../lib/queries';
import { gravarCasaDoUsuario, useCasaDoUsuario } from '../../lib/rotas-criar-api';
import { EnderecoCampos } from '../endereco/endereco-campos';

/** O que a gaveta chama ao salvar: `validar` (mostra os erros) e `gravar` (só se a pessoa mexeu no endereço). */
export interface EnderecoDaGaveta {
  validar: () => boolean;
  gravar: () => Promise<void>;
}

/**
 * Seção "Endereço" da gaveta Editar usuário, para vendedor e promotor (T-0191, RN-CORE-75): a casa, usada como base das rotas.
 * O mesmo componente de endereço e ponto no mapa do diálogo "Endereço base". O ponto não é obrigatório aqui; sem ele a Casa não
 * vale como base. Grava junto com o Salvar da gaveta; apagar todos os campos remove a casa.
 */
export function SecaoEndereco({ usuarioId, registrar }: { usuarioId: string; registrar: (h: EnderecoDaGaveta | null) => void }) {
  const qc = useQueryClient();
  const casa = useCasaDoUsuario(usuarioId);
  const carteira = useSellerCustomers(usuarioId);
  const [form, setForm] = useState<FormEndereco>(ENDERECO_VAZIO);
  const [mexeu, setMexeu] = useState(false);
  const [mostrarErros, setMostrarErros] = useState(false);
  const atual = useRef({ form, mexeu });
  atual.current = { form, mexeu };

  useEffect(() => {
    if (casa.isSuccess && !atual.current.mexeu) setForm(formDoEndereco(casa.data));
  }, [casa.isSuccess, casa.data]);

  useEffect(() => {
    registrar({
      validar: () => {
        const { form: f, mexeu: m } = atual.current;
        if (!m || enderecoEmBranco(f)) return true;
        setMostrarErros(true);
        return Object.keys(errosDoEndereco(f, { exigePonto: false })).length === 0;
      },
      gravar: async () => {
        const { form: f, mexeu: m } = atual.current;
        if (!m) return;
        await gravarCasaDoUsuario(usuarioId, enderecoEmBranco(f) ? null : corpoDoEndereco(f));
        setMexeu(false);
        await Promise.all([qc.invalidateQueries({ queryKey: ['core', 'casa', usuarioId] }), qc.invalidateQueries({ queryKey: ['core', 'base', usuarioId] }), qc.invalidateQueries({ queryKey: ['routes'] })]);
      },
    });
    return () => registrar(null);
  }, [registrar, usuarioId, qc]);

  const centro = useMemo(() => centroDosClientes((carteira.data ?? []).map((c) => ({ lat: c.lat, lng: c.lng }))), [carteira.data]);
  const erros = mostrarErros && !enderecoEmBranco(form) ? errosDoEndereco(form, { exigePonto: false }) : {};

  return (
    <fieldset className="m-0 flex flex-col gap-2 border-0 p-0" data-testid="usuarios.endereco">
      <legend className="mb-1 p-0 text-[13px] font-semibold text-ink">Endereço</legend>
      {casa.isPending && <LoadingBlock />}
      {casa.isError && <Notice tone="danger">{errorMessage(casa.error)}</Notice>}
      {casa.isSuccess && (
        <EnderecoCampos
          value={form}
          onChange={(v) => {
            setForm(v);
            setMexeu(true);
          }}
          erros={erros}
          centro={centro}
          testId="usuarios.endereco-campos"
        />
      )}
    </fieldset>
  );
}
