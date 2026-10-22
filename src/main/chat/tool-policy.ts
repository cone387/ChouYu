import { getState } from '../database'

export function isToolEnabled(name: string): boolean { return getState(`tool:${name}:enabled`) !== 'false' }
