<#
  Axthrowa kod imzalama sertifikasini bu bilgisayara kurar.

  Kullanim:
    Kurmak icin   :  Sertifikayi-Kur.bat  (cift tik)
    Kaldirmak icin:  powershell -ExecutionPolicy Bypass -File Sertifikayi-Kur.ps1 -Kaldir

  NE ISE YARAR
    "3D Baski Maliyet.exe" Axthrowa tarafindan imzalanmistir. Windows bu
    sertifikayi tanimadigi icin varsayilan olarak "Bilinmeyen yayimci"
    uyarisi cikarir. Bu sertifikayi kurdugunuzda Windows imzayi taniyacak
    ve uyari cikmayacaktir.

  GUVENLIK UYARISI
    Bu islem, Axthrowa sertifikasiyla imzalanmis HER programi bu kullanici
    icin guvenilir hale getirir. Yalnizca sertifikanin ve .exe dosyasinin
    guvendiginiz bir kaynaktan geldiginden eminseniz kurun.
#>

param([switch]$Kaldir)

$ErrorActionPreference = 'Stop'
$cerPath = Join-Path $PSScriptRoot 'Axthrowa-CodeSigning.cer'

if (-not (Test-Path $cerPath)) {
  Write-Host "HATA: Axthrowa-CodeSigning.cer bu klasorde bulunamadi." -ForegroundColor Red
  exit 1
}

$cer = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 $cerPath
$stores = @('Root', 'TrustedPublisher')

Write-Host ''
Write-Host '  Axthrowa Kod Imzalama Sertifikasi' -ForegroundColor Cyan
Write-Host '  ---------------------------------'
Write-Host "  Konu       : $($cer.Subject)"
Write-Host "  Parmak izi : $($cer.Thumbprint)"
Write-Host "  Gecerlilik : $($cer.NotBefore.ToString('dd.MM.yyyy')) - $($cer.NotAfter.ToString('dd.MM.yyyy'))"
Write-Host ''

# --- Kaldirma ---
if ($Kaldir) {
  $found = $false
  foreach ($s in $stores) {
    $path = "Cert:\CurrentUser\$s"
    Get-ChildItem $path | Where-Object Thumbprint -eq $cer.Thumbprint | ForEach-Object {
      Remove-Item -Path $_.PSPath -Force
      Write-Host "  Kaldirildi: $path" -ForegroundColor Yellow
      $found = $true
    }
  }
  if (-not $found) { Write-Host '  Sertifika zaten kurulu degildi.' }
  Write-Host ''
  exit 0
}

# --- Zaten kurulu mu? ---
$already = Get-ChildItem Cert:\CurrentUser\Root | Where-Object Thumbprint -eq $cer.Thumbprint
if ($already) {
  Write-Host '  Bu sertifika zaten kurulu. Yapilacak bir sey yok.' -ForegroundColor Green
  Write-Host ''
  exit 0
}

Write-Host '  UYARI: Bu sertifikayi kurmak, onunla imzalanmis her programi' -ForegroundColor Yellow
Write-Host '  bu kullanici icin guvenilir hale getirir.' -ForegroundColor Yellow
Write-Host ''
$answer = Read-Host '  Kurmak istiyor musunuz? (E/H)'
if ($answer -notmatch '^[EeYy]') {
  Write-Host '  Iptal edildi.'
  Write-Host ''
  exit 0
}

foreach ($s in $stores) {
  $store = New-Object System.Security.Cryptography.X509Certificates.X509Store($s, 'CurrentUser')
  $store.Open('ReadWrite')
  $store.Add($cer)
  $store.Close()
  Write-Host "  Eklendi: CurrentUser\$s" -ForegroundColor Green
}

Write-Host ''
Write-Host '  Tamam. Artik "3D Baski Maliyet.exe" imzali ve guvenilir gorunecek.' -ForegroundColor Green
Write-Host '  Kaldirmak icin bu dosyayi -Kaldir parametresiyle calistirin.'
Write-Host ''
