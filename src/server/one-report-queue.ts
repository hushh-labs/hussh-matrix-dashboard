/** Reserve the operator's deadline-bound platform capture before general fanout. */
export async function prepareOperatorPlatform<T extends { error: string | null }>(operator: boolean, capture: () => Promise<T>): Promise<T | null> {
  if (!operator) return null;
  const result = await capture();
  if (result.error) throw new Error('The One platform capture is unavailable.');
  return result;
}
