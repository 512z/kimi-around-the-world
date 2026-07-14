// Hash-based value noise (2D tileable / 3D seamless) + FBM.
// Deterministic, no dependencies.

export function ihash(i, j, k = 0) {
  let n = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263) + Math.imul(k | 0, 1442695041);
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177);
  n = (n ^ (n >>> 16)) >>> 0;
  return n / 4294967295;
}

function wrap(v, period) {
  if (period <= 0) return v;
  v %= period;
  return v < 0 ? v + period : v;
}

export function vnoise2(x, y, period = 0) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = ihash(wrap(ix, period), wrap(iy, period));
  const b = ihash(wrap(ix + 1, period), wrap(iy, period));
  const c = ihash(wrap(ix, period), wrap(iy + 1, period));
  const d = ihash(wrap(ix + 1, period), wrap(iy + 1, period));
  return a * (1 - ux) * (1 - uy) + b * ux * (1 - uy) + c * (1 - ux) * uy + d * ux * uy;
}

export function fbm2(x, y, octaves = 4, period = 0, gain = 0.5, lac = 2.0) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise2(x * freq, y * freq, period > 0 ? period * freq : 0);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}

export function vnoise3(x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy), uz = fz * fz * (3 - 2 * fz);
  const c000 = ihash(ix, iy, iz),     c100 = ihash(ix + 1, iy, iz);
  const c010 = ihash(ix, iy + 1, iz), c110 = ihash(ix + 1, iy + 1, iz);
  const c001 = ihash(ix, iy, iz + 1), c101 = ihash(ix + 1, iy, iz + 1);
  const c011 = ihash(ix, iy + 1, iz + 1), c111 = ihash(ix + 1, iy + 1, iz + 1);
  const x00 = c000 + (c100 - c000) * ux, x10 = c010 + (c110 - c010) * ux;
  const x01 = c001 + (c101 - c001) * ux, x11 = c011 + (c111 - c011) * ux;
  const y0 = x00 + (x10 - x00) * uy, y1 = x01 + (x11 - x01) * uy;
  return y0 + (y1 - y0) * uz;
}

export function fbm3(x, y, z, octaves = 4, gain = 0.5, lac = 2.0) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * vnoise3(x * freq, y * freq, z * freq);
    norm += amp;
    amp *= gain;
    freq *= lac;
  }
  return sum / norm;
}
