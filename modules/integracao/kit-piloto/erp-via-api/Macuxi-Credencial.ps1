# T-0162 — Gerenciador de Credenciais do Windows (Credential Manager), por usuário. Segredo só passa pela memória.
# Uso: . .\Macuxi-Credencial.ps1 ; Gravar-Credencial 'Macuxi.Piloto/hub_chave_api' $texto ; Ler-Credencial 'Macuxi.Piloto/hub_chave_api'
if (-not ('Macuxi.CredencialWin' -as [type])) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
namespace Macuxi {
  public static class CredencialWin {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct CREDENTIAL {
      public uint Flags; public uint Type; public string TargetName; public string Comment;
      public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten; public uint CredentialBlobSize;
      public IntPtr CredentialBlob; public uint Persist; public uint AttributeCount; public IntPtr Attributes;
      public string TargetAlias; public string UserName;
    }
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredWrite(ref CREDENTIAL c, uint flags);
    [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredRead(string target, uint type, uint flags, out IntPtr c);
    [DllImport("advapi32.dll")] static extern void CredFree(IntPtr c);
    public static void Gravar(string alvo, string valor) {
      byte[] bytes = Encoding.Unicode.GetBytes(valor);
      IntPtr blob = Marshal.AllocCoTaskMem(bytes.Length);
      try {
        Marshal.Copy(bytes, 0, blob, bytes.Length);
        CREDENTIAL c = new CREDENTIAL();
        c.Type = 1; c.TargetName = alvo; c.UserName = "macuxi"; c.CredentialBlobSize = (uint)bytes.Length;
        c.CredentialBlob = blob; c.Persist = 2; // 2 = persiste neste computador
        if (!CredWrite(ref c, 0)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      } finally { Marshal.FreeCoTaskMem(blob); }
    }
    public static string Ler(string alvo) {
      IntPtr p;
      if (!CredRead(alvo, 1, 0, out p)) return null;
      try {
        CREDENTIAL c = (CREDENTIAL)Marshal.PtrToStructure(p, typeof(CREDENTIAL));
        return Marshal.PtrToStringUni(c.CredentialBlob, (int)c.CredentialBlobSize / 2);
      } finally { CredFree(p); }
    }
  }
}
'@
}

function Gravar-Credencial([string]$Alvo, [string]$Valor) { [Macuxi.CredencialWin]::Gravar($Alvo, $Valor) }
function Ler-Credencial([string]$Alvo) { [Macuxi.CredencialWin]::Ler($Alvo) }
