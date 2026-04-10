/**
 * Next.js instrumentation hook — stable in Next.js 15, no config flag needed.
 * Executes once when the server process starts.
 * https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run the full validation in the Node.js runtime, not the Edge runtime
  // (Edge runtime does not have Buffer, crypto, etc.)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { validateStartup } = await import('./lib/startup/validate');
    await validateStartup();
  }
}
