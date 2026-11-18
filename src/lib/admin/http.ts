// Web APIs only, so the browser can import this too (AdminApp does, for messageOf).

// The JSON `{ error }` answer every admin route gives for a refusal or a failure.
export const reply = (status: number, error: string) => Response.json({ error }, { status });

export const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
