export function createWarnAndContinuePersist<T>(
  writer: (value: T) => Promise<void>,
  message: string,
  warn: (message: string, err: unknown) => void = (m, e) => {
    console.warn(m, e)
  },
): (value: T) => void {
  return (value: T): void => {
    void writer(value).catch((err) => {
      warn(message, err)
    })
  }
}
