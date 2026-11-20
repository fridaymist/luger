// Typed access to the main process (see src/preload/index.ts).
declare global {
  interface Window {
    luger: {
      invoke: <T = any>(channel: string, ...args: unknown[]) => Promise<T>
      on: (event: string, fn: (payload: any) => void) => () => void
      pathForFile: (file: File) => string
      platform: string
    }
  }
}

export const invoke = <T = any>(channel: string, ...args: unknown[]): Promise<T> => window.luger.invoke<T>(channel, ...args)
export const on = (event: string, fn: (payload: any) => void) => window.luger.on(event, fn)
export const api = <T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> => invoke<T>('api', action, body)
export const platform = () => window.luger.platform
