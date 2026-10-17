// The developer pages (/dev/sound, /dev/photo, /dev/demo, /ui-kit) are in English or write demo data into the database.
// They are routed only in development and in the test build (the end-to-end tests drive them), never in the build that
// goes to the phone: vite.config.ts sets __DEV_ROUTES__ when E2E_PORT or BIRDDEX_DEV_ROUTES is set.

export const DEV_ROUTES_ENABLED: boolean = import.meta.env.DEV || __DEV_ROUTES__
