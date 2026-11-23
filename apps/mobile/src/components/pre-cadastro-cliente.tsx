/**
 * Formulário do pré-cadastro de cliente no Campo, montado pelo shell (v1.0.28; regras em `lib/pre-cadastro-cliente.ts`).
 * O Core exporta `TelaNovoClientePreCadastro` e `ROTA_NOVO_CLIENTE`; o shell lê os dois como opcionais (o mesmo padrão
 * do balão do sino) para o main seguir compilando antes do export chegar. Ao concluir, a própria tela do Core volta à
 * lista; o voltar do Android e o formulário alterado seguem o histórico e o bloqueio de saída do shell (RN-VEN-38).
 */
import * as appCore from '@macuxi/core/app';
import { useLocalSearchParams } from 'expo-router';
import type { ComponentType } from 'react';

import { clienteIdDaRota } from '@/lib/pre-cadastro-cliente';

const core = appCore as typeof appCore & Partial<{ ROTA_NOVO_CLIENTE: string; TelaNovoClientePreCadastro: ComponentType<{ clienteId?: string }> }>;
const FormularioDoCore = core.TelaNovoClientePreCadastro;

function TelaNovoCliente() {
  const { clienteId } = useLocalSearchParams<{ clienteId?: string | string[] }>();
  return FormularioDoCore ? <FormularioDoCore clienteId={clienteIdDaRota(clienteId)} /> : null;
}

/** Tela e endereço para `comPreCadastroCliente`: só o que o Core já exporta. */
export const TELA_PRE_CADASTRO_CLIENTE: { rota?: string; formulario?: ComponentType } = {
  rota: core.ROTA_NOVO_CLIENTE,
  formulario: FormularioDoCore !== undefined ? TelaNovoCliente : undefined,
};
