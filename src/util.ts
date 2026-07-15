/** Format a millisecond duration as HH:MM:SS (clamped at zero) */
export function formatDuration(durationMs: number): string {
	const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
	const hours = Math.floor(totalSeconds / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const seconds = totalSeconds % 60
	return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':')
}

/** Streamlabs status events may carry the raw status string or a partial model */
export function extractStatus(data: unknown, modelKey: string): string | null {
	if (typeof data === 'string') return data
	if (typeof data === 'object' && data !== null) {
		const value = (data as Record<string, unknown>)[modelKey]
		if (typeof value === 'string') return value
	}
	return null
}
