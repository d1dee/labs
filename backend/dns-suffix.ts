/** Qualify only short DNS names; explicit FQDNs and address literals stay intact. */
export function qualifyFogHostname(hostname: string, suffix?: string | null): string {
    const name = hostname.trim();
    const domain = suffix?.trim().replace(/^\.+|\.+$/g, '') ?? '';
    if (!domain || !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(name)) return name;
    const qualified = `${name}.${domain}`;
    return qualified.length <= 253 ? qualified : name;
}
