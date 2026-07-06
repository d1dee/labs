import { createFetch } from '@better-fetch/fetch';

export const $fetch = createFetch({
    credentials: 'include',
});

interface ApiError {
    error?: string;
    code?: string;
    status: number;
    statusText: string;
}

export async function throwOnError<T>(
    res: { data: T | null; error: ApiError | null },
    fallback: string,
): Promise<T> {
    if (res.error) {
        const err = new Error(res.error.error || fallback);
        (err as any).code = res.error.code;
        throw err;
    }
    return res.data as T;
}
