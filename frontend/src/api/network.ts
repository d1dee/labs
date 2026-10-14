export function ipv4Number(address: string): number | null {
    const parts = address.split('.');
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
    return parts.reduce((value, part) => value * 256 + Number(part), 0);
}

export function ipv4Range(value: string): [number, number] | null {
    const range = value.trim();
    if (range.includes('-')) {
        const [first, last, extra] = range.split('-').map((part) => part.trim());
        const start = ipv4Number(first ?? '');
        const end = ipv4Number(last ?? '');
        return extra === undefined && start !== null && end !== null && start <= end ? [start, end] : null;
    }
    const [network, prefix = '32', extra] = range.split('/');
    const base = ipv4Number(network ?? '');
    if (extra !== undefined || base === null || !/^\d{1,2}$/.test(prefix) || Number(prefix) > 32) return null;
    const mask = Number(prefix) === 0 ? 0 : (0xffffffff << (32 - Number(prefix))) >>> 0;
    const start = (base & mask) >>> 0;
    return [start, start + 2 ** (32 - Number(prefix)) - 1];
}

export function addressInRange(address: string, range: string): boolean {
    const ip = ipv4Number(address);
    const bounds = ipv4Range(range);
    return ip !== null && bounds !== null && ip >= bounds[0] && ip <= bounds[1];
}
