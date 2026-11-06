'use client';

/**
 * Primeiro acesso do super-admin (T-0087; ADR 0029 §2): e-mail, nome, senha (12+) e o código de convite → cadastro do TOTP (QR +
 * chave) → os 10 códigos de recuperação UMA vez → empresas. Só funciona com zero super-admins: depois a API responde 410 e a
 * tela manda para a entrada. testIDs: primeiro-acesso.*.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, type FormEvent } from 'react';
import { EtapaLoginSchema, PrimeiroAcessoSchema, SENHA_SUPER_ADMIN_MIN } from '@macuxi/platform-sdk';
import { Button, Notice } from '@macuxi/ui/web';

import { chamarPortal, ErroPortal, mensagemDoErro } from '@/lib/portal-api';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { Campo, LinkBotao, MolduraEstreita } from './base';
import { CadastroTotp } from './cadastro-totp';

type Campos = { email: string; nome: string; senha: string; confirmacao: string; convite: string };
type Erros = Partial<Record<keyof Campos, string>>;

/** Conferência na tela (a API revalida tudo com o mesmo schema). */
export function validarPrimeiroAcesso(c: Campos): Erros {
  const e: Erros = {};
  const p = PrimeiroAcessoSchema.safeParse({ email: c.email, nome: c.nome, senha: c.senha, convite: c.convite.trim() });
  if (!p.success) {
    for (const i of p.error.issues) {
      const k = i.path[0];
      if (k === 'email') e.email = 'Informe um e-mail válido.';
      if (k === 'nome') e.nome = 'Informe o seu nome (2 letras ou mais).';
      if (k === 'senha') e.senha = `A senha precisa de ${SENHA_SUPER_ADMIN_MIN} caracteres ou mais.`;
      if (k === 'convite') e.convite = 'O código de convite tem 32 caracteres ou mais. Copie inteiro, sem espaços.';
    }
  }
  if (c.senha && c.confirmacao !== c.senha) e.confirmacao = 'As duas senhas não são iguais.';
  return e;
}

export function TelaPrimeiroAcesso() {
  const router = useRouter();
  const [c, setC] = useState<Campos>({ email: '', nome: '', senha: '', confirmacao: '', convite: '' });
  const [erros, setErros] = useState<Erros>({});
  const [erro, setErro] = useState<string | null>(null);
  const [encerrado, setEncerrado] = useState(false);
  const [desafio, setDesafio] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const mudar = (k: keyof Campos) => (ev: { target: { value: string } }) => setC((x) => ({ ...x, [k]: ev.target.value }));
  const desafioVencido = useCallback(() => {
    setDesafio(null);
    setEncerrado(true);
    setErro('O tempo para cadastrar o 2º fator acabou. Entre com o e-mail e a senha que você criou: o cadastro do aplicativo continua de lá.');
  }, []);

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (enviando) return;
    const e = validarPrimeiroAcesso(c);
    setErros(e);
    setErro(null);
    if (Object.keys(e).length > 0) return;
    setEnviando(true);
    try {
      const r = await chamarPortal(ROTAS_PORTAL.primeiroAcesso, { metodo: 'POST', corpo: { email: c.email.trim(), nome: c.nome.trim(), senha: c.senha, convite: c.convite.trim() }, schema: EtapaLoginSchema });
      setC({ email: '', nome: '', senha: '', confirmacao: '', convite: '' });
      setDesafio(r.desafio);
    } catch (x) {
      if (x instanceof ErroPortal && x.status === 410) {
        setEncerrado(true);
        setErro('O primeiro acesso já foi feito. Entre com o seu e-mail e a sua senha.');
      } else if (x instanceof ErroPortal && (x.status === 401 || x.status === 403)) setErro('Código de convite incorreto. Confira com quem fez o deploy.');
      else if (x instanceof ErroPortal && x.status === 503) setErro('O portal ainda não está configurado neste servidor (falta o convite ou a chave do 2º fator). Avise o engenheiro de plantão.');
      else setErro(mensagemDoErro(x));
      setC((x2) => ({ ...x2, senha: '', confirmacao: '' }));
    } finally {
      setEnviando(false);
    }
  };

  if (desafio) {
    return (
      <MolduraEstreita testId="primeiro-acesso.tela">
        <CadastroTotp desafio={desafio} aoTerminar={() => router.replace('/empresas')} aoDesafioVencido={desafioVencido} />
      </MolduraEstreita>
    );
  }

  return (
    <MolduraEstreita testId="primeiro-acesso.tela">
      <form onSubmit={(e) => void enviar(e)} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-extrabold">Primeiro acesso</h1>
          <span className="text-[13px] text-ink-2">Crie o acesso do super-admin com o código de convite do deploy. Depois deste cadastro, o primeiro acesso se fecha.</span>
        </div>
        {erro && (
          <div data-testid="primeiro-acesso.erro">
            <Notice tone={encerrado ? 'info' : 'danger'}>{erro}</Notice>
          </div>
        )}
        {encerrado ? (
          <LinkBotao href="/entrar" primario testId="primeiro-acesso.ir-entrar">
            Ir para a entrada
          </LinkBotao>
        ) : (
          <>
            <Campo rotulo="E-mail" testId="primeiro-acesso.email" type="email" autoComplete="username" value={c.email} onChange={mudar('email')} erro={erros.email} />
            <Campo rotulo="Nome" testId="primeiro-acesso.nome" autoComplete="name" value={c.nome} onChange={mudar('nome')} erro={erros.nome} />
            <Campo rotulo="Senha" testId="primeiro-acesso.senha" type="password" autoComplete="new-password" value={c.senha} onChange={mudar('senha')} erro={erros.senha} ajuda={`${SENHA_SUPER_ADMIN_MIN} caracteres ou mais. Use um gerenciador de senhas.`} />
            <Campo rotulo="Repita a senha" testId="primeiro-acesso.confirmacao" type="password" autoComplete="new-password" value={c.confirmacao} onChange={mudar('confirmacao')} erro={erros.confirmacao} />
            <Campo rotulo="Código de convite" testId="primeiro-acesso.convite" type="password" autoComplete="off" spellCheck={false} value={c.convite} onChange={mudar('convite')} erro={erros.convite} ajuda="O segredo PROD_SUPERADMIN_CONVITE do deploy." />
            <Button data-testid="primeiro-acesso.criar" type="submit" variant="primary" disabled={enviando}>
              {enviando ? 'Criando…' : 'Criar acesso e cadastrar o 2º fator'}
            </Button>
            <Link href="/entrar" className="text-[12px] font-semibold text-accent no-underline hover:text-accent-ink">
              Já tenho acesso: entrar
            </Link>
          </>
        )}
      </form>
    </MolduraEstreita>
  );
}
