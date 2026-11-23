let waiting = 0;

export const blockingPaidCalls = () => waiting;

export async function duringBlockingPaidCall<T>(call: () => Promise<T>): Promise<T> {
  waiting++;
  try {
    return await call();
  } finally {
    waiting--;
  }
}
