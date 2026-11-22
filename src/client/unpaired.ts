/**
 * Whether the server refused a request because this browser has no valid
 * device cookie (403 `unpaired`). A 403 for a foreign Host or Origin is not
 * that: pairing again would not fix it.
 */
export async function isUnpaired(res: Response) {
	if (res.status !== 403) return false;
	const body = (await res
		.clone()
		.json()
		.catch(() => null)) as { error?: { code?: string } } | null;
	return body?.error?.code === "unpaired";
}
