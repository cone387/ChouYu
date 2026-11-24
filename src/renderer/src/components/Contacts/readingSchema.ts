import { z } from 'zod'

/** A2UI 0.16 inspects v3-style metadata. Expose only our closed catalog's types;
 * parsing and constraints remain entirely in patched Zod 4's _zod runtime. */
export function readingSchema<T extends z.ZodType>(schema: T): T {
  const def = schema._zod.def
  const reflected: Record<string, unknown> = { typeName: `Zod${def.type[0].toUpperCase()}${def.type.slice(1)}` }
  if (schema instanceof z.ZodObject) {
    for (const field of Object.values(schema.shape)) readingSchema(field as z.ZodType)
    Object.assign(reflected, { shape: () => schema.shape, unknownKeys: 'strip' })
  } else if (schema instanceof z.ZodArray) {
    if (!(schema.element instanceof z.ZodType)) throw new Error('Unsupported reading array element')
    reflected.type = readingSchema(schema.element)
  } else if (schema instanceof z.ZodEnum) {
    reflected.values = schema.options
  } else if (!(schema instanceof z.ZodString || schema instanceof z.ZodNumber)) {
    throw new Error(`Unsupported reading schema type: ${def.type}`)
  }
  Object.defineProperty(schema, '_def', { value: reflected, configurable: true })
  return schema
}
