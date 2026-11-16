import { describe, expect, it } from 'vitest';
import {
  conferirImportacaoDeEquipe,
  errosParaCsv,
  lerCsvDeEquipe,
  MAX_LINHAS_EQUIPE_CSV,
  modeloCsvDeEquipe,
  type ContextoImportacao,
  type UsuarioExistente,
} from './equipe-importacao';

const CAB = 'nome,email,telefone,perfil,email_superior,codigo_erp,modulos,filial';
const F1 = { id: '0f000000-0000-4000-8000-000000000001', codigo: '0001', external_id: 'FIL-1' };
const F2 = { id: '0f000000-0000-4000-8000-000000000002', codigo: '0002', external_id: null };
const ctxBase = (over: Partial<ContextoImportacao> = {}): ContextoImportacao => ({
  existentes: [],
  modulosDoTenant: ['core', 'vendedor', 'promotor', 'gestor'],
  modulosDoPerfil: { gerente: ['core', 'gestor'], supervisor: ['core', 'gestor'], vendedor: ['core', 'vendedor'], promotor: ['core', 'promotor'], admin: ['core'], analista: ['core'], assistente: ['core'] },
  limites: {},
  emUso: {},
  filiais: [F1],
  ...over,
});
const ler = (linhas: string[]) => {
  const r = lerCsvDeEquipe([CAB, ...linhas].join('\n'));
  if (!r.ok) throw new Error(r.mensagem);
  return r.linhas;
};
const conferir = (linhas: string[], ctx = ctxBase()) => conferirImportacaoDeEquipe(ler(linhas), ctx);

describe('RN-CORE-31 / RF-CORE-02: leitura do CSV da Equipe', () => {
  it('RN-CORE-31: aceita vírgula ou ponto e vírgula, aspas e BOM, e rejeita cabeçalho sem as colunas obrigatórias', () => {
    const r = lerCsvDeEquipe('\uFEFFnome;email;perfil\r\n"Silva; Ana";ana@x.com;vendedor\r\n');
    expect(r.ok && r.linhas[0]).toMatchObject({ numero: 2, nome: 'Silva; Ana', email: 'ana@x.com', perfil: 'vendedor' });
    const ruim = lerCsvDeEquipe('nome;telefone\nAna;1');
    expect(ruim.ok).toBe(false);
    if (!ruim.ok) expect(ruim.mensagem).toMatch(/email/);
  });
  it('RN-CORE-31: passou de ' + MAX_LINHAS_EQUIPE_CSV + ' linhas, o arquivo inteiro é recusado', () => {
    const muitas = [CAB, ...Array.from({ length: MAX_LINHAS_EQUIPE_CSV + 1 }, (_, i) => `U${i},u${i}@x.com,,vendedor,,,`)].join('\n');
    expect(lerCsvDeEquipe(muitas).ok).toBe(false);
  });
  it('RN-CORE-31: modelo traz as colunas e 2 linhas de exemplo', () => {
    const m = modeloCsvDeEquipe().trim().split('\n');
    expect(m[0]).toBe(CAB);
    expect(m).toHaveLength(3);
  });
  it('RN-CORE-31: nunca aceita coluna de senha', () => {
    expect(lerCsvDeEquipe('nome,email,perfil,senha\nA,a@x.com,vendedor,123').ok).toBe(false);
  });
});

describe('RN-CORE-39: filial de cadastro na importação da equipe', () => {
  it('RN-CORE-39: sem a coluna e com uma filial só na empresa, o usuário novo entra nessa filial', () => {
    const lido = lerCsvDeEquipe('nome,email,perfil\nAna,ana@x.com,vendedor');
    if (!lido.ok) throw new Error(lido.mensagem);
    const r = conferirImportacaoDeEquipe(lido.linhas, ctxBase());
    expect(r.erros).toEqual([]);
    expect(r.plano[0]).toMatchObject({ acao: 'criar', filial_id: F1.id });
  });
  it('RN-CORE-39: a coluna casa pelo external_id ou pelo código da filial', () => {
    const r = conferir(['Ana,ana@x.com,,vendedor,,,,0002', 'Bia,bia@x.com,,vendedor,,,,FIL-1'], ctxBase({ filiais: [F1, F2] }));
    expect(r.erros).toEqual([]);
    expect(r.plano.map((p) => p.filial_id)).toEqual([F2.id, F1.id]);
  });
  it('RN-CORE-39: filial que não existe é erro da linha, na coluna filial', () => {
    const r = conferir(['Ana,ana@x.com,,vendedor,,,,XYZ']);
    expect(r.erros).toEqual([expect.objectContaining({ linha: 2, coluna: 'filial' })]);
    expect(r.plano).toEqual([]);
  });
  it('RN-CORE-39: sem a coluna e com várias filiais (ou nenhuma), a linha nova é erro', () => {
    for (const filiais of [[F1, F2], []]) {
      const r = conferir(['Ana,ana@x.com,,vendedor,,,,'], ctxBase({ filiais }));
      expect(r.erros).toEqual([expect.objectContaining({ linha: 2, coluna: 'filial' })]);
    }
  });
  it('RN-CORE-39: quem já existe não troca de filial pelo arquivo e não exige a coluna', () => {
    const ex: UsuarioExistente = { id: 'u1', email: 'ana@x.com', perfil: 'vendedor', nome: 'Ana', external_id: null, ativo: true, modulos: ['core', 'vendedor'], superior_email: null };
    const r = conferir(['Ana,ana@x.com,,vendedor,,,,'], ctxBase({ existentes: [ex], filiais: [F1, F2] }));
    expect(r.erros).toEqual([]);
    expect(r.plano[0]).toMatchObject({ acao: 'sem_mudanca', filial_id: null });
  });
});

describe('RN-CORE-31: conferir sem gravar, erros por linha', () => {
  it('RN-CORE-31: arquivo válido gera plano ordenado gerentes → supervisores → campo e monta a árvore pelo e-mail do superior', () => {
    const r = conferir(['Vera,vera@x.com,,vendedor,sup@x.com,V1,vendedor', 'Sandra,sup@x.com,,supervisor,ger@x.com,,', 'Gil,ger@x.com,,gerente,,,']);
    expect(r.erros).toEqual([]);
    expect(r.plano.map((p) => p.email)).toEqual(['ger@x.com', 'sup@x.com', 'vera@x.com']);
    expect(r.plano[2]).toMatchObject({ acao: 'criar', superior_email: 'sup@x.com', external_id: 'V1' });
    expect(r.resumo).toMatchObject({ novos: 3, atualizados: 0, sem_mudanca: 0, com_erro: 0 });
  });
  it('RN-CORE-31: e-mail repetido, e-mail inválido e perfil desconhecido apontam a linha e a coluna, sem repetir o dado', () => {
    const r = conferir(['A,a@x.com,,vendedor,,,', 'B,a@x.com,,vendedor,,,', 'C,sem-arroba,,vendedor,,,', 'D,d@x.com,,chefe,,,']);
    const por = (n: number) => r.erros.filter((e) => e.linha === n).map((e) => e.coluna);
    expect(por(3)).toContain('email');
    expect(por(4)).toContain('email');
    expect(por(5)).toContain('perfil');
    expect(JSON.stringify(r.erros)).not.toContain('sem-arroba');
  });
  it('RN-CORE-31: superior inexistente, de perfil incompatível e o próprio usuário são recusados', () => {
    const r = conferir([
      'G,g@x.com,,gerente,v@x.com,,',
      'V,v@x.com,,vendedor,g@x.com,,',
      'S,s@x.com,,supervisor,naoexiste@x.com,,',
      'X,x@x.com,,vendedor,x@x.com,,',
      'P,p@x.com,,promotor,v@x.com,,',
    ]);
    const cols = (n: number) => r.erros.filter((e) => e.linha === n && e.coluna === 'email_superior');
    expect(cols(2)).toHaveLength(1);
    expect(cols(4)).toHaveLength(1);
    expect(cols(5)).toHaveLength(1);
    expect(cols(6)).toHaveLength(1);
  });
  it('RN-CORE-31: superior pode ser um usuário que já existe no tenant', () => {
    const existentes: UsuarioExistente[] = [{ id: 'u1', email: 'sup@x.com', perfil: 'supervisor', nome: 'S', external_id: null, ativo: true, modulos: ['core', 'gestor'], superior_email: null }];
    expect(conferir(['V,v@x.com,,vendedor,sup@x.com,,'], ctxBase({ existentes })).erros).toEqual([]);
  });
  it('RN-CORE-31: codigo_erp repetido no arquivo ou já usado por outro usuário do tenant é recusado', () => {
    const existentes: UsuarioExistente[] = [{ id: 'u1', email: 'o@x.com', perfil: 'vendedor', nome: 'O', external_id: 'V9', ativo: true, modulos: ['core', 'vendedor'], superior_email: null }];
    const r = conferir(['A,a@x.com,,vendedor,,V1,', 'B,b@x.com,,vendedor,,V1,', 'C,c@x.com,,vendedor,,V9,'], ctxBase({ existentes }));
    expect(r.erros.filter((e) => e.coluna === 'codigo_erp').map((e) => e.linha)).toEqual([3, 4]);
  });
  it('RN-CORE-31: idempotente pelo e-mail: existente é atualizado, não troca perfil e sem mudança não regrava', () => {
    const existentes: UsuarioExistente[] = [
      { id: 'u1', email: 'a@x.com', perfil: 'vendedor', nome: 'Ana', external_id: 'V1', ativo: true, modulos: ['core', 'vendedor'], superior_email: null },
      { id: 'u2', email: 'b@x.com', perfil: 'vendedor', nome: 'Beto', external_id: null, ativo: true, modulos: ['core', 'vendedor'], superior_email: null },
    ];
    const r = conferir(['Ana,A@x.com,,vendedor,,V1,', 'Beto Novo,b@x.com,,promotor,,,'], ctxBase({ existentes }));
    expect(r.erros).toEqual([]);
    expect(r.plano.find((p) => p.email === 'a@x.com')?.acao).toBe('sem_mudanca');
    expect(r.plano.find((p) => p.email === 'b@x.com')).toMatchObject({ acao: 'atualizar', perfil: 'vendedor', nome: 'Beto Novo' });
    expect(r.avisos.some((a) => a.linha === 3 && a.coluna === 'perfil')).toBe(true);
  });
  it('RN-CORE-01/02: módulo fora da licença do tenant ou do perfil é recusado (a exceção só remove); o que não foi listado vira remoção', () => {
    const r = conferir(['A,a@x.com,,vendedor,,,vendedor;catalogo', 'B,b@x.com,,vendedor,,,gestor']);
    expect(r.erros.filter((e) => e.coluna === 'modulos').map((e) => e.linha)).toEqual([2, 3]);
    const ok = conferir(['D,d@x.com,,gerente,,,core']);
    expect(ok.plano[0]!.modulos_removidos).toEqual(['gestor']);
    expect(conferir(['E,e@x.com,,gerente,,,']).plano[0]!.modulos_removidos).toEqual([]);
  });
  it('RN-CORE-02: quantidade de licenças por módulo — os que excedem o limite são recusados na ordem do arquivo', () => {
    const ctx = ctxBase({ limites: { vendedor: 2 }, emUso: { vendedor: 1 } });
    const r = conferir(['A,a@x.com,,vendedor,,,', 'B,b@x.com,,vendedor,,,', 'C,c@x.com,,vendedor,,,'], ctx);
    expect(r.erros.map((e) => [e.linha, e.coluna])).toEqual([[3, 'modulos'], [4, 'modulos']]);
    expect(conferir(['A,a@x.com,,vendedor,,,'], ctx).erros).toEqual([]);
  });
  it('regra 7 (RN-CORE-29): promotor não recebe o módulo vendedor (nunca cria pedido)', () => {
    const ctx = ctxBase({ modulosDoPerfil: { ...ctxBase().modulosDoPerfil, promotor: ['core', 'promotor', 'vendedor'] } });
    expect(conferir(['P,p@x.com,,promotor,,,promotor;vendedor'], ctx).erros.map((e) => e.coluna)).toEqual(['modulos']);
    expect(conferir(['P,p@x.com,,promotor,,,promotor'], ctx).erros).toEqual([]);
  });
});

describe('RN-CORE-31/34: CSV de erros', () => {
  it('RN-CORE-31: CSV de erros sem o dado da célula e com neutralização de fórmula', () => {
    expect(errosParaCsv([{ linha: 3, coluna: 'email', mensagem: 'E-mail inválido.' }])).toBe('linha,coluna,mensagem\r\n3,email,E-mail inválido.\r\n');
    expect(errosParaCsv([{ linha: 1, coluna: '=cmd', mensagem: 'x' }])).toContain("'=cmd");
  });
});

describe('RN-CORE-31: telefone na reimportação', () => {
  const ex: UsuarioExistente = { id: 'u1', email: 'a@x.com', perfil: 'vendedor', nome: 'Ana', external_id: 'V1', ativo: true, telefone: '95900000000', modulos: ['core', 'vendedor'], superior_email: null };
  it('RN-CORE-31: arquivo que só muda o telefone de quem existe vira atualização', () => {
    const r = conferir(['Ana,a@x.com,95911112222,vendedor,,V1,'], ctxBase({ existentes: [ex] }));
    expect(r.plano[0]).toMatchObject({ acao: 'atualizar', telefone: '95911112222' });
  });
  it('RN-CORE-31: telefone igual ou célula vazia não gera mudança (vazio não apaga)', () => {
    expect(conferir(['Ana,a@x.com,95900000000,vendedor,,V1,'], ctxBase({ existentes: [ex] })).plano[0]?.acao).toBe('sem_mudanca');
    expect(conferir(['Ana,a@x.com,,vendedor,,V1,'], ctxBase({ existentes: [ex] })).plano[0]?.acao).toBe('sem_mudanca');
  });
});
