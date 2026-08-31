import type { View } from '../components/Sidebar';

export interface ViewMeta {
  title: string;
  description: string;
  /** Mobil menüde kısa etiket. */
  short: string;
}

export const VIEW_META: Record<View, ViewMeta> = {
  dashboard: {
    title: 'Panel',
    description: 'Ciro, kâr, stok uyarıları ve üretim özeti.',
    short: 'Panel',
  },
  calc: {
    title: 'Yeni Hesaplama',
    description: 'Baskı dosyası yükleyin, filament ve süreyi girin; maliyet anında hesaplansın.',
    short: 'Hesap',
  },
  inventory: {
    title: 'Envanter',
    description: 'Filament makaraları, fiyat takibi ve kalan stok.',
    short: 'Stok',
  },
  catalog: {
    title: 'Hazır Ürünler',
    description: 'Kaydettiğiniz modeller; siparişe veya hesaplamaya tek tıkla.',
    short: 'Ürünler',
  },
  orders: {
    title: 'Siparişler',
    description: 'Müşteri fişleri, fiyatlandırma ve yazıcıya gönderme.',
    short: 'Sipariş',
  },
  gantt: {
    title: 'Üretim Takvimi',
    description: 'Bekleyen işlerin yazıcılara dağılımı ve teslim tarihleri.',
    short: 'Takvim',
  },
  jobs: {
    title: 'Baskılar',
    description: 'Üretim kuyruğu; bağlı yazıcıdaki işler otomatik eklenir.',
    short: 'Baskı',
  },
  invoices: {
    title: 'Faturalar',
    description: 'Proforma ve fatura, cari kartlar, PDF kayıt.',
    short: 'Fatura',
  },
  printers: {
    title: 'Yazıcılar',
    description: 'Ağ veya USB bağlantısı, canlı durum ve dosya gönderme.',
    short: 'Yazıcı',
  },
  backup: {
    title: 'Yedekler',
    description: 'Verinizi yedekleyin, geri yükleyin veya dışa aktarın.',
    short: 'Yedek',
  },
  settings: {
    title: 'Ayarlar',
    description: 'Logo, kullanıcılar, şifreleme ve program kısayolları.',
    short: 'Ayar',
  },
};

/** Kullanıcıya kavramları açıklayan kısa rehber. */
export const WORKFLOW_TIP =
  'Sipariş = müşteri fişi · Baskı = üretim kuyruğu · Yazıcı = cihaz bağlantısı';
