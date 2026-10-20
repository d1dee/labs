import { defineConfig } from 'drizzle-kit';
export default defineConfig({
    schema: './db/index.ts',
    out: './drizzle',
    dialect: 'sqlite',
    dbCredentials: {
        url: './teachers.db',
    },
    verbose: true,
    strict: true,
});
