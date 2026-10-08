import { Hono } from 'hono';
import { auth } from '../auth';
import { organization } from '../../db/schema';
import type { StreamIdentity } from './stream';

export type Organization = typeof organization.$inferSelect;

export type AppEnv = {
    Bindings: { streamIdentity?: StreamIdentity };
    Variables: {
        user:
            | (typeof auth.$Infer.Session.user & {
                  organizationId?: string | null;
              })
            | null;
        session: typeof auth.$Infer.Session.session | null;
        organization: Organization | null;
    };
};

export const createApp = () => new Hono<AppEnv>();
