export function startMockProvider(provider: 'openai' | 'claude', options?:{tools?:boolean|'always';text?:string;holdText?:string;omitUsage?:boolean;truncated?:boolean;failure?:{status:number;message:string}}): Promise<{
  baseUrl: string; requests: Array<{path:string; headers:Record<string,string>; body:any}>; close():Promise<void>
}>
