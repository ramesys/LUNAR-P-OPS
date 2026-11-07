/** Refuse to run browser fixtures against the normal development stack. */
export default async function globalSetup(): Promise<void> {
  const response: Response = await fetch("http://127.0.0.1:15180/e2e-isolated.txt").catch((): never => {
    throw new Error("Isolated E2E stack unavailable. Start it with make e2e-up.");
  });
  if (!response.ok || !(await response.text()).startsWith("LUNAR-OPS isolated E2E stack;")) {
    throw new Error("E2E isolation marker missing. Start the isolated stack with make e2e-up.");
  }
}
