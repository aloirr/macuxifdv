/**
 * T-0140 lote 03 — RD-0019: no BKO, a "Crie sua senha" decide o que fazer depois de um erro da troca
 * (`POST /v1/auth/senha/trocar`) pelo `acaoDoErroDaTroca` do Core (fonte única; `modules/core/contracts/ciclo-senha.ts`), e não
 * mais pelo mapa próprio por status HTTP (`apps/web/lib/ciclo-senha.ts`). O que se prova: para CADA erro que a API manda nessa
 * rota, a tela faz o MESMO que fazia no main 9d097404 (oráculo abaixo, transcrito do `resultadoDoErroDaTroca` antigo:
 * `login` = `voltar_ao_login`, `fica` = `ficar`), com o mesmo texto; e o app (Core, `erroDaTroca`) decide a mesma ação.
 * Spec: docs/desenho/T-0094.md §2 (tabela erro → ação); regras RN-CORE-32, RN-CORE-33, RN-CORE-34.
 * Sem banco: roda local e no CI. Matriz: docs/testes/T-0140.md, seção "Lote 03".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acaoDoErroDaTroca, CODIGOS_AUTH, mensagemDaSenha, TEXTOS_CRIE_SENHA, TEXTOS_LOGIN_SENHA } from '@macuxi/core/contracts';
import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { describe, expect, it } from 'vitest';
import { resultadoDoErroDaTroca } from '../../apps/web/lib/ciclo-senha';
import { mensagemDoLogin } from '../../apps/web/lib/login';
import { erroDaTroca } from '../../modules/core/app/lib/senha';

const RAIZ = join(__dirname, '..', '..');
const SENHA_NOVA = 'abc';

type AcaoAntiga = 'login' | 'fica' | 'destacar' | 'limpar';
const NOVO_NOME: Record<AcaoAntiga, string> = { login: 'voltar_ao_login', fica: 'ficar', destacar: 'destacar', limpar: 'limpar' };

/** Erro como o SDK web entrega (v1 `{ codigo, mensagem, detalhes }` vira `status`, `code`, `message`, `details`). */
const erro = (status: number, code: string, message = 'texto da API', details?: Record<string, unknown>) => new ApiRequestError(status, code, message, details);
/** O mesmo erro como o SDK mobile entrega (`codigo`, `detalhes`), para conferir o app. */
const erroMobile = (e: ApiRequestError) => Object.assign(new Error(e.message), { status: e.status, codigo: e.code, detalhes: e.details });

const PERFIL_FORA = 'Seu perfil usa o app Macuxi Campo. Entre por ele.';

/** Os erros que a rota `auth/senha/trocar` manda (modules/core/api/autenticacao.ts) e o que o BKO fazia no main 9d097404. */
const CASOS: Array<{ nome: string; e: ApiRequestError; antes: AcaoAntiga; texto: string }> = [
  { nome: '422 RN-CORE-32 com faltas', e: erro(422, 'RN-CORE-32', 'x', { faltas: ['caracteres', 'numero'] }), antes: 'destacar', texto: mensagemDaSenha(['caracteres', 'numero'], SENHA_NOVA)! },
  { nome: '422 RN-CORE-32 sem faltas (igual ao e-mail)', e: erro(422, 'RN-CORE-32', 'x', { faltas: [] }), antes: 'destacar', texto: TEXTOS_CRIE_SENHA.igualAoEmail },
  { nome: '422 RN-CORE-32 com falta desconhecida', e: erro(422, 'RN-CORE-32', 'x', { faltas: ['emoji'] }), antes: 'destacar', texto: TEXTOS_CRIE_SENHA.igualAoEmail },
  { nome: '422 RN-CORE-34 (repetiu a temporária)', e: erro(422, 'RN-CORE-34'), antes: 'limpar', texto: TEXTOS_CRIE_SENHA.repetiuATemporaria },
  { nome: '401 CREDENCIAIS_INVALIDAS', e: erro(401, CODIGOS_AUTH.credenciais), antes: 'login', texto: TEXTOS_CRIE_SENHA.naoValeMais },
  { nome: '410 SENHA_TEMPORARIA_VENCIDA', e: erro(410, CODIGOS_AUTH.senhaVencida), antes: 'login', texto: TEXTOS_LOGIN_SENHA.senhaVencida },
  { nome: '423 USUARIO_BLOQUEADO', e: erro(423, CODIGOS_AUTH.bloqueado), antes: 'login', texto: mensagemDoLogin(erro(423, CODIGOS_AUTH.bloqueado)) },
  { nome: '423 DISPOSITIVO_BLOQUEADO', e: erro(423, 'DISPOSITIVO_BLOQUEADO'), antes: 'login', texto: mensagemDoLogin(erro(423, 'DISPOSITIVO_BLOQUEADO')) },
  { nome: '429 MUITAS_TENTATIVAS', e: erro(429, CODIGOS_AUTH.muitasTentativas), antes: 'login', texto: mensagemDoLogin(erro(429, CODIGOS_AUTH.muitasTentativas)) },
  { nome: '403 PERFIL_FORA_DO_APP (RN-CORE-33)', e: erro(403, CODIGOS_AUTH.perfilForaDoApp, PERFIL_FORA), antes: 'login', texto: mensagemDoLogin(erro(403, CODIGOS_AUTH.perfilForaDoApp, PERFIL_FORA)) },
  { nome: 'sem internet (status 0)', e: erro(0, 'SEM_CONEXAO'), antes: 'fica', texto: TEXTOS_CRIE_SENHA.semInternet },
  { nome: '400 VALIDACAO', e: erro(400, 'VALIDACAO', 'Dados inválidos.'), antes: 'fica', texto: mensagemDoLogin(erro(400, 'VALIDACAO')) },
  { nome: '503 AUTENTICACAO_INDISPONIVEL', e: erro(503, 'AUTENTICACAO_INDISPONIVEL'), antes: 'fica', texto: mensagemDoLogin(erro(503, 'AUTENTICACAO_INDISPONIVEL')) },
  { nome: '500 ERRO_INTERNO', e: erro(500, 'ERRO_INTERNO'), antes: 'fica', texto: mensagemDoLogin(erro(500, 'ERRO_INTERNO')) },
];

describe('T-0140 lote 03 — RD-0019: a "Crie sua senha" do BKO faz o mesmo de antes para cada erro da API (acaoDoErroDaTroca do Core)', () => {
  it.each(CASOS)('S1. $nome → mesma ação e mesmo texto do main', ({ e, antes, texto }) => {
    const r = resultadoDoErroDaTroca(e, SENHA_NOVA);
    expect(r.acao).toBe(NOVO_NOME[antes]);
    expect(r.mensagem).toBe(texto);
    // a ação é a da fonte única
    expect(r.acao).toBe(acaoDoErroDaTroca(e));
  });

  it.each(CASOS)('S2. $nome → o app (Core, erroDaTroca) decide a mesma ação que o BKO', ({ e }) => {
    expect(erroDaTroca(erroMobile(e)).acao).toBe(resultadoDoErroDaTroca(e, SENHA_NOVA).acao);
  });

  it('S3. o fetch que nem chega ao servidor (TypeError) fica na tela, com o texto genérico (como antes)', () => {
    const r = resultadoDoErroDaTroca(new TypeError('Failed to fetch'), SENHA_NOVA);
    expect(r).toEqual({ acao: 'ficar', mensagem: mensagemDoLogin(new TypeError('Failed to fetch')) });
  });

  it('S4. a tela usa os nomes do contrato: volta ao login, destaca, limpa; nenhuma comparação com os nomes antigos', () => {
    const tela = readFileSync(join(RAIZ, 'apps/web/components/ciclo-senha.tsx'), 'utf8');
    expect(tela).toContain("r.acao === 'voltar_ao_login'");
    expect(tela).toContain("r.acao === 'destacar'");
    expect(tela).toContain("r.acao === 'limpar'");
    expect(tela).not.toMatch(/acao === '(login|fica)'/);
  });

  /**
   * Mudança FORA do contrato da API (observação, sem defeito): o mapa antigo olhava o status; o novo olha o código. Uma resposta
   * 401/410/423/429 SEM o código do contrato (só viria de um proxy na frente da API, ou de um erro 4xx do Fastify, que a API
   * devolve como `REQUISICAO_INVALIDA`) antes voltava ao login e agora fica na tela, com o texto genérico, e o botão tenta de novo.
   */
  it.each([
    [401, 'REQUISICAO_INVALIDA'],
    [410, 'REQUISICAO_INVALIDA'],
    [423, 'REQUISICAO_INVALIDA'],
    [429, 'REQUISICAO_INVALIDA'],
  ])('S5. %i sem código do contrato (%s): antes voltava ao login, agora fica na tela (observação)', (status, code) => {
    const e = erro(status, code);
    expect(resultadoDoErroDaTroca(e, SENHA_NOVA)).toEqual({ acao: 'ficar', mensagem: mensagemDoLogin(e) });
  });
});
