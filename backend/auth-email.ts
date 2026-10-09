export function requireAuthEmailConfig(): void {
    if (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM_EMAIL) {
        throw new Error('Configure RESEND_API_KEY and RESEND_FROM_EMAIL to send authentication emails.');
    }
}

export async function sendAuthEmail(to: string, subject: string, text: string): Promise<void> {
    requireAuthEmailConfig();
    const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ from: process.env.RESEND_FROM_EMAIL, to: [to], subject, text }),
        signal: AbortSignal.timeout(10_000),
        // Router self-signed TLS settings must never weaken email API transport.
        tls: { rejectUnauthorized: true },
    } as RequestInit & { tls: { rejectUnauthorized: boolean } });
    if (!response.ok) {
        // Do not log the response body: it can contain addresses or token URLs.
        throw new Error(`Resend authentication email delivery failed (${response.status}).`);
    }
}
