/**
 * Fatura belgesi (bağımsız HTML).
 *
 * Aynı çıktı üç yerde kullanılır: ekrandaki önizleme, yazıcıya gönderme ve
 * PDF üretimi. Tek kaynak olduğu için ekranda gördüğünüz ile PDF birebir
 * aynıdır. Belge kendi CSS'ini taşır; uygulamanın Tailwind stilinden bağımsız
 * çalışır, çünkü PDF'i üreten başsız tarayıcı uygulama stillerini görmez.
 */

import { formatDate, formatTRY } from './format';
import { INVOICE_KIND_META, amountInWords, invoiceTotals, lineNet } from './invoice';
import { qrSvg } from './qr';
import type { Branding, Invoice, SellerInfo } from '../types';

/** HTML'e gömülecek her metin kaçırılır; müşteri adı işaret içerebilir. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Satır sonlarını koruyarak kaçırır (adres alanları için). */
function escapeLines(value: string): string {
  return escapeHtml(value).replace(/\r?\n/g, '<br />');
}

/** Boş alanlar belgeye hiç yazılmasın; boş etiket çirkin durur. */
function row(label: string, value: string): string {
  if (!value.trim()) return '';
  return `<div class="kv"><span>${escapeHtml(label)}</span><b>${escapeLines(value)}</b></div>`;
}

const STYLE = `
  @page { size: A4; margin: 14mm 14mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: "Segoe UI", "Inter", system-ui, -apple-system, Arial, sans-serif;
    font-size: 11px;
    line-height: 1.45;
    color: #14181f;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .sayfa { max-width: 182mm; margin: 0 auto; padding: 4mm 0; }
  .ust { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .satici h1 { margin: 0 0 2px; font-size: 15px; letter-spacing: -0.2px; }
  .satici p { margin: 0; color: #55606f; font-size: 10px; white-space: pre-line; }
  .belge { text-align: right; min-width: 190px; }
  .belge .tur {
    display: inline-block;
    padding: 4px 12px;
    border-radius: 4px;
    background: #101828;
    color: #fff;
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 1.4px;
    text-transform: uppercase;
  }
  .belge .no { margin-top: 6px; font-size: 15px; font-weight: 700; }
  .belge .tarih { color: #55606f; font-size: 10px; }
  hr { border: 0; border-top: 1.5px solid #101828; margin: 12px 0; }
  .taraflar { display: flex; gap: 12px; }
  .kutu { flex: 1; border: 1px solid #d8dee7; border-radius: 6px; padding: 9px 11px; }
  .kutu h2 {
    margin: 0 0 5px;
    font-size: 9px;
    letter-spacing: 1.1px;
    text-transform: uppercase;
    color: #6b7684;
    font-weight: 700;
  }
  .kutu .ad { font-size: 12px; font-weight: 700; margin-bottom: 3px; }
  .kv { display: flex; gap: 6px; font-size: 10px; }
  .kv span { color: #6b7684; min-width: 74px; }
  .kv b { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; }
  thead th {
    background: #101828;
    color: #fff;
    font-size: 9px;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    padding: 7px 8px;
    text-align: left;
    font-weight: 700;
  }
  tbody td { padding: 7px 8px; border-bottom: 1px solid #e6ebf1; vertical-align: top; }
  tbody tr:nth-child(even) td { background: #f7f9fc; }
  .sag { text-align: right; white-space: nowrap; }
  .orta { text-align: center; }
  .num { font-variant-numeric: tabular-nums; }
  .alt { display: flex; justify-content: space-between; gap: 16px; margin-top: 12px; }
  .yaziyla { flex: 1; font-size: 10px; color: #3d4757; }
  .yaziyla .baslik { color: #6b7684; text-transform: uppercase; letter-spacing: 0.8px; font-size: 9px; }
  .yaziyla .tutar { font-weight: 700; color: #14181f; text-transform: capitalize; }
  .toplamlar { min-width: 240px; }
  .toplamlar div { display: flex; justify-content: space-between; padding: 3px 0; font-size: 11px; }
  .toplamlar .genel {
    margin-top: 5px;
    padding-top: 7px;
    border-top: 1.5px solid #101828;
    font-size: 14px;
    font-weight: 700;
  }
  .notlar { margin-top: 14px; font-size: 10px; color: #3d4757; white-space: pre-line; }
  .dipnot {
    margin-top: 16px;
    padding-top: 8px;
    border-top: 1px solid #e6ebf1;
    font-size: 9px;
    color: #8a94a3;
    display: flex;
    justify-content: space-between;
    gap: 12px;
  }
  .logo { max-height: 52px; max-width: 190px; object-fit: contain; margin-bottom: 6px; }
  .onay { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; margin-top: 18px; }
  .imza { text-align: center; min-width: 170px; }
  .imza img { max-height: 56px; max-width: 170px; object-fit: contain; }
  .imza .cizgi { border-top: 1px solid #b6bfcc; margin-top: 4px; padding-top: 3px; font-size: 9px; color: #6b7684; }
  .qr { text-align: center; }
  .qr svg { width: 76px; height: 76px; }
  .qr span { display: block; font-size: 8px; color: #8a94a3; margin-top: 2px; }
  @media print { .sayfa { padding: 0; } }
`;

/** Faturanın tam HTML belgesini üretir. */
export function renderInvoiceHtml(
  invoice: Invoice,
  seller: SellerInfo,
  branding: Branding = { businessName: '', logo: '', signature: '', signatureLabel: '' },
): string {
  const totals = invoiceTotals(invoice);
  const kind = INVOICE_KIND_META[invoice.kind].label;

  const rows = invoice.lines
    .map((line, index) => {
      const net = lineNet(line, invoice.vatRate, invoice.vatIncluded);
      const unit = invoice.vatIncluded
        ? line.unitPrice / (1 + Math.max(0, invoice.vatRate) / 100)
        : line.unitPrice;
      return `
        <tr>
          <td class="orta num">${index + 1}</td>
          <td>${escapeHtml(line.name)}</td>
          <td class="orta num">${line.quantity}</td>
          <td class="sag num">${escapeHtml(formatTRY(unit))}</td>
          <td class="sag num">${escapeHtml(formatTRY(net))}</td>
        </tr>`;
    })
    .join('');

  const sellerLines = [seller.address, seller.phone, seller.email]
    .filter((part) => part.trim())
    .join('\n');
  const sellerTax = [seller.taxOffice, seller.taxNumber].filter((p) => p.trim()).join(' · ');

  // Kargo/paketleme etiketi icin QR. Uretilemezse fatura yine cikar.
  let qrCode = '';
  try {
    qrCode = qrSvg(invoice.number);
  } catch {
    qrCode = '';
  }

  const customerTitle = [invoice.customer.company, invoice.customer.name]
    .filter((part) => part.trim())
    .join(' — ');

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(invoice.number)}</title>
<style>${STYLE}</style>
</head>
<body>
  <div class="sayfa">
    <div class="ust">
      <div class="satici">
        ${branding.logo ? `<img class="logo" src="${escapeHtml(branding.logo)}" alt="" />` : ''}
        <h1>${escapeHtml(branding.businessName || seller.name || '3D Baskı Atölyesi')}</h1>
        <p>${escapeLines(sellerLines)}</p>
        ${sellerTax ? `<p>${escapeHtml(sellerTax)}</p>` : ''}
      </div>
      <div class="belge">
        <span class="tur">${escapeHtml(kind)}</span>
        <div class="no">${escapeHtml(invoice.number)}</div>
        <div class="tarih">Düzenlenme: ${escapeHtml(formatDate(invoice.issuedAt))}</div>
        ${
          invoice.dueDate && invoice.dueDate !== invoice.issuedAt
            ? `<div class="tarih">Vade: ${escapeHtml(formatDate(invoice.dueDate))}</div>`
            : ''
        }
      </div>
    </div>

    <hr />

    <div class="taraflar">
      <div class="kutu">
        <h2>Sayın</h2>
        <div class="ad">${escapeHtml(customerTitle || 'Müşteri')}</div>
        ${row('Adres', invoice.customer.address)}
        ${row('Vergi D.', invoice.customer.taxOffice)}
        ${row('VKN/TCKN', invoice.customer.taxNumber)}
        ${row('Telefon', invoice.customer.phone)}
        ${row('E-posta', invoice.customer.email)}
      </div>
      <div class="kutu">
        <h2>Ödeme</h2>
        ${row('IBAN', seller.iban)}
        ${row('Vade', formatDate(invoice.dueDate || invoice.issuedAt))}
        ${row('KDV oranı', `%${invoice.vatRate}`)}
        ${row('Fiyatlar', invoice.vatIncluded ? 'KDV dahil' : 'KDV hariç')}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="width:26px" class="orta">#</th>
          <th>Açıklama</th>
          <th style="width:52px" class="orta">Miktar</th>
          <th style="width:96px" class="sag">Birim Fiyat</th>
          <th style="width:104px" class="sag">Tutar</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>

    <div class="alt">
      <div class="yaziyla">
        <div class="baslik">Yalnız</div>
        <div class="tutar">${escapeHtml(amountInWords(totals.grand))}</div>
      </div>
      <div class="toplamlar num">
        <div><span>Ara toplam</span><span>${escapeHtml(formatTRY(totals.subtotal))}</span></div>
        ${
          totals.discount > 0
            ? `<div><span>İskonto</span><span>-${escapeHtml(formatTRY(totals.discount))}</span></div>
               <div><span>KDV matrahı</span><span>${escapeHtml(formatTRY(totals.taxable))}</span></div>`
            : ''
        }
        <div><span>KDV (%${invoice.vatRate})</span><span>${escapeHtml(formatTRY(totals.vat))}</span></div>
        <div class="genel"><span>Genel toplam</span><span>${escapeHtml(formatTRY(totals.grand))}</span></div>
      </div>
    </div>

    ${invoice.notes.trim() ? `<div class="notlar">${escapeLines(invoice.notes)}</div>` : ''}

    <div class="onay">
      <div class="qr">
        ${qrCode}
        <span>${escapeHtml(invoice.number)}</span>
      </div>
      <div class="imza">
        ${branding.signature ? `<img src="${escapeHtml(branding.signature)}" alt="" />` : ''}
        <div class="cizgi">${escapeHtml(branding.signatureLabel || 'Onaylayan')}</div>
      </div>
    </div>

    <div class="dipnot">
      <span>${escapeHtml(invoice.kind === 'proforma' ? 'Bu belge proformadır; mali değeri yoktur.' : 'Bu belge bilgi amaçlıdır.')}</span>
      <span>${escapeHtml(invoice.number)} · Created by axthrowa</span>
    </div>
  </div>
</body>
</html>`;
}
