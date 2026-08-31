//! 3D Baski Maliyet Hesaplayici — Tauri arka ucu.
//!
//! Rust tarafi yalnizca tarayicinin yapamadigi isi ustlenir: uzak sayfalari
//! CORS kisiti olmadan indirmek ve bunu guvenli yapmak. Fiyat/teknik bilgi
//! ayristirmasi arayuzdeki (TypeScript) saf modullerde kalir; boylece ayni
//! kod hem masaustunde hem tarayicida calisir ve birim testleri gecerli olur.

use std::collections::HashMap;
use std::net::IpAddr;
use std::time::Duration;

use serde::{Deserialize, Serialize};

const USER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                          (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_SECS: u64 = 15;
const MAX_BODY_BYTES: usize = 4 * 1024 * 1024;

#[derive(Serialize)]
pub struct FetchedPage {
    html: String,
    final_url: String,
}

/// Ozel ag adreslerini (yerel ag, loopback, link-local) reddeder.
fn is_private(ip: &IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            let o = v4.octets();
            v4.is_loopback()
                || v4.is_private()
                || v4.is_link_local()
                || v4.is_broadcast()
                || v4.is_documentation()
                || v4.is_unspecified()
                || o[0] == 0
                || (o[0] == 100 && (64..=127).contains(&o[1])) // CGNAT
                || o[0] >= 224 // multicast / reserved
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || v6.is_unspecified()
                || matches!(v6.segments()[0] & 0xfe00, 0xfc00) // benzersiz yerel
                || matches!(v6.segments()[0] & 0xffc0, 0xfe80) // link-local
                || v6.to_ipv4_mapped().is_some_and(|v4| is_private(&IpAddr::V4(v4)))
        }
    }
}

/// Adresi dogrular ve yerel aga cikisi engeller (SSRF korumasi).
fn assert_public(raw: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(raw)
        .map_err(|_| "Gecersiz adres. http:// veya https:// ile baslamalidir.".to_string())?;

    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Yalnizca http ve https adresleri desteklenir.".into());
    }

    let host = parsed
        .host_str()
        .ok_or_else(|| "Adreste alan adi yok.".to_string())?;
    let port = parsed.port_or_known_default().unwrap_or(443);

    // DNS cozumlemesi: donen tum adresler genel olmali.
    let addrs = std::net::ToSocketAddrs::to_socket_addrs(&(host, port))
        .map_err(|_| format!("Alan adi cozumlenemedi: {host}"))?;

    let mut any = false;
    for addr in addrs {
        any = true;
        if is_private(&addr.ip()) {
            return Err("Yerel ag adreslerine istek yapilamaz.".into());
        }
    }
    if !any {
        return Err(format!("Alan adi cozumlenemedi: {host}"));
    }

    Ok(parsed)
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(Duration::from_secs(TIMEOUT_SECS))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|e| format!("Istemci olusturulamadi: {e}"))
}

/// Govdeyi sayfanin kendi karakter kodlamasina gore metne cevirir.
/// Turkce e-ticaret siteleri sik sik windows-1254 kullanir.
fn decode_body(bytes: &[u8], content_type: Option<&str>) -> String {
    let head = &bytes[..bytes.len().min(4096)];
    let head_ascii = String::from_utf8_lossy(head).to_lowercase();

    let charset = content_type
        .and_then(|ct| {
            ct.to_lowercase()
                .split("charset=")
                .nth(1)
                .map(|s| s.trim().trim_matches('"').to_string())
        })
        .or_else(|| {
            head_ascii.split("charset=").nth(1).map(|rest| {
                rest.trim_start()
                    .trim_start_matches(['"', '\''])
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                    .collect::<String>()
            })
        })
        .unwrap_or_else(|| "utf-8".into());

    let label = if charset == "iso-8859-9" { "windows-1254" } else { &charset };
    let encoding = encoding_rs::Encoding::for_label(label.as_bytes())
        .unwrap_or(encoding_rs::UTF_8);

    encoding.decode(bytes).0.into_owned()
}

/// Verilen adresi indirir. Ayristirma arayuzde yapilir.
#[tauri::command]
async fn fetch_page(url: String) -> Result<FetchedPage, String> {
    assert_public(&url)?;

    let response = client()?
        .get(&url)
        .header("accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")
        .header("accept-language", "tr-TR,tr;q=0.9,en;q=0.8")
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                "Sayfa zaman asimina ugradi. Site yavas olabilir, tekrar deneyin.".to_string()
            } else {
                "Sayfaya baglanilamadi. Adresi ve internet baglantinizi kontrol edin.".to_string()
            }
        })?;

    if !response.status().is_success() {
        return Err(format!(
            "Site {} yaniti dondu. Sayfa bot korumasi kullaniyor olabilir; bilgileri manuel girin.",
            response.status().as_u16()
        ));
    }

    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);

    if let Some(ct) = &content_type {
        let lower = ct.to_lowercase();
        let ok = lower.contains("text/html")
            || lower.contains("application/xhtml")
            || lower.contains("text/plain")
            || lower.contains("application/json");
        if !ok {
            let kind = lower.split(';').next().unwrap_or(&lower).to_string();
            return Err(format!("Desteklenmeyen icerik turu: {kind}"));
        }
    }

    let final_url = response.url().to_string();
    let bytes = response
        .bytes()
        .await
        .map_err(|_| "Sayfa icerigi okunamadi.".to_string())?;

    let truncated = &bytes[..bytes.len().min(MAX_BODY_BYTES)];
    Ok(FetchedPage {
        html: decode_body(truncated, content_type.as_deref()),
        final_url,
    })
}

// ------------------------------------------------------------ Yazicilar
//
// Agdaki yazicilarla (Moonraker / OctoPrint / Snapmaker) konusan katman.
// Node surumundeki `/api/printer/*` uclarinin birebir karsiligidir: hangi
// adrese ne sorulacagi bilgisi arayuzdeki `printerLink.ts` dosyasinda durur,
// burasi yalnizca verilen goreli yola gider ve ham cevabi doner.
//
// Not: yerel ag adresleri BILEREK serbesttir. Fiyat cekmede ozel adresler
// SSRF'e karsi kapatilir; burada ise hedef zaten kullanicinin kendi
// yazicisidir ve adresi elle girmistir.

const PRINTER_TIMEOUT_SECS: u64 = 8;
const PRINTER_UPLOAD_TIMEOUT_SECS: u64 = 10 * 60;

#[derive(Serialize)]
pub struct PrinterReply {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<u16>,
}

impl PrinterReply {
    fn failed(message: impl Into<String>) -> Self {
        PrinterReply { ok: false, error: Some(message.into()), payload: None, status: None }
    }
}

#[derive(Deserialize)]
pub struct StatusPath {
    #[serde(default)]
    key: String,
    path: String,
}

/// Yaziciya gidecek taban adresi dogrular.
fn assert_printer_base(raw: &str) -> Result<String, String> {
    let parsed = url::Url::parse(raw).map_err(|_| "Yazici adresi gecersiz.".to_string())?;
    if parsed.scheme() != "http" && parsed.scheme() != "https" {
        return Err("Yalnizca http/https adresleri desteklenir.".into());
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        return Err("Adreste kullanici bilgisi olamaz.".into());
    }
    let host = parsed.host_str().ok_or("Yazici adresi eksik.")?;
    Ok(match parsed.port() {
        Some(port) => format!("{}://{}:{}", parsed.scheme(), host, port),
        None => format!("{}://{}", parsed.scheme(), host),
    })
}

/// Istemcinin verdigi yol ayni sunucuda goreli olmalidir.
fn assert_printer_path(raw: &str) -> Result<String, String> {
    if !raw.starts_with('/') || raw.starts_with("//") {
        return Err("Yazici yolu \"/\" ile baslamalidir.".into());
    }
    Ok(raw.to_string())
}

/// Satir sonu enjeksiyonuna izin vermeyen baslik suzgeci.
fn safe_headers(raw: &HashMap<String, String>) -> Vec<(String, String)> {
    raw.iter()
        .filter(|(key, value)| {
            key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
                && !value.contains(['\r', '\n'])
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn printer_error(status: u16) -> String {
    match status {
        401 | 403 => "API anahtari reddedildi.".into(),
        404 => "Yazici bu API ucunu tanimiyor. Baglanti turunu kontrol edin.".into(),
        409 => "Yazici mesgul; islem simdi yapilamiyor.".into(),
        other => format!("Yazici {other} kodu dondurdu."),
    }
}

fn network_message(error: &reqwest::Error) -> String {
    if error.is_timeout() {
        "Yazici zamaninda cevap vermedi.".into()
    } else if error.is_connect() {
        "Baglanti kurulamadi. Adres ve port dogru mu?".into()
    } else {
        "Yaziciya ulasilamadi.".into()
    }
}

fn printer_client(timeout_secs: u64) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|e| format!("Istemci olusturulamadi: {e}"))
}

/// Yazicinin durumunu okur; istenen yollarin cevaplarini birlestirir.
#[tauri::command]
async fn printer_status(
    base: String,
    paths: Vec<StatusPath>,
    headers: HashMap<String, String>,
) -> Result<PrinterReply, String> {
    let base = assert_printer_base(&base)?;
    if paths.is_empty() {
        return Err("Sorgu yolu verilmedi.".into());
    }
    let client = printer_client(PRINTER_TIMEOUT_SECS)?;
    let allowed = safe_headers(&headers);
    let mut payload = serde_json::Map::new();

    for item in paths.iter().take(4) {
        let path = assert_printer_path(&item.path)?;
        let mut request = client.get(format!("{base}{path}"));
        for (key, value) in &allowed {
            request = request.header(key.as_str(), value.as_str());
        }

        let response = match request.send().await {
            Ok(response) => response,
            Err(error) => return Ok(PrinterReply::failed(network_message(&error))),
        };
        let status = response.status().as_u16();
        if !response.status().is_success() {
            return Ok(PrinterReply {
                ok: false,
                error: Some(printer_error(status)),
                payload: None,
                status: Some(status),
            });
        }

        let value: serde_json::Value = response.json().await.unwrap_or(serde_json::Value::Null);
        if item.key.is_empty() {
            if let serde_json::Value::Object(map) = value {
                payload.extend(map);
            }
        } else {
            payload.insert(item.key.clone(), value);
        }
    }

    Ok(PrinterReply {
        ok: true,
        error: None,
        payload: Some(serde_json::Value::Object(payload)),
        status: None,
    })
}

/// Duraklat / devam et / iptal gibi komutlari iletir.
#[tauri::command]
async fn printer_command(
    base: String,
    path: String,
    headers: HashMap<String, String>,
    body: Option<serde_json::Value>,
) -> Result<PrinterReply, String> {
    let base = assert_printer_base(&base)?;
    let path = assert_printer_path(&path)?;
    let client = printer_client(PRINTER_TIMEOUT_SECS)?;

    let mut request = client.post(format!("{base}{path}"));
    for (key, value) in safe_headers(&headers) {
        request = request.header(key.as_str(), value.as_str());
    }
    request = match body {
        Some(value) => request.json(&value),
        None => request.header(reqwest::header::CONTENT_LENGTH, "0"),
    };

    match request.send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            let ok = response.status().is_success();
            Ok(PrinterReply {
                ok,
                error: if ok { None } else { Some(printer_error(status)) },
                payload: None,
                status: Some(status),
            })
        }
        Err(error) => Ok(PrinterReply::failed(network_message(&error))),
    }
}

/// G-code dosyasini yaziciya yukler ve istenirse baskiyi baslatir.
/// Dosya diskten okunur; arayuz yalnizca yolunu verir.
#[tauri::command]
async fn printer_upload(
    base: String,
    path: String,
    field: String,
    fields: HashMap<String, String>,
    headers: HashMap<String, String>,
    file_path: String,
    filename: String,
) -> Result<PrinterReply, String> {
    let base = assert_printer_base(&base)?;
    let path = assert_printer_path(&path)?;
    let bytes = std::fs::read(&file_path).map_err(|_| "Dosya okunamadi.".to_string())?;
    if bytes.is_empty() {
        return Ok(PrinterReply::failed("Dosya bos gorunuyor."));
    }

    let safe_name = filename
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("baski.gcode")
        .replace(['"', '\'', '\r', '\n'], "");
    let part = reqwest::multipart::Part::bytes(bytes)
        .file_name(if safe_name.is_empty() { "baski.gcode".to_string() } else { safe_name })
        .mime_str("application/octet-stream")
        .map_err(|e| format!("Dosya hazirlanamadi: {e}"))?;

    let mut form = reqwest::multipart::Form::new().part(field, part);
    for (key, value) in fields {
        form = form.text(key, value);
    }

    let client = printer_client(PRINTER_UPLOAD_TIMEOUT_SECS)?;
    let mut request = client.post(format!("{base}{path}")).multipart(form);
    for (key, value) in safe_headers(&headers) {
        request = request.header(key.as_str(), value.as_str());
    }

    match request.send().await {
        Ok(response) => {
            let status = response.status().as_u16();
            let ok = response.status().is_success();
            Ok(PrinterReply {
                ok,
                error: if ok { None } else { Some(printer_error(status)) },
                payload: None,
                status: Some(status),
            })
        }
        Err(error) => Ok(PrinterReply::failed(network_message(&error))),
    }
}

/// Yazici teknik bilgisi icin aday sayfa adresleri toplar (en iyi caba).
#[tauri::command]
async fn search_web(query: String, limit: usize) -> Result<Vec<String>, String> {
    let endpoint = format!(
        "https://html.duckduckgo.com/html/?q={}",
        urlencode(&query)
    );
    let page = fetch_page(endpoint).await?;

    let mut urls: Vec<String> = Vec::new();
    for part in page.html.split("result__a").skip(1) {
        let Some(href_at) = part.find("href=\"") else { continue };
        let rest = &part[href_at + 6..];
        let Some(end) = rest.find('"') else { continue };
        let mut href = rest[..end].replace("&amp;", "&");

        // DuckDuckGo yonlendirme baglantisini coz.
        if let Some(idx) = href.find("uddg=") {
            let encoded: String = href[idx + 5..]
                .chars()
                .take_while(|c| *c != '&')
                .collect();
            href = urldecode(&encoded);
        }

        if href.starts_with("http") && !urls.contains(&href) {
            urls.push(href);
            if urls.len() >= limit.clamp(1, 8) {
                break;
            }
        }
    }
    Ok(urls)
}

fn urlencode(input: &str) -> String {
    let mut out = String::with_capacity(input.len() * 3);
    for byte in input.as_bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(*byte as char)
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

fn urldecode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(value) => {
                        out.push(value);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            other => {
                out.push(other);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            fetch_page,
            search_web,
            printer_status,
            printer_command,
            printer_upload
        ])
        .run(tauri::generate_context!())
        .expect("Tauri uygulamasi baslatilamadi");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ozel_adresler_reddedilir() {
        for host in [
            "http://127.0.0.1/",
            "http://localhost:8080/",
            "http://192.168.1.5/",
            "http://10.0.0.1/",
            "http://169.254.169.254/",
        ] {
            assert!(assert_public(host).is_err(), "{host} reddedilmeliydi");
        }
    }

    #[test]
    fn gecersiz_semalar_reddedilir() {
        assert!(assert_public("file:///C:/Windows/win.ini").is_err());
        assert!(assert_public("ftp://ornek.com/").is_err());
        assert!(assert_public("bu bir adres degil").is_err());
    }

    #[test]
    fn windows_1254_cozulur() {
        // "Şişli" kelimesi windows-1254 baytlariyla.
        let bytes = [
            b'<', b'm', b'e', b't', b'a', b' ', b'c', b'h', b'a', b'r', b's', b'e', b't', b'=',
            b'w', b'i', b'n', b'd', b'o', b'w', b's', b'-', b'1', b'2', b'5', b'4', b'>', 0xDE,
            0x69, 0xFE, b'l', b'i',
        ];
        let text = decode_body(&bytes, None);
        assert!(text.contains("Şişli"), "cozulen metin: {text}");
    }

    #[test]
    fn utf8_varsayilan_kodlamadir() {
        let text = decode_body("fiyat 749,90 ₺".as_bytes(), Some("text/html; charset=utf-8"));
        assert!(text.contains("749,90"));
        assert!(text.contains('₺'));
    }

    #[test]
    fn yazici_adresi_dogrulanir() {
        assert_eq!(assert_printer_base("http://192.168.1.50:7125").unwrap(), "http://192.168.1.50:7125");
        assert_eq!(assert_printer_base("http://octopi.local/x").unwrap(), "http://octopi.local");
        assert!(assert_printer_base("file:///c:/gizli").is_err());
        assert!(assert_printer_base("http://kul:sifre@1.2.3.4").is_err());
    }

    #[test]
    fn yazici_yolu_goreli_olmali() {
        assert!(assert_printer_path("/api/job").is_ok());
        assert!(assert_printer_path("http://baska/x").is_err());
        assert!(assert_printer_path("//baska/x").is_err());
    }

    #[test]
    fn bozuk_baslik_elenir() {
        let mut headers = HashMap::new();
        headers.insert("X-Api-Key".to_string(), "gizli".to_string());
        headers.insert("Kotu".to_string(), "a
b".to_string());
        headers.insert("bos luk".to_string(), "x".to_string());
        let allowed = safe_headers(&headers);
        assert_eq!(allowed.len(), 1);
        assert_eq!(allowed[0].0, "X-Api-Key");
    }

    #[test]
    fn url_kodlama_cift_yonlu() {
        assert_eq!(urlencode("bambu lab p1s"), "bambu+lab+p1s");
        assert_eq!(urldecode("https%3A%2F%2Fornek.com%2Fa"), "https://ornek.com/a");
        assert_eq!(urldecode(&urlencode("3d yazici")), "3d yazici");
    }
}
