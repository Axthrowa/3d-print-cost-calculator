import { useEffect, useState } from 'react';
import { cx } from '../lib/cx';
import {
  ROLE_META,
  canChangeRole,
  canRemoveUser,
  createUser,
  validatePassword,
  validateUsername,
  type Role,
  type Session,
  type User,
} from '../lib/auth';
import { uid } from '../lib/storage';
import { SENSITIVE_FIELDS } from '../lib/vault';
import { Banner, NumberField, Section, SelectField, TextField } from './ui';
import type { Branding, DockApp } from '../types';
import type { MaintenanceSettings } from '../lib/workshop';

interface SettingsPanelProps {
  branding: Branding;
  onBrandingChange: (branding: Branding) => void;
  dock: DockApp[];
  onDockChange: (dock: DockApp[]) => void;
  users: User[];
  onUsersChange: (users: User[]) => void;
  session: Session | null;
  maintenance: MaintenanceSettings;
  onMaintenanceChange: (settings: MaintenanceSettings) => void;
  encrypted: boolean;
  onToggleEncryption: (on: boolean) => void;
  onToast: (tone: 'success' | 'warning' | 'error', text: string) => void;
}

const GEAR = (
  <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="3" />
    <path
      strokeLinecap="round"
      d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"
    />
  </svg>
);

const MAX_IMAGE_BYTES = 512 * 1024;

/** Görseli data URI'ye çevirir; büyük dosya veri dosyasını şişirir. */
function readImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_IMAGE_BYTES) {
      reject(new Error('Görsel 512 KB sınırını aşıyor.'));
      return;
    }
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      reject(new Error('Yalnızca PNG, JPEG veya WEBP.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Görsel okunamadı.'));
    reader.readAsDataURL(file);
  });
}

/** Görsel yükleme kutusu; önizleme ve kaldırma ile. */
function ImageField({
  label,
  hint,
  value,
  onChange,
  onError,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (dataUri: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <div>
      <p className="field-label">{label}</p>
      <div className="flex items-center gap-3">
        <div className="grid h-16 w-28 shrink-0 place-items-center overflow-hidden rounded-lg border border-dashed border-slate-300 bg-white dark:border-white/15 dark:bg-white/[0.04]">
          {value ? (
            <img src={value} alt="" className="max-h-full max-w-full object-contain" />
          ) : (
            <span className="text-[10px] text-slate-400">yok</span>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <label className="btn-ghost cursor-pointer !px-3 !py-1.5 !text-xs">
            Dosya seç
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                readImage(file)
                  .then(onChange)
                  .catch((error: Error) => onError(error.message));
              }}
            />
          </label>
          {value && (
            <button
              type="button"
              className="btn-ghost !px-3 !py-1.5 !text-xs"
              onClick={() => onChange('')}
            >
              Kaldır
            </button>
          )}
        </div>
      </div>
      <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>
    </div>
  );
}

export function SettingsPanel({
  branding,
  onBrandingChange,
  dock,
  onDockChange,
  users,
  onUsersChange,
  session,
  maintenance,
  onMaintenanceChange,
  encrypted,
  onToggleEncryption,
  onToast,
}: SettingsPanelProps) {
  const [newUser, setNewUser] = useState({
    username: '',
    displayName: '',
    password: '',
    role: 'operator' as Role,
  });
  const [userErrors, setUserErrors] = useState<string[]>([]);
  const [slicers, setSlicers] = useState<Array<{ id: string; label: string; path: string }>>([]);
  const [inbox, setInbox] = useState<{ listening: string; tokenSet: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/slicers')
      .then((response) => response.json())
      .then((body: { slicers?: Array<{ id: string; label: string; path: string }> }) => {
        if (alive) setSlicers(body.slicers ?? []);
      })
      .catch(() => undefined);
    fetch('/api/inbox')
      .then((response) => response.json())
      .then((body: { listening?: string; tokenSet?: boolean }) => {
        if (alive && body.listening) {
          setInbox({ listening: body.listening, tokenSet: Boolean(body.tokenSet) });
        }
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const addUser = async () => {
    const problems = [
      ...validateUsername(users, newUser.username),
      ...validatePassword(newUser.password),
    ];
    if (problems.length > 0) {
      setUserErrors(problems);
      return;
    }
    const created = await createUser(
      uid('kul'),
      newUser.username,
      newUser.displayName,
      newUser.role,
      newUser.password,
      new Date().toISOString(),
    );
    onUsersChange([...users, created]);
    setNewUser({ username: '', displayName: '', password: '', role: 'operator' });
    setUserErrors([]);
    onToast('success', `${created.displayName} eklendi.`);
  };

  return (
    <div className="space-y-4">
      <Section
        title="Kurumsal Kimlik"
        icon={GEAR}
        description="Logo ve imza; kenar çubuğunda ve faturalarda görünür."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField
            label="İşletme adı"
            value={branding.businessName}
            onChange={(businessName) => onBrandingChange({ ...branding, businessName })}
            placeholder="Axthrowa 3D Baskı"
          />
          <TextField
            label="İmza altı yazısı"
            value={branding.signatureLabel}
            onChange={(signatureLabel) => onBrandingChange({ ...branding, signatureLabel })}
            placeholder="Yetkili imza"
          />
        </div>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <ImageField
            label="Logo"
            hint="Faturanın üstünde ve menüde görünür. PNG/JPEG, en fazla 512 KB."
            value={branding.logo}
            onChange={(logo) => onBrandingChange({ ...branding, logo })}
            onError={(message) => onToast('error', message)}
          />
          <ImageField
            label="İmza"
            hint="Faturanın altına, onaylayan bölümüne yerleşir."
            value={branding.signature}
            onChange={(signature) => onBrandingChange({ ...branding, signature })}
            onError={(message) => onToast('error', message)}
          />
        </div>
      </Section>

      <Section
        title="Güvenlik"
        icon={GEAR}
        description="Veri dosyası şifrelemesi ve kullanıcı hesapları."
      >
        <div
          className={cx(
            'rounded-xl border p-3.5',
            encrypted
              ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-500/25 dark:bg-emerald-500/10'
              : 'border-amber-300 bg-amber-50 dark:border-amber-500/25 dark:bg-amber-500/10',
          )}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-[12px] font-semibold text-slate-800 dark:text-slate-100">
                Veri dosyası {encrypted ? 'şifreli' : 'şifresiz'}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-600 dark:text-slate-300">
                {encrypted
                  ? 'AES-256-GCM · anahtar parolanızdan türetilir, diskte saklanmaz.'
                  : `Şifresizken şu alanlar diskte düz metindir: ${SENSITIVE_FIELDS.join(', ')}.`}
              </p>
            </div>
            <button
              type="button"
              className={cx(encrypted ? 'btn-ghost' : 'btn-primary', '!px-3 !py-1.5 !text-xs')}
              onClick={() => onToggleEncryption(!encrypted)}
            >
              {encrypted ? 'Şifrelemeyi kapat' : 'Şifrelemeyi aç'}
            </button>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {users.map((user) => (
            <div
              key={user.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 p-3 dark:border-white/10"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">
                  {user.displayName}
                  {session?.userId === user.id && (
                    <span className="ml-2 text-[10px] font-normal text-slate-400">(siz)</span>
                  )}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {user.username} · {ROLE_META[user.role].label}
                  {user.master && ' · ana yönetici'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <SelectField<Role>
                  label=""
                  value={user.role}
                  options={[
                    { value: 'admin', label: ROLE_META.admin.label },
                    { value: 'operator', label: ROLE_META.operator.label },
                  ]}
                  onChange={(role) => {
                    if (!canChangeRole(users, user.id)) return;
                    onUsersChange(users.map((u) => (u.id === user.id ? { ...u, role } : u)));
                  }}
                />
                <button
                  type="button"
                  className="btn-ghost !px-2.5 !py-1 !text-[11px]"
                  disabled={!canRemoveUser(users, user.id)}
                  title={
                    canRemoveUser(users, user.id) ? 'Kullanıcıyı sil' : 'Son yönetici silinemez'
                  }
                  onClick={() => onUsersChange(users.filter((u) => u.id !== user.id))}
                >
                  Sil
                </button>
              </div>
            </div>
          ))}
        </div>

        {userErrors.length > 0 && (
          <div className="mt-3">
            <Banner tone="warning">
              <ul className="list-inside list-disc">
                {userErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </Banner>
          </div>
        )}

        <div className="mt-3 grid gap-3 rounded-xl border border-dashed border-slate-300 p-3.5 sm:grid-cols-4 dark:border-white/10">
          <TextField
            label="Kullanıcı adı"
            value={newUser.username}
            onChange={(username) => setNewUser({ ...newUser, username })}
          />
          <TextField
            label="Görünen ad"
            value={newUser.displayName}
            onChange={(displayName) => setNewUser({ ...newUser, displayName })}
          />
          <div>
            <label className="field-label" htmlFor="yeni-parola">
              Parola
            </label>
            <input
              id="yeni-parola"
              type="password"
              className="field-input"
              value={newUser.password}
              onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
            />
          </div>
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <SelectField<Role>
                label="Rol"
                value={newUser.role}
                options={[
                  { value: 'operator', label: ROLE_META.operator.label },
                  { value: 'admin', label: ROLE_META.admin.label },
                ]}
                onChange={(role) => setNewUser({ ...newUser, role })}
              />
            </div>
            <button
              type="button"
              className="btn-primary !px-3 !py-2 !text-xs"
              onClick={() => void addUser()}
            >
              Ekle
            </button>
          </div>
        </div>
      </Section>

      <Section
        title="Hızlı Başlatıcı"
        icon={GEAR}
        description="Cura, PrusaSlicer, Blender gibi programları menüden açın."
      >
        <div className="space-y-2">
          {dock.map((app) => (
            <div key={app.id} className="flex flex-wrap items-center gap-2">
              <input
                aria-label="Simge"
                className="field-input w-14 text-center !py-1.5"
                maxLength={2}
                value={app.icon}
                onChange={(event) =>
                  onDockChange(
                    dock.map((a) => (a.id === app.id ? { ...a, icon: event.target.value } : a)),
                  )
                }
              />
              <input
                aria-label="Program adı"
                className="field-input w-40 !py-1.5 !text-[12px]"
                value={app.label}
                placeholder="PrusaSlicer"
                onChange={(event) =>
                  onDockChange(
                    dock.map((a) => (a.id === app.id ? { ...a, label: event.target.value } : a)),
                  )
                }
              />
              <input
                aria-label="Program yolu"
                className="field-input min-w-[12rem] flex-1 !py-1.5 !text-[11px]"
                value={app.path}
                placeholder="C:\\Program Files\\Prusa3D\\PrusaSlicer\\prusa-slicer.exe"
                onChange={(event) =>
                  onDockChange(
                    dock.map((a) => (a.id === app.id ? { ...a, path: event.target.value } : a)),
                  )
                }
              />
              <button
                type="button"
                className="btn-ghost !px-2.5 !py-1 !text-[11px]"
                onClick={() => onDockChange(dock.filter((a) => a.id !== app.id))}
              >
                Sil
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn-ghost !px-3 !py-1.5 !text-xs"
            onClick={() =>
              onDockChange([...dock, { id: uid('dock'), label: '', path: '', icon: '⚙' }])
            }
          >
            + Kısayol ekle
          </button>
          {slicers.length > 0 && (
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Bulunan dilimleyiciler: {slicers.map((slicer) => slicer.label).join(', ')} — yollarını
              yukarı kopyalayabilirsiniz.
            </p>
          )}
        </div>
      </Section>

      <Section
        title="Bakım ve Entegrasyon"
        icon={GEAR}
        description="Yazıcı bakım aralığı ve dış sipariş ucu."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField
            label="Bakım aralığı"
            value={maintenance.intervalHours}
            onChange={(intervalHours) => onMaintenanceChange({ ...maintenance, intervalHours })}
            suffix="sa"
            min={1}
            hint="Bu süre dolunca yazıcı için bakım uyarısı çıkar."
          />
          <div>
            <p className="field-label">Dilimleyici</p>
            <p className="text-[12px] text-slate-600 dark:text-slate-300">
              {slicers.length > 0
                ? slicers.map((slicer) => slicer.label).join(', ')
                : 'Kurulu dilimleyici bulunamadı.'}
            </p>
            <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">
              STL içe aktarırken "Dilimle" düğmesi bunu kullanır.
            </p>
          </div>
        </div>

        {inbox && (
          <div className="mt-3 rounded-xl bg-slate-100/70 p-3 dark:bg-white/[0.05]">
            <p className="text-[12px] font-semibold text-slate-700 dark:text-slate-200">
              E-ticaret sipariş ucu
            </p>
            <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500 dark:text-slate-400">
              POST {inbox.listening}
            </p>
            <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
              Bu adres yalnızca bu bilgisayardan erişilebilir. Shopify/Etsy/Shopier'in ulaşabilmesi
              için cloudflared veya ngrok gibi bir tünel gerekir.
              {inbox.tokenSet
                ? ' Paylaşılan anahtar tanımlı.'
                : ' Güvenlik için WEBHOOK_TOKEN ortam değişkenini tanımlayın.'}
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}
