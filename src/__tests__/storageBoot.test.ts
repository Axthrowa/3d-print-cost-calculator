import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Açılışta veri dosyası okuma davranışı.
 *
 * Tek denemede pes etmek, exe/bat kalkarken düşen ilk istekte uygulamayı
 * boş açıyordu: kayıtlı envanter ve siparişler yokmuş gibi görünüyor,
 * üstelik sonraki yazmalar diske değil tarayıcıya gidiyordu.
 */

const DISK = {
  ok: true,
  data: {
    users: [{ id: 'u1', username: 'axthrowa', displayName: 'Axthrowa', role: 'admin' }],
    data: { orders: [{ id: 'o1', code: 'SIP-0001', items: [] }] },
  },
};

/** Modül durumu (backend, mirror) testler arasında sızmasın. */
async function freshBoot() {
  vi.resetModules();
  const mod = await import('../lib/storage');
  return mod.boot();
}

const ok = () => new Response(JSON.stringify(DISK), { status: 200 });
const fail = (status: number) => new Response('hata', { status });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {},
    removeItem: () => {},
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('boot — sunucudan okuma', () => {
  it('ilk istek düşse de veriyi okur', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED')).mockResolvedValueOnce(ok());

    const state = await freshBoot();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(state.unreachable).toBeFalsy();
    expect(state.data?.orders).toHaveLength(1);
    expect(state.users).toHaveLength(1);
  });

  it('iki istek düşse de üçüncüde okur', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(ok());

    const state = await freshBoot();
    expect(state.data?.orders).toHaveLength(1);
  });

  it('sunucu hata veriyorsa boş veriyle açmaz', async () => {
    fetchMock.mockResolvedValue(fail(500));

    const state = await freshBoot();
    expect(state.unreachable).toBe(true);
    // Boş veri dönmek kullanıcıya "kayıtlarım gitti" dedirtirdi.
    expect(state.data).toBeNull();
  });

  it('sunucuya hiç ulaşılamıyorsa da boş veriyle açmaz', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));

    const state = await freshBoot();
    expect(state.unreachable).toBe(true);
    expect(state.data).toBeNull();
  });

  it('köprü yoksa (404) tarayıcı deposuna düşer', async () => {
    fetchMock.mockResolvedValue(fail(404));

    const state = await freshBoot();
    // 404 = böyle bir uç nokta yok (örn. `vite dev`); yeniden denemek anlamsız.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(state.unreachable).toBeFalsy();
    expect(state.data).not.toBeNull();
  });
});
