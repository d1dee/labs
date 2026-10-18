import { $fetch, throwOnError } from './client';

export async function wakeDevice(id: string) {
    return throwOnError(
        await $fetch<{ success: boolean; message: string }>(`/api/devices/${id}/wake`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: {},
        }),
        'Failed to send wake packet',
    );
}
