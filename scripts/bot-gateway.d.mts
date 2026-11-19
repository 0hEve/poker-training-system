export const binary: string;
export const port: number;
export function healthy(): Promise<boolean>;
export function build(): boolean;
export function ensureGateway(opts?: { quiet?: boolean }): Promise<{ started: boolean; stop(): void }>;
