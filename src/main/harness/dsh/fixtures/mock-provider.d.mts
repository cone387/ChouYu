export function startMockProvider(provider: 'openai' | 'claude', options?:{tools?:boolean;holdText?:string}): Promise<{
  baseUrl: string; requests: Array<{path:string; headers:Record<string,string>; body:any}>; close():Promise<void>
}>
