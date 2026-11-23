/**
 * Telas do pré-cadastro de cliente no Campo, montadas pelo shell (v1.0.28; regras em `lib/pre-cadastro-cliente.ts`).
 * O Core exporta `TelaNovoClientePreCadastro` (`aoConcluir`, `clienteId`) e `TelaClientes` (`aoNovoCliente`); enquanto
 * o export não chega ao main, o shell lê os dois como opcionais (o mesmo padrão do balão do sino) e a carteira segue
 * sem "Novo cliente". A lista fica dentro do `VisitSheetsProvider`, como o `comVisitas` do Core.
 * O voltar do Android e o formulário alterado seguem o histórico e o bloqueio de saída do shell (RN-VEN-38).
 */
import * as appCore from '@macuxi/core/app';
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { router, useLocalSearchParams } from 'expo-router';
import type { ComponentType } from 'react';

import { clienteIdDaRota, HREF_LISTA_CLIENTES, hrefNovoCliente, podeNovoCliente } from '@/lib/pre-cadastro-cliente';

interface PropsFormularioCore {
  aoConcluir?: () => void;
  clienteId?: string;
}

interface PropsListaCore {
  aoNovoCliente?: () => void;
}

const exportsCore = appCore as unknown as {
  TelaNovoClientePreCadastro?: ComponentType<PropsFormularioCore>;
  TelaClientes?: ComponentType<PropsListaCore>;
};

const FormularioDoCore = exportsCore.TelaNovoClientePreCadastro;
const ListaDoCore = exportsCore.TelaClientes;

/** Ao concluir, volta à lista: o histórico do shell volta até ela e tira o formulário da pilha. */
const voltarALista = () => router.navigate(HREF_LISTA_CLIENTES as never);

function TelaNovoCliente() {
  const { id } = useLocalSearchParams<{ id?: string | string[] }>();
  if (!FormularioDoCore) return null;
  return <FormularioDoCore clienteId={clienteIdDaRota(id)} aoConcluir={voltarALista} />;
}

function TelaClientesDoShell() {
  const visao = useVisaoShell();
  if (!ListaDoCore) return null;
  const novo = podeNovoCliente(visao) ? () => router.navigate(hrefNovoCliente() as never) : undefined;
  return (
    <appCore.VisitSheetsProvider>
      <ListaDoCore aoNovoCliente={novo} />
    </appCore.VisitSheetsProvider>
  );
}

/** Telas para `comPreCadastroCliente`: só as que o Core já exporta. */
export const TELAS_PRE_CADASTRO_CLIENTE: { lista?: ComponentType; formulario?: ComponentType } = {
  lista: ListaDoCore ? TelaClientesDoShell : undefined,
  formulario: FormularioDoCore ? TelaNovoCliente : undefined,
};
