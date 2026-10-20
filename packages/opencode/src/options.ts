export type Options = {
  tasks: boolean
  ship: boolean
  prPanel: boolean
  models: Record<string, string>
}

export function options(input: Record<string, unknown>): Options {
  for (const key of ['tasks', 'ship', 'prPanel']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new Error(`${key} must be a boolean`)
  }
  const models = input.models ?? {}
  if (!models || typeof models !== 'object' || Array.isArray(models) ||
      Object.values(models).some(value => typeof value !== 'string' || !value.includes('/'))) {
    throw new Error('models must map reviewer/scout names to provider/model[#variant] strings')
  }
  return {
    tasks: input.tasks !== false,
    ship: input.ship !== false,
    prPanel: input.prPanel !== false,
    models: models as Record<string, string>,
  }
}
