declare module 'ioredis' {
  export default class Redis {
    constructor(url?: string)
    on(event: string, listener: (...args: unknown[]) => void): this
    get(key: string): Promise<string | null>
    set(key: string, value: string): Promise<string>
    publish(channel: string, message: string): Promise<number>
    subscribe(channel: string): Promise<number>
    quit(): Promise<void>
  }
}


