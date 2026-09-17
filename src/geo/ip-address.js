import { BlockList, isIP } from 'node:net';

/**
 * IP parsing to 16-byte form and classification of special ranges. IPv4 is mapped into IPv6 as
 * ::ffff:a.b.c.d for classification and as ::a.b.c.d (the first 96 bits zero) for MMDB trees.
 */
export class IpAddress {
  /** @type {readonly ['private', 'loopback', 'link-local', 'multicast', 'reserved', 'unspecified']} */
  static KINDS = ['private', 'loopback', 'link-local', 'multicast', 'reserved', 'unspecified'];

  static #lists = IpAddress.#buildLists();

  static #buildLists() {
    /** @type {Record<string, [string, number, 'ipv4'|'ipv6'][]>} */
    const spec = {
      unspecified: [['0.0.0.0', 8, 'ipv4'], ['::', 128, 'ipv6']],
      loopback: [['127.0.0.0', 8, 'ipv4'], ['::1', 128, 'ipv6']],
      private: [['10.0.0.0', 8, 'ipv4'], ['172.16.0.0', 12, 'ipv4'], ['192.168.0.0', 16, 'ipv4'], ['100.64.0.0', 10, 'ipv4'], ['fc00::', 7, 'ipv6']],
      'link-local': [['169.254.0.0', 16, 'ipv4'], ['fe80::', 10, 'ipv6']],
      multicast: [['224.0.0.0', 4, 'ipv4'], ['ff00::', 8, 'ipv6']],
      reserved: [['192.0.0.0', 24, 'ipv4'], ['192.0.2.0', 24, 'ipv4'], ['198.18.0.0', 15, 'ipv4'], ['198.51.100.0', 24, 'ipv4'], ['203.0.113.0', 24, 'ipv4'], ['240.0.0.0', 4, 'ipv4'], ['2001:db8::', 32, 'ipv6'], ['100::', 64, 'ipv6']],
    };
    return Object.fromEntries(Object.entries(spec).map(([kind, nets]) => {
      const list = new BlockList();
      for (const [addr, prefix, family] of nets) list.addSubnet(addr, prefix, family);
      return [kind, list];
    }));
  }

  /**
   * @param {string} text
   * @returns {{ version: 4|6, bytes: Uint8Array, text: string }|null} 16 bytes; IPv4 as ::a.b.c.d.
   */
  static parse(text) {
    const s = text.trim();
    const v = isIP(s);
    if (v === 4) {
      const parts = s.split('.').map(Number);
      const bytes = new Uint8Array(16);
      bytes.set(parts, 12);
      return { version: 4, bytes, text: s };
    }
    if (v !== 6) return null;
    let addr = s.includes('%') ? s.slice(0, s.indexOf('%')) : s;
    // Embedded IPv4 tail (::ffff:1.2.3.4): convert to two hextets.
    const m = addr.match(/^(.*:)(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (m) {
      const o = m.slice(2).map(Number);
      addr = `${m[1]}${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
    }
    const [head, tail = ''] = addr.split('::');
    const hi = head ? head.split(':') : [];
    const lo = tail ? tail.split(':') : [];
    if (!addr.includes('::') && hi.length !== 8) return null;
    const groups = [...hi, ...new Array(8 - hi.length - lo.length).fill('0'), ...lo];
    if (groups.length !== 8) return null;
    const bytes = new Uint8Array(16);
    groups.forEach((g, i) => { const n = parseInt(g, 16); bytes[i * 2] = n >> 8; bytes[i * 2 + 1] = n & 0xff; });
    const mapped = bytes.slice(0, 10).every((b) => b === 0) && bytes[10] === 0xff && bytes[11] === 0xff;
    if (mapped) { const b4 = new Uint8Array(16); b4.set(bytes.slice(12), 12); return { version: 4, bytes: b4, text: Array.from(bytes.slice(12)).join('.') }; }
    return { version: 6, bytes, text: IpAddress.format6(bytes) };
  }

  /** Canonical RFC 5952 text. @param {Uint8Array} bytes */
  static format6(bytes) {
    const groups = [];
    for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
    let best = { start: -1, len: 0 };
    for (let i = 0; i < 8; i++) {
      if (groups[i] !== '0') continue;
      let j = i;
      while (j < 8 && groups[j] === '0') j++;
      if (j - i > best.len) best = { start: i, len: j - i };
      i = j;
    }
    if (best.len < 2) return groups.join(':');
    const head = groups.slice(0, best.start).join(':');
    const tail = groups.slice(best.start + best.len).join(':');
    return `${head}::${tail}`;
  }

  /**
   * @param {{ version: 4|6, text: string }} ip
   * @returns {'public'|'private'|'loopback'|'link-local'|'multicast'|'reserved'|'unspecified'}
   */
  static classify(ip) {
    const family = ip.version === 4 ? 'ipv4' : 'ipv6';
    for (const kind of IpAddress.KINDS) if (IpAddress.#lists[kind].check(ip.text, family)) return kind;
    return 'public';
  }
}
