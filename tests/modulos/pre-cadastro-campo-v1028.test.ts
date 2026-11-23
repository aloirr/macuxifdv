/**
 * v1.0.28 — pré-cadastro de cliente no Campo (decisão do dono do produto, 23/11/2026; RN-CORE-78 e RN-CORE-79), sem banco.
 * Cadeia real do aparelho: parâmetro e clientes pelo pull → `obrigatoriosDasLinhas` → `salvarPreCadastro` → MOTOR DE SYNC REAL do
 * SDK (armazenamento em memória, entidade `cliente_pre_cadastro` registrada por `entidadesCliente`) → transporte que faz o papel da
 * API pelo contrato (push idempotente pelo UUID; pull de `cliente` com `status_cadastro`/`motivo_recusa`/`external_id`) → lista
 * (`sobreporPreCadastros` + `listarClientesLocais` + `situacaoDoCliente`/`situacaoNaLinha` + `seloDoPreCadastro`, a mesma composição
 * de `usar-clientes-locais.ts` e de `LinhaCliente` em `telas/clientes.tsx`).
 * O servidor é o do contrato (a rota real de push e a revalidação 422 têm os testes de banco do Core). Matriz: offline → reconexão;
 * reenvio duplicado; 422 da API → "Corrigir e reenviar" que substitui o item da fila; recusado pelo ERP → correção com o mesmo id;
 * código do ERP; parâmetro de obrigatórios com e sem linha; CNPJ com dígito errado; perfil; valor × regra do selo em cada status.
 */
import { manifest as manifestCore } from '@macuxi/core/manifest';
import { criarArmazenamentoEmMemoria, criarClienteHttp, criarMotorSync, criarRegistroSync, ErroSemConexao, type ItemPush, type LinhaSync, type ResultadoItemPush } from '@macuxi/platform-sdk';
import { ROTULO_AGUARDANDO_ERP, ROTULO_RECUSADO_ERP, seloDoPreCadastro } from '@macuxi/ui/mobile/puro';
import { describe, expect, it } from 'vitest';

import { PreCadastroClienteSchema, type ClienteSync, type ParametroSync, type PreCadastroCliente } from '../../modules/core/contracts';
import { podePreCadastrarCliente, situacaoDoCliente, situacaoDoPreCadastro, situacaoNaLinha } from '../../modules/core/domain';
import { listarClientesLocais } from '../../modules/core/app/lib/cliente360-local';
import { entidadesCliente } from '../../modules/core/app/lib/entidades-cliente';
import { entidadesRota } from '../../modules/core/app/lib/entidades-rota';
import { ENTIDADE_PRE_CADASTRO, obrigatoriosDasLinhas, salvarPreCadastro, sobreporPreCadastros, valoresDoCliente, type ValoresPreCadastro } from '../../modules/core/app/lib/pre-cadastro-local';

const U = (n: number) => `0c028000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGORA = '2026-11-23T14:00:00.000Z';
const HOJE = '2026-11-23';
const ID = U(1);
const CNPJ_OK = '11.222.333/0001-81';
const VALORES: ValoresPreCadastro = { documento: CNPJ_OK, razao_social: 'Mercado Boa Vista', telefone: '(92) 99999-0000' };

type Decisao = { status: 'pendente' | 'aprovado' | 'recusado'; motivo?: string; codigo?: string };

/** Aparelho do vendedor (motor real) + o "servidor" do contrato. */
function montar(parametro?: unknown) {
  let sinal = false;
  let ativado = false;
  let relogio = Date.parse(AGORA);
  const instante = () => new Date((relogio += 1000)).toISOString();
  const servidor = { recebidos: new Map<string, PreCadastroCliente>(), recebimentos: 0, decisao: new Map<string, Decisao>(), recusa422: new Map<string, string>() };
  const registro = criarRegistroSync([manifestCore]);
  for (const e of [...entidadesCliente, ...entidadesRota]) if (!registro.entidade(e.nome)) registro.registrar(e);
  const linhaCliente = (p: PreCadastroCliente, d: Decisao | undefined): ClienteSync => ({
    id: p.id, updated_at: instante(), deleted_at: null, external_id: d?.codigo ?? null, documento: p.documento, razao_social: p.razao_social,
    nome_fantasia: p.nome_fantasia ?? null, segmento: null, telefone: p.telefone ?? null, email: p.email ?? null, logradouro: p.logradouro ?? null,
    numero: p.numero ?? null, bairro: p.bairro ?? null, cidade: p.cidade ?? null, uf: p.uf ?? null, cep: p.cep ?? null, latitude: null, longitude: null,
    ativo: true, status_cadastro: d?.status ?? 'pendente', motivo_recusa: d?.status === 'recusado' ? (d.motivo ?? null) : null,
  });
  const motor = criarMotorSync({
    registro,
    armazenamento: criarArmazenamentoEmMemoria(),
    agora: () => new Date(relogio),
    online: () => sinal,
    ambiente: {
      http: criarClienteHttp(async () => {
        throw new ErroSemConexao('sem http no teste');
      }),
      online: () => sinal,
      novoId: () => U(900),
      usuario: () => ({ id: U(9), nome: 'Lucas', perfil: 'vendedor', fuso: 'America/Manaus' }),
    },
    transporte: {
      async push(itens: ItemPush[]): Promise<ResultadoItemPush[]> {
        return itens.map((i) => {
          servidor.recebimentos += 1;
          const p = PreCadastroClienteSchema.parse(i.payload); // o servidor recebe o contrato estrito
          // revalidação da API (422): uma vez por id; o item fica `falhou` no aparelho
          const recusa = servidor.recusa422.get(p.id);
          if (recusa) {
            servidor.recusa422.delete(p.id);
            return { id: i.id, status: 'rejeitado', codigo: 'VALIDACAO', mensagem: recusa };
          }
          // reenvio da correção (mesmo id): substitui e volta a pendente; o mesmo payload repetido não duplica
          servidor.recebidos.set(p.id, p);
          if (servidor.decisao.get(p.id)?.status === 'recusado') servidor.decisao.delete(p.id);
          return { id: i.id, status: 'aceito', em: instante() };
        });
      },
      async pull(entidade: string) {
        const itens: LinhaSync[] =
          entidade === 'cliente'
            ? [...servidor.recebidos.values()].map((p) => linhaCliente(p, servidor.decisao.get(p.id)) as unknown as LinhaSync)
            : entidade === 'parametro' && parametro !== undefined
              ? [{ id: U(50), updated_at: AGORA, deleted_at: null, external_id: null, modulo: 'core', chave: 'cliente.pre_cadastro.obrigatorios', valor: parametro } satisfies ParametroSync as unknown as LinhaSync]
              : [];
        return { itens, proximo_cursor: null, horizonte: instante() };
      },
    },
  });

  /** O que a lista mostra: linhas do pull + a fila sobreposta, com o selo da `LinhaCliente`. */
  const lista = async () => {
    const pull = await motor.linhas<ClienteSync & LinhaSync>('cliente');
    const clientes = sobreporPreCadastros(pull, motor.sobreposicao([ENTIDADE_PRE_CADASTRO]), AGORA);
    return listarClientesLocais({ clientes, financeiros: [], titulos: [], historico: [] }, HOJE).map((c) => {
      const situacao = situacaoNaLinha(situacaoDoCliente(c), []);
      const pre = situacaoDoPreCadastro(c);
      const selo = situacao === 'pre_cadastro' ? seloDoPreCadastro(pre.situacao) : null;
      return { id: c.id, nome: c.nome_fantasia ?? c.razao_social, situacao, selo: selo?.texto ?? null, motivo: pre.motivo, status: c.status_cadastro ?? null };
    });
  };
  const obrigatorios = async () => obrigatoriosDasLinhas(await motor.linhas<ParametroSync & LinhaSync>('parametro'));
  const salvar = async (valores: ValoresPreCadastro, id = ID) => salvarPreCadastro(motor, { id, valores, obrigatorios: await obrigatorios(), online: false });
  const sincronizar = async () => {
    if (!ativado) {
      await motor.aplicarModulosAtivos(['core']);
      ativado = true;
    }
    sinal = true;
    const ok = await motor.sincronizar();
    sinal = false;
    return ok;
  };
  return { motor, servidor, lista, obrigatorios, salvar, sincronizar };
}

describe('v1.0.28 pré-cadastro no Campo: perfil (critério 1)', () => {
  it('RN-CORE-78 e RN-PRO-01: só o vendedor pré-cadastra; promotor, gestão e sem perfil não', () => {
    // a página `novo-cliente` (perfis: ['vendedor']) e o botão das duas listas usam esta checagem: novo-cliente.layout.test.ts
    expect(podePreCadastrarCliente('vendedor')).toBe(true);
    for (const p of ['promotor', 'supervisor', 'gerente', 'admin'] as const) expect(podePreCadastrarCliente(p), p).toBe(false);
  });
});

describe('v1.0.28 pré-cadastro no Campo: offline → fila → ERP (motor real)', () => {
  it('RN-CORE-79: sem parâmetro valem só os sempre obrigatórios; com o parâmetro sincronizado entram os dele', async () => {
    const sem = montar();
    await sem.sincronizar();
    expect(await sem.obrigatorios()).toEqual(['razao_social', 'documento']);
    const com = montar(['telefone', 'endereco']);
    await com.sincronizar();
    const ob = await com.obrigatorios();
    expect(ob.slice(0, 2)).toEqual(['razao_social', 'documento']);
    expect(ob).toEqual(expect.arrayContaining(['telefone', 'endereco']));
    // o obrigatório do parâmetro barra o salvar sem mexer na fila
    const r = await com.salvar({ documento: CNPJ_OK, razao_social: 'Mercado Boa Vista' });
    expect(r.ok).toBe(false);
    expect(com.motor.estado().fila).toEqual([]);
  });

  it('RN-CORE-79: CNPJ com dígito verificador errado não entra na fila; CPF válido entra', async () => {
    const t = montar();
    const r = await t.salvar({ ...VALORES, documento: '11.222.333/0001-82' });
    expect(r).toEqual({ ok: false, erros: expect.objectContaining({ documento: 'CNPJ inválido' }) });
    expect(t.motor.estado().fila).toEqual([]);
    expect((await t.salvar({ ...VALORES, documento: '529.982.247-25' }, U(2))).ok).toBe(true);
  });

  it('RN-CORE-78: sem sinal o cliente aparece na hora com "Aguardando ERP"; o reenvio do mesmo id não duplica; na reconexão o servidor recebe um só', async () => {
    const t = montar();
    expect(await t.salvar(VALORES)).toEqual({ ok: true, id: ID });
    expect(await t.salvar(VALORES)).toEqual({ ok: true, id: ID });
    expect(t.motor.estado().fila.map((i) => [i.id, i.entidade])).toEqual([[ID, ENTIDADE_PRE_CADASTRO]]);
    expect(t.servidor.recebimentos).toBe(0);
    expect(await t.lista()).toEqual([{ id: ID, nome: 'Mercado Boa Vista', situacao: 'pre_cadastro', selo: ROTULO_AGUARDANDO_ERP, motivo: null, status: 'pendente' }]);

    expect(await t.sincronizar(), t.motor.estado().erro ?? '').toBe(true);
    expect(t.servidor.recebimentos).toBe(1);
    expect([...t.servidor.recebidos.values()].map((p) => [p.id, p.origem, p.documento, p.telefone])).toEqual([[ID, 'campo', '11222333000181', '92999990000']]);
    expect(t.motor.estado().fila).toEqual([]);
    // o pull trouxe a linha pendente: segue um cliente só, com o mesmo selo
    expect(await t.lista()).toEqual([{ id: ID, nome: 'Mercado Boa Vista', situacao: 'pre_cadastro', selo: ROTULO_AGUARDANDO_ERP, motivo: null, status: 'pendente' }]);
  });

  it('RN-CORE-78: recusado mostra o motivo; "Corrigir e reenviar" usa o MESMO id, volta a "Aguardando ERP" e o servidor guarda a correção', async () => {
    const t = montar();
    await t.salvar(VALORES);
    await t.sincronizar();
    t.servidor.decisao.set(ID, { status: 'recusado', motivo: 'CNPJ com situação inapta na Receita' });
    await t.sincronizar();
    expect(await t.lista()).toEqual([{ id: ID, nome: 'Mercado Boa Vista', situacao: 'pre_cadastro', selo: ROTULO_RECUSADO_ERP, motivo: 'CNPJ com situação inapta na Receita', status: 'recusado' }]);

    // a correção abre o formulário preenchido a partir da linha recusada e salva com o id dela, offline
    const linha = (await t.motor.linhas<ClienteSync & LinhaSync>('cliente')).find((c) => c.id === ID)!;
    expect(await t.salvar({ ...valoresDoCliente(linha), razao_social: 'Mercado Boa Vista Ltda' }, linha.id)).toEqual({ ok: true, id: ID });
    expect(t.motor.estado().fila.map((i) => i.id)).toEqual([ID]);
    expect(await t.lista()).toEqual([{ id: ID, nome: 'Mercado Boa Vista Ltda', situacao: 'pre_cadastro', selo: ROTULO_AGUARDANDO_ERP, motivo: null, status: 'pendente' }]);

    await t.sincronizar();
    expect(t.servidor.recebidos.size).toBe(1);
    expect(t.servidor.recebidos.get(ID)?.razao_social).toBe('Mercado Boa Vista Ltda');
    expect(await t.lista()).toEqual([{ id: ID, nome: 'Mercado Boa Vista Ltda', situacao: 'pre_cadastro', selo: ROTULO_AGUARDANDO_ERP, motivo: null, status: 'pendente' }]);
  });

  it('RN-CORE-78: com o código do ERP o selo some (Em dia), e o rótulo nunca diz "Aguardando" para aprovado', async () => {
    const t = montar();
    await t.salvar(VALORES);
    await t.sincronizar();
    t.servidor.decisao.set(ID, { status: 'aprovado', codigo: 'ERP-000123' });
    await t.sincronizar();
    expect(await t.lista()).toEqual([{ id: ID, nome: 'Mercado Boa Vista', situacao: 'em_dia', selo: null, motivo: null, status: 'aprovado' }]);
  });
});

describe('v1.0.28 pré-cadastro no Campo: 422 da API (defeito corrigido)', () => {
  it('RN-CORE-78: o item que a API recusou (422) sai de "Aguardando ERP" com a mensagem; a correção SUBSTITUI o item da fila e o reenvio é aceito', async () => {
    const t = montar();
    await t.salvar(VALORES);
    t.servidor.recusa422.set(ID, 'Inscrição estadual inválida para AM');
    await t.sincronizar();
    expect(t.motor.estado().fila.map((i) => [i.id, i.situacao])).toEqual([[ID, 'falhou']]);
    const [linha] = await t.lista();
    expect(linha).toMatchObject({ id: ID, status: 'recusado', motivo: 'Inscrição estadual inválida para AM' });
    expect(linha?.selo).not.toBe(ROTULO_AGUARDANDO_ERP);

    // "Corrigir e reenviar": mesmo id, o item parado vira pendente com o payload novo (um item só na fila)
    expect(await t.salvar({ ...VALORES, razao_social: 'Mercado Boa Vista Ltda' })).toEqual({ ok: true, id: ID });
    expect(t.motor.estado().fila.map((i) => [i.id, i.situacao, (i.payload as PreCadastroCliente).razao_social])).toEqual([[ID, 'pendente', 'Mercado Boa Vista Ltda']]);
    expect(await t.lista()).toEqual([{ id: ID, nome: 'Mercado Boa Vista Ltda', situacao: 'pre_cadastro', selo: ROTULO_AGUARDANDO_ERP, motivo: null, status: 'pendente' }]);

    await t.sincronizar();
    expect(t.motor.estado().fila).toEqual([]);
    expect([...t.servidor.recebidos.values()].map((p) => [p.id, p.razao_social, p.documento])).toEqual([[ID, 'Mercado Boa Vista Ltda', '11222333000181']]);
  });
});

describe('v1.0.28 valor × regra do selo (critério 7)', () => {
  it('RN-CORE-78: cada status do contrato tem um só rótulo, e o rótulo diz o status', () => {
    const casos = [
      [{ status_cadastro: 'pendente', external_id: null }, 'Aguardando ERP'],
      [{ status_cadastro: undefined, external_id: null }, 'Aguardando ERP'],
      [{ status_cadastro: 'recusado', external_id: null, motivo_recusa: 'x' }, 'Recusado pelo ERP'],
      [{ status_cadastro: 'aprovado', external_id: 'ERP-1' }, null],
    ] as const;
    for (const [c, rotulo] of casos) expect(seloDoPreCadastro(situacaoDoPreCadastro(c).situacao)?.texto ?? null, JSON.stringify(c)).toBe(rotulo);
  });
});
