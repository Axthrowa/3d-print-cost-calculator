<#
  Uretilen .exe dosyasini "Axthrowa" sertifikasiyla imzalar.

  Kullanim:  powershell -ExecutionPolicy Bypass -File packaging\sign-exe.ps1

  NOT: Bu kendi urettigimiz (self-signed) bir sertifikadir. Imza, dosyanin
  sizin tarafinizdan uretildigini ve degistirilmedigini kanitlar; ancak
  BASKA bir bilgisayarda Windows bu sertifikayi tanimaz. Orada guvenilir
  gorunmesi icin Axthrowa-CodeSigning.cer dosyasinin o makinede
  "Guvenilen Kok Sertifika Yetkilileri" deposuna kurulmasi gerekir.
#>

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root 'packaging\build\3D Baski Maliyet.exe'

if (-not (Test-Path $exe)) {
  throw "exe bulunamadi. Once: node packaging\build-exe.mjs"
}

$signtool = Get-ChildItem 'C:\Program Files (x86)\Windows Kits\10\bin' -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -like '*\x64\*' } |
  Sort-Object FullName -Descending |
  Select-Object -First 1
if (-not $signtool) { throw 'signtool.exe bulunamadi (Windows SDK gerekli).' }

$cert = Get-ChildItem Cert:\CurrentUser\My |
  Where-Object { $_.Subject -like '*Axthrowa*' -and $_.HasPrivateKey } |
  Select-Object -First 1

if (-not $cert) {
  Write-Host 'Axthrowa sertifikasi yok, uretiliyor...'
  $cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject 'CN=Axthrowa, O=Axthrowa, C=TR' `
    -FriendlyName 'Axthrowa Code Signing' `
    -CertStoreLocation Cert:\CurrentUser\My `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA -KeyLength 3072 `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(5)
  Export-Certificate -Cert $cert -FilePath (Join-Path $PSScriptRoot 'Axthrowa-CodeSigning.cer') | Out-Null
}

Write-Host "Imzalaniyor: $($cert.Subject)  [$($cert.Thumbprint)]"

& $signtool.FullName sign /fd SHA256 /td SHA256 /tr 'http://timestamp.digicert.com' /sha1 $cert.Thumbprint $exe
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Zaman damgasi alinamadi; damgasiz imzalaniyor.'
  & $signtool.FullName sign /fd SHA256 /sha1 $cert.Thumbprint $exe
}

$sig = Get-AuthenticodeSignature $exe
Write-Host ''
Write-Host "Durum   : $($sig.Status)"
Write-Host "Yayimci : $($sig.SignerCertificate.Subject)"
