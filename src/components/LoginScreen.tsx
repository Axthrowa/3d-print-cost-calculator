import { useState } from 'react';
import { cx } from '../lib/cx';
import { MASTER_USERNAME, loginByUsername, masterUser, type Session, type User } from '../lib/auth';
import { Banner, Spinner } from './ui';

interface LoginScreenProps {
  users: User[];
  /** İlk yönetici oluşturulduğunda kaydeder. */
  onCreateFirstUser: (user: User) => void;
  /** Giriş başarılı: oturum ve veri anahtarı. */
  onLogin: (session: Session, key: string) => void;
  /** Kurumsal görünüm. */
  businessName: string;
  logo: string;
}

export function LoginScreen({
  users,
  onCreateFirstUser,
  onLogin,
  businessName,
  logo,
}: LoginScreenProps) {
  const [username, setUsername] = useState(MASTER_USERNAME);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setErrors([]);
    setBusy(true);
    try {
      let list = users;
      if (list.length === 0) {
        const user = masterUser(new Date().toISOString());
        onCreateFirstUser(user);
        list = [user];
      }

      const clean = username.trim();
      if (clean.length < 1) {
        setErrors(['Kullanıcı adı girin.']);
        return;
      }

      const result = await loginByUsername(list, clean);
      if (!result.ok || !result.session || !result.key) {
        setErrors([result.error ?? 'Giriş başarısız.']);
        return;
      }
      onLogin(result.session, result.key);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-slate-100 px-4 dark:bg-ink-950">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          {logo ? (
            <img src={logo} alt="" className="max-h-16 max-w-[180px] object-contain" />
          ) : (
            <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-accent-400 to-accent-600 text-white shadow-lg shadow-accent-500/25">
              <svg
                viewBox="0 0 24 24"
                className="size-6"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path strokeLinejoin="round" d="M4 16V8l8-4 8 4v8l-8 4z" />
                <path strokeLinejoin="round" d="M4 8l8 4 8-4M12 12v8" />
              </svg>
            </span>
          )}
          <div>
            <h1 className="text-lg font-bold text-slate-900 dark:text-white">
              {businessName || '3D Baskı Maliyet'}
            </h1>
            <p className="text-[12px] text-slate-500 dark:text-slate-400">
              Devam etmek için kullanıcı adınızı seçin
            </p>
          </div>
        </div>

        <div className="panel space-y-3 p-5">
          {errors.length > 0 && (
            <Banner tone="error">
              <ul className="list-inside list-disc">
                {errors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </Banner>
          )}

          <div>
            <label className="field-label" htmlFor="giris-kullanici">
              Kullanıcı adı
            </label>
            {users.length > 1 ? (
              <select
                id="giris-kullanici"
                className="field-input"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              >
                {users.map((user) => (
                  <option key={user.id} value={user.username}>
                    {user.displayName} ({user.username})
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="giris-kullanici"
                className="field-input"
                autoComplete="username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && void submit()}
              />
            )}
          </div>

          <button
            type="button"
            className={cx('btn-primary w-full !py-2.5', busy && 'opacity-70')}
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy ? <Spinner className="mx-auto size-4" /> : 'Devam et'}
          </button>
        </div>
      </div>
    </div>
  );
}
