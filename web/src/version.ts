/** Which build this is. The number comes from web/package.json and the commit from git, both put in by vite at build time (see vite.config.ts);
 *  without them (tests, odd tooling) the placeholders below show. */
declare const __APP_VERSION__: string | undefined;
declare const __APP_COMMIT__: string | undefined;
export const VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
export const COMMIT: string = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : '';
export const versionLabel = (): string => `Version ${VERSION}${COMMIT ? ` (${COMMIT})` : ''}`;
